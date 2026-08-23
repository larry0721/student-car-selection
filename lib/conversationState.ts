import {
  getClarificationLifecycle,
  planConversationContinuation,
  type ConversationIntakeSession,
  type IntakeQuestion,
} from "./conversationIntake";

export type AdvisorConversationStateKind =
  | "IDLE"
  | "ASKING_CLARIFICATION"
  | "CLARIFICATION_REQUIRED"
  | "READY_TO_CONFIRM"
  | "READY_TO_RECOMMEND"
  | "SHOWING_RECOMMENDATION"
  | "EXPLAIN_UNSUPPORTED"
  | "NO_MATCH"
  | "RECOVERABLE_ERROR";

export type ConversationAction =
  | "SUBMIT_MESSAGE"
  | "CONTINUE_CLARIFICATION"
  | "ANSWER_CLARIFICATION"
  | "SKIP_CLARIFICATION"
  | "CONFIRM_PROFILE"
  | "EDIT_PROFILE"
  | "RUN_RECOMMENDATION"
  | "REVISE_PREFERENCES"
  | "SHOW_SUPPORTED_OPTIONS"
  | "START_OVER"
  | "RETRY";

export type ConversationInvariantDiagnosticCode =
  | "NO_VALID_ACTION"
  | "CLARIFICATION_REQUIRED_WITHOUT_QUESTION"
  | "CONFIRMATION_WITH_PENDING_REQUIRED_FIELD"
  | "DEAD_CTA"
  | "NO_OP_TRANSITION"
  | "CLARIFICATION_LOOP"
  | "DEFAULT_OVERWROTE_EXPLICIT_VALUE"
  | "UNRESOLVED_CONFLICT"
  | "INVALID_RECOMMENDATION_TRANSITION"
  | "MISSING_RECOVERY_PATH";

export type ConversationInvariantDiagnostic = {
  code: ConversationInvariantDiagnosticCode;
  message: string;
};

export type AdvisorConversationState = {
  kind: AdvisorConversationStateKind;
  validActions: ConversationAction[];
  pendingClarification: IntakeQuestion | null;
  blockingClarificationCount: number;
  confirmationPayloadExists: boolean;
  profileIsRecommendationValid: boolean;
  recommendationExists: boolean;
  unsupportedReason: string;
  noMatchExplanation: string;
  recoveryMessage: string;
  unresolvedConflictCount: number;
  explicitValueOverwrittenByDefault: boolean;
  diagnostics: ConversationInvariantDiagnostic[];
};

export type DeriveAdvisorConversationStateInput = {
  session?: ConversationIntakeSession | null;
  confirmationPayloadExists?: boolean;
  blockingClarificationCount?: number;
  profileIsRecommendationValid?: boolean;
  profileApproved?: boolean;
  recommendationExists?: boolean;
  noMatch?: boolean;
  noMatchExplanation?: string;
  recoverableError?: string;
  unsupportedReason?: string;
  explicitValueOverwrittenByDefault?: boolean;
};

