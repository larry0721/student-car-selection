import assert from "node:assert/strict";
import {
  answerConversationQuestion,
  createConversationIntakeSession,
  requestAnotherConversationQuestion,
} from "../lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  carryForwardConfirmedPreferenceDraft,
  confirmPreferenceItem,
  createConfirmedPreferenceProfile,
  removePreferenceItem,
  updateConfirmedPreferenceItem,
  type ConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
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

const bmwSession = answerConversationQuestion(
  createConversationIntakeSession("I want a BMW, but repairs cannot be expensive."),
  "The badge isn't required. I mainly like the style.",
);
let bmwDraft = createConfirmedPreferenceProfile(bmwSession, defaults);
const styleItem = findItemByLabel(bmwDraft, "Design and image matter");
const maintenanceItem = requireItemByField(bmwDraft, "reliabilityImportance");
bmwDraft = confirmPreferenceItem(confirmPreferenceItem(bmwDraft, styleItem.id), maintenanceItem.id);
assert.equal(requireItemByField(bmwDraft, "preferredMake").constraintStrength, "preferred");
assert.equal(findItemByField(bmwDraft, "requiredMake"), undefined);
assert.equal(bmwDraft.explicitHardConstraints.some((item) => item.field === "preferredMake"), false);
assert.equal(bmwDraft.confirmedUpdates.reliabilityImportance, 4);
assert.ok(bmwDraft.advisorSummary.includes("BMW is preferred"));

const awdSession = answerConversationQuestion(
  createConversationIntakeSession("I need something for winter."),
  "I drive in snow every day, so AWD is required.",
);
let awdDraft = createConfirmedPreferenceProfile(awdSession, defaults);
const awdItem = findItemByField(awdDraft, "drivetrainPreference");
assert.ok(awdItem);
assert.equal(awdItem.constraintStrength, "required");
awdDraft = updateConfirmedPreferenceItem(awdDraft, awdItem.id, { constraintStrength: "preferred", certainty: "confirmed" });
assert.equal(requireItemByField(awdDraft, "drivetrainPreference").constraintStrength, "preferred");
assert.equal(awdDraft.explicitHardConstraints.some((item) => item.field === "drivetrainPreference"), false);

const highBudgetSession = createConversationIntakeSession("I have around $50,000 for a car.");
let budgetDraft = createConfirmedPreferenceProfile(highBudgetSession, defaults);
const budgetItem = findItemByField(budgetDraft, "maxPurchaseBudget");
assert.ok(budgetItem);
assert.equal(budgetItem.value, 50000);
budgetDraft = updateConfirmedPreferenceItem(budgetDraft, budgetItem.id, {
  value: 25000,
  displayValue: "Up to $25,000",
  certainty: "confirmed",
  constraintStrength: "required",
  evidencePhrase: "User correction: $25,000 firm maximum",
});
assert.equal(requireItemByField(budgetDraft, "maxPurchaseBudget").value, 25000);
assert.equal(requireItemByField(budgetDraft, "maxPurchaseBudget").userEdited, true);
assert.equal(requireItemByField(budgetDraft, "maxPurchaseBudget").evidencePhrase, "User correction: $25,000 firm maximum");
assert.equal(budgetDraft.confirmedUpdates.maxPurchaseBudget, 25000);

const performanceSession = createConversationIntakeSession("I want something powerful.");
let performanceDraft = createConfirmedPreferenceProfile(performanceSession, defaults);
const performanceItem = findItemByField(performanceDraft, "performanceImportance");
assert.ok(performanceItem);
performanceDraft = removePreferenceItem(performanceDraft, performanceItem.id);
assert.equal(findItemByField(performanceDraft, "performanceImportance"), undefined);
assert.ok(performanceDraft.items.some((item) => item.field === "maxPurchaseBudget"), "other profile information should remain");

const unansweredDraft = createConfirmedPreferenceProfile(createConversationIntakeSession("I want a safe first car under $15,000."), defaults);
const paymentItem = findItemByField(unansweredDraft, "paymentMethod");
assert.ok(paymentItem);
assert.equal(paymentItem.certainty, "needs_answer");
assert.equal(paymentItem.displayValue, "Not specified");
assert.equal(unansweredDraft.confirmedUpdates.paymentMethod, undefined);

