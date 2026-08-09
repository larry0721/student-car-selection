import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveEffectiveScoringPolicy } from "../lib/effectiveScoringPolicy";
import { understandingDraftSchemaDefinitions } from "../lib/understandingDraftSchema";
import {
  defaultScoreWeights,
  getDynamicScoreWeights,
  runCandidatePipeline,
} from "../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type {
  DecisionParticipation,
  DecisionParticipationPolicy,
  DecisionPolicyDimension,
  DecisionPolicySource,
} from "../types/decisionPolicy";
import type { Vehicle } from "../types/vehicle";

const fullCatalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 30000,
  monthlyBudget: 1200,
  downPayment: 5000,
  loanTermMonths: 60,
  apr: 7,
  paymentMethod: "cash",
  purchaseCondition: "any",
  expectedAnnualMileage: 9000,
  fuelPrice: 4.25,
  insuranceBudget: 0,
  minYear: 2010,
  maxMileage: 200000,
  minMpg: 0,
  fuelEconomyImportance: 3,
  reliabilityImportance: 3,
  performanceImportance: 3,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "mild",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "standard",
  scoreWeights: defaultScoreWeights,
};

const valueCar = fixtureVehicle(fullCatalog[0], {
  id: "adaptive-value",
  price: 8000,
  reliabilityScore: 88,
  safetyScore: 74,
  mpg: 42,
  insurance: 85,
  maintenanceEstimate: 60,
  resaleScore: 58,
  performanceScore: 48,
});
const evidenceCar = fixtureVehicle(fullCatalog[1], {
  id: "adaptive-evidence",
  price: 19800,
  reliabilityScore: 96,
  safetyScore: 98,
  mpg: 24,
  insurance: 165,
  maintenanceEstimate: 300,
  resaleScore: 92,
  performanceScore: 68,
});
const performanceCar = fixtureVehicle(fullCatalog[4], {
  id: "adaptive-performance",
  price: 16400,
  reliabilityScore: 58,
  safetyScore: 78,
  mpg: 20,
  insurance: 205,
  maintenanceEstimate: 215,
  resaleScore: 48,
  performanceScore: 98,
});
const controlledCatalog = [valueCar, evidenceCar, performanceCar];

const normalPolicy = resolveEffectiveScoringPolicy({
  profile: baseProfile,
  baseWeights: defaultScoreWeights,
});
assert.equal(normalPolicy.mode, "weighted");
assert.equal(normalPolicy.legacyProfile, true);
assertWeightsSum(normalPolicy.effectiveWeights);
assert.deepEqual(
  normalPolicy.effectiveWeights,
  getDynamicScoreWeights(baseProfile),
  "legacy profiles must preserve the prior dynamic-weight result",
);

const disabledAffordabilityProfile = withPolicies(baseProfile, [
  policy("affordability", "disabled"),
  policy("reliability", "active", 1),
]);
const disabledAffordability = resolveEffectiveScoringPolicy({
  profile: disabledAffordabilityProfile,
  baseWeights: weights({ affordability: 60, reliability: 25, safety: 15 }),
});
assert.equal(disabledAffordability.categories.affordability.normalizedEffectiveWeight, 0);
assert.equal(disabledAffordability.categories.affordability.scoringEnabled, false);
assertWeightsSum(disabledAffordability.effectiveWeights);
assert.ok(disabledAffordability.categories.maintenanceRisk.normalizedEffectiveWeight > 0);
assert.ok(disabledAffordability.categories.insuranceCost.normalizedEffectiveWeight > 0);
assert.ok(disabledAffordability.categories.fuelEnergyCost.normalizedEffectiveWeight > 0);

const activeReliability = resolveEffectiveScoringPolicy({
  profile: withPolicies(baseProfile, [policy("reliability", "active", 0.5)]),
  baseWeights: defaultScoreWeights,
});
const deprioritizedReliability = resolveEffectiveScoringPolicy({
  profile: withPolicies(baseProfile, [policy("reliability", "deprioritized", 0.9)]),
  baseWeights: defaultScoreWeights,
});
assert.ok(
  deprioritizedReliability.categories.reliability.effectiveRawWeight
    < activeReliability.categories.reliability.effectiveRawWeight,
);

