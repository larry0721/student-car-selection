import {
  interpretPreferenceMessage,
  type BuyerProfilePatch,
  type InferredPreference,
  type InterpretationConfidence,
  type PreferenceConflict,
  type PreferenceFact,
  type PreferenceFieldConfidence,
  type PreferenceInterpretation,
  type PreferenceUncertainty,
} from "./preferenceInterpretation";
import {
  preferenceInterpretationFromSemanticResult,
  preferenceInterpretationFromValidatedUnderstanding,
} from "./semanticPreferenceAdapter";
import {
  buildProfilePatch,
  mergeCanonicalConcepts,
  type CanonicalMappedConcept,
} from "./semanticMapping";
import { createSemanticUnderstandingService, type SemanticUnderstandingService } from "./semanticUnderstandingService";
import {
  understandDeterministically,
  type ValidatedUnderstanding,
} from "./semanticUnderstanding";
import {
  mergeDecisionParticipationPolicyMaps,
  policyAllowsClarification,
  policyIsPositiveCriterion,
} from "./decisionParticipationPolicy";
import { assessCatalogIntentFeasibility } from "./advisorIntegrity";
import { vehicleCatalog } from "../data/vehicleCatalog";
import type { BuyerProfile } from "../types/buyer";
import type { DecisionParticipationPolicyMap, DecisionPolicyDimension } from "../types/decisionPolicy";

export type IntakeStatus =
  | "awaiting_initial_message"
  | "awaiting_clarification"
  | "ready_for_confirmation"
  | "explain_unsupported"
  | "recoverable_error"
  | "confirmed";

export type IntakeTurnRole = "user" | "advisor";

export type IntakeQuestionCode =
  | "performance_meaning"
  | "make_flexibility"
  | "relationship_intent"
  | "budget_max"
  | "winter_traction"
  | "ownership_tradeoff"
  | "family_seating"
  | "daily_use"
  | "new_used";

export type IntakeQuestion = {
  id: IntakeQuestionCode;
  text: string;
  reason: string;
};

export type ConversationTurn = {
  id: string;
  role: IntakeTurnRole;
  text: string;
  intent?: string;
  questionCode?: IntakeQuestionCode;
  sequence: number;
};

export type ConversationIntakeSession = {
  conversationTurns: ConversationTurn[];
  accumulatedInterpretation: PreferenceInterpretation;
  confirmedProfileUpdates: BuyerProfilePatch;
  pendingProfileUpdates: BuyerProfilePatch;
  currentQuestion: IntakeQuestion | null;
  answeredQuestionIds: IntakeQuestionCode[];
  skippedQuestionIds: IntakeQuestionCode[];
  unresolvedUncertainties: PreferenceUncertainty[];
  unresolvedConflicts: PreferenceConflict[];
  interpretationConfidence: InterpretationConfidence;
  intakeStatus: IntakeStatus;
  semanticUnderstanding?: ValidatedUnderstanding | null;
  semanticProviderUsed?: "model" | "deterministic" | "fixture" | null;
  semanticFallbackUsed?: boolean;
  semanticFallbackReason?: string;
  semanticProviderFailure?: {
    code: string;
    message: string;
  };
  baselineProfile?: BuyerProfile;
};

export type ClarificationLifecycleStatus = "asked" | "answered" | "resolved" | "unresolved" | "superseded";

export type ClarificationLifecycleEntry = {
  questionId: IntakeQuestionCode;
  status: ClarificationLifecycleStatus;
  attempts: number;
  lastQuestionText: string;
};

export type ConversationContinuationPlan = {
  question: IntakeQuestion | null;
  outcome: "ask_clarification" | "ready_for_confirmation" | "explain_unsupported";
  reason: string;
};

type ClarificationAnswerResult = {
  profileUpdates: BuyerProfilePatch;
  explicitFacts: PreferenceFact[];
  inferredPreferences: InferredPreference[];
  confidenceByField: PreferenceFieldConfidence[];
  resolvedUncertaintyTopics: string[];
  resolvedConflictTopics: string[];
  newUncertainties: PreferenceUncertainty[];
  newConflicts: PreferenceConflict[];
  acknowledgement: string;
  evidencePhrase: string;
  canonicalMappings?: CanonicalMappedConcept[];
};

const maxClarifyingQuestions = 3;

export function createConversationIntakeSession(rawUserMessage: string): ConversationIntakeSession {
  const accumulatedInterpretation = interpretPreferenceMessage(rawUserMessage);
  return createConversationIntakeSessionFromInterpretation(rawUserMessage, accumulatedInterpretation, {
    semanticUnderstanding: null,
    semanticProviderUsed: "deterministic",
    semanticFallbackUsed: true,
  });
}

export function createDeterministicSemanticConversationIntakeSession(
  rawUserMessage: string,
): ConversationIntakeSession {
  const validatedUnderstanding = understandDeterministically({
    currentMessage: rawUserMessage,
    conversationHistory: [{ id: "turn-1", role: "user", text: rawUserMessage }],
  });
  const accumulatedInterpretation = preferenceInterpretationFromValidatedUnderstanding(
    rawUserMessage,
    validatedUnderstanding,
    "fallback",
  );
  return createConversationIntakeSessionFromInterpretation(rawUserMessage, accumulatedInterpretation, {
    semanticUnderstanding: validatedUnderstanding,
    semanticProviderUsed: "deterministic",
    semanticFallbackUsed: true,
  });
}

export async function createSemanticConversationIntakeSession(
  rawUserMessage: string,
  service: SemanticUnderstandingService = createSemanticUnderstandingService(),
): Promise<ConversationIntakeSession> {
  const semanticResult = await service.understand({
    currentMessage: rawUserMessage,
    conversationHistory: [{ id: "turn-1", role: "user", text: rawUserMessage }],
  });
  const accumulatedInterpretation = preferenceInterpretationFromSemanticResult(rawUserMessage, semanticResult);
  return createConversationIntakeSessionFromInterpretation(rawUserMessage, accumulatedInterpretation, {
    semanticUnderstanding: semanticResult.validatedUnderstanding,
    semanticProviderUsed: semanticResult.providerUsed,
    semanticFallbackUsed: semanticResult.fallbackUsed,
    semanticFallbackReason: semanticResult.fallbackReason,
    semanticProviderFailure: semanticResult.providerFailure,
  });
}

function createConversationIntakeSessionFromInterpretation(
  rawUserMessage: string,
  accumulatedInterpretation: PreferenceInterpretation,
  semanticMetadata: Pick<
    ConversationIntakeSession,
    | "semanticUnderstanding"
    | "semanticProviderUsed"
    | "semanticFallbackUsed"
    | "semanticFallbackReason"
    | "semanticProviderFailure"
  >,
): ConversationIntakeSession {
  const answeredQuestionIds: IntakeQuestionCode[] = [];
  const skippedQuestionIds: IntakeQuestionCode[] = [];
  const currentQuestion = selectNextQuestion(accumulatedInterpretation, answeredQuestionIds, skippedQuestionIds);
  const intakeStatus: IntakeStatus = currentQuestion ? "awaiting_clarification" : "ready_for_confirmation";
  const confirmedProfileUpdates = getConfirmedProfileUpdates(accumulatedInterpretation);
  const session: ConversationIntakeSession = {
    conversationTurns: [
      createTurn(1, "user", rawUserMessage, "initial_message"),
      createTurn(
        2,
        "advisor",
        currentQuestion
          ? `${accumulatedInterpretation.interpretationSummary} ${currentQuestion.text}`
          : "I think I understand enough to summarize what you're looking for.",
        "initial_interpretation",
        currentQuestion?.id,
      ),
    ],
    accumulatedInterpretation,
    confirmedProfileUpdates,
    pendingProfileUpdates: accumulatedInterpretation.suggestedProfileUpdates,
    currentQuestion,
    answeredQuestionIds,
    skippedQuestionIds,
    unresolvedUncertainties: accumulatedInterpretation.uncertainties,
    unresolvedConflicts: accumulatedInterpretation.conflicts,
    interpretationConfidence: calculateInterpretationConfidence(
      accumulatedInterpretation,
      accumulatedInterpretation.uncertainties,
      accumulatedInterpretation.conflicts,
    ),
    intakeStatus,
    ...semanticMetadata,
  };

  return session;
}

