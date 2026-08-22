import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CanonicalDatum,
  CanonicalEvidence,
  CanonicalUnit,
  CanonicalVehicleRecord,
} from "../types/canonicalVehicle";
import type {
  DemoIntelligenceSource,
  DemoTrustedVehicleFact,
  DemoVehicleIntelligenceRecord,
  DemoVehicleIntelligenceSnapshot,
} from "../types/demoVehicleIntelligence";
import type { PublishedCVRRepositoryState } from "../types/publishedVehicleIntelligence";
import type { ReliabilityRiskAssessment } from "../types/reliabilityRiskAssessment";
import type { NhtsaSafetyRecord } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-client";

const root = process.cwd();
const repositoryPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const manifestPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.manifest.json");
const safetyPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.nhtsa-safety-report.json");
const reliabilityPath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.reliability-risk-assessments.json");
const outputPath = join(root, "data/demo/goldenVehicleIntelligence.v1.json");

const expectedVehicleIds = [
  "hyundai-accent-2017-craigslist-carstrucks-data",
  "toyota-prius-2016-usedcarscatalog",
  "toyota-rav4-2016-craigslist-carstrucks-data",
  "honda-cr-v-2016-craigslist-carstrucks-data",
  "nissan-leaf-2018-craigslist-carstrucks-data",
] as const;

type GoldenManifest = Readonly<{
  goldenDatasetVersion: string;
  vehicles: readonly Readonly<{ vehicleId: string; displayName: string }>[];
}>;

type SafetyReport = Readonly<{
  runAt: string;
  sourceResults: readonly Readonly<{
    vehicleId: string;
    expectedVehicleId: number;
    sourceState: "RATED" | "NOT_RATED";
    match: Readonly<{ confidence: number }> | null;
    record: NhtsaSafetyRecord | null;
  }>[];
}>;

type ReliabilityReport = Readonly<{
  generatedAt: string;
  assessments: readonly ReliabilityRiskAssessment[];
}>;

const trustedFieldSpecs = [
  ["identity", "bodyStyle", "bodyStyle"],
  ["identity", "vehicleCategory", "vehicleCategory"],
  ["identity", "drivetrain", "drivetrain"],
  ["identity", "transmission", "transmission"],
  ["identity", "fuelType", "fuelType"],
  ["environment", "fuelEconomy", "fuelEconomy"],
  ["environment", "emissions", "emissions"],
  ["environment", "evRange", "evRange"],
  ["environment", "chargingSpeed", "chargingSpeed"],
] as const;