const topSafety = resolveEffectiveScoringPolicy({
  profile: withPolicies(baseProfile, [policy("safety", "active", 1)]),
  baseWeights: defaultScoreWeights,
});
const normalSafety = resolveEffectiveScoringPolicy({
  profile: withPolicies(baseProfile, [policy("safety", "active", 0.5)]),
  baseWeights: defaultScoreWeights,
});
assert.ok(
  topSafety.categories.safety.effectiveRawWeight
    > normalSafety.categories.safety.effectiveRawWeight,
);

const performanceOnlyPolicy = {
  ...policy("performance", "active", 1),
  sourceText: "Performance only",
};
const performanceOnlyProfile = withPolicies(baseProfile, [performanceOnlyPolicy]);
const performanceOnlyScoring = resolveEffectiveScoringPolicy({
  profile: performanceOnlyProfile,
  baseWeights: defaultScoreWeights,
});
assert.equal(performanceOnlyScoring.categories.drivingPreferenceFit.normalizedEffectiveWeight, 100);
for (const category of Object.keys(performanceOnlyScoring.categories) as Array<keyof typeof performanceOnlyScoring.categories>) {
  if (category === "drivingPreferenceFit") continue;
  assert.equal(
    performanceOnlyScoring.categories[category].normalizedEffectiveWeight,
    0,
    `${category} must not participate when another category is explicitly the only ranking priority`,
  );
}
assert.equal(runPair(performanceOnlyProfile, controlledCatalog).winner, "adaptive-performance");

const ratioBefore =
  normalSafety.categories.reliability.normalizedEffectiveWeight
  / normalSafety.categories.maintenanceRisk.normalizedEffectiveWeight;
const fuelDisabled = resolveEffectiveScoringPolicy({
  profile: withPolicies(baseProfile, [
    policy("safety", "active", 0.5),
    policy("fuelEnergyCost", "disabled"),
  ]),
  baseWeights: defaultScoreWeights,
});
const ratioAfter =
  fuelDisabled.categories.reliability.normalizedEffectiveWeight
  / fuelDisabled.categories.maintenanceRisk.normalizedEffectiveWeight;
assert.ok(Math.abs(ratioBefore - ratioAfter) < 0.0001, "unaffected category ratios should remain stable");

assert.throws(
  () =>
    resolveEffectiveScoringPolicy({
      profile: baseProfile,
      baseWeights: { ...defaultScoreWeights, safety: Number.NaN },
    }),
  /Invalid base scoring weight/,
);
assert.throws(
  () =>
    resolveEffectiveScoringPolicy({
      profile: baseProfile,
      baseWeights: { ...defaultScoreWeights, safety: -1 },
    }),
  /Invalid base scoring weight/,
);