export function answerConversationQuestion(session: ConversationIntakeSession, answer: string): ConversationIntakeSession {
  const trimmedAnswer = answer.trim();
  if (!session.currentQuestion || !trimmedAnswer) return session;

  const result = interpretClarificationAnswer(session, trimmedAnswer);
  const answeredQuestionIds = [...session.answeredQuestionIds, session.currentQuestion.id];
  const skippedQuestionIds = session.skippedQuestionIds;
  const mergedInterpretation = mergePreferenceInterpretation(session.accumulatedInterpretation, result);
  const unresolvedUncertainties = mergeUncertainties(
    session.unresolvedUncertainties,
    result.resolvedUncertaintyTopics,
    result.newUncertainties,
  );
  const unresolvedConflicts = mergeConflicts(session.unresolvedConflicts, result.resolvedConflictTopics, result.newConflicts);
  const nextQuestion = selectNextQuestion(
    mergedInterpretation,
    answeredQuestionIds,
    skippedQuestionIds,
    unresolvedUncertainties,
    unresolvedConflicts,
    session.baselineProfile,
  );
  const intakeStatus: IntakeStatus = nextQuestion ? "awaiting_clarification" : "ready_for_confirmation";
  const nextSequence = session.conversationTurns.length + 1;
  const advisorText = nextQuestion
    ? `${result.acknowledgement} ${nextQuestion.text}`
    : `${result.acknowledgement} I think I understand enough to summarize what you're looking for.`;

  return {
    ...session,
    conversationTurns: [
      ...session.conversationTurns,
      createTurn(nextSequence, "user", trimmedAnswer, "clarification_answer", session.currentQuestion.id),
      createTurn(nextSequence + 1, "advisor", advisorText, "clarification_merge", nextQuestion?.id),
    ],
    accumulatedInterpretation: mergedInterpretation,
    confirmedProfileUpdates: {
      ...session.confirmedProfileUpdates,
      ...getConfirmedProfileUpdates(mergedInterpretation),
      ...getConfirmedProfileUpdatesFromResult(result),
    },
    pendingProfileUpdates: mergedInterpretation.suggestedProfileUpdates,
    currentQuestion: nextQuestion,
    answeredQuestionIds,
    unresolvedUncertainties,
    unresolvedConflicts,
    interpretationConfidence: calculateInterpretationConfidence(mergedInterpretation, unresolvedUncertainties, unresolvedConflicts),
    intakeStatus,
  };
}

export async function answerConversationQuestionWithSemantic(
  session: ConversationIntakeSession,
  answer: string,
  service: SemanticUnderstandingService = createSemanticUnderstandingService(),
): Promise<ConversationIntakeSession> {
  const trimmedAnswer = answer.trim();
  if (!trimmedAnswer) return session;

  const activeQuestion = session.currentQuestion;
  const semanticResult = await service.understand({
    currentMessage: trimmedAnswer,
    conversationHistory: [
      ...session.conversationTurns.map((turn) => ({
        id: turn.id,
        role: turn.role,
        text: turn.text,
        questionCode: turn.questionCode,
      })),
      { id: `turn-${session.conversationTurns.length + 1}`, role: "user", text: trimmedAnswer, questionCode: activeQuestion?.id },
    ],
    currentUnderstanding: session.semanticUnderstanding || undefined,
  });
  const semanticInterpretation = preferenceInterpretationFromSemanticResult(trimmedAnswer, semanticResult);
  const semanticAnswer = clarificationResultFromSemanticInterpretation(semanticInterpretation, trimmedAnswer);
  const useDeterministicFallback = semanticResult.fallbackUsed || semanticResult.providerUsed === "deterministic";
  const deterministicAnswer = activeQuestion
    ? interpretClarificationAnswer(session, trimmedAnswer)
    : emptyClarificationAnswerResult(trimmedAnswer);
  // A successful model response is authoritative for the user's answer. The
  // question-specific parser only supplements a true technical fallback.
  const result = useDeterministicFallback
    ? mergeClarificationAnswerResults(deterministicAnswer, semanticAnswer)
    : semanticAnswer;

  const answeredQuestionIds = activeQuestion
    ? [...session.answeredQuestionIds, activeQuestion.id]
    : session.answeredQuestionIds;
  const skippedQuestionIds = session.skippedQuestionIds;
  const mergedInterpretation = mergePreferenceInterpretation(session.accumulatedInterpretation, result);
  const unresolvedUncertainties = mergeUncertainties(
    session.unresolvedUncertainties,
    result.resolvedUncertaintyTopics,
    result.newUncertainties,
  );
  const unresolvedConflicts = mergeConflicts(session.unresolvedConflicts, result.resolvedConflictTopics, result.newConflicts);
  const nextQuestion = selectNextQuestion(
    mergedInterpretation,
    answeredQuestionIds,
    skippedQuestionIds,
    unresolvedUncertainties,
    unresolvedConflicts,
    session.baselineProfile,
  );
  const intakeStatus: IntakeStatus = nextQuestion ? "awaiting_clarification" : "ready_for_confirmation";
  const nextSequence = session.conversationTurns.length + 1;
  const advisorText = nextQuestion
    ? `${result.acknowledgement} ${nextQuestion.text}`
    : `${result.acknowledgement} I think I understand enough to summarize what you're looking for.`;

  return {
    ...session,
    conversationTurns: [
      ...session.conversationTurns,
      createTurn(nextSequence, "user", trimmedAnswer, "clarification_answer", activeQuestion?.id),
      createTurn(nextSequence + 1, "advisor", advisorText, "clarification_merge", nextQuestion?.id),
    ],
    accumulatedInterpretation: mergedInterpretation,
    confirmedProfileUpdates: {
      ...session.confirmedProfileUpdates,
      ...getConfirmedProfileUpdates(mergedInterpretation),
      ...getConfirmedProfileUpdatesFromResult(result),
    },
    pendingProfileUpdates: mergedInterpretation.suggestedProfileUpdates,
    currentQuestion: nextQuestion,
    answeredQuestionIds,
    unresolvedUncertainties,
    unresolvedConflicts,
    interpretationConfidence: calculateInterpretationConfidence(mergedInterpretation, unresolvedUncertainties, unresolvedConflicts),
    intakeStatus,
    semanticUnderstanding: semanticResult.validatedUnderstanding || session.semanticUnderstanding || null,
    semanticProviderUsed: semanticResult.providerUsed,
    semanticFallbackUsed: semanticResult.fallbackUsed,
    semanticFallbackReason: semanticResult.fallbackReason,
    semanticProviderFailure: semanticResult.providerFailure,
  };
}

export function skipConversationQuestion(session: ConversationIntakeSession): ConversationIntakeSession {
  if (!session.currentQuestion) return session;

  const skippedQuestionIds = [...session.skippedQuestionIds, session.currentQuestion.id];
  const nextQuestion = selectNextQuestion(
    session.accumulatedInterpretation,
    session.answeredQuestionIds,
    skippedQuestionIds,
    session.unresolvedUncertainties,
    session.unresolvedConflicts,
    session.baselineProfile,
  );
  const intakeStatus: IntakeStatus = nextQuestion ? "awaiting_clarification" : "ready_for_confirmation";
  const nextSequence = session.conversationTurns.length + 1;
  const advisorText = nextQuestion
    ? "That's okay. I can continue without it, but I'll treat that part of the recommendation with lower confidence. " +
      nextQuestion.text
    : "That's okay. I can continue without it, but I'll treat that part of the recommendation with lower confidence. I think I understand enough to summarize what you're looking for.";

  return {
    ...session,
    conversationTurns: [
      ...session.conversationTurns,
      createTurn(nextSequence, "user", "Skipped this question.", "skip_question", session.currentQuestion.id),
      createTurn(nextSequence + 1, "advisor", advisorText, "skip_acknowledgement", nextQuestion?.id),
    ],
    currentQuestion: nextQuestion,
    skippedQuestionIds,
    interpretationConfidence: downgradeConfidence(session.interpretationConfidence),
    intakeStatus,
  };
}

