import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decisionPolicyDimensionLabel,
  mergeDecisionParticipationPolicyMaps,
  resolveDecisionParticipationPolicies,
  validateDecisionParticipationPolicy,
} from "../lib/decisionParticipationPolicy";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import {
  createDeterministicSemanticConversationIntakeSession,
} from "../lib/conversationIntake";
import {
  assessConfirmedPreferenceDraftReadiness,
  assessConfirmedProfileConversionReadiness,
} from "../lib/recommendationReadiness";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";
import type { DecisionParticipationPolicy } from "../types/decisionPolicy";
import type { Vehicle } from "../types/vehicle";

const catalog = JSON.parse(
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
  minYear: 2000,
  maxMileage: 250000,
  minMpg: 0,
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

function policy(
  dimension: DecisionParticipationPolicy["dimension"],
  participation: DecisionParticipationPolicy["participation"],
  messageRef: string,
  source: DecisionParticipationPolicy["source"] = "user_explicit",
): DecisionParticipationPolicy {
  return {
    dimension,
    participation,
    source,
    confidence: 0.98,
    confirmation: source === "inferred" ? "inferred" : "explicit",
    sourceText: `${dimension} ${participation}`,
    messageRef,
    explanation: "Test policy.",
  };
}

function approvedConversion(input: string, profile = baseProfile) {
  const session = createDeterministicSemanticConversationIntakeSession(input);
  const draft = createConfirmedPreferenceProfile(session, profile);
  const approved = approveConfirmedPreferenceProfile(draft, 99);
  return {
    session,
    draft,
    conversion: convertConfirmedPreferencesToBuyerProfile(profile, approved),
  };
}

const valid = validateDecisionParticipationPolicy(policy("purchaseBudget", "disabled", "turn-1"));
assert.equal(valid.dimension, "purchaseBudget");
assert.equal(valid.participation, "disabled");
assert.throws(
  () => validateDecisionParticipationPolicy({ ...valid, dimension: "madeUpDimension" }),
  /dimension must be one of/,
);
assert.throws(
  () => validateDecisionParticipationPolicy({ ...valid, participation: "ignored" }),
  /participation must be one of/,
);

const ignoredBudget = approvedConversion("Ignore budget");
assert.equal(ignoredBudget.session.semanticFallbackUsed, true);
assert.equal(ignoredBudget.session.accumulatedInterpretation.decisionPolicies?.purchaseBudget?.participation, "disabled");
assert.equal(ignoredBudget.session.currentQuestion?.id, "daily_use");
assert.match(ignoredBudget.session.currentQuestion?.text || "", /what should matter most/i);
assert.equal(
  ignoredBudget.draft.items.some((item) => item.field === "maxPurchaseBudget" && item.certainty === "assumed_default"),
  false,
);
assert.equal(
  ignoredBudget.draft.items.find((item) => item.policyDimension === "purchaseBudget")?.displayValue,
  "No restriction",
);
assert.equal(assessConfirmedPreferenceDraftReadiness(ignoredBudget.draft).ready, false);
assert.equal(ignoredBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation, "disabled");
assert.equal(
  ignoredBudget.conversion.preservedDefaults.some((item) => item.field === "maxPurchaseBudget"),
  false,
);
assert.equal(
  ignoredBudget.conversion.preservedDefaults.some((item) => item.field === "loanTermMonths"),
  false,
);
assert.equal(assessConfirmedProfileConversionReadiness(ignoredBudget.conversion).ready, false);

const ignoredBudgetWithCriterion = approvedConversion("Ignore budget; I want a reliable truck");
assert.equal(ignoredBudgetWithCriterion.session.currentQuestion, null);
assert.equal(assessConfirmedPreferenceDraftReadiness(ignoredBudgetWithCriterion.draft).ready, true);
assert.equal(ignoredBudgetWithCriterion.conversion.buyerProfile.bodyStyle, "truck");

const budgetFreeProfile: BuyerProfile = {
  ...ignoredBudgetWithCriterion.conversion.buyerProfile,
  maxPurchaseBudget: 1,
  monthlyBudget: 1,
  minYear: 2000,
  maxMileage: 250000,
};
const budgetFreePipeline = runCandidatePipeline(budgetFreeProfile, catalog, {
  includeCompromises: true,
  includeExcluded: true,
});
assert.ok(budgetFreePipeline.pipelineDebug.qualifiedCount > 0);
for (const recommendation of budgetFreePipeline.decisionSet.primaryRecommendations) {
  assert.equal(
    recommendation.hardConstraintResults.some((item) => item.code === "totalBudget" || item.code === "monthlyPayment"),
    false,
  );
  assert.equal(
    recommendation.reasonsForRecommendation.some((item) => item.category === "affordability"),
    false,
  );
}

const unknownBudget = approvedConversion("I do not know my budget");
assert.equal(unknownBudget.session.accumulatedInterpretation.decisionPolicies?.purchaseBudget?.participation, "unresolved");
assert.equal(unknownBudget.session.currentQuestion?.id, "budget_max");
assert.equal(assessConfirmedPreferenceDraftReadiness(unknownBudget.draft).ready, false);
assert.notEqual(
  unknownBudget.draft.items.find((item) => item.policyDimension === "purchaseBudget")?.displayValue,
  "No restriction",
);

const preferredBudget = approvedConversion("Around $25,000");
assert.equal(preferredBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation, "active");
assert.equal(preferredBudget.conversion.buyerProfile.maxPurchaseBudget, 25000);
assert.equal(
  preferredBudget.conversion.appliedHardConstraints.some((item) => item.field === "maxPurchaseBudget"),
  false,
);
assert.equal(
  preferredBudget.conversion.appliedSoftPreferences.some((item) => item.field === "maxPurchaseBudget"),
  true,
);

const enforcedBudget = approvedConversion("Under $25,000");
assert.equal(enforcedBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation, "enforced");
assert.equal(
  enforcedBudget.conversion.appliedHardConstraints.some((item) => item.field === "maxPurchaseBudget"),
  true,
);

let policies = resolveDecisionParticipationPolicies(undefined, [
  policy("purchaseBudget", "enforced", "turn-1"),
]);
policies = mergeDecisionParticipationPolicyMaps(policies, {
  purchaseBudget: policy("purchaseBudget", "disabled", "turn-2", "user_correction"),
});
assert.equal(policies.purchaseBudget?.participation, "disabled");
policies = mergeDecisionParticipationPolicyMaps(policies, {
  purchaseBudget: policy("purchaseBudget", "enforced", "turn-3", "user_correction"),
});
assert.equal(policies.purchaseBudget?.participation, "enforced");

const explicit = policy("reliability", "active", "turn-2");
const inferred = policy("reliability", "disabled", "turn-2", "inferred");
assert.equal(
  mergeDecisionParticipationPolicyMaps({ reliability: explicit }, { reliability: inferred }).reliability?.participation,
  "active",
);

const firstFresh = approvedConversion("Ignore budget");
const secondFresh = approvedConversion("Under $40,000");
assert.equal(firstFresh.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation, "disabled");
assert.equal(secondFresh.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation, "enforced");

const restoredBudget = approvedConversion(
  "Actually keep it under $40,000",
  firstFresh.conversion.buyerProfile,
);
assert.equal(restoredBudget.conversion.buyerProfile.maxPurchaseBudget, 40000);
assert.equal(
  restoredBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation,
  "enforced",
  "A newly approved explicit policy must replace an older policy even when intake message IDs restart",
);

const unrelatedSafety = approvedConversion(
  "Safety matters most",
  secondFresh.conversion.buyerProfile,
);
assert.equal(
  unrelatedSafety.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation,
  "enforced",
  "An inferred unresolved policy must not erase an older explicit budget",
);

const bodyStyleDisabled: BuyerProfile = {
  ...baseProfile,
  bodyStyle: "suv",
  decisionPolicies: {
    bodyStyle: policy("bodyStyle", "disabled", "turn-1"),
  },
};
const bodyStylePipeline = runCandidatePipeline(bodyStyleDisabled, catalog, {
  includeCompromises: true,
  includeExcluded: true,
});
assert.ok(bodyStylePipeline.decisionSet.primaryRecommendations.some((item) => item.vehicle.bodyType !== "suv"));

const ignoredEverything = approvedConversion("Money is no object");
assert.equal(assessConfirmedPreferenceDraftReadiness(ignoredEverything.draft).ready, false);
assert.ok(
  Object.values(ignoredEverything.draft.decisionPolicies).filter(Boolean).every(
    (item) => item?.participation === "disabled",
  ),
);

const globallyIgnored = approvedConversion("Ignore everything");
assert.equal(globallyIgnored.session.currentQuestion?.id, "daily_use");
assert.ok(
  Object.values(globallyIgnored.draft.decisionPolicies).filter(Boolean).every(
    (item) => item?.participation === "disabled",
  ),
);

assert.equal(decisionPolicyDimensionLabel("fuelEnergyCost"), "Fuel and energy cost");

const fallbackCases = [
  ["No budget limit", "purchaseBudget", "disabled"],
  ["No preference on body style", "bodyStyle", "disabled"],
  ["No manual transmission", "transmission", "enforced"],
  ["Fuel type does not matter", "fuelType", "disabled"],
  ["Ignore fuel economy", "fuelEnergyCost", "disabled"],
] as const;
for (const [input, dimension, participation] of fallbackCases) {
  const session = createDeterministicSemanticConversationIntakeSession(input);
  const mapped = session.accumulatedInterpretation.decisionPolicies?.[dimension];
  assert.equal(mapped?.dimension, dimension);
  assert.equal(mapped?.participation, participation);
  assert.ok(["user_explicit", "deterministic_fallback"].includes(mapped?.source || ""));
}

const noLimit = approvedConversion("No budget limit");
assert.equal(noLimit.session.currentQuestion?.id, "ownership_tradeoff");
assert.match(noLimit.session.currentQuestion?.text || "", /ongoing costs/i);

const repairsStillMatter = approvedConversion("Money is no object, but I hate expensive repairs");
assert.equal(repairsStillMatter.conversion.buyerProfile.decisionPolicies?.maintenanceRisk?.participation, "active");
assert.equal(assessConfirmedProfileConversionReadiness(repairsStillMatter.conversion).ready, true);

console.table([
  {
    case: "disabled budget",
    participation: ignoredBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation,
    clarification: ignoredBudget.session.currentQuestion?.text,
    readiness: assessConfirmedProfileConversionReadiness(ignoredBudget.conversion).ready,
  },
  {
    case: "unknown budget",
    participation: unknownBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation,
    clarification: unknownBudget.session.currentQuestion?.text,
    readiness: assessConfirmedPreferenceDraftReadiness(unknownBudget.draft).ready,
  },
  {
    case: "preferred budget",
    participation: preferredBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation,
    clarification: preferredBudget.session.currentQuestion?.text || "none",
    readiness: assessConfirmedProfileConversionReadiness(preferredBudget.conversion).ready,
  },
  {
    case: "enforced budget",
    participation: enforcedBudget.conversion.buyerProfile.decisionPolicies?.purchaseBudget?.participation,
    clarification: enforcedBudget.session.currentQuestion?.text || "none",
    readiness: assessConfirmedProfileConversionReadiness(enforcedBudget.conversion).ready,
  },
]);

console.log("Decision participation policy tests passed.");
