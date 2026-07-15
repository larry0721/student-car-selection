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

export type IntakeStatus =
  | "awaiting_initial_message"
  | "awaiting_clarification"
  | "ready_for_confirmation"
  | "confirmed";

export type IntakeTurnRole = "user" | "advisor";

export type IntakeQuestionCode =
  | "performance_meaning"
  | "make_flexibility"
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
};

const maxClarifyingQuestions = 3;

export function createConversationIntakeSession(rawUserMessage: string): ConversationIntakeSession {
  const accumulatedInterpretation = interpretPreferenceMessage(rawUserMessage);
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
  const nextQuestion = selectNextQuestion(mergedInterpretation, answeredQuestionIds, skippedQuestionIds, unresolvedUncertainties, unresolvedConflicts);
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

export function skipConversationQuestion(session: ConversationIntakeSession): ConversationIntakeSession {
  if (!session.currentQuestion) return session;

  const skippedQuestionIds = [...session.skippedQuestionIds, session.currentQuestion.id];
  const nextQuestion = selectNextQuestion(
    session.accumulatedInterpretation,
    session.answeredQuestionIds,
    skippedQuestionIds,
    session.unresolvedUncertainties,
    session.unresolvedConflicts,
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
  const nextQuestion =
    selectNextQuestion(
      session.accumulatedInterpretation,
      session.answeredQuestionIds,
      session.skippedQuestionIds,
      session.unresolvedUncertainties,
      session.unresolvedConflicts,
    ) ||
    fallbackQuestion(session);

  if (!nextQuestion) return session;

  const nextSequence = session.conversationTurns.length + 1;
  return {
    ...session,
    conversationTurns: [
      ...session.conversationTurns,
      createTurn(nextSequence, "advisor", nextQuestion.text, "additional_question", nextQuestion.id),
    ],
    currentQuestion: nextQuestion,
    intakeStatus: "awaiting_clarification",
  };
}

export function getLatestAdvisorTurn(session: ConversationIntakeSession) {
  return [...session.conversationTurns].reverse().find((turn) => turn.role === "advisor");
}

function fallbackQuestion(session: ConversationIntakeSession): IntakeQuestion | null {
  const updates = session.accumulatedInterpretation.suggestedProfileUpdates;
  if (!updates.maxPurchaseBudget && !session.answeredQuestionIds.includes("budget_max")) {
    return {
      id: "budget_max",
      text: "What is the maximum purchase budget you want me to work within?",
      reason: "Budget strongly affects responsible recommendations.",
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

export function getConciseUnderstanding(session: ConversationIntakeSession) {
  return {
    confirmedFacts: session.accumulatedInterpretation.explicitFacts.slice(0, 5),
    strongPreferences: session.accumulatedInterpretation.inferredPreferences.slice(0, 5),
    remainingUncertainty: session.unresolvedUncertainties[0],
    activeConflict: session.unresolvedConflicts[0],
  };
}

function interpretClarificationAnswer(session: ConversationIntakeSession, answer: string): ClarificationAnswerResult {
  switch (session.currentQuestion?.id) {
    case "performance_meaning":
      return interpretPerformanceAnswer(answer);
    case "make_flexibility":
      return interpretMakeFlexibilityAnswer(session, answer);
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
  const make = String(session.accumulatedInterpretation.suggestedProfileUpdates.preferredMake || "BMW");
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
    explicitFacts.push({ label: "Required make", value: make, evidencePhrase: answer, field: "requiredMake" });
    confidenceByField.push({
      field: "requiredMake",
      value: make,
      confidence: "high",
      evidencePhrase: answer,
      requiresConfirmation: false,
    });
  } else {
    profileUpdates.preferredMake = make;
    explicitFacts.push({ label: "Preferred make", value: make, evidencePhrase: answer, field: "preferredMake" });
    confidenceByField.push({
      field: "preferredMake",
      value: make,
      confidence: "high",
      evidencePhrase: answer,
      requiresConfirmation: false,
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
      ? "That helps. It sounds like the BMW badge is flexible, but the style and driving feel still matter."
      : "Understood. I'll treat the BMW badge as a firm requirement, while keeping the repair-cost concern visible.",
    evidencePhrase: answer,
  };
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
    });
    confidenceByField.push({
      field: "drivetrainPreference",
      value,
      confidence: required ? "high" : "medium",
      evidencePhrase: answer,
      requiresConfirmation: !required,
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
  const suggestedProfileUpdates = mergeProfileUpdates(interpretation.suggestedProfileUpdates, result.profileUpdates);
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
  };
}

function selectNextQuestion(
  interpretation: PreferenceInterpretation,
  answeredQuestionIds: IntakeQuestionCode[],
  skippedQuestionIds: IntakeQuestionCode[],
  unresolvedUncertainties = interpretation.uncertainties,
  unresolvedConflicts = interpretation.conflicts,
): IntakeQuestion | null {
  const unavailable = new Set([...answeredQuestionIds, ...skippedQuestionIds]);
  if (answeredQuestionIds.length + skippedQuestionIds.length >= maxClarifyingQuestions) return null;

  const updates = interpretation.suggestedProfileUpdates;
  const raw = interpretation.rawUserMessage.toLowerCase();
  const candidates: IntakeQuestion[] = [];

  if (
    !unavailable.has("make_flexibility") &&
    (updates.preferredMake || /\bbmw\b/.test(raw)) &&
    (unresolvedConflicts.some((conflict) => /repair|premium|brand|luxury/i.test(conflict.topic + conflict.description)) ||
      /repair|maintenance/i.test(raw))
  ) {
    candidates.push({
      id: "make_flexibility",
      text: `Is ${updates.preferredMake || "that brand"} flexible, or should I treat it as non-negotiable?`,
      reason: "Brand flexibility can materially change qualification.",
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
    (updates.climate === "snow" || /\bwinter|snow|ice\b/.test(raw)) &&
    !updates.drivetrainPreference
  ) {
    candidates.push({
      id: "winter_traction",
      text: "For winter driving, do you need AWD or 4WD, or is good snow capability enough?",
      reason: "Traction can become a hard requirement only if confirmed.",
    });
  }

  if (!unavailable.has("budget_max") && !updates.maxPurchaseBudget) {
    candidates.push({
      id: "budget_max",
      text: "What is the maximum purchase budget you want me to work within?",
      reason: "Budget strongly affects responsible recommendations.",
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

  if (!unavailable.has("daily_use") && updates.maxPurchaseBudget && !/commute|school|family|work|daily|snow|winter/.test(raw)) {
    candidates.push({
      id: "daily_use",
      text: "Will this car mostly be used for commuting, school, family driving, or bad weather?",
      reason: "Use case helps prioritize the next phase.",
    });
  }

  if (!unavailable.has("new_used") && !updates.purchaseCondition && updates.maxPurchaseBudget && Number(updates.maxPurchaseBudget) < 20000) {
    candidates.push({
      id: "new_used",
      text: "Are you open to used cars, or do you only want new?",
      reason: "Condition changes what is realistic under budget.",
    });
  }

  return candidates[0] || null;
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
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return next;
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