export function requestAnotherConversationQuestion(session: ConversationIntakeSession): ConversationIntakeSession {
  if (session.currentQuestion) return session;
  const plan = planConversationContinuation(session);

  if (!plan.question) {
    return {
      ...session,
      intakeStatus: plan.outcome === "ready_for_confirmation" ? "ready_for_confirmation" : "explain_unsupported",
    };
  }

  const nextSequence = session.conversationTurns.length + 1;
  return {
    ...session,
    conversationTurns: [
      ...session.conversationTurns,
      createTurn(nextSequence, "advisor", plan.question.text, "additional_question", plan.question.id),
    ],
    currentQuestion: plan.question,
    intakeStatus: "awaiting_clarification",
  };
}

export function planConversationContinuation(session: ConversationIntakeSession): ConversationContinuationPlan {
  if (session.currentQuestion) {
    return {
      question: session.currentQuestion,
      outcome: "ask_clarification",
      reason: "An actionable clarification is already active.",
    };
  }

  const nextQuestion = selectNextQuestion(
    session.accumulatedInterpretation,
    session.answeredQuestionIds,
    session.skippedQuestionIds,
    session.unresolvedUncertainties,
    session.unresolvedConflicts,
    session.baselineProfile,
  ) || fallbackQuestion(session);

  if (nextQuestion) {
    return {
      question: nextQuestion,
      outcome: "ask_clarification",
      reason: "The planner found a supported detail that can still affect the recommendation.",
    };
  }

  const updates = session.accumulatedInterpretation.suggestedProfileUpdates;
  const policies = mergeDecisionParticipationPolicyMaps(
    session.baselineProfile?.decisionPolicies,
    session.accumulatedInterpretation.decisionPolicies,
  );
  const enoughInformation = hasPositiveDecisionCriterion(updates) || Object.values(policies || {}).some(policyIsPositiveCriterion);
  return enoughInformation
    ? {
        question: null,
        outcome: "ready_for_confirmation",
        reason: "No useful clarification remains and the profile has a supported decision criterion.",
      }
    : {
        question: null,
        outcome: "explain_unsupported",
        reason: "No useful clarification remains and the understood request has no supported decision criterion.",
      };
}

export function getClarificationLifecycle(session: ConversationIntakeSession): ClarificationLifecycleEntry[] {
  const questionTurns = session.conversationTurns.filter(
    (turn): turn is ConversationTurn & { questionCode: IntakeQuestionCode } => turn.role === "advisor" && Boolean(turn.questionCode),
  );
  const questionIds = Array.from(new Set(questionTurns.map((turn) => turn.questionCode)));
  return questionIds.map((questionId) => {
    const attempts = questionTurns.filter((turn) => turn.questionCode === questionId).length;
    const lastQuestionText = [...questionTurns].reverse().find((turn) => turn.questionCode === questionId)?.text || "";
    const isActive = session.currentQuestion?.id === questionId;
    const wasAnswered = session.answeredQuestionIds.includes(questionId);
    const remainsUnresolved = questionNeedsRefinement(session, questionId);
    return {
      questionId,
      attempts,
      lastQuestionText,
      status: isActive
        ? "asked"
        : wasAnswered && remainsUnresolved
          ? "unresolved"
          : wasAnswered
            ? "resolved"
            : session.skippedQuestionIds.includes(questionId)
              ? "unresolved"
              : "superseded",
    };
  });
}

export function getLatestAdvisorTurn(session: ConversationIntakeSession) {
  return [...session.conversationTurns].reverse().find((turn) => turn.role === "advisor");
}

function fallbackQuestion(session: ConversationIntakeSession): IntakeQuestion | null {
  const updates = session.accumulatedInterpretation.suggestedProfileUpdates;
  const policies = mergeDecisionParticipationPolicyMaps(
    session.baselineProfile?.decisionPolicies,
    session.accumulatedInterpretation.decisionPolicies,
  );
  const effectivePurchaseBudget = updates.maxPurchaseBudget ?? session.baselineProfile?.maxPurchaseBudget;
  if (
    !effectivePurchaseBudget
    && policyAllowsClarification(policies, "purchaseBudget")
    && clarificationAttemptCount(session, "budget_max") < 2
  ) {
    return {
      id: "budget_max",
      text: clarificationAttemptCount(session, "budget_max") > 0
        ? "If you are unsure of an exact amount, what price range would still feel responsible—or should purchase price not limit the search?"
        : "What is the maximum purchase budget you want me to work within?",
      reason: "Budget strongly affects responsible recommendations.",
    };
  }
  if (!session.answeredQuestionIds.includes("daily_use") && !hasPositiveDecisionCriterion(updates)) {
    return {
      id: "daily_use",
      text: "What should matter most in the recommendation: reliability, safety, daily use, or the kind of vehicle?",
      reason: "A disabled preference does not provide a positive basis for a recommendation.",
    };
  }
  if (!session.answeredQuestionIds.includes("daily_use")) {
    return {
      id: "daily_use",
      text: "Will this car mostly be used for commuting, school, family driving, or bad weather?",
      reason: "Use case helps prioritize the next phase.",
    };
  }
  return null;
}

function clarificationAttemptCount(session: ConversationIntakeSession, questionId: IntakeQuestionCode) {
  return session.conversationTurns.filter(
    (turn) => turn.role === "advisor" && turn.questionCode === questionId,
  ).length;
}

function questionNeedsRefinement(session: ConversationIntakeSession, questionId: IntakeQuestionCode) {
  const updates = session.accumulatedInterpretation.suggestedProfileUpdates;
  const policies = mergeDecisionParticipationPolicyMaps(
    session.baselineProfile?.decisionPolicies,
    session.accumulatedInterpretation.decisionPolicies,
  );
  if (questionId === "budget_max") {
    return !(updates.maxPurchaseBudget ?? session.baselineProfile?.maxPurchaseBudget)
      && policyAllowsClarification(policies, "purchaseBudget");
  }
  if (questionId === "daily_use") return !hasPositiveDecisionCriterion(updates);
  return false;
}

export function getConciseUnderstanding(session: ConversationIntakeSession) {
  return {
    confirmedFacts: session.accumulatedInterpretation.explicitFacts.slice(0, 5),
    strongPreferences: session.accumulatedInterpretation.inferredPreferences.slice(0, 5),
    remainingUncertainty: session.unresolvedUncertainties[0],
    activeConflict: session.unresolvedConflicts[0],
  };
}

export function prepareConversationRevisionSession(
  session: ConversationIntakeSession,
  baselineProfile: BuyerProfile,
): ConversationIntakeSession {
  return {
    ...session,
    baselineProfile,
    currentQuestion: null,
    answeredQuestionIds: [],
    skippedQuestionIds: [],
    intakeStatus: "awaiting_initial_message",
  };
}

function interpretClarificationAnswer(session: ConversationIntakeSession, answer: string): ClarificationAnswerResult {
  switch (session.currentQuestion?.id) {
    case "performance_meaning":
      return interpretPerformanceAnswer(answer);
    case "make_flexibility":
      return interpretMakeFlexibilityAnswer(session, answer);
    case "relationship_intent":
      return interpretRelationshipIntentAnswer(session, answer);
    case "budget_max":
      return interpretBudgetAnswer(answer);
    case "winter_traction":
      return interpretWinterAnswer(answer);
    case "ownership_tradeoff":
      return interpretOwnershipTradeoffAnswer(answer);
    case "family_seating":
      return interpretFamilyAnswer(answer);
    case "daily_use":
      return interpretDailyUseAnswer(answer);
    case "new_used":
      return interpretNewUsedAnswer(answer);
    default:
      return {
        profileUpdates: {},
        explicitFacts: [],
        inferredPreferences: [],
        confidenceByField: [],
        resolvedUncertaintyTopics: [],
        resolvedConflictTopics: [],
        newUncertainties: [],
        newConflicts: [],
        acknowledgement: "That helps. I'll keep that answer with the rest of what you've told me.",
        evidencePhrase: answer,
      };
  }
}

