import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { assessReliabilityRisk } from "../src/vehicle-intelligence/reliability-risk-assessment-policy";
import type { BuyerProfile } from "../types/buyer";
import type { VehicleReliabilityEvidenceSnapshot } from "../types/nhtsaReliabilityEvidence";
import type { ReliabilityInterpretation } from "../types/reliabilityInterpretation";
import type { Vehicle } from "../types/vehicle";

const root = process.cwd();
const interpretationPath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.reliability-interpretations.json");
const rawEvidencePath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.nhtsa-reliability-evidence.json");
const outputPath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.reliability-risk-assessments.json");
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const publishedPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const expectedVehicleIds = [
  "hyundai-accent-2017-craigslist-carstrucks-data",
  "toyota-prius-2016-usedcarscatalog",
  "toyota-rav4-2016-craigslist-carstrucks-data",
  "honda-cr-v-2016-craigslist-carstrucks-data",
  "nissan-leaf-2018-craigslist-carstrucks-data",
] as const;

async function main() {
  const interpretationSerialized = readFileSync(interpretationPath, "utf8");
  const rawEvidenceSerialized = readFileSync(rawEvidencePath, "utf8");
  const catalogSerialized = readFileSync(catalogPath, "utf8");
  const publishedSerialized = readFileSync(publishedPath, "utf8");
  const interpretationReport = JSON.parse(interpretationSerialized) as { interpretations: ReliabilityInterpretation[] };
  const evidenceReport = JSON.parse(rawEvidenceSerialized) as { snapshots: VehicleReliabilityEvidenceSnapshot[] };
  const catalog = JSON.parse(catalogSerialized) as Vehicle[];
  assert.deepEqual(interpretationReport.interpretations.map((item) => item.vehicleId), expectedVehicleIds);
  assert.deepEqual(evidenceReport.snapshots.map((item) => item.vehicle.vehicleId), expectedVehicleIds);

  const recommendationBefore = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  const identityByVehicle = new Map(evidenceReport.snapshots.map((snapshot) => [snapshot.vehicle.vehicleId, snapshot.vehicle]));
  const assessments = await Promise.all(interpretationReport.interpretations.map((interpretation) => {
    const vehicle = identityByVehicle.get(interpretation.vehicleId);
    assert.ok(vehicle, `Missing vehicle identity for ${interpretation.vehicleId}.`);
    return assessReliabilityRisk({ interpretation, vehicle });
  }));

  const results = assessments.map((assessment) => ({
    vehicle: `${assessment.vehicle.modelYear} ${assessment.vehicle.make} ${assessment.vehicle.model}`,
    vehicleId: assessment.vehicleId,
    primaryConcerns: assessment.primaryConcerns.map((concern) => ({
      component: concern.component,
      complaintCount: concern.complaintCount,
      recallCount: concern.recallCount,
      corroboration: concern.corroboration,
      seriousSignalPresent: concern.seriousSignalPresent,
      evidenceCount: concern.evidenceIds.length,
    })),
    corroboratedConcerns: assessment.corroboratedConcerns.map((concern) => concern.component),
    severity: {
      critical: assessment.seriousSignals.criticalCount,
      serious: assessment.seriousSignals.seriousCount,
      material: assessment.seriousSignals.materialCount,
      limited: assessment.seriousSignals.limitedCount,
      unknown: assessment.seriousSignals.unknownCount,
    },
    concernLevel: assessment.concernLevel,
    confidence: assessment.evidenceConfidence.level,
    applicability: assessment.applicability,
    exposureAvailability: assessment.exposureContext.providerResult.availability,
    keyLimitation: assessment.exposureContext.normalizedEvidence.limitations.at(-1) ?? assessment.limitations[0],
  }));

  assert.ok(assessments.every((assessment) => assessment.reliabilityScore === null));
  assert.ok(assessments.every((assessment) => assessment.comparativeRank === null));
  assert.ok(assessments.every((assessment) => assessment.comparativeReliabilitySupported === false));
  assert.ok(assessments.every((assessment) => assessment.recommendationScoringEligible === false));
  assert.ok(assessments.every((assessment) => assessment.productionRecommendationConnected === false));
  assert.ok(assessments.every((assessment) => assessment.exposureContext.normalizedEvidence.complaintRecordsPerThousandVehicles === null));
  assert.equal(readFileSync(interpretationPath, "utf8"), interpretationSerialized);
  assert.equal(readFileSync(rawEvidencePath, "utf8"), rawEvidenceSerialized);
  assert.equal(readFileSync(catalogPath, "utf8"), catalogSerialized);
  assert.equal(readFileSync(publishedPath, "utf8"), publishedSerialized);
  const recommendationAfter = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  assert.equal(recommendationAfter, recommendationBefore);

  writeFileSync(outputPath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    sourceInterpretationPath: interpretationPath,
    comparativeRankingCreated: false,
    reliabilityScoreCreated: false,
    productionRecommendationConnected: false,
    vehiclesRankedAgainstEachOther: false,
    results,
    assessments,
  }, null, 2)}\n`, { mode: 0o600 });

  console.log(JSON.stringify({ outputPath, vehiclesRankedAgainstEachOther: false, results }, null, 2));
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
