import assert from "node:assert/strict";
import {
  answerConversationQuestion,
  answerConversationQuestionWithSemantic,
  createConversationIntakeSession,
  prepareConversationRevisionSession,
} from "../lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  carryForwardConfirmedPreferenceDraft,
  createConfirmedPreferenceProfile,
  type ConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { defaultScoreWeights } from "../lib/recommendations";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
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

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const deterministicService = createSemanticUnderstandingService({ providerMode: "deterministic" });

  const directBudgetSession = createConversationIntakeSession("I want to keep it under $25,000.");
  const directBudgetDraft = createConfirmedPreferenceProfile(directBudgetSession, defaults);
  assert.equal(budgetValue(directBudgetDraft), 25000, "an explicit opening budget must reach confirmation");

  const clarificationSession = createConversationIntakeSession("I want something safe and reliable.");
  const defaultDraftBeforeAnswer = createConfirmedPreferenceProfile(clarificationSession, defaults);
  const answeredBudgetSession = answerConversationQuestion(clarificationSession, "$25,000 maximum.");
  const answeredBudgetDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(answeredBudgetSession, defaults),
    defaultDraftBeforeAnswer,
  );
  assert.equal(budgetValue(answeredBudgetDraft), 25000, "an explicit clarification must replace the assumed default");

  const approvedBudget = approveConfirmedPreferenceProfile(
    answeredBudgetDraft,
    answeredBudgetSession.conversationTurns.length + 1,
  );
  const budgetConversion = convertConfirmedPreferencesToBuyerProfile(defaults, approvedBudget);
  assert.equal(budgetConversion.buyerProfile.maxPurchaseBudget, 25000, "the confirmed budget must reach BuyerProfile");

  const revisedSession = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(answeredBudgetSession, budgetConversion.buyerProfile),
    "Actually make that $22,000.",
    deterministicService,
  );
  const revisedDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(revisedSession, budgetConversion.buyerProfile),
    answeredBudgetDraft,
  );
  assert.equal(budgetValue(revisedDraft), 22000, "the latest explicit budget revision must win");
  const revisedConversion = convertConfirmedPreferencesToBuyerProfile(
    budgetConversion.buyerProfile,
    approveConfirmedPreferenceProfile(revisedDraft, revisedSession.conversationTurns.length + 1),
  );
  assert.equal(revisedConversion.buyerProfile.maxPurchaseBudget, 22000, "the revised budget must reach BuyerProfile");

  const unrelatedFollowUpSession = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(answeredBudgetSession, budgetConversion.buyerProfile),
    "Mostly commuting to school.",
    deterministicService,
  );
  const unrelatedFollowUpDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(unrelatedFollowUpSession, budgetConversion.buyerProfile),
    answeredBudgetDraft,
  );
  assert.equal(budgetValue(unrelatedFollowUpDraft), 25000, "an unrelated follow-up must preserve the explicit budget");

  const noBudgetDraft = createConfirmedPreferenceProfile(
    createConversationIntakeSession("I want something reliable."),
    defaults,
  );
  assert.equal(budgetValue(noBudgetDraft), 18000, "the existing default remains available when no budget was expressed");
  assert.equal(
    noBudgetDraft.items.find((item) => item.field === "maxPurchaseBudget")?.certainty,
    "assumed_default",
  );

  console.log("Budget state regression passed 6 scenarios.");
}

function budgetValue(draft: ConfirmedPreferenceProfile) {
  const item = draft.items.find((candidate) => candidate.field === "maxPurchaseBudget");
  assert.ok(item, "Expected a purchase-budget confirmation item");
  return item.value;
}