function clarificationResultFromSemanticInterpretation(
  interpretation: PreferenceInterpretation,
  answer: string,
): ClarificationAnswerResult {
  const resolvedRelationshipConflicts = interpretation.conflicts.filter((conflict) =>
    isResolvedByCanonicalRelationshipIntent(conflict, interpretation.canonicalMappings)
  );
  const activeConflicts = interpretation.conflicts.filter(
    (conflict) => !resolvedRelationshipConflicts.includes(conflict),
  );
  return {
    profileUpdates: interpretation.suggestedProfileUpdates,
    explicitFacts: interpretation.explicitFacts,
    inferredPreferences: interpretation.inferredPreferences,
    confidenceByField: interpretation.confidenceByField,
    resolvedUncertaintyTopics: interpretation.confidenceByField.map((field) => topicForField(field.field)),
    resolvedConflictTopics: [
      ...resolvedRelationshipConflicts.map((conflict) => conflict.topic),
      ...(activeConflicts.length ? [] : ["Understanding unavailable"]),
    ],
    newUncertainties: interpretation.uncertainties,
    newConflicts: activeConflicts,
    acknowledgement: interpretation.interpretationSummary || "That helps. I'll keep that with the rest of what you've told me.",
    evidencePhrase: answer,
    canonicalMappings: interpretation.canonicalMappings,
  };
}

