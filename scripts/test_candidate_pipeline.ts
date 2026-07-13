import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { CandidatePipelineDebug, Vehicle } from "../types/vehicle";

const vehicleCatalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 18000,
  monthlyBudget: 650,
  downPayment: 2000,
  loanTermMonths: 60,
  apr: 8.5,
  paymentMethod: "not-sure",
  purchaseCondition: "any",
  expectedAnnualMileage: 9000,
  fuelPrice: 4.25,
  insuranceBudget: 145,
  minYear: 2014,
  maxMileage: 110000,
  minMpg: 24,
  fuelEconomyImportance: 3,
  reliabilityImportance: 4,
  performanceImportance: 2,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "not-sure",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "not-sure",
  scoreWeights: defaultScoreWeights,
};

const benchmarkProfiles: Record<string, BuyerProfile> = {
  A: {
    ...baseProfile,
    maxPurchaseBudget: 12000,
    purchaseCondition: "used",
    expectedAnnualMileage: 12000,
    climate: "mild",
    reliabilityImportance: 5,
    reliabilityMinimum: 75,
    safetyPriority: "high",
    performanceImportance: 1,
  },
  B: {
    ...baseProfile,
    maxPurchaseBudget: 25000,
    bodyStyle: "suv",
    climate: "snow",
    drivetrainPreference: "AWD",
    familySize: 4,
    cargoNeed: "high",
    safetyPriority: "maximum",
    scoreWeights: weights({
      safety: 25,
      practicality: 20,
      reliability: 15,
      affordability: 15,
      maintenanceRisk: 10,
      insuranceCost: 5,
      fuelEnergyCost: 5,
      resaleValue: 5,
      drivingPreferenceFit: 0,
    }),
  },
  C: {
    ...baseProfile,
    maxPurchaseBudget: 13000,
    purchaseCondition: "used",
    requiredMake: "BMW",
    minMpg: 20,
    performanceImportance: 5,
    reliabilityImportance: 4,
    scoreWeights: weights({
      drivingPreferenceFit: 25,
      reliability: 20,
      maintenanceRisk: 20,
      affordability: 15,
      safety: 8,
      insuranceCost: 5,
      fuelEnergyCost: 3,
      practicality: 2,
      resaleValue: 2,
    }),
  },
  D: {
    ...baseProfile,
    maxPurchaseBudget: 13000,
    purchaseCondition: "used",
    preferredMake: "BMW",
    minMpg: 20,
    performanceImportance: 5,
    reliabilityImportance: 4,
  },
  E: {
    ...baseProfile,
    maxPurchaseBudget: 8000,
    monthlyBudget: 260,
    downPayment: 500,
    bodyStyle: "suv",
    drivetrainPreference: "AWD",
    climate: "snow",
    purchaseCondition: "new",
    familySize: 5,
    cargoNeed: "high",
    safetyPriority: "maximum",
    safetyMinimum: 95,
    transmissionPreference: "manual",
  },
  F: {
    ...baseProfile,
    maxPurchaseBudget: 13000,
    purchaseCondition: "used",
    requiredMake: "BMW",
    flexibleConstraints: ["make"],
    allowCompromises: true,
    minMpg: 20,
    performanceImportance: 5,
    reliabilityImportance: 4,
  },
};

Object.entries(benchmarkProfiles).forEach(([name, profile]) => {
  const result = runCandidatePipeline(profile, vehicleCatalog, { includeCompromises: true, includeExcluded: true });
  const debug = result.pipelineDebug;

  assertPipelineDebug(debug);
  assert.equal(debug.candidateCount, result.decisionSet.noMatch.totalEvaluated, `Profile ${name} candidate count should match evaluated total`);
  assert.equal(debug.filteredCount, debug.qualifiedCount + debug.compromiseCount, `Profile ${name} filtered count should equal qualified plus compromise`);
  assert.equal(debug.excludedCount, result.decisionSet.excludedRecommendations.length, `Profile ${name} excluded count should match decision set`);
  assert.equal(debug.qualifiedCount, result.decisionSet.primaryRecommendations.length, `Profile ${name} qualified count should match decision set`);
  assert.equal(debug.compromiseCount, result.decisionSet.compromiseRecommendations.length, `Profile ${name} compromise count should match decision set`);
  assert.equal(debug.topFive.length, Math.min(5, debug.qualifiedCount || debug.compromiseCount), `Profile ${name} top-five count should be bounded`);
  assert.equal(debug.runnerUpLossReasons.length, Math.max(0, debug.topFive.length - 1), `Profile ${name} should explain every top-five runner-up`);
  debug.runnerUpLossReasons.forEach((loss) => {
    assert.ok(loss.primaryReason.length > 20, `Profile ${name} runner-up loss reason should be meaningful`);
    assert.ok(loss.scoreGap >= 0, `Profile ${name} score gap should not be negative`);
  });

  if (name === "A") {
    assert.ok(result.decisionSet.primaryRecommendations[0]?.vehicle.reliabilityScore >= 75, "Profile A top result should respect reliability minimum");
  }
  if (name === "B") {
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "suv"));
    assert.ok(
      result.decisionSet.primaryRecommendations.every(
        (recommendation) => recommendation.vehicle.drivetrain === "AWD" || recommendation.vehicle.drivetrain === "4WD",
      ),
    );
  }
  if (name === "C") {
    assert.equal(debug.qualifiedCount, 0, "Profile C should have no qualified BMW matches");
    assert.equal(debug.topFive.length, 0, "Profile C should not fabricate top-five recommendations");
  }
});

console.log("Candidate pipeline contract passed.");
console.log("Candidate pipeline benchmark report:");
Object.entries(benchmarkProfiles).forEach(([name, profile]) => {
  const result = runCandidatePipeline(profile, vehicleCatalog, { includeCompromises: true, includeExcluded: true });
  console.log(formatPipelineBenchmark(name, result.pipelineDebug));
});

function assertPipelineDebug(debug: CandidatePipelineDebug) {
  assert.ok(debug.catalogCount >= debug.candidateCount);
  assert.equal(debug.candidateCount, debug.filteredCount + debug.excludedCount);
  assert.equal(debug.advisorLayerSource, "recommendation_object");
  assert.deepEqual(
    debug.stages.map((stage) => stage.stage),
    ["loadCatalog", "candidateGeneration", "constraintFiltering", "suitabilityEvaluation", "ranking", "recommendationObject", "advisorLayer"],
  );
}

function formatPipelineBenchmark(name: string, debug: CandidatePipelineDebug) {
  const topFive = debug.topFive.length
    ? debug.topFive
        .map((vehicle) => `#${vehicle.rank} ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.overallMatchScore})`)
        .join(", ")
    : "none";
  const runnerUps = debug.runnerUpLossReasons.length
    ? debug.runnerUpLossReasons.map((loss) => `#${loss.rank}: ${loss.primaryReason}`).join(" | ")
    : "none";

  return [
    `Profile ${name}`,
    `candidate ${debug.candidateCount}`,
    `filtered ${debug.filteredCount}`,
    `excluded ${debug.excludedCount}`,
    `qualified ${debug.qualifiedCount}`,
    `top five ${topFive}`,
    `runner-up losses ${runnerUps}`,
  ].join("; ");
}

function weights(overrides: Partial<ScoreWeights>): ScoreWeights {
  return { ...defaultScoreWeights, ...overrides };
}
