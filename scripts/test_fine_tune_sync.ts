import assert from "node:assert/strict";
import {
  createFineTuneMetadataFromConversion,
  getProfileSourceLabel,
  markManualFieldEdit,
  summarizeFineTuneChanges,
  summarizeRecommendationChange,
} from "../lib/fineTuneProfile";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
  updateConfirmedPreferenceItem,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { answerConversationQuestion, createConversationIntakeSession } from "../lib/conversationIntake";
import { defaultScoreWeights } from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";

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

let budgetDraft = createConfirmedPreferenceProfile(createConversationIntakeSession("I need a safe first car under $15,000."), defaults);
budgetDraft = updateConfirmedPreferenceItem(budgetDraft, "field:maxPurchaseBudget", {
  value: 15000,
  displayValue: "Up to $15,000",
  certainty: "confirmed",
  constraintStrength: "required",
});
const budgetConversion = convertConfirmedPreferencesToBuyerProfile(defaults, approveConfirmedPreferenceProfile(budgetDraft, 2));
const budgetMetadata = createFineTuneMetadataFromConversion(budgetConversion);
assert.equal(budgetConversion.buyerProfile.maxPurchaseBudget, 15000);
assert.equal(budgetMetadata.maxPurchaseBudget?.certainty, "confirmed");
assert.equal(budgetMetadata.maxPurchaseBudget?.source, "user-confirmation");
assert.equal(budgetMetadata.expectedAnnualMileage?.source, "default");

const editedBudgetProfile = { ...budgetConversion.buyerProfile, maxPurchaseBudget: 20000 };
const editedBudgetMetadata = markManualFieldEdit(budgetMetadata, "maxPurchaseBudget", "budget", "required");
assert.equal(editedBudgetProfile.maxPurchaseBudget, 20000);
assert.equal(editedBudgetMetadata.maxPurchaseBudget?.source, "manual-edit");
assert.equal(editedBudgetMetadata.maxPurchaseBudget?.certainty, "confirmed");
assert.equal(summarizeFineTuneChanges(["maxPurchaseBudget"]).message, "You changed 1 preference: budget. Your current result still uses the previous profile.");

const multiple = summarizeFineTuneChanges(["maxPurchaseBudget", "drivetrainPreference", "requiredMake"]);
assert.equal(multiple.changedFields.length, 3);
assert.ok(multiple.message.includes("3 preferences"));

const bmwPreferredSession = answerConversationQuestion(
  createConversationIntakeSession("I want a BMW, but repairs cannot be expensive."),
  "The badge isn't required. I mainly like the style.",
);
let bmwDraft = createConfirmedPreferenceProfile(bmwPreferredSession, defaults);
bmwDraft = updateConfirmedPreferenceItem(bmwDraft, "field:preferredMake", {
  certainty: "confirmed",
  constraintStrength: "preferred",
});
const bmwPreferred = convertConfirmedPreferencesToBuyerProfile(defaults, approveConfirmedPreferenceProfile(bmwDraft, 3));
assert.equal(bmwPreferred.buyerProfile.preferredMake, "BMW");
assert.equal(bmwPreferred.buyerProfile.requiredMake, undefined);

const bmwRequiredProfile: BuyerProfile = {
  ...bmwPreferred.buyerProfile,
  preferredMake: undefined,
  requiredMake: "BMW",
};
const bmwRequiredMetadata = markManualFieldEdit(createFineTuneMetadataFromConversion(bmwPreferred), "requiredMake", "required make", "required");
assert.equal(bmwRequiredProfile.requiredMake, "BMW");
assert.equal(bmwRequiredMetadata.requiredMake?.source, "manual-edit");
assert.equal(bmwRequiredMetadata.requiredMake?.constraintStrength, "required");

const awdPreferredConversion = convertConfirmedPreferencesToBuyerProfile(
  defaults,
  approveConfirmedPreferenceProfile(
    createConfirmedPreferenceProfile(
      answerConversationQuestion(createConversationIntakeSession("I need something for winter."), "AWD would be nice, but it is flexible."),
      defaults,
    ),
    4,
  ),
);
assert.equal(awdPreferredConversion.buyerProfile.drivetrainPreference, "any", "preferred AWD should not silently become a hard requirement");
const awdRequiredProfile: BuyerProfile = { ...awdPreferredConversion.buyerProfile, drivetrainPreference: "AWD" };
assert.equal(awdRequiredProfile.drivetrainPreference, "AWD");

const recommendationSummary = summarizeRecommendationChange({
  changedFields: ["maxPurchaseBudget"],
  topBefore: "2014 Toyota Corolla",
  topAfter: "2015 Toyota Prius",
  qualifiedBefore: 20,
  qualifiedAfter: 42,
});
assert.ok(recommendationSummary.message.includes("budget"));
assert.ok(recommendationSummary.message.includes("changed from 2014 Toyota Corolla to 2015 Toyota Prius"));
assert.ok(recommendationSummary.message.includes("up from 20"));

assert.equal(getProfileSourceLabel({ hasConversation: true, hasManualEdits: false }), "Advisor conversation");
assert.equal(getProfileSourceLabel({ hasConversation: true, hasManualEdits: true }), "Advisor conversation with manual edits");
assert.equal(getProfileSourceLabel({ hasConversation: false, hasManualEdits: true }), "Manual details");
assert.equal(getProfileSourceLabel({ hasConversation: false, hasManualEdits: false }), "App defaults");

console.log("Fine-tuning synchronization passed.");
console.log("Before/after examples:");
console.log(`Budget edit: ${JSON.stringify({ before: 15000, after: editedBudgetProfile.maxPurchaseBudget, source: editedBudgetMetadata.maxPurchaseBudget?.source })}`);
console.log(`BMW preferred to required: ${JSON.stringify({ before: bmwPreferred.buyerProfile.preferredMake, after: bmwRequiredProfile.requiredMake })}`);
console.log(`AWD preferred to required: ${JSON.stringify({ before: awdPreferredConversion.buyerProfile.drivetrainPreference, after: awdRequiredProfile.drivetrainPreference })}`);