function isResolvedByCanonicalRelationshipIntent(
  conflict: PreferenceConflict,
  mappings: NonNullable<PreferenceInterpretation["canonicalMappings"]> = [],
) {
  const relationshipConcepts = new Set([
    "vehicle_make",
    "body_style",
    "vehicle_category",
    "fuel_type",
    "drivetrain",
    "transmission",
  ]);
  const conflictText = `${conflict.topic} ${conflict.description} ${conflict.evidencePhrases.join(" ")}`.toLowerCase();
  const describesRelationshipRevision = conflict.conflictType === "correction"
    || conflict.conflictType === "changed_mind"
    || (
      /\b(?:initially|earlier|previously|then|changed|revised|replaced|relaxed|no longer)\b/.test(conflictText)
      && /\b(?:excluded|allowed|required|preferred|wanted|did not want|don't want)\b/.test(conflictText)
    );
  if (!describesRelationshipRevision) return false;
  return mappings.some((mapping) =>
    relationshipConcepts.has(mapping.conceptType)
    && mapping.intent !== "uncertain"
    && mapping.confirmationStatus === "confirmed"
    && (Array.isArray(mapping.value) ? mapping.value : [mapping.value])
      .some((value) => conflictText.includes(String(value).toLowerCase()))
  );
}

function emptyClarificationAnswerResult(answer: string): ClarificationAnswerResult {
  return {
    profileUpdates: {},
    explicitFacts: [],
    inferredPreferences: [],
    confidenceByField: [],
    resolvedUncertaintyTopics: [],
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: "",
    evidencePhrase: answer,
    canonicalMappings: [],
  };
}

function mergeClarificationAnswerResults(
  primary: ClarificationAnswerResult,
  semantic: ClarificationAnswerResult,
): ClarificationAnswerResult {
  return {
    profileUpdates: mergeProfileUpdates(primary.profileUpdates, semantic.profileUpdates),
    explicitFacts: mergeFacts(primary.explicitFacts, semantic.explicitFacts),
    inferredPreferences: mergeInferredPreferences(primary.inferredPreferences, semantic.inferredPreferences, semantic.explicitFacts),
    confidenceByField: mergeConfidence(primary.confidenceByField, semantic.confidenceByField),
    resolvedUncertaintyTopics: Array.from(new Set([...primary.resolvedUncertaintyTopics, ...semantic.resolvedUncertaintyTopics])),
    resolvedConflictTopics: Array.from(new Set([...primary.resolvedConflictTopics, ...semantic.resolvedConflictTopics])),
    newUncertainties: mergeUncertainties(primary.newUncertainties, [], semantic.newUncertainties),
    newConflicts: mergeConflicts(primary.newConflicts, [], semantic.newConflicts),
    acknowledgement: semantic.inferredPreferences.length > primary.inferredPreferences.length
      ? semantic.acknowledgement
      : primary.acknowledgement || semantic.acknowledgement,
    evidencePhrase: `${primary.evidencePhrase}\n${semantic.evidencePhrase}`.trim(),
    canonicalMappings: mergeCanonicalConcepts(primary.canonicalMappings, semantic.canonicalMappings),
  };
}

function topicForField(field: keyof BuyerProfilePatch) {
  const topics: Partial<Record<keyof BuyerProfilePatch, string>> = {
    performanceImportance: "Meaning of powerful",
    maxPurchaseBudget: "Maximum budget",
    drivetrainPreference: "Winter traction",
    familySize: "Family seating",
    preferredMake: "Vehicle reference meaning",
    requiredMake: "Vehicle reference meaning",
  };
  return topics[field] || String(field);
}

function interpretPerformanceAnswer(answer: string): ClarificationAnswerResult {
  const lower = answer.toLowerCase();
  const acceleration = /quick|acceleration|accelerate|fast|speed/.test(lower);
  const handling = /handling|corner|sporty|steer|control/.test(lower);
  const capability = /large|bigger|capable|tow|truck|suv|size/.test(lower);
  const inferredPreferences: InferredPreference[] = [];

  if (acceleration) {
    inferredPreferences.push({
      label: "Acceleration matters",
      value: "Power means quick acceleration, not just a larger vehicle.",
      evidencePhrase: answer,
      field: "performanceImportance",
      requiresConfirmation: false,
    });
  }
  if (handling) {
    inferredPreferences.push({
      label: "Handling matters",
      value: "Power includes steering feel and control.",
      evidencePhrase: answer,
      field: "performanceImportance",
      requiresConfirmation: false,
    });
  }
  if (capability && !acceleration && !handling) {
    inferredPreferences.push({
      label: "Vehicle capability matters",
      value: "Power means capability or size more than sporty feel.",
      evidencePhrase: answer,
      requiresConfirmation: false,
    });
  }

  return {
    profileUpdates: { performanceImportance: 5 },
    explicitFacts: [],
    inferredPreferences,
    confidenceByField: [
      {
        field: "performanceImportance",
        value: 5,
        confidence: "high",
        evidencePhrase: answer,
        requiresConfirmation: false,
      },
    ],
    resolvedUncertaintyTopics: ["Meaning of powerful"],
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: acceleration || handling
      ? "That changes how I interpret powerful. You care more about acceleration and handling than vehicle size."
      : "That helps. I'll treat power as capability rather than assuming sporty driving feel.",
    evidencePhrase: answer,
  };
}

function interpretMakeFlexibilityAnswer(session: ConversationIntakeSession, answer: string): ClarificationAnswerResult {
  const lower = answer.toLowerCase();
  const priorMapping = session.accumulatedInterpretation.canonicalMappings
    ?.find((item) => item.conceptType === "vehicle_make" && item.intent !== "excluded");
  const make = String(
    session.accumulatedInterpretation.suggestedProfileUpdates.preferredMake
    || session.accumulatedInterpretation.suggestedProfileUpdates.requiredMake
    || priorMapping?.value
    || "the requested make",
  );
  const flexible = /not required|isn.?t required|is not required|flexible|not non[-\s]?negotiable|badge isn|badge is not|no[, ]/i.test(answer);
  const required = /required|non[-\s]?negotiable|only|must|has to be/i.test(answer) && !flexible;
  const style = /style|look|looks|design|premium|expensive|cool/i.test(answer);
  const driving = /drive|driving|handling|sporty|fun/i.test(answer);
  const inferredPreferences: InferredPreference[] = [];
  const explicitFacts: PreferenceFact[] = [];
  const confidenceByField: PreferenceFieldConfidence[] = [];
  const profileUpdates: BuyerProfilePatch = {};

  if (required) {
    profileUpdates.requiredMake = make;
    profileUpdates.preferredMake = undefined;
    explicitFacts.push({
      label: "Required make",
      value: make,
      evidencePhrase: answer,
      field: "requiredMake",
      canonicalIntent: "required",
    });
    confidenceByField.push({
      field: "requiredMake",
      value: make,
      confidence: "high",
      evidencePhrase: answer,
      requiresConfirmation: false,
      canonicalIntent: "required",
    });
  } else {
    profileUpdates.preferredMake = make;
    explicitFacts.push({
      label: "Preferred make",
      value: make,
      evidencePhrase: answer,
      field: "preferredMake",
      canonicalIntent: "preferred",
    });
    confidenceByField.push({
      field: "preferredMake",
      value: make,
      confidence: "high",
      evidencePhrase: answer,
      requiresConfirmation: false,
      canonicalIntent: "preferred",
    });
  }

  if (style) {
    inferredPreferences.push({
      label: "Design and image matter",
      value: "Premium styling matters more than forcing one badge.",
      evidencePhrase: answer,
      requiresConfirmation: false,
    });
  }
  if (driving) {
    profileUpdates.performanceImportance = 5;
    inferredPreferences.push({
      label: "Driving feel matters",
      value: "The car should feel engaging to drive.",
      evidencePhrase: answer,
      field: "performanceImportance",
      requiresConfirmation: false,
    });
    confidenceByField.push({
      field: "performanceImportance",
      value: 5,
      confidence: "high",
      evidencePhrase: answer,
      requiresConfirmation: false,
    });
  }

  return {
    profileUpdates,
    explicitFacts,
    inferredPreferences,
    confidenceByField,
    resolvedUncertaintyTopics: [],
    resolvedConflictTopics: flexible ? ["Premium preference versus repair cost"] : [],
    newUncertainties: [],
    newConflicts: required
      ? [
          {
            topic: "Brand requirement versus repair cost",
            description: "Keeping the brand as mandatory can work against the low-repair-cost goal.",
            evidencePhrases: [answer],
          },
        ]
      : [],
    acknowledgement: flexible
      ? `That helps. It sounds like the ${make} badge is flexible, but the style and driving feel still matter.`
      : `Understood. I'll treat the ${make} badge as a firm requirement, while keeping the repair-cost concern visible.`,
    evidencePhrase: answer,
    canonicalMappings: priorMapping
      ? [{
          ...priorMapping,
          id: `${priorMapping.id}:confirmed`,
          intent: required ? "required" : "preferred",
          decisionConcept: required ? "hard_constraint" : "preference",
          destination: required ? "requiredMake" : "preferredMake",
          supportStatus: "supported_and_used",
          confirmationStatus: "confirmed",
          requiresConfirmation: false,
          source: "user_correction",
          sourceText: answer,
        }]
      : undefined,
  };
}

function interpretRelationshipIntentAnswer(
  session: ConversationIntakeSession,
  answer: string,
): ClarificationAnswerResult {
  const lower = answer.toLowerCase();
  const intent =
    /\b(?:no|exclude|avoid|don't want|do not want)\b/i.test(lower)
      ? "excluded"
      : /\b(?:required|must|only|need|non[-\s]?negotiable)\b/i.test(lower)
        ? "required"
        : /\b(?:prefer|preferred|first choice)\b/i.test(lower)
          ? "preferred"
          : /\b(?:acceptable|okay|ok|fine|allowed|either|both|flexible)\b/i.test(lower)
            ? "allowed"
            : undefined;
  const uncertainMappings = session.accumulatedInterpretation.canonicalMappings
    ?.filter(
      (item) =>
        item.intent === "uncertain"
        && ["body_style", "vehicle_category", "fuel_type", "drivetrain", "transmission"]
          .includes(item.conceptType),
    ) || [];

  if (!intent || !uncertainMappings.length) {
    return {
      profileUpdates: {},
      explicitFacts: [],
      inferredPreferences: [],
      confidenceByField: [],
      resolvedUncertaintyTopics: [],
      resolvedConflictTopics: [],
      newUncertainties: [{
        topic: "Preference strength",
        evidencePhrase: answer,
        question: "Should I treat those options as required, preferred, or simply acceptable?",
      }],
      newConflicts: [],
      acknowledgement: "I still need to understand how strongly you want those options.",
      evidencePhrase: answer,
    };
  }

  const canonicalMappings: CanonicalMappedConcept[] = uncertainMappings.map((item) => ({
    ...item,
    id: `${item.id}:confirmed`,
    intent,
    decisionConcept: intent === "required"
      ? "hard_constraint" as const
      : intent === "preferred"
        ? "preference" as const
        : intent === "allowed"
          ? "allowed_fallback" as const
          : "exclusion" as const,
    destination: relationshipDestination(item.conceptType, intent),
    supportStatus: "supported_and_used" as const,
    confirmationStatus: "confirmed" as const,
    requiresConfirmation: false,
    source: "user_correction" as const,
    sourceText: answer,
  }));
  const values = canonicalMappings.flatMap((item) =>
    Array.isArray(item.value) ? item.value.map(String) : [String(item.value)]
  );

  return {
    profileUpdates: buildProfilePatch(canonicalMappings),
    explicitFacts: [],
    inferredPreferences: [],
    confidenceByField: [],
    resolvedUncertaintyTopics: session.unresolvedUncertainties
      .filter((uncertainty) =>
        values.some((value) =>
          `${uncertainty.topic} ${uncertainty.evidencePhrase}`.toLowerCase()
            .includes(value.toLowerCase())
        )
      )
      .map((uncertainty) => uncertainty.topic),
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: `Understood. I'll treat ${formatList(values)} as ${intent === "allowed" ? "acceptable options" : intent}.`,
    evidencePhrase: answer,
    canonicalMappings,
  };
}

function relationshipDestination(
  conceptType: CanonicalMappedConcept["conceptType"],
  intent: "required" | "preferred" | "allowed" | "excluded",
): CanonicalMappedConcept["destination"] {
  const destinations = {
    body_style: {
      required: "requiredBodyStyles",
      preferred: "preferredBodyStyles",
      allowed: "allowedBodyStyles",
      excluded: "excludedBodyStyles",
    },
    vehicle_category: {
      required: "requiredVehicleCategories",
      preferred: "preferredVehicleCategories",
      allowed: "allowedVehicleCategories",
      excluded: "excludedVehicleCategories",
    },
    fuel_type: {
      required: "requiredFuelTypes",
      preferred: "preferredFuelTypes",
      allowed: "allowedFuelTypes",
      excluded: "excludedFuelTypes",
    },
    drivetrain: {
      required: "requiredDrivetrains",
      preferred: "preferredDrivetrains",
      allowed: "allowedDrivetrains",
      excluded: "excludedDrivetrains",
    },
    transmission: {
      required: "requiredTransmissions",
      preferred: "preferredTransmissions",
      allowed: "allowedTransmissions",
      excluded: "excludedTransmissions",
    },
  } as const;
  if (!(conceptType in destinations)) return undefined;
  return destinations[conceptType as keyof typeof destinations][intent];
}

function interpretBudgetAnswer(answer: string): ClarificationAnswerResult {
  const budget = getMoneyValue(answer);
  if (!budget) {
    return {
      profileUpdates: {},
      explicitFacts: [],
      inferredPreferences: [],
      confidenceByField: [],
      resolvedUncertaintyTopics: [],
      resolvedConflictTopics: [],
      newUncertainties: [
        {
          topic: "Maximum budget",
          evidencePhrase: answer,
          question: "What maximum purchase price should I use?",
        },
      ],
      newConflicts: [],
      acknowledgement: "I still do not have a firm budget, so I'll keep that as unresolved.",
      evidencePhrase: answer,
    };
  }

  return {
    profileUpdates: { maxPurchaseBudget: budget },
    explicitFacts: [{ label: "Purchase budget", value: `Up to $${budget.toLocaleString()}`, evidencePhrase: answer, field: "maxPurchaseBudget" }],
    inferredPreferences: [],
    confidenceByField: [
      {
        field: "maxPurchaseBudget",
        value: budget,
        confidence: /max|maximum|firm|hard|limit|under|up to|cannot/i.test(answer) ? "high" : "medium",
        evidencePhrase: answer,
        requiresConfirmation: !/max|maximum|firm|hard|limit|under|up to|cannot/i.test(answer),
      },
    ],
    resolvedUncertaintyTopics: ["Starting point", "Core requirement", "Maximum budget"],
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: `Understood. I'll treat $${budget.toLocaleString()} as a firm purchase limit.`,
    evidencePhrase: answer,
  };
}

function interpretWinterAnswer(answer: string): ClarificationAnswerResult {
  const lower = answer.toLowerCase();
  const snow = /snow|ice|winter/.test(lower);
  const awd = /awd|all[-\s]?wheel/.test(lower);
  const fourWheel = /4wd|four[-\s]?wheel/.test(lower);
  const required = /required|must|need|has to|every day|daily/.test(lower);
  const profileUpdates: BuyerProfilePatch = {};
  const explicitFacts: PreferenceFact[] = [];
  const confidenceByField: PreferenceFieldConfidence[] = [];

  if (snow) {
    profileUpdates.climate = "snow";
    explicitFacts.push({ label: "Climate", value: "Snow or ice", evidencePhrase: answer, field: "climate" });
    confidenceByField.push({ field: "climate", value: "snow", confidence: "high", evidencePhrase: answer, requiresConfirmation: false });
  }
  if (awd || fourWheel) {
    const value = awd ? "AWD" : "4WD";
    profileUpdates.drivetrainPreference = value;
    explicitFacts.push({
      label: required ? "Required drivetrain" : "Preferred drivetrain",
      value,
      evidencePhrase: answer,
      field: "drivetrainPreference",
      canonicalIntent: required ? "required" : "preferred",
    });
    confidenceByField.push({
      field: "drivetrainPreference",
      value,
      confidence: required ? "high" : "medium",
      evidencePhrase: answer,
      requiresConfirmation: !required,
      canonicalIntent: required ? "required" : "preferred",
    });
  }

  return {
    profileUpdates,
    explicitFacts,
    inferredPreferences: [
      {
        label: "Winter traction matters",
        value: required ? "Traction should be treated as a requirement for winter use." : "Traction should be weighted carefully for winter use.",
        evidencePhrase: answer,
        field: "drivetrainPreference",
        requiresConfirmation: !required,
      },
    ],
    confidenceByField,
    resolvedUncertaintyTopics: ["Winter traction"],
    resolvedConflictTopics: [],
    newUncertainties: awd || fourWheel
      ? []
      : [{ topic: "Winter traction", evidencePhrase: answer, question: "Do you need AWD or 4WD, or is good winter tire compatibility enough?" }],
    newConflicts: [],
    acknowledgement: required && (awd || fourWheel)
      ? `Understood. I'll treat ${awd ? "AWD" : "4WD"} as required for snowy driving.`
      : "That helps. I'll treat winter driving as important, but I still won't force AWD unless you say it is required.",
    evidencePhrase: answer,
  };
}

function interpretOwnershipTradeoffAnswer(answer: string): ClarificationAnswerResult {
  const reliability = /reliable|reliability|dependable|last|break/.test(answer.toLowerCase());
  return {
    profileUpdates: reliability ? { reliabilityImportance: 5, allowCompromises: true } : { allowCompromises: true },
    explicitFacts: [],
    inferredPreferences: reliability
      ? [
          {
            label: "Reliability can justify more budget",
            value: "You are willing to pay more when the reliability improvement is meaningful.",
            evidencePhrase: answer,
            field: "reliabilityImportance",
            requiresConfirmation: false,
          },
        ]
      : [],
    confidenceByField: reliability
      ? [
          {
            field: "reliabilityImportance",
            value: 5,
            confidence: "high",
            evidencePhrase: answer,
            requiresConfirmation: false,
          },
        ]
      : [],
    resolvedUncertaintyTopics: [],
    resolvedConflictTopics: ["Premium image versus low budget"],
    newUncertainties: [],
    newConflicts: [
      {
        topic: "Affordability versus reliability flexibility",
        description: "Affordability still matters, but reliability can justify paying more.",
        evidencePhrases: [answer],
      },
    ],
    acknowledgement: "That helps. I’ll keep affordability in view, but reliability can now outweigh the cheapest option.",
    evidencePhrase: answer,
  };
}

function interpretFamilyAnswer(answer: string): ClarificationAnswerResult {
  const familySize = answer.match(/\b(\d+)\b/);
  const size = familySize ? Number(familySize[1]) : 0;
  return {
    profileUpdates: size ? { familySize: size, cargoNeed: "high" } : { cargoNeed: "high" },
    explicitFacts: size
      ? [{ label: "Passenger need", value: `${size} people`, evidencePhrase: answer, field: "familySize" }]
      : [],
    inferredPreferences: [
      {
        label: "Family practicality matters",
        value: "Passenger and cargo space should be kept visible.",
        evidencePhrase: answer,
        field: "cargoNeed",
        requiresConfirmation: !size,
      },
    ],
    confidenceByField: size
      ? [{ field: "familySize", value: size, confidence: "high", evidencePhrase: answer, requiresConfirmation: false }]
      : [],
    resolvedUncertaintyTopics: ["Family seating"],
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: size ? `Got it. I’ll remember seating for ${size}.` : "Got it. I’ll keep space and practicality important.",
    evidencePhrase: answer,
  };
}

function interpretDailyUseAnswer(answer: string): ClarificationAnswerResult {
  return {
    profileUpdates: {},
    explicitFacts: [{ label: "Primary use", value: answer, evidencePhrase: answer }],
    inferredPreferences: [
      {
        label: "Use case is clearer",
        value: "The recommendation should reflect this daily use pattern.",
        evidencePhrase: answer,
        requiresConfirmation: false,
      },
    ],
    confidenceByField: [],
    resolvedUncertaintyTopics: ["Primary use"],
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: "That gives me a clearer picture of how the car will be used.",
    evidencePhrase: answer,
  };
}

function interpretNewUsedAnswer(answer: string): ClarificationAnswerResult {
  const lower = answer.toLowerCase();
  const value = /used|pre[-\s]?owned/.test(lower) ? "used" : /new/.test(lower) ? "new" : undefined;
  return {
    profileUpdates: value ? { purchaseCondition: value } : {},
    explicitFacts: value
      ? [{ label: "Purchase condition", value: value === "used" ? "Used" : "New", evidencePhrase: answer, field: "purchaseCondition" }]
      : [],
    inferredPreferences: [],
    confidenceByField: value
      ? [{ field: "purchaseCondition", value, confidence: "high", evidencePhrase: answer, requiresConfirmation: false }]
      : [],
    resolvedUncertaintyTopics: ["New or used"],
    resolvedConflictTopics: [],
    newUncertainties: [],
    newConflicts: [],
    acknowledgement: value ? `Understood. I’ll treat ${value} as the purchase condition.` : "I’ll keep new versus used unresolved for now.",
    evidencePhrase: answer,
  };
}

function mergePreferenceInterpretation(
  interpretation: PreferenceInterpretation,
  result: ClarificationAnswerResult,
): PreferenceInterpretation {
  const canonicalMappings = mergeCanonicalConcepts(interpretation.canonicalMappings, result.canonicalMappings);
  const suggestedProfileUpdates = mergeCanonicalProfileUpdates(
    mergeProfileUpdates(interpretation.suggestedProfileUpdates, result.profileUpdates),
    canonicalMappings,
    result.canonicalMappings,
    result.profileUpdates.decisionPolicies,
  );
  const explicitFacts = mergeFacts(interpretation.explicitFacts, result.explicitFacts);
  const inferredPreferences = mergeInferredPreferences(interpretation.inferredPreferences, result.inferredPreferences, result.explicitFacts);
  const confidenceByField = mergeConfidence(interpretation.confidenceByField, result.confidenceByField);
  const conflicts = mergeConflicts(interpretation.conflicts, result.resolvedConflictTopics, result.newConflicts);
  const uncertainties = mergeUncertainties(interpretation.uncertainties, result.resolvedUncertaintyTopics, result.newUncertainties);

  return {
    ...interpretation,
    rawUserMessage: `${interpretation.rawUserMessage}\n${result.evidencePhrase}`,
    interpretationSummary: buildMergedSummary(explicitFacts, inferredPreferences, conflicts),
    explicitFacts,
    inferredPreferences,
    uncertainties,
    conflicts,
    confidenceByField,
    suggestedProfileUpdates,
    nextClarifyingQuestion: "",
    canonicalMappings,
    decisionPolicies: suggestedProfileUpdates.decisionPolicies || {},
  };
}

function selectNextQuestion(
  interpretation: PreferenceInterpretation,
  answeredQuestionIds: IntakeQuestionCode[],
  skippedQuestionIds: IntakeQuestionCode[],
  unresolvedUncertainties = interpretation.uncertainties,
  unresolvedConflicts = interpretation.conflicts,
  baselineProfile?: BuyerProfile,
): IntakeQuestion | null {
  const unavailable = new Set([...answeredQuestionIds, ...skippedQuestionIds]);
  if (answeredQuestionIds.length + skippedQuestionIds.length >= maxClarifyingQuestions) return null;

  const updates = interpretation.suggestedProfileUpdates;
  if (
    interpretation.canonicalMappings?.some((item) => item.supportStatus === "recognized_out_of_scope")
    || interpretation.explicitFacts.some((item) => item.label === "Outside current scope")
  ) {
    return null;
  }
  if (assessCatalogIntentFeasibility(updates, vehicleCatalog).terminalNoMatch) return null;
  const raw = interpretation.rawUserMessage.toLowerCase();
  const policies = mergeDecisionParticipationPolicyMaps(
    baselineProfile?.decisionPolicies,
    interpretation.decisionPolicies,
  );
  const effectivePurchaseBudget = updates.maxPurchaseBudget ?? baselineProfile?.maxPurchaseBudget;
  const uncertainMake = interpretation.canonicalMappings
    ?.find((item) => item.conceptType === "vehicle_make" && item.intent === "uncertain");
  const uncertainRelationship = interpretation.canonicalMappings
    ?.filter(
      (item) =>
        item.intent === "uncertain"
        && ["body_style", "vehicle_category", "fuel_type", "drivetrain", "transmission"]
          .includes(item.conceptType),
    );
  const candidates: IntakeQuestion[] = [];

  if (
    !unavailable.has("make_flexibility") &&
    (
      Boolean(uncertainMake)
      || (
        (updates.preferredMake || /\bbmw\b/.test(raw))
        && (
          unresolvedConflicts.some((conflict) => /repair|premium|brand|luxury/i.test(conflict.topic + conflict.description))
          || /repair|maintenance/i.test(raw)
        )
      )
    )
  ) {
    candidates.push({
      id: "make_flexibility",
      text: `Is ${updates.preferredMake || uncertainMake?.value || "that brand"} flexible, or should I treat it as non-negotiable?`,
      reason: "Brand flexibility can materially change qualification.",
    });
  }

  if (
    !unavailable.has("relationship_intent")
    && uncertainRelationship?.length
  ) {
    const values = Array.from(
      new Set(uncertainRelationship.flatMap((item) =>
        Array.isArray(item.value) ? item.value.map(String) : [String(item.value)]
      )),
    );
    candidates.push({
      id: "relationship_intent",
      text: `Should I treat ${formatList(values)} as required, preferred, or simply acceptable options?`,
      reason: "The relationship strength changes qualification and ranking.",
    });
  }

  if (!unavailable.has("performance_meaning") && unresolvedUncertainties.some((uncertainty) => uncertainty.topic === "Meaning of powerful")) {
    candidates.push({
      id: "performance_meaning",
      text: "When you say powerful, do you mean quick acceleration, sporty handling, or a larger and more capable vehicle?",
      reason: "Performance wording is ambiguous.",
    });
  }

  if (
    !unavailable.has("winter_traction") &&
    /\b(?:winter|snow|ice)\b/.test(raw) &&
    !updates.drivetrainPreference
  ) {
    candidates.push({
      id: "winter_traction",
      text: "For winter driving, do you need AWD or 4WD, or is good snow capability enough?",
      reason: "Traction can become a hard requirement only if confirmed.",
    });
  }

  if (
    !unavailable.has("budget_max")
    && !effectivePurchaseBudget
    && policyAllowsClarification(policies, "purchaseBudget")
  ) {
    candidates.push({
      id: "budget_max",
      text: "What is the maximum purchase budget you want me to work within?",
      reason: "Budget strongly affects responsible recommendations.",
    });
  }

  if (
    !unavailable.has("ownership_tradeoff")
    && policies?.totalOwnershipBudget?.participation === "unresolved"
  ) {
    candidates.push({
      id: "ownership_tradeoff",
      text: "Should ongoing costs like insurance, fuel, and repairs still influence the recommendation?",
      reason: "The user removed a purchase-price limit but did not say whether ownership costs still matter.",
    });
  }

  if (
    !unavailable.has("ownership_tradeoff") &&
    (unresolvedConflicts.length > 0 || /cheap|affordable|costing too much/.test(raw)) &&
    !answeredQuestionIds.includes("ownership_tradeoff")
  ) {
    candidates.push({
      id: "ownership_tradeoff",
      text: "If cost and reliability compete, which one should I protect more?",
      reason: "Ownership-cost tradeoffs can change ranking.",
    });
  }

  if (!unavailable.has("family_seating") && updates.cargoNeed === "high" && !updates.familySize) {
    candidates.push({
      id: "family_seating",
      text: "How many people does this car need to carry regularly?",
      reason: "Passenger needs can change body style and practicality fit.",
    });
  }

  if (
    !unavailable.has("daily_use")
    && policies?.purchaseBudget?.participation === "disabled"
    && !hasPositiveDecisionCriterion(updates)
  ) {
    candidates.push({
      id: "daily_use",
      text: "What should matter most in the recommendation: reliability, safety, daily use, or the kind of vehicle?",
      reason: "A disabled budget does not provide a positive basis for a recommendation.",
    });
  }

  if (!unavailable.has("daily_use") && effectivePurchaseBudget && !/commute|school|family|work|daily|snow|winter/.test(raw)) {
    candidates.push({
      id: "daily_use",
      text: "Will this car mostly be used for commuting, school, family driving, or bad weather?",
      reason: "Use case helps prioritize the next phase.",
    });
  }

  if (
    !unavailable.has("new_used")
    && !updates.purchaseCondition
    && effectivePurchaseBudget
    && Number(effectivePurchaseBudget) < 20000
  ) {
    candidates.push({
      id: "new_used",
      text: "Are you open to used cars, or do you only want new?",
      reason: "Condition changes what is realistic under budget.",
    });
  }

  return candidates.sort(
    (left, right) => clarificationPriority(right.id) - clarificationPriority(left.id),
  )[0] || null;
}

function clarificationPriority(question: IntakeQuestionCode) {
  const priorities: Partial<Record<IntakeQuestionCode, number>> = {
    make_flexibility: 100,
    relationship_intent: 98,
    winter_traction: 95,
    performance_meaning: 90,
    family_seating: 88,
    budget_max: 85,
    ownership_tradeoff: 80,
    daily_use: 60,
    new_used: 50,
  };
  return priorities[question] || 0;
}

function createTurn(
  sequence: number,
  role: IntakeTurnRole,
  text: string,
  intent?: string,
  questionCode?: IntakeQuestionCode,
): ConversationTurn {
  return {
    id: `turn-${sequence}`,
    role,
    text,
    intent,
    questionCode,
    sequence,
  };
}

function mergeProfileUpdates(current: BuyerProfilePatch, updates: BuyerProfilePatch) {
  const next: BuyerProfilePatch = { ...current };
  for (const [key, value] of Object.entries(updates) as Array<[keyof BuyerProfilePatch, BuyerProfilePatch[keyof BuyerProfilePatch]]>) {
    if (key === "decisionPolicies") {
      next.decisionPolicies = mergeDecisionParticipationPolicyMaps(
        next.decisionPolicies,
        value as BuyerProfilePatch["decisionPolicies"],
      );
    } else if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

function mergeCanonicalProfileUpdates(
  current: BuyerProfilePatch,
  canonicalMappings: CanonicalMappedConcept[],
  latestMappings: CanonicalMappedConcept[] = [],
  latestPolicies: DecisionParticipationPolicyMap | undefined = undefined,
) {
  const next: BuyerProfilePatch = { ...current };
  const latestConcepts = new Set(latestMappings.map((item) => item.conceptType));
  if (latestConcepts.has("vehicle_make")) {
    delete next.requiredMake;
    delete next.preferredMake;
    delete next.requiredMakes;
    delete next.preferredMakes;
    delete next.allowedMakes;
    delete next.excludedMakes;
  }
  if (latestConcepts.has("body_style") || latestConcepts.has("vehicle_category")) {
    delete next.bodyStyle;
    delete next.requiredBodyStyles;
    delete next.preferredBodyStyles;
    delete next.allowedBodyStyles;
    delete next.excludedBodyStyles;
    delete next.requiredVehicleCategories;
    delete next.preferredVehicleCategories;
    delete next.allowedVehicleCategories;
    delete next.excludedVehicleCategories;
    next.flexibleConstraints = next.flexibleConstraints?.filter((item) => item !== "bodyStyle");
  }
  if (latestConcepts.has("fuel_type")) {
    delete next.requiredFuelType;
    delete next.requiredFuelTypes;
    delete next.preferredFuelTypes;
    delete next.allowedFuelTypes;
    delete next.excludedFuelTypes;
  }
  if (latestConcepts.has("drivetrain")) {
    delete next.drivetrainPreference;
    delete next.requiredDrivetrains;
    delete next.preferredDrivetrains;
    delete next.allowedDrivetrains;
    delete next.excludedDrivetrains;
  }
  if (latestConcepts.has("transmission")) {
    delete next.transmissionPreference;
    delete next.requiredTransmissions;
    delete next.preferredTransmissions;
    delete next.allowedTransmissions;
    delete next.excludedTransmissions;
  }

  const affectedPolicyDimensions = new Set<DecisionPolicyDimension>();
  for (const concept of latestConcepts) {
    const dimension = decisionPolicyDimensionForSemanticConcept(concept);
    if (dimension) affectedPolicyDimensions.add(dimension);
  }
  if (next.decisionPolicies && affectedPolicyDimensions.size) {
    next.decisionPolicies = { ...next.decisionPolicies };
    for (const dimension of affectedPolicyDimensions) {
      if (!latestPolicies?.[dimension]) delete next.decisionPolicies[dimension];
    }
    if (!Object.keys(next.decisionPolicies).length) delete next.decisionPolicies;
  }

  return mergeProfileUpdates(next, buildProfilePatch(canonicalMappings) as BuyerProfilePatch);
}

function decisionPolicyDimensionForSemanticConcept(
  concept: CanonicalMappedConcept["conceptType"],
): DecisionPolicyDimension | undefined {
  const dimensions: Partial<Record<CanonicalMappedConcept["conceptType"], DecisionPolicyDimension>> = {
    vehicle_make: "make",
    body_style: "bodyStyle",
    vehicle_category: "bodyStyle",
    fuel_type: "fuelType",
    drivetrain: "drivetrain",
    transmission: "transmission",
  };
  return dimensions[concept];
}

function mergeFacts(current: PreferenceFact[], updates: PreferenceFact[]) {
  return mergeByKey(current, updates, (item) => item.field || item.label);
}

function mergeInferredPreferences(current: InferredPreference[], updates: InferredPreference[], explicitFacts: PreferenceFact[]) {
  const explicitFields = new Set(explicitFacts.map((fact) => fact.field).filter(Boolean));
  const filtered = current.filter((preference) => !preference.field || !explicitFields.has(preference.field));
  return mergeByKey(filtered, updates, (item) => item.label);
}

function mergeConfidence(current: PreferenceFieldConfidence[], updates: PreferenceFieldConfidence[]) {
  return mergeByKey(current, updates, (item) => item.field);
}

function mergeUncertainties(
  current: PreferenceUncertainty[],
  resolvedTopics: string[],
  updates: PreferenceUncertainty[],
) {
  const resolved = new Set(resolvedTopics);
  return mergeByKey(
    current.filter((uncertainty) => !resolved.has(uncertainty.topic)),
    updates,
    (item) => item.topic,
  );
}

function mergeConflicts(current: PreferenceConflict[], resolvedTopics: string[], updates: PreferenceConflict[]) {
  const resolved = new Set(resolvedTopics);
  return mergeByKey(
    current.filter((conflict) => !resolved.has(conflict.topic)),
    updates,
    (item) => item.topic,
  );
}

function mergeByKey<T>(current: T[], updates: T[], getKey: (item: T) => string | number | symbol | undefined) {
  const map = new Map<string | number | symbol, T>();
  current.forEach((item) => {
    const key = getKey(item);
    if (key) map.set(key, item);
  });
  updates.forEach((item) => {
    const key = getKey(item);
    if (key) map.set(key, item);
  });
  return Array.from(map.values());
}

function getConfirmedProfileUpdates(interpretation: PreferenceInterpretation) {
  const confirmed: BuyerProfilePatch = {};
  interpretation.confidenceByField.forEach((entry) => {
    if (entry.confidence === "high" && !entry.requiresConfirmation) {
      (confirmed as Record<string, unknown>)[entry.field] = entry.value;
    }
  });
  return confirmed;
}

function getConfirmedProfileUpdatesFromResult(result: ClarificationAnswerResult) {
  const confirmed: BuyerProfilePatch = {};
  result.confidenceByField.forEach((entry) => {
    if (entry.confidence === "high" && !entry.requiresConfirmation) {
      (confirmed as Record<string, unknown>)[entry.field] = entry.value;
    }
  });
  return confirmed;
}

function calculateInterpretationConfidence(
  interpretation: PreferenceInterpretation,
  unresolvedUncertainties: PreferenceUncertainty[],
  unresolvedConflicts: PreferenceConflict[],
): InterpretationConfidence {
  if (unresolvedUncertainties.length >= 2 || unresolvedConflicts.length >= 2) return "low";
  if (!interpretation.suggestedProfileUpdates.maxPurchaseBudget || unresolvedUncertainties.length || unresolvedConflicts.length) return "medium";
  return "high";
}

function downgradeConfidence(confidence: InterpretationConfidence): InterpretationConfidence {
  if (confidence === "high") return "medium";
  return "low";
}

function hasPositiveDecisionCriterion(updates: BuyerProfilePatch) {
  if (Object.values(updates.decisionPolicies || {}).some(
    (policy) =>
      policy
      && policyIsPositiveCriterion(policy)
      && !["purchaseBudget", "monthlyPayment", "totalOwnershipBudget"].includes(policy.dimension),
  )) {
    return true;
  }
  return Object.entries(updates).some(([key, value]) => {
    if (key === "decisionPolicies" || value === undefined || value === "" || value === "any" || value === "not-sure") {
      return false;
    }
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

function buildMergedSummary(
  explicitFacts: PreferenceFact[],
  inferredPreferences: InferredPreference[],
  conflicts: PreferenceConflict[],
) {
  const factText = explicitFacts.slice(0, 2).map((fact) => fact.value);
  const preferenceText = inferredPreferences.slice(0, 2).map((preference) => preference.value);
  const parts = [...factText, ...preferenceText].filter(Boolean);
  const base = parts.length
    ? `I’m building a clearer picture around ${formatList(parts)}.`
    : "I’m building a clearer picture from your answers.";
  if (conflicts.length) return `${base} There is still one tradeoff to keep visible.`;
  return base;
}

function getMoneyValue(answer: string) {
  const match = answer.match(/\$?\s*(\d{1,3}(?:,\d{3})|\d{4,6}|\d{1,3})\s*(k)?/i);
  if (!match) return 0;
  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  const value = match[2] || numeric < 1000 ? numeric * 1000 : numeric;
  return value >= 1000 ? value : 0;
}

function formatList(values: string[]) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return "your priorities";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}
