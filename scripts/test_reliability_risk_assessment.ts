import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { interpretReliabilityEvidence } from "../src/vehicle-intelligence/reliability-evidence-interpretation-policy";
import { assessReliabilityRisk } from "../src/vehicle-intelligence/reliability-risk-assessment-policy";
import { createFixtureVehicleExposureProvider } from "../src/vehicle-intelligence/vehicle-exposure-provider";
import { buildVehicleReliabilityEvidenceSnapshot } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-reliability-evidence";
import type { BuyerProfile } from "../types/buyer";
import type {
  NhtsaComplaintLookupResult,
  NhtsaComplaintRecord,
  NhtsaRecallLookupResult,
  NhtsaRecallRecord,
} from "../types/nhtsaReliabilityEvidence";
import type { VehicleExposureRecord } from "../types/vehicleExposure";
import type { Vehicle } from "../types/vehicle";

const generatedAt = "2026-08-19T12:00:00.000Z";
const vehicle = { vehicleId: "risk-test-vehicle", modelYear: 2020, make: "Example", model: "Model" } as const;
const root = process.cwd();
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const publishedPaths = [
  join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json"),
  join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.manifest.json"),
] as const;

async function main() {
  const catalogSerialized = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(catalogSerialized) as Vehicle[];
  const publishedBefore = publishedPaths.map((path) => readFileSync(path, "utf8"));
  const recommendationBefore = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);

  const oneHundred = await assess(complaints(100, "ENGINE"), recalls([]));
  const threeHundred = await assess(complaints(300, "ENGINE"), recalls([]));
  assert.equal(oneHundred.concernLevel, "LIMITED_CONCERN");
  assert.equal(threeHundred.concernLevel, "LIMITED_CONCERN", "Raw complaint volume alone cannot escalate concern.");
  assert.notEqual(threeHundred.concernLevel, "ELEVATED_CONCERN");

  const corroborated = await assess(complaints(5, "SERVICE BRAKES"), recalls([recall("26V000001", "SERVICE BRAKES")]));
  assert.equal(corroborated.concernLevel, "MEANINGFUL_CONCERN");
  assert.equal(corroborated.primaryConcerns[0].corroboration, "COMPLAINT_PATTERN_WITH_RECALL");
  assert.ok(corroborated.explanationFacts.some((fact) => fact.kind === "CORROBORATED_BY_RECALL"));

  const serious = await assess(complaints(2, "ENGINE", { fireReported: true, injuries: 1 }), recalls([]));
  assert.equal(serious.seriousSignals.seriousCount, 2);
  assert.ok(serious.primaryConcerns[0].seriousSignalPresent);
  assert.ok(serious.explanationFacts.some((fact) => fact.kind === "SERIOUS_SIGNAL_PRESENT"));

  assert.equal(corroborated.exposureContext.providerResult.availability, "UNAVAILABLE");
  assert.equal(corroborated.exposureContext.normalizedEvidence.complaintRecordsPerThousandVehicles, null);
  assert.equal(corroborated.exposureContext.normalizedEvidence.denominatorValue, null);
  assert.equal(corroborated.comparativeReliabilitySupported, false);
  assert.equal(corroborated.comparativeRank, null);

  const fixtureProvider = createFixtureVehicleExposureProvider({
    dataUse: "test",
    providerId: "vehicle-exposure:test-fixture",
    fixtures: { [vehicle.vehicleId]: exposureRecord(1_000) },
  });
  const fixtureInterpretation = interpret(complaints(5, "ENGINE"), recalls([]));
  await assert.rejects(
    () => assessReliabilityRisk({ interpretation: fixtureInterpretation, vehicle, exposureProvider: fixtureProvider }),
    /allowTestExposureProvider=true/,
  );
  const fixtureAssessment = await assessReliabilityRisk({
    interpretation: fixtureInterpretation,
    vehicle,
    exposureProvider: fixtureProvider,
    allowTestExposureProvider: true,
  });
  assert.equal(fixtureAssessment.exposureContext.normalizedEvidence.availability, "AVAILABLE");
  assert.equal(fixtureAssessment.exposureContext.normalizedEvidence.complaintRecordsPerThousandVehicles, 5);
  assert.equal(fixtureAssessment.exposureContext.normalizedEvidence.comparativeReliabilitySupported, false);

  for (const assessment of [oneHundred, threeHundred, corroborated, serious, fixtureAssessment]) {
    assert.equal(assessment.reliabilityScore, null);
    assert.equal(assessment.recommendationScoringEligible, false);
    assert.equal(assessment.productionRecommendationConnected, false);
  }

  const noMeaningfulSignal = await assess(complaints(1, "UNKNOWN OR OTHER"), recalls([]));
  assert.equal(noMeaningfulSignal.concernLevel, "NO_MEANINGFUL_SIGNAL");
  assert.ok(noMeaningfulSignal.limitations.some((item) => /not comparative reliability grades/i.test(item)));
  assert.ok(noMeaningfulSignal.explanationFacts.some((fact) => fact.kind === "NO_MEANINGFUL_SIGNAL_IS_NOT_PERFECT_RELIABILITY"));

  assert.equal(corroborated.applicability.scope, "model_year");
  assert.equal(corroborated.applicability.configurationSpecific, false);
  assert.equal(corroborated.applicability.vinSpecific, false);

  const interpretationEvidence = new Set(interpret(complaints(5, "SERVICE BRAKES"), recalls([recall("26V000001", "SERVICE BRAKES")])).issueClusters.flatMap((cluster) => cluster.evidenceIds));
  for (const concern of corroborated.primaryConcerns) {
    assert.ok(concern.evidenceIds.length > 0);
    concern.evidenceIds.forEach((id) => assert.ok(interpretationEvidence.has(id), `Missing source lineage for ${id}.`));
  }
  for (const fact of corroborated.explanationFacts) {
    fact.evidenceIds.forEach((id) => assert.ok(interpretationEvidence.has(id), `Explanation fact invented evidence ${id}.`));
  }

  assert.equal(readFileSync(catalogPath, "utf8"), catalogSerialized, "Risk assessment changed the original catalog.");
  publishedPaths.forEach((path, index) => assert.equal(readFileSync(path, "utf8"), publishedBefore[index], "Risk assessment changed a published CVR artifact."));
  const recommendationAfter = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  assert.equal(recommendationAfter, recommendationBefore, "Risk assessment changed recommendation rankings.");

  const productionFiles = [...filesIn(join(root, "app")), ...filesIn(join(root, "components")), ...filesIn(join(root, "lib"))];
  const forbiddenImports = productionFiles.filter((path) => /reliability-risk-assessment-policy|vehicle-exposure-provider/.test(readFileSync(path, "utf8")));
  assert.deepEqual(forbiddenImports, [], "A production application module imported the future risk/exposure boundary.");

  assert.ok(fixtureProvider.providerKind === "fixture" && fixtureProvider.dataUse === "test");
  assert.equal(fixtureAssessment.primaryConcerns.length <= 3, true);
  assert.equal(Object.isFrozen(fixtureAssessment), true);

  console.log("Reliability risk assessment passed: 20 deterministic concern, exposure, lineage, isolation, and immutability checks.");
}

