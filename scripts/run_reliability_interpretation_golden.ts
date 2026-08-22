import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { interpretReliabilityEvidence } from "../src/vehicle-intelligence/reliability-evidence-interpretation-policy";
import type { BuyerProfile } from "../types/buyer";
import type { VehicleReliabilityEvidenceSnapshot } from "../types/nhtsaReliabilityEvidence";
import type { Vehicle } from "../types/vehicle";

const root = process.cwd();
const sourcePath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.nhtsa-reliability-evidence.json");
const outputPath = join(root, "data/vehicle-knowledge/repositories/golden-set-v1.reliability-interpretations.json");
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const sourceSerialized = readFileSync(sourcePath, "utf8");
const catalogSerialized = readFileSync(catalogPath, "utf8");
const sourceReport = JSON.parse(sourceSerialized) as { runAt: string; snapshots: VehicleReliabilityEvidenceSnapshot[] };
const catalog = JSON.parse(catalogSerialized) as Vehicle[];
const expectedVehicleIds = [
  "hyundai-accent-2017-craigslist-carstrucks-data",
  "toyota-prius-2016-usedcarscatalog",
  "toyota-rav4-2016-craigslist-carstrucks-data",
  "honda-cr-v-2016-craigslist-carstrucks-data",
  "nissan-leaf-2018-craigslist-carstrucks-data",
] as const;

function main() {
  assert.deepEqual(sourceReport.snapshots.map((snapshot) => snapshot.vehicle.vehicleId), expectedVehicleIds);
  const recommendationBefore = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  const interpretations = sourceReport.snapshots.map(interpretReliabilityEvidence);
  const comparison = interpretations.map((interpretation) => ({
    vehicleId: interpretation.vehicleId,
    evidenceCount: interpretation.issueClusters.reduce((ids, cluster) => {
      cluster.evidenceIds.forEach((id) => ids.add(id));
      return ids;
    }, new Set<string>()).size,
    mainIssueClusters: interpretation.issueClusters.slice(0, 5).map((cluster) => ({
      component: cluster.component,
      complaints: cluster.complaintCount,
      recalls: cluster.recallCount,
      seriousSignals: cluster.seriousSignalCount,
      corroboration: cluster.corroboration,
      confidence: cluster.confidence.level,
    })),
    seriousSignals: {
      critical: interpretation.seriousSignals.criticalCount,
      serious: interpretation.seriousSignals.seriousCount,
      material: interpretation.seriousSignals.materialCount,
      limited: interpretation.seriousSignals.limitedCount,
    },
    corroboration: interpretation.corroboration,
    exposureContext: interpretation.exposureContext,
    assessmentState: interpretation.assessmentState,
    confidence: interpretation.confidence,
    importantLimitations: interpretation.limitations,
  }));
  assert.ok(interpretations.every((interpretation) => interpretation.reliabilityScore === null));
  assert.ok(interpretations.every((interpretation) => interpretation.comparativeRank === null));
  assert.ok(interpretations.every((interpretation) => interpretation.productionRecommendationConnected === false));
  assert.equal(readFileSync(sourcePath, "utf8"), sourceSerialized, "Interpretation rewrote the retained raw evidence report.");
  assert.equal(readFileSync(catalogPath, "utf8"), catalogSerialized, "Interpretation changed the original catalog.");
  const recommendationAfter = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  assert.equal(recommendationAfter, recommendationBefore, "Interpretation changed recommendation output.");
  const report = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    sourceEvidenceReportRunAt: sourceReport.runAt,
    sourceEvidenceReportPath: sourcePath,
    originalEvidenceRewritten: false,
    originalCatalogMutated: false,
    reliabilityScoreCreated: false,
    comparativeRankingCreated: false,
    productionRecommendationConnected: false,
    comparison,
    interpretations,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ outputPath, comparison: comparison.map((item) => ({
    vehicleId: item.vehicleId,
    evidenceCount: item.evidenceCount,
    mainIssueClusters: item.mainIssueClusters,
    seriousSignals: item.seriousSignals,
    corroboration: item.corroboration.state,
    exposure: item.exposureContext.state,
    assessmentState: item.assessmentState,
    confidence: item.confidence.level,
  })) }, null, 2));
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

main();