const pairedResults = {
  budgetActive: runPair(
    withPolicies(
      { ...baseProfile, maxPurchaseBudget: 20000, scoreWeights: focusedWeights({ affordability: 85, reliability: 10, safety: 5 }) },
      [policy("affordability", "active", 0.5), policy("reliability", "active", 0.5)],
    ),
    [valueCar, evidenceCar],
  ),
  budgetDisabled: runPair(
    withPolicies(
      { ...baseProfile, maxPurchaseBudget: 20000, scoreWeights: focusedWeights({ affordability: 85, reliability: 10, safety: 5 }) },
      [policy("affordability", "disabled"), policy("reliability", "active", 0.5)],
    ),
    [valueCar, evidenceCar],
  ),
  safetyNormal: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ affordability: 32, safety: 25, drivingPreferenceFit: 43 }) },
      [policy("safety", "active", 0.5), policy("performance", "active", 0.5)],
    ),
    [evidenceCar, performanceCar],
  ),
  safetyTop: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ affordability: 32, safety: 25, drivingPreferenceFit: 43 }) },
      [policy("safety", "active", 1), policy("performance", "active", 0.5)],
    ),
    [evidenceCar, performanceCar],
  ),
  reliabilityNormal: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ reliability: 45, drivingPreferenceFit: 45, safety: 10 }) },
      [policy("reliability", "active", 0.5), policy("performance", "active", 0.5)],
    ),
    [evidenceCar, performanceCar],
  ),
  reliabilityLow: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ reliability: 45, drivingPreferenceFit: 45, safety: 10 }) },
      [policy("reliability", "deprioritized", 0.5), policy("performance", "active", 0.5)],
    ),
    [evidenceCar, performanceCar],
  ),
  fuelActive: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ fuelEnergyCost: 60, safety: 40 }) },
      [policy("fuelEnergyCost", "active", 0.5), policy("safety", "active", 0.5)],
    ),
    [valueCar, evidenceCar],
  ),
  fuelDisabled: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ fuelEnergyCost: 60, safety: 40 }) },
      [policy("fuelEnergyCost", "disabled"), policy("safety", "active", 0.5)],
    ),
    [valueCar, evidenceCar],
  ),
  maintenanceHigh: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ maintenanceRisk: 60, safety: 40 }) },
      [policy("maintenanceRisk", "active", 1), policy("safety", "active", 0.5)],
    ),
    [valueCar, evidenceCar],
  ),
  maintenanceDisabled: runPair(
    withPolicies(
      { ...baseProfile, scoreWeights: focusedWeights({ maintenanceRisk: 60, safety: 40 }) },
      [policy("maintenanceRisk", "disabled"), policy("safety", "active", 0.5)],
    ),
    [valueCar, evidenceCar],
  ),
};

console.table(
  Object.entries(pairedResults).map(([scenario, result]) => ({
    scenario,
    winner: result.winner,
    runnerUp: result.runnerUp,
    scoreGap: result.scoreGap,
    decidingContribution: result.decidingContribution,
  })),
);

assert.notEqual(pairedResults.budgetActive.winner, pairedResults.budgetDisabled.winner);
assert.notEqual(pairedResults.safetyNormal.winner, pairedResults.safetyTop.winner);
assert.notEqual(pairedResults.reliabilityNormal.winner, pairedResults.reliabilityLow.winner);
assert.notEqual(pairedResults.fuelActive.winner, pairedResults.fuelDisabled.winner);
assert.notEqual(pairedResults.maintenanceHigh.winner, pairedResults.maintenanceDisabled.winner);

const purchaseDisabledProfile = withPolicies(
  { ...baseProfile, maxPurchaseBudget: 9000, paymentMethod: "cash" },
  [
    policy("purchaseBudget", "disabled"),
    policy("monthlyPayment", "disabled"),
    policy("affordability", "disabled"),
    policy("reliability", "active", 0.8),
  ],
);
const purchaseDisabledResult = runCandidatePipeline(
  purchaseDisabledProfile,
  [valueCar, evidenceCar],
  { includeExcluded: true },
);
assert.ok(
  purchaseDisabledResult.decisionSet.primaryRecommendations.some(
    (recommendation) => recommendation.vehicle.price > 9000,
  ),
  "disabled purchase price must not remain a hard filter",
);

const affordabilityDisabledProfile = withPolicies(
  { ...baseProfile, maxPurchaseBudget: 9000, monthlyBudget: 200 },
  [
    policy("affordability", "disabled"),
    policy("reliability", "active", 0.8),
  ],
);
const affordabilityDisabledPolicy = resolveEffectiveScoringPolicy({
  profile: affordabilityDisabledProfile,
  baseWeights: affordabilityDisabledProfile.scoreWeights,
});
assert.equal(
  affordabilityDisabledPolicy.effectiveHardConstraints.find(
    (constraint) => constraint.dimension === "purchaseBudget",
  )?.enforced,
  false,
);
assert.equal(
  affordabilityDisabledPolicy.effectiveHardConstraints.find(
    (constraint) => constraint.dimension === "monthlyPayment",
  )?.enforced,
  false,
);
const affordabilityDisabledResult = runCandidatePipeline(
  affordabilityDisabledProfile,
  [valueCar, evidenceCar],
  { includeExcluded: true },
);
assert.ok(
  affordabilityDisabledResult.decisionSet.primaryRecommendations.some(
    (recommendation) => recommendation.vehicle.price > 9000,
  ),
  "disabled affordability must suppress legacy purchase-price qualification",
);

