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
  truckRequired: {
    ...baseProfile,
    maxPurchaseBudget: 20000,
    bodyStyle: "truck",
    reliabilityImportance: 5,
  },
  truckFlexibleSuvFallback: {
    ...baseProfile,
    maxPurchaseBudget: 20000,
    bodyStyle: "truck",
    flexibleConstraints: ["bodyStyle"],
    allowCompromises: true,
    reliabilityImportance: 5,
  },
  sevenSeatSuv: {
    ...baseProfile,
    bodyStyle: "suv",
    familySize: 7,
  },
  hybridSedan: {
    ...baseProfile,
    bodyStyle: "sedan",
    requiredFuelType: "hybrid",
  },
  awdNoSubaru: {
    ...baseProfile,
    drivetrainPreference: "AWD",
    excludedMakes: ["Subaru"],
  },
  subaruSedan: {
    ...baseProfile,
    requiredMake: "Subaru",
    bodyStyle: "sedan",
  },
  inexpensiveReliableFirstCar: {
    ...baseProfile,
    maxPurchaseBudget: 18000,
    reliabilityImportance: 5,
    safetyPriority: "high",
  },
  impossiblePickup: {
    ...baseProfile,
    maxPurchaseBudget: 3000,
    minYear: 2024,
    bodyStyle: "truck",
  },
  toyotaRequired: {
    ...baseProfile,
    requiredMake: "Toyota",
  },
  lexusRequired: {
    ...baseProfile,
    requiredMake: "Lexus",
  },
  bmwRequired: {
    ...baseProfile,
    requiredMake: "BMW",
  },
  cadillacRequired: {
    ...baseProfile,
    requiredMake: "Cadillac",
  },
  toyotaPreferredHondaFallback: {
    ...baseProfile,
    preferredMake: "Toyota",
    allowedMakes: ["Toyota", "Honda"],
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
  if (name === "truckRequired") {
    assert.ok(debug.qualifiedCount > 0, "Truck profile should have qualified trucks in the current catalog");
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "truck"));
    assert.equal(
      result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.id === "subaru-legacy-2019-craigslist-carstrucks-data"),
      false,
      "Subaru Legacy must not qualify for an explicit truck request",
    );
    assert.ok(
      result.decisionSet.excludedRecommendations.some((recommendation) =>
        recommendation.vehicle.bodyType !== "truck" &&
        recommendation.hardConstraintResults.some((constraint) => constraint.code === "bodyStyle" && !constraint.passed),
      ),
      "Non-trucks should be excluded by the body-style constraint",
    );
  }
  if (name === "truckFlexibleSuvFallback") {
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "truck"));
    assert.ok(result.decisionSet.compromiseRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "suv"));
    assert.equal(
      [...result.decisionSet.primaryRecommendations, ...result.decisionSet.compromiseRecommendations].some(
        (recommendation) => recommendation.vehicle.bodyType === "sedan",
      ),
      false,
      "SUV fallback may permit SUVs, but never sedans",
    );
  }
  if (name === "sevenSeatSuv") {
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "suv"));
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.seats >= 7));
    assert.equal(result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.bodyType === "sedan"), false);
  }
  if (name === "hybridSedan") {
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "sedan"));
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.fuelType === "hybrid"));
    assert.equal(
      result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.id === "subaru-legacy-2019-craigslist-carstrucks-data"),
      false,
      "Gasoline Subaru Legacy must not qualify for a hybrid sedan request",
    );
  }
  if (name === "awdNoSubaru") {
    assert.ok(
      result.decisionSet.primaryRecommendations.every(
        (recommendation) => recommendation.vehicle.drivetrain === "AWD" || recommendation.vehicle.drivetrain === "4WD",
      ),
    );
    assert.equal(result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.make === "Subaru"), false);
    assert.ok(
      result.decisionSet.excludedRecommendations.some((recommendation) =>
        recommendation.vehicle.make === "Subaru" &&
        recommendation.hardConstraintResults.some((constraint) => constraint.label === "Excluded make" && !constraint.passed),
      ),
      "Subaru vehicles should be excluded by the explicit make-exclusion constraint",
    );
  }
  if (name === "subaruSedan") {
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.make === "Subaru"));
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "sedan"));
    assert.ok(result.decisionSet.primaryRecommendations.length > 0, "Subaru must not be banned when explicitly requested and qualified");
  }
  if (name === "impossiblePickup") {
    assert.equal(result.decisionSet.primaryRecommendations.length, 0);
    assert.equal(result.pipelineDebug.topFive.length, 0);
    assert.equal(result.decisionSet.noMatch.noMatch, true);
    assert.equal(
      result.decisionSet.compromiseRecommendations.some((recommendation) => recommendation.vehicle.make === "Subaru"),
      false,
      "Impossible truck request must not turn into a Subaru compromise",
    );
  }
  if (name === "toyotaRequired") {
    assert.ok(result.decisionSet.primaryRecommendations.length > 0, "Toyota request should find Toyota candidates in the current catalog");
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.make === "Toyota"));
    assert.equal(
      result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.make === "Subaru"),
      false,
      "Explicit Toyota request must not qualify Subaru",
    );
  }
  if (name === "bmwRequired") {
    assert.equal(debug.qualifiedCount, 0, "BMW request should return no match because the current catalog has no BMW vehicles");
    assert.equal(result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.make === "Subaru"), false);
  }
  if (name === "lexusRequired") {
    assert.equal(debug.qualifiedCount, 0, "Lexus request should return no match because the current catalog has no Lexus vehicles");
    assert.equal(result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.make === "Subaru"), false);
  }
  if (name === "cadillacRequired") {
    assert.equal(debug.qualifiedCount, 0, "Cadillac request should honestly no-match because the current catalog has no Cadillac vehicles");
    assert.equal(result.decisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.make === "Subaru"), false);
  }
  if (name === "toyotaPreferredHondaFallback") {
    const allowed = new Set(["Toyota", "Honda"]);
    assert.ok(result.decisionSet.primaryRecommendations.length > 0, "Toyota/Honda fallback should find allowed candidates");
    assert.ok(result.decisionSet.primaryRecommendations.every((recommendation) => allowed.has(recommendation.vehicle.make)));
    assert.equal(
      result.decisionSet.primaryRecommendations.some((recommendation) => !allowed.has(recommendation.vehicle.make)),
      false,
      "Allowed make fallback must not qualify unrelated makes",
    );
  }
});

const noTruckCatalog = vehicleCatalog.filter((vehicle) => vehicle.bodyType !== "truck");
const noTruckResult = runCandidatePipeline(
  { ...baseProfile, bodyStyle: "truck", maxPurchaseBudget: 20000 },
  noTruckCatalog,
  { includeCompromises: true, includeExcluded: true },
);
assert.equal(noTruckResult.decisionSet.primaryRecommendations.length, 0, "No-truck catalog should produce no qualified truck match");
assert.equal(noTruckResult.pipelineDebug.topFive.length, 0, "No-truck catalog should not fabricate non-truck top five");
assert.ok(noTruckResult.decisionSet.noMatch.topConstraintBlockers.some((blocker) => blocker.code === "bodyStyle"));

const afterTruckDefaultResult = runCandidatePipeline(baseProfile, vehicleCatalog, { includeCompromises: true, includeExcluded: true });
assert.notEqual(afterTruckDefaultResult.decisionSet.primaryRecommendations[0]?.vehicle.bodyType, "truck", "Repeated default searches should not reuse stale truck state");

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
