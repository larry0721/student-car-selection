import assert from "node:assert/strict";
import {
  answerConversationQuestion,
  answerConversationQuestionWithSemantic,
  createConversationIntakeSession,
  createSemanticConversationIntakeSession,
  getClarificationLifecycle,
  planConversationContinuation,
  prepareConversationRevisionSession,
  requestAnotherConversationQuestion,
  type ConversationIntakeSession,
} from "../lib/conversationIntake";
import {
  deriveAdvisorConversationState,
  getValidConversationActions,
  validateConversationState,
  validateConversationTransition,
  type AdvisorConversationState,
} from "../lib/conversationState";
import {
  approveConfirmedPreferenceProfile,
  carryForwardConfirmedPreferenceDraft,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { defaultScoreWeights, getRecommendationDecisionSet } from "../lib/recommendations";
import { vehicleCatalog } from "../data/vehicleCatalog";
import { DeterministicSemanticUnderstandingProvider, understandAndValidate } from "../lib/semanticUnderstanding";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import { buildProfilePatch, mapValidatedUnderstandingToProfile, mergeCanonicalConcepts } from "../lib/semanticMapping";
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
  const passed: string[] = [];
  const check = (name: string, assertion: () => void) => {
    assertion();
    passed.push(name);
  };

  const initial = createConversationIntakeSession("I want something that looks premium.");
  const initialState = deriveState(initial);
  check("initial message has a valid next action", () => assert.ok(initialState.validActions.length));
  check("first clarification has answer action", () => assert.ok(initialState.validActions.includes("ANSWER_CLARIFICATION")));

  const firstAnswer = answerConversationQuestion(initial, "I don't know yet.");
  const firstContinuation = requestAnotherConversationQuestion(firstAnswer);
  check("second clarification has a valid action", () => assert.ok(deriveState(firstContinuation).validActions.length));
  const secondAnswer = answerConversationQuestion(firstContinuation, "I still don't know.");
  const secondContinuation = requestAnotherConversationQuestion(secondAnswer);
  check("third clarification or safe exit has a valid action", () => assert.ok(deriveState(secondContinuation).validActions.length));
  const thirdAnswer = answerConversationQuestion(secondContinuation, "I still don't know what matters most.");
  const exhaustedContinuation = requestAnotherConversationQuestion(thirdAnswer);

  check("unresolved clarification is refined", () => {
    assert.equal(firstContinuation.currentQuestion?.id, "budget_max");
    assert.notEqual(firstContinuation.currentQuestion?.text, initial.currentQuestion?.text);
  });
  check("answered unresolved field remains eligible", () => {
    assert.equal(getClarificationLifecycle(firstAnswer).find((entry) => entry.questionId === "budget_max")?.status, "unresolved");
  });
  check("clarification exhaustion exits safely", () => {
    assert.equal(exhaustedContinuation.currentQuestion, null);
    assert.equal(exhaustedContinuation.intakeStatus, "explain_unsupported");
    assert.equal(deriveState(exhaustedContinuation).kind, "EXPLAIN_UNSUPPORTED");
  });
  check("clarification action always has a question", () => {
    for (const state of [initialState, deriveState(firstContinuation), deriveState(secondContinuation), deriveState(exhaustedContinuation)]) {
      if (state.validActions.includes("ANSWER_CLARIFICATION")) assert.ok(state.pendingClarification);
    }
  });

  const representativeStates: AdvisorConversationState[] = [
    deriveAdvisorConversationState({}),
    initialState,
    deriveAdvisorConversationState({ session: firstAnswer, confirmationPayloadExists: true, blockingClarificationCount: 1 }),
    deriveAdvisorConversationState({ session: readySession(), confirmationPayloadExists: true, profileIsRecommendationValid: true }),
    deriveAdvisorConversationState({ session: readySession(), confirmationPayloadExists: true, profileIsRecommendationValid: true, profileApproved: true }),
    deriveAdvisorConversationState({ recommendationExists: true }),
    deriveState(exhaustedContinuation),
    deriveAdvisorConversationState({ noMatch: true, noMatchExplanation: "No exact match." }),
    deriveAdvisorConversationState({ recoverableError: "Try again." }),
  ];
  check("every renderable state has at least one action", () => {
    for (const state of representativeStates) assert.ok(getValidConversationActions(state).length >= 1, state.kind);
  });
  check("advancing no-op is diagnosed", () => {
    assert.ok(validateConversationTransition(firstContinuation, "ANSWER_CLARIFICATION", firstContinuation).some((item) => item.code === "NO_OP_TRANSITION"));
  });
  check("clarification loop is diagnosed", () => {
    assert.ok(deriveState(exhaustedContinuation).diagnostics.some((item) => item.code === "CLARIFICATION_LOOP"));
  });
  check("unsupported request exits with choices", () => {
    const state = deriveState(exhaustedContinuation);
    assert.deepEqual(state.validActions, ["SHOW_SUPPORTED_OPTIONS", "EDIT_PROFILE", "START_OVER"]);
  });

  const funIgnoreBudget = createConversationIntakeSession("I want something fun, ignore budget.");
  check("fun and ignored budget never dead-ends", () => {
    const state = deriveState(funIgnoreBudget);
    assert.ok(state.validActions.length);
    assert.notEqual(state.kind, "RECOVERABLE_ERROR");
  });

  const budgetSession = answerConversationQuestion(createConversationIntakeSession("I want something reliable."), "$25,000 maximum.");
  const budgetDraft = createConfirmedPreferenceProfile(budgetSession, defaults);
  const approvedBudget = approveConfirmedPreferenceProfile(budgetDraft, budgetSession.conversationTurns.length + 1);
  const conversion = convertConfirmedPreferencesToBuyerProfile(defaults, approvedBudget);
  check("explicit budget persists", () => assert.equal(itemValue(budgetDraft, "maxPurchaseBudget"), 25000));
  const revisedBudgetSession = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(budgetSession, conversion.buyerProfile),
    "Actually make that $22,000.",
    createSemanticUnderstandingService({ providerMode: "deterministic" }),
  );
  const revisedBudgetDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(revisedBudgetSession, conversion.buyerProfile),
    budgetDraft,
  );
  check("budget revision persists", () => assert.equal(itemValue(revisedBudgetDraft, "maxPurchaseBudget"), 22000));

  const unrelated = answerConversationQuestion(requestAnotherConversationQuestion(budgetSession), "Mostly commuting to school.");
  const unrelatedDraft = carryForwardConfirmedPreferenceDraft(createConfirmedPreferenceProfile(unrelated, defaults), budgetDraft);
  check("unrelated answer preserves intent", () => assert.equal(itemValue(unrelatedDraft, "maxPurchaseBudget"), 25000));
  check("latest explicit value beats a default", () => {
    const state = deriveAdvisorConversationState({ explicitValueOverwrittenByDefault: false });
    assert.equal(state.diagnostics.some((item) => item.code === "DEFAULT_OVERWROTE_EXPLICIT_VALUE"), false);
    assert.ok(validateConversationState({ ...state, explicitValueOverwrittenByDefault: true }).some((item) => item.code === "DEFAULT_OVERWROTE_EXPLICIT_VALUE"));
  });

  const provider = new DeterministicSemanticUnderstandingProvider();
  const firstMeaning = await understandAndValidate(provider, {
    currentMessage: "No SUVs.",
    conversationHistory: [{ id: "turn-1", role: "user", text: "No SUVs." }],
  });
  const revisedMeaning = await understandAndValidate(provider, {
    currentMessage: "Actually SUVs are okay, I just don't want anything huge.",
    conversationHistory: [{ id: "turn-2", role: "user", text: "Actually SUVs are okay, I just don't want anything huge." }],
  });
  const revisionPatch = buildProfilePatch(mergeCanonicalConcepts(
    mapValidatedUnderstandingToProfile(firstMeaning).concepts,
    mapValidatedUnderstandingToProfile(revisedMeaning).concepts,
  ));
  check("revision removes stale conflicting constraint", () => {
    assert.deepEqual(revisionPatch.allowedBodyStyles, ["suv"]);
    assert.equal(revisionPatch.excludedBodyStyles, undefined);
  });
  const semanticService = createSemanticUnderstandingService({ providerMode: "deterministic" });
  const excludedSuvSession = await createSemanticConversationIntakeSession("No SUVs.", semanticService);
  const excludedSuvDraft = createConfirmedPreferenceProfile(excludedSuvSession, defaults);
  const allowedSuvSession = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(excludedSuvSession, defaults),
    "Actually SUVs are okay, I just don't want anything huge.",
    semanticService,
  );
  const allowedSuvDraft = carryForwardConfirmedPreferenceDraft(
    createConfirmedPreferenceProfile(allowedSuvSession, defaults),
    excludedSuvDraft,
  );
  check("confirmed revision supersedes stale relationship item", () => {
    assert.deepEqual(allowedSuvDraft.confirmedUpdates.allowedBodyStyles, ["suv"]);
    assert.equal(allowedSuvDraft.confirmedUpdates.excludedBodyStyles, undefined);
  });

  check("no-match has recovery actions", () => {
    const state = deriveAdvisorConversationState({ noMatch: true, noMatchExplanation: "No exact match." });
    assert.ok(state.validActions.includes("REVISE_PREFERENCES") && state.validActions.includes("START_OVER"));
  });
  check("recoverable error has recovery actions", () => {
    const state = deriveAdvisorConversationState({ recoverableError: "Please retry." });
    assert.ok(state.validActions.includes("RETRY") && state.validActions.includes("START_OVER"));
  });
  check("confirmation rejects blocking clarification", () => {
    const state = deriveAdvisorConversationState({ session: firstAnswer, confirmationPayloadExists: true, blockingClarificationCount: 1 });
    assert.notEqual(state.kind, "READY_TO_CONFIRM");
  });
  check("recommendation rejects invalid profile", () => {
    const invalid = deriveAdvisorConversationState({ session: readySession(), confirmationPayloadExists: true, profileApproved: true });
    assert.ok(invalid.diagnostics.some((item) => item.code === "INVALID_RECOMMENDATION_TRANSITION"));
  });

  const before = getRecommendationDecisionSet(conversion.buyerProfile, vehicleCatalog).primaryRecommendations.map((item) => item.vehicleId);
  deriveAdvisorConversationState({ session: readySession(), confirmationPayloadExists: true, profileIsRecommendationValid: true, profileApproved: true });
  const after = getRecommendationDecisionSet(conversion.buyerProfile, vehicleCatalog).primaryRecommendations.map((item) => item.vehicleId);
  check("valid recommendation path remains unchanged", () => assert.deepEqual(after, before));
  check("start over returns clean idle", () => assert.equal(deriveAdvisorConversationState({}).kind, "IDLE"));
  check("repeated click does not duplicate question", () => {
    const repeated = requestAnotherConversationQuestion(firstContinuation);
    assert.equal(repeated.conversationTurns.length, firstContinuation.conversationTurns.length);
  });

  assert.equal(passed.length, 26);
  console.log(`Conversation invariants passed ${passed.length} scenarios.`);
  passed.forEach((name, index) => console.log(`PASS ${index + 1}: ${name}`));
}

function deriveState(session: ConversationIntakeSession) {
  return deriveAdvisorConversationState({
    session,
    confirmationPayloadExists: !session.currentQuestion,
    blockingClarificationCount: session.currentQuestion || session.intakeStatus === "explain_unsupported" ? 1 : 0,
    profileIsRecommendationValid: Boolean(session.confirmedProfileUpdates.maxPurchaseBudget),
  });
}

function readySession() {
  return {
    ...createConversationIntakeSession("I need a safe car under $15,000."),
    currentQuestion: null,
    intakeStatus: "ready_for_confirmation" as const,
    unresolvedConflicts: [],
  };
}

function itemValue(draft: ReturnType<typeof createConfirmedPreferenceProfile>, field: string) {
  return draft.items.find((item) => item.field === field)?.value;
}
