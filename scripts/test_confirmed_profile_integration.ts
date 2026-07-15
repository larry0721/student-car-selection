import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approveConfirmedPreferenceProfile,
  confirmPreferenceItem,
  createConfirmedPreferenceProfile,
  removePreferenceItem,
  updateConfirmedPreferenceItem,
  type ConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import {
  answerConversationQuestion,
  createConversationIntakeSession,
} from "../lib/conversationIntake";
import { defaultScoreWeights, getRecommendationDecisionSet } from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

const vehicleCatalog = JSON.parse(readFileSync("data/processed/vehicleCatalog.json", "utf8")) as Vehicle[];

const defaults: BuyerProfile = {
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

const bmwPreferredDraft = approveDraft(
  confirmField(
    confirmField(
      updateConfirmedPreferenceItem(
        createConfirmedPreferenceProfile(
          answerConversationQuestion(
            createConversationIntakeSession("I want a BMW, but repairs cannot be expensive and I have a $25,000 budget."),
            "The badge isn't required. I mainly like the style.",
          ),
          defaults,
        ),
        "field:maxPurchaseBudget",
        {
          value: 25000,
          displayValue: "Up to $25,000",
          certainty: "confirmed",
          constraintStrength: "required",
          evidencePhrase: "User correction: $25,000 firm maximum",
        },
      ),
      "preferredMake",
    ),
    "reliabilityImportance",
  ),
);
const bmwPreferredConversion = convertConfirmedPreferencesToBuyerProfile(defaults, bmwPreferredDraft);
assert.equal(bmwPreferredConversion.buyerProfile.preferredMake, "BMW");
assert.equal(bmwPreferredConversion.buyerProfile.requiredMake, undefined);
assert.equal(bmwPreferredConversion.buyerProfile.maxPurchaseBudget, 25000);
assert.ok(bmwPreferredConversion.appliedSoftPreferences.some((item) => item.field === "preferredMake"));
assert.ok(bmwPreferredConversion.appliedHardConstraints.some((item) => item.field === "maxPurchaseBudget"));
const bmwPreferredDecisionSet = getRecommendationDecisionSet(bmwPreferredConversion.buyerProfile, vehicleCatalog);
assert.ok(
  bmwPreferredDecisionSet.primaryRecommendations.some((recommendation) => recommendation.vehicle.make !== "BMW"),
  "BMW preferred must allow non-BMW vehicles to qualify",
);

const bmwRequiredDraft = approveDraft(
  confirmField(
    updateConfirmedPreferenceItem(createConfirmedPreferenceProfile(createConversationIntakeSession("I only want a BMW."), defaults), "field:requiredMake", {
      certainty: "confirmed",
      constraintStrength: "required",
    }),
    "requiredMake",
  ),
);
const bmwRequiredConversion = convertConfirmedPreferencesToBuyerProfile(defaults, bmwRequiredDraft);
assert.equal(bmwRequiredConversion.buyerProfile.requiredMake, "BMW");
assert.equal(bmwRequiredConversion.buyerProfile.preferredMake, undefined);
const bmwRequiredDecisionSet = getRecommendationDecisionSet(bmwRequiredConversion.buyerProfile, vehicleCatalog);
assert.equal(bmwRequiredDecisionSet.primaryRecommendations.length, 0, "required BMW should honestly no-match when no BMW qualifies");

const awdRequiredDraft = approveDraft(
  createConfirmedPreferenceProfile(
    answerConversationQuestion(createConversationIntakeSession("I need something for winter."), "I drive in snow every day, so AWD is required."),
    defaults,
  ),
);
const awdRequiredConversion = convertConfirmedPreferencesToBuyerProfile(defaults, awdRequiredDraft);
assert.equal(awdRequiredConversion.buyerProfile.drivetrainPreference, "AWD");
const awdDecisionSet = getRecommendationDecisionSet(awdRequiredConversion.buyerProfile, vehicleCatalog);
assert.ok(
  awdDecisionSet.excludedRecommendations.some((recommendation) =>
    recommendation.hardConstraintResults.some((constraint) => constraint.code === "drivetrain" && !constraint.passed),
  ),
  "non-AWD vehicles should be excluded by the existing qualification engine",
);

const firmBudgetConversion = convertConfirmedPreferencesToBuyerProfile(defaults, approveDraft(budgetDraft(25000)));
assert.equal(firmBudgetConversion.buyerProfile.maxPurchaseBudget, 25000);
const firmBudgetDecisionSet = getRecommendationDecisionSet(firmBudgetConversion.buyerProfile, vehicleCatalog);
assert.ok(
  firmBudgetDecisionSet.primaryRecommendations.every((recommendation) => recommendation.vehicle.price <= 25000),
  "vehicles above the confirmed hard purchase cap must not qualify",
);

const performanceDraft = approveDraft(removePreferenceItem(createConfirmedPreferenceProfile(createConversationIntakeSession("I want something powerful."), defaults), "field:performanceImportance"));
const performanceConversion = convertConfirmedPreferencesToBuyerProfile(defaults, performanceDraft);
assert.equal(performanceConversion.buyerProfile.performanceImportance, defaults.performanceImportance);

assert.ok(bmwPreferredConversion.preservedDefaults.some((item) => item.field === "expectedAnnualMileage"));
assert.ok(bmwPreferredConversion.preservedDefaults.some((item) => item.field === "insuranceBudget"));
assert.ok(bmwPreferredConversion.preservedDefaults.every((item) => item.constraintStrength === "flexible"));

let editedAfterResults = bmwPreferredDraft;
editedAfterResults = updateConfirmedPreferenceItem(editedAfterResults, "field:maxPurchaseBudget", {
  value: 13000,
  displayValue: "Up to $13,000",
  certainty: "confirmed",
  constraintStrength: "required",
  evidencePhrase: "User correction: 13000",
});
const editedConversion = convertConfirmedPreferencesToBuyerProfile(defaults, approveDraft(editedAfterResults));
assert.equal(editedConversion.buyerProfile.maxPurchaseBudget, 13000);

const noMatchDraft = approveDraft(
  updateConfirmedPreferenceItem(
    confirmField(createConfirmedPreferenceProfile(createConversationIntakeSession("I only want a BMW under $13,000."), defaults), "requiredMake"),
    "field:maxPurchaseBudget",
    {
      value: 13000,
      displayValue: "Up to $13,000",
      certainty: "confirmed",
      constraintStrength: "required",
    },
  ),
);
const noMatchConversion = convertConfirmedPreferencesToBuyerProfile(defaults, noMatchDraft);
const noMatchDecisionSet = getRecommendationDecisionSet(noMatchConversion.buyerProfile, vehicleCatalog);
assert.equal(noMatchDecisionSet.primaryRecommendations.length, 0);
assert.ok(noMatchDecisionSet.excludedRecommendations.length > 0);

console.log("Confirmed profile integration passed.");
console.log("Converted profiles:");
console.log(`BMW preferred: ${JSON.stringify(summarizeProfile(bmwPreferredConversion.buyerProfile))}`);
console.log(`BMW required: ${JSON.stringify(summarizeProfile(bmwRequiredConversion.buyerProfile))}`);
console.log(`AWD required: ${JSON.stringify(summarizeProfile(awdRequiredConversion.buyerProfile))}`);
console.log(`Firm budget: ${JSON.stringify(summarizeProfile(firmBudgetConversion.buyerProfile))}`);
console.log("Recommendation results:");
console.log(`BMW preferred top: ${topName(bmwPreferredDecisionSet)}`);
console.log(`BMW required top: ${topName(bmwRequiredDecisionSet)}`);
console.log(`AWD required top: ${topName(awdDecisionSet)}`);
console.log(`Firm budget top: ${topName(firmBudgetDecisionSet)}`);
console.log(`No match count: ${noMatchDecisionSet.primaryRecommendations.length}`);

function approveDraft(draft: ConfirmedPreferenceProfile) {
  return approveConfirmedPreferenceProfile(draft, 99);
}

function budgetDraft(maxPurchaseBudget: number) {
  return updateConfirmedPreferenceItem(createConfirmedPreferenceProfile(createConversationIntakeSession(`I have $${maxPurchaseBudget} maximum.`), defaults), "field:maxPurchaseBudget", {
    value: maxPurchaseBudget,
    displayValue: `Up to $${maxPurchaseBudget.toLocaleString()}`,
    certainty: "confirmed",
    constraintStrength: "required",
  });
}

function confirmField(draft: ConfirmedPreferenceProfile, field: string) {
  const item = draft.items.find((candidate) => candidate.field === field);
  assert.ok(item, `Expected field ${field}`);
  return confirmPreferenceItem(draft, item.id);
}

function summarizeProfile(profile: BuyerProfile) {
  return {
    maxPurchaseBudget: profile.maxPurchaseBudget,
    monthlyBudget: profile.monthlyBudget,
    requiredMake: profile.requiredMake,
    preferredMake: profile.preferredMake,
    drivetrainPreference: profile.drivetrainPreference,
    reliabilityImportance: profile.reliabilityImportance,
    performanceImportance: profile.performanceImportance,
    safetyPriority: profile.safetyPriority,
    expectedAnnualMileage: profile.expectedAnnualMileage,
    insuranceBudget: profile.insuranceBudget,
  };
}

function topName(decisionSet: ReturnType<typeof getRecommendationDecisionSet>) {
  const top = decisionSet.primaryRecommendations[0]?.vehicle;
  return top ? `${top.year} ${top.make} ${top.model}` : "No match";
}
