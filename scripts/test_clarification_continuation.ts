import assert from "node:assert/strict";
import {
  answerConversationQuestion,
  answerConversationQuestionWithSemantic,
  createConversationIntakeSession,
  prepareConversationRevisionSession,
  requestAnotherConversationQuestion,
} from "../lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  carryForwardConfirmedPreferenceDraft,
  createConfirmedPreferenceProfile,
  type ConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { assessConfirmedProfileConversionReadiness } from "../lib/recommendationReadiness";
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
  const opening = createConversationIntakeSession("I want something that looks premium.");
  const afterUnknownBudget = answerConversationQuestion(opening, "I don't know yet.");
  const exhausted = {
    ...afterUnknownBudget,
    answeredQuestionIds: [...afterUnknownBudget.answeredQuestionIds, "daily_use" as const],
    currentQuestion: null,
    intakeStatus: "ready_for_confirmation" as const,
  };
  const preservedBeforeContinuation = createConfirmedPreferenceProfile(exhausted, defaults);

  assert.equal(exhausted.currentQuestion, null, "the fixture must reproduce a not-ready confirmation state");
  const continued = requestAnotherConversationQuestion(exhausted);
  assert.equal(continued.intakeStatus, "awaiting_clarification", "the CTA must reopen clarification");
  assert.ok(continued.currentQuestion, "the CTA must display exactly one useful clarification");
  assert.equal(
    continued.conversationTurns.length,
    exhausted.conversationTurns.length + 1,
    "continuation must append one advisor clarification",
  );

  const answered = answerConversationQuestion(continued, "$25,000 maximum.");
  const answeredDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(answered, defaults),
    preservedBeforeContinuation,
  );
  assert.equal(itemValue(answeredDraft, "maxPurchaseBudget"), 25000, "clarification must update BuyerProfile input");
  assert.ok(
    answeredDraft.items.some((item) => item.label === "Design and image matter"),
    "previously understood preferences must survive clarification",
  );

  const conversion = convertConfirmedPreferencesToBuyerProfile(
    defaults,
    approveConfirmedPreferenceProfile(answeredDraft, answered.conversationTurns.length + 1),
  );
  assert.equal(conversion.buyerProfile.maxPurchaseBudget, 25000);
  assert.equal(assessConfirmedProfileConversionReadiness(conversion).ready, true, "a sufficient answer must unblock recommendations");

  const revisedSession = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(answered, conversion.buyerProfile),
    "Actually make that $22,000.",
    deterministicService,
  );
  const revisedDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(revisedSession, conversion.buyerProfile),
    answeredDraft,
  );
  assert.equal(itemValue(revisedDraft, "maxPurchaseBudget"), 22000, "the newest explicit value must win");

  const unrelatedSession = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(answered, conversion.buyerProfile),
    "Mostly commuting to school.",
    deterministicService,
  );
  const unrelatedDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(unrelatedSession, conversion.buyerProfile),
    answeredDraft,
  );
  assert.equal(itemValue(unrelatedDraft, "maxPurchaseBudget"), 25000, "an unrelated answer must preserve confirmed budget");

  const repeated = requestAnotherConversationQuestion(continued);
  assert.equal(repeated.conversationTurns.length, continued.conversationTurns.length, "repeated activation must not duplicate the question");
  assert.equal(repeated.currentQuestion?.id, continued.currentQuestion?.id);

  const reset = createConversationIntakeSession("I want something reliable.");
  assert.equal(reset.conversationTurns.some((turn) => turn.text.includes("25,000")), false, "a fresh session must not retain prior answers");
  assert.equal(reset.confirmedProfileUpdates.maxPurchaseBudget, undefined, "Start over semantics must reset explicit budget state");

  console.log("Clarification continuation passed 7 scenarios.");
}

function itemValue(draft: ConfirmedPreferenceProfile, field: string) {
  return draft.items.find((item) => item.field === field)?.value;
}