export function deriveAdvisorConversationState(
  input: DeriveAdvisorConversationStateInput,
): AdvisorConversationState {
  const session = input.session || null;
  const blockingClarificationCount = input.blockingClarificationCount || 0;
  const base = {
    pendingClarification: null,
    blockingClarificationCount,
    confirmationPayloadExists: Boolean(input.confirmationPayloadExists),
    profileIsRecommendationValid: Boolean(input.profileIsRecommendationValid),
    recommendationExists: Boolean(input.recommendationExists),
    unsupportedReason: input.unsupportedReason || "",
    noMatchExplanation: input.noMatchExplanation || "",
    recoveryMessage: input.recoverableError || "",
    unresolvedConflictCount: session?.unresolvedConflicts.length || 0,
    explicitValueOverwrittenByDefault: Boolean(input.explicitValueOverwrittenByDefault),
  };

  let state: Omit<AdvisorConversationState, "diagnostics">;
  if (input.recoverableError) {
    state = { ...base, kind: "RECOVERABLE_ERROR", validActions: ["RETRY", "EDIT_PROFILE", "START_OVER"] };
  } else if (input.noMatch) {
    state = {
      ...base,
      kind: "NO_MATCH",
      noMatchExplanation: input.noMatchExplanation || "No vehicle satisfies the current requirements.",
      validActions: ["REVISE_PREFERENCES", "START_OVER"],
    };
  } else if (input.recommendationExists) {
    state = { ...base, kind: "SHOWING_RECOMMENDATION", validActions: ["REVISE_PREFERENCES", "START_OVER"] };
  } else if (!session) {
    state = { ...base, kind: "IDLE", validActions: ["SUBMIT_MESSAGE", "EDIT_PROFILE"] };
  } else if (session.currentQuestion) {
    state = {
      ...base,
      kind: "ASKING_CLARIFICATION",
      pendingClarification: session.currentQuestion,
      blockingClarificationCount: Math.max(1, blockingClarificationCount),
      validActions: ["ANSWER_CLARIFICATION", "SKIP_CLARIFICATION", "START_OVER"],
    };
  } else if (session.intakeStatus === "explain_unsupported") {
    state = {
      ...base,
      kind: "EXPLAIN_UNSUPPORTED",
      unsupportedReason: input.unsupportedReason || "The remaining preference cannot be translated into a supported vehicle decision yet.",
      validActions: ["SHOW_SUPPORTED_OPTIONS", "EDIT_PROFILE", "START_OVER"],
    };
  } else if (session.intakeStatus === "recoverable_error") {
    state = {
      ...base,
      kind: "RECOVERABLE_ERROR",
      recoveryMessage: input.recoverableError || "The advisor could not advance this conversation safely.",
      validActions: ["RETRY", "EDIT_PROFILE", "START_OVER"],
    };
  } else if (input.profileApproved) {
    state = {
      ...base,
      kind: "READY_TO_RECOMMEND",
      validActions: ["RUN_RECOMMENDATION", "EDIT_PROFILE", "START_OVER"],
    };
  } else if (blockingClarificationCount > 0 || !input.profileIsRecommendationValid) {
    const continuation = planConversationContinuation(session);
    state = continuation.question
      ? {
          ...base,
          kind: "CLARIFICATION_REQUIRED",
          pendingClarification: continuation.question,
          blockingClarificationCount: Math.max(1, blockingClarificationCount),
          validActions: ["CONTINUE_CLARIFICATION", "EDIT_PROFILE", "START_OVER"],
        }
      : {
          ...base,
          kind: "EXPLAIN_UNSUPPORTED",
          unsupportedReason: input.unsupportedReason || continuation.reason,
          validActions: ["SHOW_SUPPORTED_OPTIONS", "EDIT_PROFILE", "START_OVER"],
        };
  } else {
    const optionalContinuation = planConversationContinuation(session);
    state = {
      ...base,
      kind: "READY_TO_CONFIRM",
      pendingClarification: optionalContinuation.question,
      validActions: [
        "CONFIRM_PROFILE",
        ...(optionalContinuation.question ? ["CONTINUE_CLARIFICATION" as const] : []),
        "EDIT_PROFILE",
        "START_OVER",
      ],
    };
  }

  const diagnostics = validateConversationState(state);
  if (
    session
    && getClarificationLifecycle(session).some((entry) => entry.status === "unresolved" && entry.attempts >= 2)
  ) {
    diagnostics.push(diagnostic("CLARIFICATION_LOOP", "A clarification remained unresolved after the allowed refinement attempt."));
  }
  return { ...state, diagnostics };
}

export function getValidConversationActions(state: AdvisorConversationState) {
  return [...state.validActions];
}