const confirmationReady = answerConversationQuestion(createConversationIntakeSession("I want something safe."), "$15,000 maximum.");
const anotherQuestion = requestAnotherConversationQuestion(confirmationReady);
assert.equal(anotherQuestion.intakeStatus, "awaiting_clarification");
assert.ok(anotherQuestion.currentQuestion, "ask another question should reopen one relevant question");
const rememberedDraft = createConfirmedPreferenceProfile(anotherQuestion, defaults);
assert.equal(requireItemByField(rememberedDraft, "maxPurchaseBudget").value, 15000);

let correctedBeforeAnotherQuestion = createConfirmedPreferenceProfile(createConversationIntakeSession("I want a BMW that looks premium."), defaults);
const inferredStyle = findItemByLabel(correctedBeforeAnotherQuestion, "Design and image matter");
correctedBeforeAnotherQuestion = removePreferenceItem(correctedBeforeAnotherQuestion, inferredStyle.id);
correctedBeforeAnotherQuestion = updateConfirmedPreferenceItem(correctedBeforeAnotherQuestion, requireItemByField(correctedBeforeAnotherQuestion, "maxPurchaseBudget").id, {
  value: 25000,
  displayValue: "Up to $25,000",
  certainty: "confirmed",
  constraintStrength: "required",
  evidencePhrase: "User correction: $25,000 firm maximum",
});
correctedBeforeAnotherQuestion = updateConfirmedPreferenceItem(
  correctedBeforeAnotherQuestion,
  requireItemByField(correctedBeforeAnotherQuestion, "preferredMake").id,
  { certainty: "confirmed", constraintStrength: "required" },
);
const carriedDraft = carryForwardConfirmedPreferenceDraft(
  createConfirmedPreferenceProfile(requestAnotherConversationQuestion(createConversationIntakeSession("I want a BMW that looks premium.")), defaults),
  correctedBeforeAnotherQuestion,
);
assert.equal(requireItemByField(carriedDraft, "maxPurchaseBudget").value, 25000);
assert.equal(requireItemByField(carriedDraft, "maxPurchaseBudget").constraintStrength, "required");
assert.equal(requireItemByField(carriedDraft, "preferredMake").constraintStrength, "required");
assert.equal(findItemByLabelOrUndefined(carriedDraft, "Design and image matter"), undefined);

const approved = approveConfirmedPreferenceProfile(bmwDraft, bmwSession.conversationTurns.length + 1);
assert.equal(approved.userApproved, true);
assert.equal(approved.approvedAtSequence, bmwSession.conversationTurns.length + 1);
assertNoRecommendationPayload(approved);

console.log("Confirmation profile flow passed.");
console.log("BMW advisor summary:");
console.log(bmwDraft.advisorSummary);
console.log("Confirmed drafts:");
console.log(`BMW: ${JSON.stringify(summarizeDraft(bmwDraft))}`);
console.log(`AWD: ${JSON.stringify(summarizeDraft(awdDraft))}`);
console.log(`Budget: ${JSON.stringify(summarizeDraft(budgetDraft))}`);

function findItemByField(draft: ConfirmedPreferenceProfile, field: string) {
  return draft.items.find((item) => item.field === field);
}

function requireItemByField(draft: ConfirmedPreferenceProfile, field: string) {
  const item = findItemByField(draft, field);
  assert.ok(item, `Expected field ${field}`);
  return item;
}

function findItemByLabel(draft: ConfirmedPreferenceProfile, label: string) {
  const item = draft.items.find((candidate) => candidate.label === label);
  assert.ok(item, `Expected item ${label}`);
  return item;
}

function findItemByLabelOrUndefined(draft: ConfirmedPreferenceProfile, label: string) {
  return draft.items.find((candidate) => candidate.label === label);
}

function summarizeDraft(draft: ConfirmedPreferenceProfile) {
  return {
    confirmedUpdates: draft.confirmedUpdates,
    hardConstraints: draft.explicitHardConstraints.map((item) => `${item.label}: ${item.displayValue}`),
    flexiblePreferences: draft.flexiblePreferences.map((item) => `${item.label}: ${item.displayValue}`),
    unresolvedFields: draft.unresolvedFields.map((item) => `${item.label}: ${item.displayValue}`),
    advisorSummary: draft.advisorSummary,
  };
}

function assertNoRecommendationPayload(draft: ConfirmedPreferenceProfile) {
  const record = draft as unknown as Record<string, unknown>;
  assert.equal(record.recommendations, undefined);
  assert.equal(record.rankedVehicles, undefined);
  assert.equal(record.vehicleResults, undefined);
}
