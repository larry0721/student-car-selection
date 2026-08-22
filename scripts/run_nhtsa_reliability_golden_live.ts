import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { loadPublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";
import { getNhtsaReliabilityEvidence } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-reliability-evidence";
import type { BuyerProfile } from "../types/buyer";
import type { CanonicalIdentitySection } from "../types/canonicalVehicle";
import type { VehicleDefectIdentity, VehicleReliabilityEvidenceSnapshot } from "../types/nhtsaReliabilityEvidence";
import type { Vehicle } from "../types/vehicle";

const root = process.cwd();
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const publishedPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const reportPath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.nhtsa-reliability-evidence.json");
const catalogSerialized = readFileSync(catalogPath, "utf8");
const publishedSerialized = readFileSync(publishedPath, "utf8");
const catalog = JSON.parse(catalogSerialized) as Vehicle[];
const publications = loadPublishedCVRRepository(publishedSerialized);
const runAt = new Date().toISOString();

const goldenVehicles = [
  { vehicleId: "hyundai-accent-2017-craigslist-carstrucks-data", label: "2017 Hyundai Accent" },
  { vehicleId: "toyota-prius-2016-usedcarscatalog", label: "2016 Toyota Prius" },
  { vehicleId: "toyota-rav4-2016-craigslist-carstrucks-data", label: "2016 Toyota RAV4" },
  { vehicleId: "honda-cr-v-2016-craigslist-carstrucks-data", label: "2016 Honda CR-V" },
  { vehicleId: "nissan-leaf-2018-craigslist-carstrucks-data", label: "2018 Nissan Leaf" },
] as const;

async function main() {
  const recommendationBefore = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  const snapshots: VehicleReliabilityEvidenceSnapshot[] = [];
  const summaries = [];

  for (const spec of goldenVehicles) {
    const publication = publications.getActivePublicationForVehicle(spec.vehicleId);
    assert.ok(publication, `Missing active golden publication for ${spec.vehicleId}.`);
    const identity = identityFromPublication(spec.vehicleId, publication.canonicalRecord.identity);
    const result = await getNhtsaReliabilityEvidence(identity, { generatedAt: runAt, dataUse: "production" });
    assert.equal(result.sourceErrors.length, 0, `${spec.label}: ${result.sourceErrors.map((item) => `${item.source}: ${item.error}`).join("; ")}`);
    const snapshot = result.snapshot;
    snapshots.push(snapshot);
    summaries.push({
      vehicleId: spec.vehicleId,
      label: spec.label,
      recalls: snapshot.recalls.length,
      complaints: snapshot.complaints.length,
      investigations: snapshot.investigations.state,
      manufacturerCommunications: snapshot.manufacturerCommunications.state,
      topComponents: snapshot.componentSummary.slice(0, 5).map((item) => ({ component: item.component, records: item.recordCount })),
      seriousSignals: snapshot.severitySummary,
      dateRange: snapshot.dateRange,
      evidenceCount: snapshot.evidence.length,
      evidenceIds: snapshot.evidence.map((item) => item.evidenceId),
      sourceScope: snapshot.sourceScopeSummary,
      coverage: snapshot.evidenceCoverage,
      limitations: snapshot.limitations,
    });
  }

  const recommendationAfter = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  assert.equal(recommendationAfter, recommendationBefore, "Live NHTSA reliability evidence collection changed recommendation output.");
  assert.equal(readFileSync(catalogPath, "utf8"), catalogSerialized, "Live NHTSA reliability evidence collection changed the original catalog.");
  assert.equal(readFileSync(publishedPath, "utf8"), publishedSerialized, "Live NHTSA reliability evidence collection changed published CVRs.");
  assert.ok(snapshots.every((snapshot) => snapshot.reliabilityScore === null));
  assert.ok(snapshots.every((snapshot) => snapshot.evidenceCoverage.reliabilityScoreSupported === false));

  const report = {
    schemaVersion: "1.0.0",
    runAt,
    source: "NHTSA Recalls and Consumer Complaints APIs",
    originalCatalogMutated: false,
    publishedCVRRepositoryMutated: false,
    productionRecommendationConnected: false,
    aggregateReliabilityScoreCreated: false,
    investigationsAcquisition: "UNSUPPORTED",
    manufacturerCommunicationsAcquisition: "UNSUPPORTED",
    summaries,
    snapshots,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    reportPath,
    runAt,
    summaries: summaries.map(({ evidenceIds: _evidenceIds, limitations: _limitations, ...summary }) => summary),
  }, null, 2));
}

function identityFromPublication(
  vehicleId: string,
  identity: CanonicalIdentitySection,
): VehicleDefectIdentity {
  const modelYear = identity.modelYear.value;
  const make = identity.make.value;
  const model = identity.model.value;
  assert.ok(modelYear !== null && make && model, `Golden CVR ${vehicleId} lacks required identity.`);
  return { vehicleId, modelYear, make, model: model.replace(/\s+(?:4WD|AWD|FWD|RWD)$/i, "").trim() };
}

function profile(): BuyerProfile {
  return {
    maxPurchaseBudget: 18000, monthlyBudget: 650, downPayment: 2000, loanTermMonths: 60, apr: 8,
    paymentMethod: "not-sure", purchaseCondition: "any", expectedAnnualMileage: 12000, fuelPrice: 4,
    insuranceBudget: 150, minYear: 2014, maxMileage: 140000, minMpg: 20, fuelEconomyImportance: 3,
    reliabilityImportance: 5, performanceImportance: 2, cargoNeed: "not-sure", familySize: 1,
    drivetrainPreference: "any", transmissionPreference: "any", bodyStyle: "any", climate: "not-sure",
    resaleValueImportance: 3, modificationPlans: "not-sure", advancedFeaturesImportance: 2,
    safetyPriority: "high", scoreWeights: { affordability: 25, reliability: 20, safety: 20, fuelEnergyCost: 10, insuranceCost: 10, maintenanceRisk: 5, practicality: 5, resaleValue: 3, drivingPreferenceFit: 2 },
  };
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