const awdRequired = runCandidatePipeline(
  withPolicies(
    { ...baseProfile, requiredDrivetrains: ["AWD"] },
    [policy("drivetrain", "enforced"), policy("safety", "active", 0.8)],
  ),
  fullCatalog,
  { includeExcluded: true },
);
assert.ok(awdRequired.decisionSet.primaryRecommendations.length > 0);
assert.ok(
  awdRequired.decisionSet.primaryRecommendations.every(
    (recommendation) => recommendation.vehicle.drivetrain === "AWD"
      || recommendation.vehicle.drivetrain === "4WD",
  ),
);

const excludedSedan = runCandidatePipeline(
  withPolicies(
    { ...baseProfile, excludedBodyStyles: ["sedan"] },
    [policy("bodyStyle", "disabled"), policy("safety", "active", 0.8)],
  ),
  fullCatalog,
  { includeExcluded: true },
);
assert.ok(
  excludedSedan.decisionSet.primaryRecommendations.every(
    (recommendation) => recommendation.vehicle.bodyType !== "sedan",
  ),
  "explicit exclusions must survive a disabled preference dimension",
);

const allDisabled = withPolicies(baseProfile, [
  policy("affordability", "disabled"),
  policy("reliability", "disabled"),
  policy("safety", "disabled"),
  policy("fuelEnergyCost", "disabled"),
  policy("insuranceCost", "disabled"),
  policy("maintenanceRisk", "disabled"),
  policy("resaleValue", "disabled"),
  policy("performance", "disabled"),
]);
const allDisabledResult = runCandidatePipeline(allDisabled, controlledCatalog);
assert.equal(allDisabledResult.rankedVehicles.length, 0);
assert.equal(allDisabledResult.decisionSet.primaryRecommendations.length, 0);

const constraintOnlyProfile = withPolicies(
  {
    ...allDisabled,
    requiredBodyStyles: ["truck"],
  },
  [
    ...Object.values(allDisabled.decisionPolicies || {}).filter(
      (item): item is DecisionParticipationPolicy => Boolean(item),
    ),
    policy("bodyStyle", "enforced"),
  ],
);
const constraintOnlyPolicy = resolveEffectiveScoringPolicy({
  profile: constraintOnlyProfile,
  baseWeights: constraintOnlyProfile.scoreWeights,
});
assert.equal(constraintOnlyPolicy.mode, "constraint_only");
const constraintOnlyResult = runCandidatePipeline(constraintOnlyProfile, fullCatalog);
assert.ok(constraintOnlyResult.rankedVehicles.length > 0);
assert.ok(constraintOnlyResult.rankedVehicles.every((vehicle) => vehicle.bodyType === "truck"));
assert.ok(constraintOnlyResult.rankedVehicles.every((vehicle) => vehicle.score === 0));

const scored = pairedResults.budgetDisabled.result.rankedVehicles;
assert.ok(scored.length >= 2);
for (const vehicle of scored) {
  const contributionTotal = vehicle.scoreContributions.reduce(
    (sum, contribution) => sum + contribution.weightedContribution,
    0,
  );
  assert.equal(contributionTotal, vehicle.weightedScoreBeforePenalties);
  assert.equal(
    vehicle.score,
    Math.max(0, Math.min(100, Math.round(contributionTotal - vehicle.penaltyTotal))),
  );
  const affordability = vehicle.scoreContributions.find(
    (contribution) => contribution.category === "affordability",
  );
  assert.equal(affordability?.weightedContribution, 0);
  assert.equal(affordability?.affectedRanking, false);
  assert.equal(
    vehicle.recommendation.reasonsForRecommendation.some(
      (reason) => reason.category === "affordability",
    ),
    false,
  );
  assert.equal(
    vehicle.penalties.some((penalty) => penalty.label === "Ownership cost concern"),
    false,
    "policy-aware financial components must not be double-counted by the legacy composite penalty",
  );
}
assert.match(
  pairedResults.budgetDisabled.result.pipelineDebug.runnerUpLossReasons[0]?.primaryReason || "",
  /weighted points/,
);

