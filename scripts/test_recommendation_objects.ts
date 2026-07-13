import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultScoreWeights, rankRecommendations, rankVehicles } from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";
import type { RecommendationObject, Vehicle } from "../types/vehicle";

const vehicleCatalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const structuredProfile: BuyerProfile = {
  maxPurchaseBudget: 25000,
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
  cargoNeed: "high",
  familySize: 4,
  drivetrainPreference: "AWD",
  transmissionPreference: "any",
  bodyStyle: "suv",
  climate: "snow",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "maximum",
  scoreWeights: defaultScoreWeights,
};

const recommendations = rankRecommendations(structuredProfile, vehicleCatalog).slice(0, 10);
assert.ok(recommendations.length > 0, "qualified recommendation objects should be returned");
recommendations.forEach(assertRecommendationObject);

const rankedVehicles = rankVehicles(structuredProfile, vehicleCatalog).slice(0, 10);
assert.equal(rankedVehicles.length, recommendations.length, "rankVehicles compatibility wrapper should preserve count");
rankedVehicles.forEach((vehicle, index) => {
  assert.ok(vehicle.recommendation, "rankVehicles should attach a recommendation object");
  assert.equal(vehicle.id, recommendations[index].vehicleId, "vehicle ranking should match recommendation ranking");
  assert.equal(vehicle.score, vehicle.recommendation.overallMatchScore, "vehicle score should match recommendation overall score");
});

const impossibleProfile: BuyerProfile = {
  ...structuredProfile,
  maxPurchaseBudget: 8000,
  monthlyBudget: 260,
  downPayment: 500,
  bodyStyle: "suv",
  drivetrainPreference: "AWD",
  purchaseCondition: "new",
  transmissionPreference: "manual",
  safetyPriority: "maximum",
};

const auditRecommendations = rankRecommendations(impossibleProfile, vehicleCatalog, { includeDisqualified: true }).slice(0, 20);
assert.ok(auditRecommendations.some((recommendation) => !recommendation.qualified), "audit mode should include disqualified recommendation objects");
auditRecommendations.filter((recommendation) => !recommendation.qualified).forEach((recommendation) => {
  assert.ok(["compromise", "excluded"].includes(recommendation.qualificationSummary.status));
  assert.notEqual(recommendation.qualificationStatus, "qualified");
  assert.notEqual(recommendation.qualified, true);
  assert.ok(recommendation.qualificationSummary.failedCount > 0);
  assert.equal(
    recommendation.qualificationSummary.failedCount,
    recommendation.hardConstraintResults.filter((constraint) => !constraint.passed).length,
  );
});

console.log("Recommendation object contract passed.");

function assertRecommendationObject(recommendation: RecommendationObject) {
  assert.equal(recommendation.qualified, true, "default recommendations must be qualified");
  assert.equal(recommendation.qualificationStatus, "qualified");
  assert.equal(recommendation.qualificationSummary.status, "qualified");
  assert.equal(recommendation.qualificationSummary.failedCount, 0);
  assert.equal(recommendation.qualificationSummary.compromiseCount, 0);
  assert.equal(recommendation.hardConstraintResults.length, recommendation.hardConstraintsPassed.length);
  assert.equal(recommendation.qualificationSummary.passedCount, recommendation.hardConstraintsPassed.length);
  assert.deepEqual(
    recommendation.hardConstraintsPassed.map((constraint) => constraint.code).sort(),
    recommendation.hardConstraintResults.filter((constraint) => constraint.passed).map((constraint) => constraint.code).sort(),
  );
  assert.ok(recommendation.hardConstraintsPassed.length > 0);
  assert.ok(recommendation.hardConstraintsPassed.every((constraint) => constraint.passed));
  assertScore(recommendation.softPreferenceScore, "softPreferenceScore");
  assertScore(recommendation.overallMatchScore, "overallMatchScore");
  assertConfidence(recommendation.recommendationConfidence, "recommendationConfidence");
  assertConfidence(recommendation.dataQualityConfidence, "dataQualityConfidence");
  assert.ok(recommendation.reasonsForRecommendation.length > 0, "structured reasons should exist");
  assert.ok(recommendation.reasonsForRecommendation.every((reason) => typeof reason !== "string"), "reasons must be structured objects");
  assert.ok(Array.isArray(recommendation.tradeoffs), "tradeoffs should be an array");
  assert.ok(recommendation.tradeoffs.every((tradeoff) => typeof tradeoff !== "string"), "tradeoffs must be structured objects");
  assert.ok(Array.isArray(recommendation.assumptionsUsed), "assumptionsUsed should be an array");
  assert.ok(Array.isArray(recommendation.estimatedFields), "estimatedFields should be an array");
  assert.ok(Array.isArray(recommendation.missingInformation), "missingInformation should be an array");
  assert.ok(recommendation.estimatedFields.some((field) => field.field === "overallMatchScore"));
  assertOwnership(recommendation);
  recommendation.betterAlternativesIfConstraintsChange.forEach((alternative) => {
    assert.ok(alternative.requiredConstraintChanges.length > 0, "constraint-change alternatives must name required changes");
    assert.ok(alternative.requiredConstraintChanges.every((constraint) => !constraint.passed));
  });
}

function assertConfidence(confidence: RecommendationObject["recommendationConfidence"], label: string) {
  assertScore(confidence.score, `${label}.score`);
  assert.ok(["high", "medium", "low"].includes(confidence.level), `${label}.level should be valid`);
  assert.ok(confidence.factors.length > 0, `${label}.factors should be populated`);
}

function assertOwnership(recommendation: RecommendationObject) {
  const ownership = recommendation.ownershipSummary;
  const monthlyTotal =
    ownership.insuranceMonthly + ownership.maintenanceMonthly + ownership.fuelMonthly + ownership.depreciationMonthly;
  assert.equal(ownership.estimatedMonthlyTotal, monthlyTotal, "monthly ownership total should equal component sum");
  const firstYear = recommendation.firstYearOwnershipEstimate;
  assert.equal(firstYear.total, firstYear.insurance + firstYear.maintenance + firstYear.fuel + firstYear.depreciation);
}

function assertScore(value: number, label: string) {
  assert.ok(Number.isFinite(value), `${label} should be finite`);
  assert.ok(value >= 0 && value <= 100, `${label} should be 0-100`);
}
