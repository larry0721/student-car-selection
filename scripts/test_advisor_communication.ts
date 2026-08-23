import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAdvisorCommunicationViewModel,
  buildConfirmationCommunicationViewModel,
  formatPolicyLine,
  getOutOfScopeAdvisorMessage,
} from "../lib/advisorCommunication";
import {
  createConfirmedPreferenceProfile,
  type ConfirmedPreferenceItem,
} from "../lib/confirmedPreferenceProfile";
import { createDeterministicSemanticConversationIntakeSession } from "../lib/conversationIntake";
import { assessConfirmedPreferenceDraftReadiness } from "../lib/recommendationReadiness";
import {
  buildDecisionReport,
  defaultScoreWeights,
  runCandidatePipeline,
} from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";
import type {
  DecisionParticipation,
  DecisionParticipationPolicy,
  DecisionPolicyDimension,
} from "../types/decisionPolicy";
import type { RecommendationDecisionSet, Vehicle } from "../types/vehicle";

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
  minYear: 2014,
  maxMileage: 110000,
  minMpg: 24,
  fuelEconomyImportance: 3,
  reliabilityImportance: 3,
  performanceImportance: 3,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "not-sure",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "standard",
  scoreWeights: defaultScoreWeights,
};

const safetyProfile = withPolicies(
  {
    ...baseProfile,
    bodyStyle: "suv",
    requiredBodyStyles: ["suv"],
    safetyPriority: "maximum",
  },
  [
    policy("bodyStyle", "enforced"),
    policy("safety", "active", 1),
    policy("purchaseBudget", "disabled"),
    policy("monthlyPayment", "disabled"),
    policy("affordability", "disabled"),
  ],
);
const safetyContext = getContext(safetyProfile);
const safetyView = buildAdvisorCommunicationViewModel(safetyContext);
const safetyTop = safetyContext.decisionSet.primaryRecommendations[0];

assert.equal(safetyView.snapshotVehicleId, safetyTop.vehicleId);
assert.ok(safetyView.advisorHeadline.includes(formatName(safetyTop)));
assert.ok(safetyView.policySummary.priorities.some((item) => /Safety: carried the most weight/i.test(item)));
assert.ok(safetyView.policySummary.ignored.some((item) => /Affordability: intentionally excluded/i.test(item)));
assert.equal(
  safetyView.reasons.some((item) => /purchase|payment|affordability/i.test(item)),
  false,
  "disabled affordability must not appear as a winner reason",
);

const rawPrimary = [
  safetyView.advisorHeadline,
  safetyView.recommendationSummary,
  ...safetyView.reasons,
  safetyView.mainTradeoff,
].join(" ");
for (const forbidden of [
  "participation",
  "effective weight",
  "normalized contribution",
  "constraint_only",
  "qualification",
]) {
  assert.equal(rawPrimary.toLowerCase().includes(forbidden), false);
}

assert.equal(
  formatPolicyLine(policy("reliability", "deprioritized", 0.2)),
  "Reliability: considered, but less important than your other priorities.",
);
assert.equal(
  formatPolicyLine(policy("fuelEnergyCost", "disabled")),
  "Fuel and energy cost: not part of this recommendation.",
);
assert.equal(
  formatPolicyLine(policy("safety", "active", 1)),
  "Safety: top priority.",
);

assert.notEqual(
  safetyView.confidence.recommendation,
  safetyView.confidence.dataQuality,
  "recommendation confidence and data quality must remain distinct",
);
assert.ok(safetyView.technicalDetails.effectiveWeights.length > 0);
assert.equal(
  safetyView.technicalDetails.contributions.length,
  safetyTop.scoreContributions.length,
  "technical contribution copy must come from the same recommendation snapshot",
);

const noMatchProfile = withPolicies(
  {
    ...baseProfile,
    requiredMake: "Tesla",
    requiredMakes: ["Tesla"],
  },
  [policy("make", "enforced")],
);
const noMatchContext = getContext(noMatchProfile);
const noMatchView = buildAdvisorCommunicationViewModel(noMatchContext);
assert.equal(noMatchView.mode, "no_match");
assert.ok(noMatchView.advisorHeadline.includes("responsible match"));
assert.ok(noMatchView.noMatch?.explanation.includes("Tesla"));
assert.equal(/\d+ vehicles/.test(noMatchView.noMatch?.explanation || ""), false);
assert.ok(noMatchView.technicalDetails.pipeline.some((item) => item.label === "Excluded"));

const allDisabledProfile = withPolicies(
  {
    ...baseProfile,
    requiredBodyStyles: ["truck"],
    bodyStyle: "truck",
  },
  [
    policy("bodyStyle", "enforced"),
    policy("affordability", "disabled"),
    policy("reliability", "disabled"),
    policy("safety", "disabled"),
    policy("fuelEnergyCost", "disabled"),
    policy("insuranceCost", "disabled"),
    policy("maintenanceRisk", "disabled"),
    policy("resaleValue", "disabled"),
    policy("performance", "disabled"),
  ],
);
const constraintOnlyView = buildAdvisorCommunicationViewModel(getContext(allDisabledProfile));
assert.equal(constraintOnlyView.mode, "constraint_only");
assert.ok(constraintOnlyView.recommendationSummary.includes("fit-based shortlist"));
assert.ok(constraintOnlyView.confidence.recommendation.includes("decisive personal winner"));