const sourceComplete = fixtureVehicle(valueCar, {
  id: "source-complete",
  dataSources: ["seed", "fueleconomy.gov"],
});
const sourceMissing = fixtureVehicle(valueCar, {
  id: "source-missing",
  dataSources: ["seed"],
});
const fuelDisabledEvidence = runCandidatePipeline(
  withPolicies(baseProfile, [
    policy("fuelEnergyCost", "disabled"),
    policy("safety", "active", 0.8),
  ]),
  [sourceComplete, sourceMissing],
);
const disabledConfidence = fuelDisabledEvidence.rankedVehicles.map(
  (vehicle) => vehicle.recommendation.dataQualityConfidence.score,
);
assert.equal(disabledConfidence[0], disabledConfidence[1]);

const fuelTopEvidence = runCandidatePipeline(
  withPolicies(baseProfile, [
    policy("fuelEnergyCost", "active", 1),
    policy("safety", "active", 0.5),
  ]),
  [sourceComplete, sourceMissing],
);
const confidenceById = new Map(
  fuelTopEvidence.rankedVehicles.map((vehicle) => [
    vehicle.id,
    vehicle.recommendation.dataQualityConfidence.score,
  ]),
);
assert.ok(
  (confidenceById.get("source-complete") || 0)
    > (confidenceById.get("source-missing") || 0),
  "missing evidence in a top-priority active category must reduce data confidence",
);
assert.equal(fuelTopEvidence.rankedVehicles[0]?.id, "source-complete");

const modelPolicyProfile = withPolicies(baseProfile, [
  policy("fuelEnergyCost", "disabled", undefined, "model_interpretation"),
  policy("safety", "active", 0.9, "model_interpretation"),
]);
const fallbackPolicyProfile = withPolicies(baseProfile, [
  policy("fuelEnergyCost", "disabled", undefined, "deterministic_fallback"),
  policy("safety", "active", 0.9, "deterministic_fallback"),
]);
assert.deepEqual(
  runCandidatePipeline(modelPolicyProfile, controlledCatalog).rankedVehicles.map(
    (vehicle) => [vehicle.id, vehicle.score],
  ),
  runCandidatePipeline(fallbackPolicyProfile, controlledCatalog).rankedVehicles.map(
    (vehicle) => [vehicle.id, vehicle.score],
  ),
  "provider source metadata must not alter deterministic engine behavior",
);
const repeatedFirst = runCandidatePipeline(modelPolicyProfile, controlledCatalog).rankedVehicles.map(
  (vehicle) => [vehicle.id, vehicle.score, vehicle.weightedScoreBeforePenalties],
);
const repeatedSecond = runCandidatePipeline(modelPolicyProfile, controlledCatalog).rankedVehicles.map(
  (vehicle) => [vehicle.id, vehicle.score, vehicle.weightedScoreBeforePenalties],
);
assert.deepEqual(repeatedFirst, repeatedSecond, "repeated policy-aware scoring must be deterministic");

const modelPolicyProperties =
  understandingDraftSchemaDefinitions.decisionPolicyInstruction.properties;
for (const forbidden of [
  "baseWeight",
  "effectiveRawWeight",
  "normalizedEffectiveWeight",
  "weightedContribution",
  "vehicleScore",
]) {
  assert.equal(
    forbidden in modelPolicyProperties,
    false,
    `semantic model contract must not accept ${forbidden}`,
  );
}