async function assess(complaintLookup: NhtsaComplaintLookupResult, recallLookup: NhtsaRecallLookupResult) {
  return assessReliabilityRisk({ interpretation: interpret(complaintLookup, recallLookup), vehicle });
}

function interpret(complaintLookup: NhtsaComplaintLookupResult, recallLookup: NhtsaRecallLookupResult) {
  return interpretReliabilityEvidence(buildVehicleReliabilityEvidenceSnapshot({
    vehicle,
    complaints: complaintLookup,
    recalls: recallLookup,
    generatedAt,
    dataUse: "test",
  }));
}

function complaints(
  count: number,
  component: string,
  severity: Partial<Pick<NhtsaComplaintRecord, "crashReported" | "fireReported" | "injuries" | "deaths">> = {},
): NhtsaComplaintLookupResult {
  const records = Array.from({ length: count }, (_, index) => complaint(String(20_000_000 + index), component, severity));
  return { state: records.length ? "COMPLAINT_RECORDS_FOUND" : "NO_COMPLAINT_RECORD_FOUND", records, sourceUrl: "https://api.nhtsa.gov/complaints/complaintsByVehicle" };
}

function complaint(
  odiNumber: string,
  component: string,
  severity: Partial<Pick<NhtsaComplaintRecord, "crashReported" | "fireReported" | "injuries" | "deaths">>,
): NhtsaComplaintRecord {
  return {
    odiNumber,
    manufacturer: "Example Manufacturer",
    incidentDate: "01/01/2026",
    complaintFiledDate: "01/02/2026",
    component,
    summary: "Consumer allegation retained for risk-assessment testing.",
    crashReported: severity.crashReported ?? false,
    fireReported: severity.fireReported ?? false,
    injuries: severity.injuries ?? 0,
    deaths: severity.deaths ?? 0,
    mileage: null,
    vehicleSpeed: null,
    modelYear: vehicle.modelYear,
    make: vehicle.make,
    model: vehicle.model,
    sourceUrl: "https://api.nhtsa.gov/complaints/odinumber",
    rawFields: { odiNumber, components: component },
  };
}

function recalls(records: NhtsaRecallRecord[]): NhtsaRecallLookupResult {
  return { state: records.length ? "RECALL_RECORDS_FOUND" : "NO_RECALL_RECORD_FOUND", records, sourceUrl: "https://api.nhtsa.gov/recalls/recallsByVehicle" };
}

function recall(campaignNumber: string, component: string): NhtsaRecallRecord {
  return {
    campaignNumber,
    manufacturer: "Example Manufacturer",
    component,
    summary: "Official safety recall.",
    consequence: "Safety consequence retained without inference.",
    remedy: "Remedy available.",
    notes: null,
    reportReceivedDate: "02/01/2026",
    modelYear: vehicle.modelYear,
    make: vehicle.make,
    model: vehicle.model,
    nhtsaActionNumber: null,
    parkIt: false,
    parkOutside: false,
    overTheAirUpdate: false,
    sourceUrl: "https://api.nhtsa.gov/recalls/campaignNumber",
    rawFields: { NHTSACampaignNumber: campaignNumber, Component: component },
  };
}

function exposureRecord(vehicleCount: number): VehicleExposureRecord {
  return {
    scope: "model_year",
    registeredVehicleCount: null,
    estimatedVehiclesInOperation: vehicleCount,
    annualMiles: { mean: 12_000, median: 11_500, unit: "miles_per_year" },
    lifetimeMileageDistribution: { p25: 35_000, median: 70_000, p75: 105_000, unit: "miles" },
    salesVolume: vehicleCount,
    geography: "US",
    observedAt: generatedAt,
    source: { providerName: "Controlled fixture", sourceRecordId: "fixture-1", sourceUrl: null, retrievedAt: generatedAt },
    confidence: { level: "HIGH", basis: ["Synthetic test fixture with a known denominator."] },
  };
}

function filesIn(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    if (statSync(child).isDirectory()) return filesIn(child);
    return /\.(ts|tsx)$/.test(name) ? [child] : [];
  });
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

void main();
