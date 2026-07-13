import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultScoreWeights, getRecommendationDecisionSet } from "../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { RecommendationObject, Vehicle } from "../types/vehicle";

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

const profileA: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 12000,
  purchaseCondition: "used",
  expectedAnnualMileage: 12000,
  climate: "mild",
  reliabilityImportance: 5,
  reliabilityMinimum: 75,
  safetyPriority: "high",
  performanceImportance: 1,
};

const profileB: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 25000,
  bodyStyle: "suv",
  climate: "snow",
  drivetrainPreference: "AWD",
  familySize: 4,
  cargoNeed: "high",
  safetyPriority: "maximum",
  scoreWeights: weights({ safety: 25, practicality: 20, reliability: 15, affordability: 15, maintenanceRisk: 10, insuranceCost: 5, fuelEnergyCost: 5, resaleValue: 5, drivingPreferenceFit: 0 }),
};

const profileC: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 13000,
  purchaseCondition: "used",
  requiredMake: "BMW",
  minMpg: 20,
  performanceImportance: 5,
  reliabilityImportance: 4,
  scoreWeights: weights({ drivingPreferenceFit: 25, reliability: 20, maintenanceRisk: 20, affordability: 15, safety: 8, insuranceCost: 5, fuelEnergyCost: 3, practicality: 2, resaleValue: 2 }),
};

const profileD: BuyerProfile = {
  ...profileC,
  requiredMake: undefined,
  preferredMake: "BMW",
};

const profileE: BuyerProfile = {
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
};

const profileF: BuyerProfile = {
  ...profileC,
  requiredMake: "BMW",
  flexibleConstraints: ["make"],
  allowCompromises: true,
};

const benchmarkProfiles = {
  A: profileA,
  B: profileB,
  C: profileC,
};

const decisionA = getRecommendationDecisionSet(profileA, vehicleCatalog);
assert.ok(decisionA.primaryRecommendations.length > 0, "Profile A should have qualified vehicles");
assert.ok(decisionA.primaryRecommendations.every((recommendation) => recommendation.vehicle.reliabilityScore >= 75));
assert.ok(decisionA.primaryRecommendations[0].vehicle.reliabilityScore >= 75, "Profile A top result must satisfy reliability minimum");
assert.ok(decisionA.primaryRecommendations[0].vehicle.safetyScore >= 70, "Profile A top result should not be unsafe");

const decisionB = getRecommendationDecisionSet(profileB, vehicleCatalog);
assert.ok(decisionB.primaryRecommendations.length > 0, "Profile B should have qualified vehicles");
assert.ok(decisionB.primaryRecommendations.every((recommendation) => recommendation.vehicle.bodyType === "suv"));
assert.ok(decisionB.primaryRecommendations.every((recommendation) => recommendation.vehicle.drivetrain === "AWD" || recommendation.vehicle.drivetrain === "4WD"));
assert.ok(decisionB.excludedRecommendations.some((recommendation) => recommendation.hardConstraintResults.some((constraint) => constraint.code === "bodyStyle" && !constraint.passed)));
assert.ok(decisionB.excludedRecommendations.some((recommendation) => recommendation.hardConstraintResults.some((constraint) => constraint.code === "drivetrain" && !constraint.passed)));

const decisionC = getRecommendationDecisionSet(profileC, vehicleCatalog);
assert.equal(decisionC.primaryRecommendations.length, 0, "Profile C should not fabricate BMW matches");
assert.equal(decisionC.noMatch.noMatch, true);
assert.ok(decisionC.excludedRecommendations.every((recommendation) => recommendation.vehicle.make !== "BMW"));
assert.ok(decisionC.noMatch.topConstraintBlockers.some((blocker) => blocker.code === "make"));

const decisionD = getRecommendationDecisionSet(profileD, vehicleCatalog);
assert.ok(decisionD.primaryRecommendations.length > 0, "Profile D should return non-BMW alternatives when BMW is preferred");
assert.ok(decisionD.primaryRecommendations.every((recommendation) => recommendation.qualificationStatus === "qualified"));
assert.ok(decisionD.primaryRecommendations[0].tradeoffs.some((tradeoff) => tradeoff.code === "make_preference_relaxed"));