function main() {
  const repository = readJson<PublishedCVRRepositoryState>(repositoryPath);
  const manifest = readJson<GoldenManifest>(manifestPath);
  const safetyReport = readJson<SafetyReport>(safetyPath);
  const reliabilityReport = readJson<ReliabilityReport>(reliabilityPath);
  const activePublications = repository.publications.filter((publication) => publication.publicationStatus === "active");
  assert.equal(activePublications.length, expectedVehicleIds.length, "Golden repository must contain exactly five active publications.");

  const records = expectedVehicleIds.map((vehicleId) => {
    const publication = activePublications.find((candidate) => candidate.vehicleId === vehicleId);
    const manifestVehicle = manifest.vehicles.find((candidate) => candidate.vehicleId === vehicleId);
    const safety = safetyReport.sourceResults.find((candidate) => candidate.vehicleId === vehicleId);
    const reliability = reliabilityReport.assessments.find((candidate) => candidate.vehicleId === vehicleId);
    assert.ok(publication, `Missing active publication for ${vehicleId}.`);
    assert.ok(manifestVehicle, `Missing golden manifest entry for ${vehicleId}.`);
    assert.ok(safety?.record && safety.match, `Missing reviewed NHTSA safety result for ${vehicleId}.`);
    assert.ok(reliability, `Missing reliability risk assessment for ${vehicleId}.`);

    const record: DemoVehicleIntelligenceRecord = {
      vehicleId,
      displayName: manifestVehicle.displayName,
      publication: {
        publicationId: publication.publicationId,
        recordVersion: publication.recordVersion,
        publishedAt: publication.publishedAt,
      },
      trustedFacts: extractTrustedFacts(publication.canonicalRecord),
      safety: {
        ratingState: safety.record.ratingState,
        sourceVehicleId: String(safety.expectedVehicleId),
        vehicleDescription: safety.record.vehicleDescription,
        matchConfidence: safety.match.confidence,
        ratings: {
          overall: safety.record.ratings.overall,
          frontCrash: safety.record.ratings.overallFrontCrash,
          sideCrash: safety.record.ratings.overallSideCrash,
          rollover: safety.record.ratings.rollover,
          rolloverPossibilityRatio: safety.record.ratings.rolloverPossibilityRatio,
        },
        technology: { ...safety.record.safetyTechnology },
        source: {
          providerName: "NHTSA Safety Ratings / NCAP",
          sourceRecordId: String(safety.expectedVehicleId),
          sourceUrl: `https://api.nhtsa.gov/SafetyRatings/VehicleId/${safety.expectedVehicleId}?format=json`,
          retrievedAt: safetyReport.runAt,
        },
      },
      reliability: {
        assessmentId: reliability.assessmentId,
        sourceInterpretationId: reliability.sourceInterpretationId,
        concernLevel: reliability.concernLevel,
        primaryConcerns: reliability.primaryConcerns.map((concern) => ({
          component: concern.component,
          corroboration: concern.corroboration,
          confidence: concern.confidence.level.toLowerCase() as "high" | "medium" | "low" | "unknown",
          evidenceCount: concern.evidenceIds.length,
        })),
        evidenceConfidence: reliability.evidenceConfidence.level.toLowerCase() as "high" | "medium" | "low" | "unknown",
        applicabilityScope: "model_year",
        applicabilityConfidence: reliability.applicability.confidence,
        exposureAvailability: reliability.exposureContext.normalizedEvidence.availability,
        exposureLimitation: reliability.exposureContext.normalizedEvidence.limitations.at(-1)
          ?? "Vehicle-population exposure is unavailable, so no comparative failure rate is produced.",
        comparativeReliabilitySupported: false,
        recommendationScoringEligible: false,
        source: {
          providerName: "NHTSA recalls and complaints",
          sourceRecordId: reliability.sourceInterpretationId,
          sourceUrl: "https://www.nhtsa.gov/recalls",
          retrievedAt: reliability.generatedAt,
        },
      },
    };
    return record;
  });

  const snapshot: DemoVehicleIntelligenceSnapshot = {
    schemaVersion: "1.0.0",
    snapshotId: `demo-vehicle-intelligence:${manifest.goldenDatasetVersion}:${repository.updatedAt}`,
    goldenDatasetVersion: manifest.goldenDatasetVersion,
    generatedAt: latestTimestamp(repository.updatedAt, safetyReport.runAt, reliabilityReport.generatedAt),
    recommendationRuntimeConnected: false,
    sourceVersions: {
      publishedRepositoryId: repository.repositoryId,
      publishedRepositoryUpdatedAt: repository.updatedAt,
      safetySnapshotAt: safetyReport.runAt,
      reliabilityPolicyVersion: reliabilityReport.assessments[0]?.policyVersion ?? "unknown",
    },
    vehicles: records,
  };

  assert.equal(snapshot.vehicles.length, 5);
  assert.ok(snapshot.vehicles.every((vehicle) => vehicle.reliability.comparativeReliabilitySupported === false));
  assert.ok(!JSON.stringify(snapshot).includes("reliabilityScore"));
  assert.ok(!JSON.stringify(snapshot).includes(root));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Generated ${snapshot.vehicles.length} deployable golden intelligence records at ${outputPath}.`);
}

function extractTrustedFacts(record: CanonicalVehicleRecord): DemoTrustedVehicleFact[] {
  return trustedFieldSpecs.flatMap(([section, key, field]) => {
    const sectionRecord = record[section] as unknown as Record<string, CanonicalDatum<unknown, CanonicalUnit>>;
    const datum = sectionRecord[key];
    if (!["verified", "sourced"].includes(datum.status)) return [];
    if (typeof datum.value !== "string" && typeof datum.value !== "number") return [];
    return [{
      field,
      value: datum.value,
      unit: datum.unit,
      confidence: datum.confidence.level,
      evidenceIds: [...datum.evidenceIds],
      sources: sourcesForEvidence(record.evidence, datum.evidenceIds),
    } satisfies DemoTrustedVehicleFact];
  });
}

function sourcesForEvidence(evidence: readonly CanonicalEvidence[], evidenceIds: readonly string[]) {
  const ids = new Set(evidenceIds);
  const sources = evidence
    .filter((item) => ids.has(item.evidenceId) && item.sourceRecordId && item.sourceUrl)
    .map((item): DemoIntelligenceSource => ({
      providerName: item.providerName,
      sourceRecordId: item.sourceRecordId!,
      sourceUrl: item.sourceUrl!,
      retrievedAt: item.retrievedAt,
    }));
  return uniqueSources(sources);
}

function uniqueSources(sources: readonly DemoIntelligenceSource[]) {
  return [...new Map(sources.map((source) => [`${source.providerName}:${source.sourceRecordId}`, source])).values()];
}

function latestTimestamp(...values: string[]) {
  return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

main();