export function validateConversationState(
  state: Omit<AdvisorConversationState, "diagnostics"> | AdvisorConversationState,
): ConversationInvariantDiagnostic[] {
  const diagnostics: ConversationInvariantDiagnostic[] = [];
  if (!state.validActions.length) diagnostics.push(diagnostic("NO_VALID_ACTION", "Every visible state must expose a valid next action."));
  if (
    ["ASKING_CLARIFICATION", "CLARIFICATION_REQUIRED"].includes(state.kind)
    && !state.pendingClarification
  ) {
    diagnostics.push(diagnostic("CLARIFICATION_REQUIRED_WITHOUT_QUESTION", "Clarification state requires one actionable question."));
  }
  if (state.validActions.includes("ANSWER_CLARIFICATION") && !state.pendingClarification) {
    diagnostics.push(diagnostic("DEAD_CTA", "Answer clarification cannot be rendered without an active question."));
  }
  if (state.kind === "READY_TO_CONFIRM" && state.blockingClarificationCount > 0) {
    diagnostics.push(diagnostic("CONFIRMATION_WITH_PENDING_REQUIRED_FIELD", "Confirmation cannot proceed with blocking clarification."));
  }
  if (state.kind === "READY_TO_CONFIRM" && !state.confirmationPayloadExists) {
    diagnostics.push(diagnostic("CONFIRMATION_WITH_PENDING_REQUIRED_FIELD", "Confirmation requires a confirmation payload."));
  }
  if (state.kind === "READY_TO_RECOMMEND" && !state.profileIsRecommendationValid) {
    diagnostics.push(diagnostic("INVALID_RECOMMENDATION_TRANSITION", "Recommendation requires a valid confirmed profile."));
  }
  if (state.kind === "SHOWING_RECOMMENDATION" && !state.recommendationExists) {
    diagnostics.push(diagnostic("INVALID_RECOMMENDATION_TRANSITION", "Recommendation state requires a recommendation object."));
  }
  if (state.kind === "EXPLAIN_UNSUPPORTED" && !state.unsupportedReason) {
    diagnostics.push(diagnostic("MISSING_RECOVERY_PATH", "Unsupported state requires an explanation."));
  }
  if (state.kind === "NO_MATCH" && !state.noMatchExplanation) {
    diagnostics.push(diagnostic("MISSING_RECOVERY_PATH", "No-match state requires an explanation."));
  }
  if (state.kind === "RECOVERABLE_ERROR" && !state.validActions.some((action) => ["RETRY", "EDIT_PROFILE", "START_OVER"].includes(action))) {
    diagnostics.push(diagnostic("MISSING_RECOVERY_PATH", "Recoverable errors require a recovery action."));
  }
  if (["READY_TO_CONFIRM", "READY_TO_RECOMMEND"].includes(state.kind) && state.unresolvedConflictCount > 0) {
    diagnostics.push(diagnostic("UNRESOLVED_CONFLICT", "Conflicting requirements must be resolved before advancing."));
  }
  if (state.explicitValueOverwrittenByDefault) {
    diagnostics.push(diagnostic("DEFAULT_OVERWROTE_EXPLICIT_VALUE", "An assumed default cannot replace an explicit value."));
  }
  return diagnostics;
}

export function validateConversationTransition(
  previous: ConversationIntakeSession,
  action: ConversationAction,
  next: ConversationIntakeSession,
): ConversationInvariantDiagnostic[] {
  const advancingActions: ConversationAction[] = [
    "SUBMIT_MESSAGE",
    "CONTINUE_CLARIFICATION",
    "ANSWER_CLARIFICATION",
    "SKIP_CLARIFICATION",
    "CONFIRM_PROFILE",
    "RUN_RECOMMENDATION",
    "REVISE_PREFERENCES",
    "RETRY",
    "START_OVER",
  ];
  if (!advancingActions.includes(action)) return [];
  if (conversationStateFingerprint(previous) !== conversationStateFingerprint(next)) return [];
  return [diagnostic("NO_OP_TRANSITION", `${action} was expected to visibly advance the conversation.`)];
}

export function conversationStateFingerprint(session: ConversationIntakeSession) {
  return JSON.stringify({
    status: session.intakeStatus,
    question: session.currentQuestion && {
      id: session.currentQuestion.id,
      text: session.currentQuestion.text,
    },
    turnCount: session.conversationTurns.length,
    updates: session.confirmedProfileUpdates,
    pending: session.pendingProfileUpdates,
    conflicts: session.unresolvedConflicts.map((item) => item.topic),
    uncertainties: session.unresolvedUncertainties.map((item) => item.topic),
  });
}

function diagnostic(code: ConversationInvariantDiagnosticCode, message: string): ConversationInvariantDiagnostic {
  return { code, message };
}