const legacyBaseline = runCandidatePipeline(
  {
    ...baseProfile,
    monthlyBudget: 650,
    downPayment: 2000,
    apr: 8.5,
    paymentMethod: "not-sure",
    fuelPrice: 4.25,
    insuranceBudget: 145,
    minYear: 2014,
    maxMileage: 110000,
    minMpg: 24,
    cargoNeed: "not-sure",
    climate: "mild",
    maxPurchaseBudget: 12000,
    purchaseCondition: "used",
    expectedAnnualMileage: 12000,
    reliabilityImportance: 5,
    reliabilityMinimum: 75,
    safetyPriority: "high",
    performanceImportance: 1,
  },
  fullCatalog,
);
assert.equal(
  `${legacyBaseline.rankedVehicles[0]?.year} ${legacyBaseline.rankedVehicles[0]?.make} ${legacyBaseline.rankedVehicles[0]?.model}`,
  "2019 Subaru Legacy",
);
assert.equal(legacyBaseline.rankedVehicles[0]?.score, 71);

console.log("Adaptive scoring tests passed.");
function runPair(profile: BuyerProfile, vehicles: Vehicle[]) {
  const result = runCandidatePipeline(profile, vehicles, {
    includeCompromises: true,
    includeExcluded: true,
  });
  const winner = result.rankedVehicles[0];
  const runnerUp = result.rankedVehicles[1];
  const decidingContribution = winner && runnerUp
    ? winner.scoreContributions
        .map((contribution) => ({
          category: contribution.category,
          gap:
            contribution.weightedContribution
            - (
              runnerUp.scoreContributions.find(
                (candidate) => candidate.category === contribution.category,
              )?.weightedContribution || 0
            ),
        }))
        .sort((a, b) => b.gap - a.gap)[0]
    : undefined;
  return {
    result,
    winner: winner?.id || "none",
    runnerUp: runnerUp?.id || "none",
    scoreGap: winner && runnerUp ? winner.score - runnerUp.score : 0,
    decidingContribution: decidingContribution
      ? `${decidingContribution.category}:${decidingContribution.gap}`
      : "none",
  };
}

function fixtureVehicle(base: Vehicle, changes: Partial<Vehicle>): Vehicle {
  return {
    ...base,
    mileage: 65000,
    condition: 4,
    dataSources: ["seed", "nhtsa", "fueleconomy.gov", "csv-import", "listing-api"],
    dataUpdatedAt: "2026-07-01",
    ...changes,
  };
}

function withPolicies(
  profile: BuyerProfile,
  policies: DecisionParticipationPolicy[],
): BuyerProfile {
  return {
    ...profile,
    decisionPolicies: Object.fromEntries(
      policies.map((item) => [item.dimension, item]),
    ),
  };
}

function policy(
  dimension: DecisionPolicyDimension,
  participation: DecisionParticipation,
  importance?: number,
  source: DecisionPolicySource = "user_explicit",
): DecisionParticipationPolicy {
  return {
    dimension,
    participation,
    importance,
    source,
    confidence: 0.99,
    confirmation: "explicit",
    sourceText: `${dimension}:${participation}`,
    messageRef: "turn-1",
    explanation: "Controlled adaptive-scoring test policy.",
  };
}

function weights(overrides: Partial<ScoreWeights>): ScoreWeights {
  return { ...defaultScoreWeights, ...overrides };
}

function focusedWeights(overrides: Partial<ScoreWeights>): ScoreWeights {
  return {
    affordability: 0,
    reliability: 0,
    safety: 0,
    fuelEnergyCost: 0,
    insuranceCost: 0,
    maintenanceRisk: 0,
    practicality: 0,
    resaleValue: 0,
    drivingPreferenceFit: 0,
    ...overrides,
  };
}

function assertWeightsSum(weightsToCheck: ScoreWeights) {
  const total = Object.values(weightsToCheck).reduce((sum, weight) => sum + weight, 0);
  assert.ok(Math.abs(total - 100) < 0.00001, `weights sum to ${total}`);
}