const decisionE = getRecommendationDecisionSet(profileE, vehicleCatalog);
assert.equal(decisionE.primaryRecommendations.length, 0, "Profile E contradictory requirements should produce no primary recommendation");
assert.equal(decisionE.noMatch.noMatch, true);
assert.ok(decisionE.noMatch.topConstraintBlockers.length > 0, "Profile E should explain blockers");

const decisionF = getRecommendationDecisionSet(profileF, vehicleCatalog);
assert.equal(decisionF.primaryRecommendations.length, 0, "Profile F has no qualified BMW vehicles");
assert.ok(decisionF.compromiseRecommendations.length > 0, "Profile F should expose make-relaxed compromises");
assert.ok(decisionF.noMatch.compromiseOptions.length > 0 && decisionF.noMatch.compromiseOptions.length <= 3);
decisionF.noMatch.compromiseOptions.forEach((option) => {
  assert.equal(option.singleConstraintChange.code, "make");
});

console.log("Qualification engine consistency passed.");
console.log("Qualification benchmark report:");
Object.entries(benchmarkProfiles).forEach(([name, profile]) => {
  const decision = getRecommendationDecisionSet(profile, vehicleCatalog);
  console.log(formatBenchmark(name, decision.primaryRecommendations, decision.compromiseRecommendations, decision.excludedRecommendations));
});

function weights(overrides: Partial<ScoreWeights>): ScoreWeights {
  return { ...defaultScoreWeights, ...overrides };
}

function formatBenchmark(
  name: string,
  qualified: RecommendationObject[],
  compromises: RecommendationObject[],
  excluded: RecommendationObject[],
) {
  const top = qualified[0];
  const runnerUp = qualified[1];
  const topLabel = top ? `${top.vehicle.year} ${top.vehicle.make} ${top.vehicle.model}` : "no match";
  const runnerUpReason = top && runnerUp ? getRunnerUpReason(top, runnerUp) : "no qualified runner-up";

  return [
    `Profile ${name}: qualified ${qualified.length}, compromises ${compromises.length}, excluded ${excluded.length}`,
    `top ${topLabel}`,
    `reliability ${top?.vehicle.reliabilityScore ?? "n/a"}`,
    `safety ${top?.vehicle.safetyScore ?? "n/a"}`,
    `hard ${top ? top.qualificationStatus : "no_match"}`,
    `confidence ${top ? `${top.recommendationConfidence.score}/100 ${top.recommendationConfidence.level}` : "n/a"}`,
    `assumptions ${top?.assumptionsUsed.length ?? 0}`,
    `runner-up lower: ${runnerUpReason}`,
  ].join("; ");
}

function getRunnerUpReason(top: RecommendationObject, runnerUp: RecommendationObject) {
  const categories = Object.keys(top.vehicle ? top.reasonsForRecommendation.reduce((acc, signal) => ({ ...acc, [signal.category]: true }), {}) : {});
  const topScores = getCategoryScores(top);
  const runnerUpScores = getCategoryScores(runnerUp);
  const biggestGap = categories
    .map((category) => ({
      category,
      gap: (topScores[category] || 0) - (runnerUpScores[category] || 0),
    }))
    .sort((a, b) => b.gap - a.gap)[0];

  if (biggestGap && biggestGap.gap > 0) return `${runnerUp.vehicle.year} ${runnerUp.vehicle.make} ${runnerUp.vehicle.model} trails on ${biggestGap.category} by ${Math.round(biggestGap.gap)} points`;
  return `${runnerUp.vehicle.year} ${runnerUp.vehicle.make} ${runnerUp.vehicle.model} has lower total match score`;
}

function getCategoryScores(recommendation: RecommendationObject) {
  return Object.fromEntries(
    recommendation.reasonsForRecommendation.map((signal) => [signal.category, Number(signal.score || 0)]),
  ) as Record<string, number>;
}