const unsupportedSession = createDeterministicSemanticConversationIntakeSession(
  "I want something that feels successful.",
);
const unsupportedDraft = createConfirmedPreferenceProfile(unsupportedSession, baseProfile);
const unsupportedItem: ConfirmedPreferenceItem = {
  id: "semantic:successful",
  group: "preferences_and_requirements",
  label: "Upscale feeling",
  value: "Something that feels successful",
  displayValue: "Understated, upscale feeling",
  certainty: "confirmed",
  constraintStrength: "preferred",
  recommendationSupport: "understood_not_ranked",
  evidencePhrase: "feels successful",
  userEdited: false,
  editableType: "text",
  canRemove: true,
};
const draftWithUnsupported = {
  ...unsupportedDraft,
  items: [...unsupportedDraft.items, unsupportedItem],
};
const confirmationView = buildConfirmationCommunicationViewModel(
  draftWithUnsupported,
  assessConfirmedPreferenceDraftReadiness(draftWithUnsupported),
);
assert.ok(
  confirmationView.policySummary.understoodNotScored.some(
    (item) => item.includes("cannot score it reliably"),
  ),
);

assert.equal(
  getOutOfScopeAdvisorMessage("I want a motorcycle"),
  "I understand that you’re asking about a motorcycle. This version currently focuses on passenger cars and light trucks.",
);

const repeatedView = buildAdvisorCommunicationViewModel(safetyContext);
assert.deepEqual(repeatedView, safetyView, "communication output must be deterministic");

const normalSafetyProfile = withPolicies(safetyProfile, [
  policy("bodyStyle", "enforced"),
  policy("safety", "active", 0.5),
  policy("purchaseBudget", "disabled"),
  policy("monthlyPayment", "disabled"),
  policy("affordability", "disabled"),
]);
const normalSafetyView = buildAdvisorCommunicationViewModel(getContext(normalSafetyProfile));
assert.notDeepEqual(
  normalSafetyView.policySummary.priorities,
  safetyView.policySummary.priorities,
  "policy revision must update visible wording",
);

const toyotaRequired = getContext(
  withPolicies(
    { ...baseProfile, requiredMake: "Toyota", requiredMakes: ["Toyota"] },
    [policy("make", "enforced")],
  ),
);
const noToyota = getContext(
  withPolicies(
    {
      ...baseProfile,
      requiredMake: undefined,
      requiredMakes: [],
      excludedMakes: ["Toyota"],
    },
    [policy("make", "enforced")],
  ),
);
assert.ok(
  toyotaRequired.decisionSet.primaryRecommendations.every(
    (item) => item.vehicle.make === "Toyota",
  ),
);
assert.ok(
  noToyota.decisionSet.primaryRecommendations.every(
    (item) => item.vehicle.make !== "Toyota",
  ),
  "a correction must not retain a stale Toyota recommendation",
);
assert.notEqual(
  buildAdvisorCommunicationViewModel(toyotaRequired).snapshotVehicleId,
  buildAdvisorCommunicationViewModel(noToyota).snapshotVehicleId,
  "follow-up profile changes must produce a new recommendation snapshot",
);

const componentSource = readFileSync(
  join(process.cwd(), "components/BuyerProfilePlanner.tsx"),
  "utf8",
);
assert.ok(componentSource.includes('validActions.includes("CONFIRM_PROFILE")'));
assert.ok(componentSource.includes("Answer one more question"));
assert.ok(componentSource.includes("clearCurrentSearchResult(\"I’m updating the current profile"));
assert.ok(componentSource.includes("!outOfScopeMessage && !currentQuestion"));

console.log("Advisor communication contract passed.");
console.table([
  {
    case: "safety first, price ignored",
    mode: safetyView.mode,
    vehicle: safetyView.snapshotVehicleId,
    headline: safetyView.advisorHeadline,
  },
  {
    case: "Tesla required",
    mode: noMatchView.mode,
    vehicle: "none",
    headline: noMatchView.advisorHeadline,
  },
  {
    case: "constraint only",
    mode: constraintOnlyView.mode,
    vehicle: constraintOnlyView.snapshotVehicleId,
    headline: constraintOnlyView.advisorHeadline,
  },
]);

function getContext(profile: BuyerProfile) {
  const decisionSet = runCandidatePipeline(profile, catalog, {
    includeCompromises: true,
    includeExcluded: true,
  }).decisionSet;
  return {
    decisionSet,
    decisionReport: buildDecisionReport(decisionSet),
    profile,
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
): DecisionParticipationPolicy {
  return {
    dimension,
    participation,
    importance,
    source: "user_explicit",
    confidence: 1,
    confirmation: "explicit",
    sourceText: `${dimension}:${participation}`,
    messageRef: "turn-1",
    explanation: "Test policy.",
  };
}

function formatName(item: RecommendationDecisionSet["primaryRecommendations"][number]) {
  return `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`;
}
