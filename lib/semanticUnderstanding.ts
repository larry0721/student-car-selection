import {
  carDomainOntology,
  isKnownSemanticConcept,
  type CanonicalSemanticIntent,
  type CarDomainOntology,
  type SemanticConcept,
} from "./carDomainOntology";
import {
  recognizeVehicleLanguage,
  type VehicleLanguageRecognitionResult,
} from "./vehicleLanguageRecognition";
import {
  decisionPolicyDimensionValues,
  type SemanticDecisionPolicyInstruction,
} from "../types/decisionPolicy";
import { resolveDecisionParticipationPolicies } from "./decisionParticipationPolicy";

export type SemanticProviderKind = "model-backed" | "deterministic-fallback" | "test-fixture";
export type UnderstandingItemStatus = "explicit" | "inferred" | "uncertain" | "contradicted" | "unresolved";
export type ProposedConstraintStrength = "required" | "preferred" | "flexible" | "unresolved";
export type InterpretationSource =
  | "deterministic_recognition"
  | "model_interpretation"
  | "deterministic_fallback"
  | "prior_confirmed_context"
  | "user_correction";

export type SemanticConversationMessage = {
  id: string;
  role: "user" | "advisor";
  text: string;
  questionCode?: string;
};

export type UnderstandingInterpretation = {
  id: string;
  concept: SemanticConcept;
  proposedValue: string | number | boolean | string[];
  sourceText: string;
  messageRef: string;
  status: UnderstandingItemStatus;
  intent: CanonicalSemanticIntent;
  confidence: number;
  proposedConstraintStrength: ProposedConstraintStrength;
  interpretationExplanation: string;
  requiresConfirmation: boolean;
  interpretationSource?: InterpretationSource;
};

export type RecognizedSemanticEntity = UnderstandingInterpretation & {
  entityKind: "make" | "model" | "vehicle_reference" | "unknown_vehicle_language";
  canonicalValue?: string;
  likelyReferencedQualities?: string[];
};

export type SemanticConflict = {
  id: string;
  topic: string;
  description: string;
  evidenceRefs: string[];
  conflictType: "correction" | "refinement" | "changed_mind" | "contradiction" | "hypothetical";
  confidence: number;
};

export type SemanticUncertainty = {
  id: string;
  topic: string;
  sourceText: string;
  messageRef: string;
  possibleInterpretations: string[];
  impact: "high" | "medium" | "low";
  question: string;
};

export type UnderstandingAssumption = {
  id: string;
  concept: SemanticConcept;
  assumption: string;
  sourceText: string;
  requiresConfirmation: boolean;
};

export type ClarificationCandidate = {
  id: string;
  question: string;
  relatedConcepts: SemanticConcept[];
  reason: string;
  priorityScore: number;
  expectedImpact: "qualification" | "ranking" | "conflict-resolution" | "confidence" | "interpretation-certainty";
};

export type UnderstandingDraft = {
  conversationSummary: string;
  decisionPolicyInstructions: SemanticDecisionPolicyInstruction[];
  explicitPreferences: UnderstandingInterpretation[];
  inferredPreferences: UnderstandingInterpretation[];
  recognizedEntities: RecognizedSemanticEntity[];
  referenceEntities: RecognizedSemanticEntity[];
  emotionalGoals: UnderstandingInterpretation[];
  practicalGoals: UnderstandingInterpretation[];
  aversions: UnderstandingInterpretation[];
  constraints: UnderstandingInterpretation[];
  uncertainties: SemanticUncertainty[];
  conflicts: SemanticConflict[];
  assumptions: UnderstandingAssumption[];
  unresolvedConcepts: UnderstandingInterpretation[];
  confidenceByInterpretation: Array<{ interpretationId: string; confidence: number; reason: string }>;
  suggestedClarifications: ClarificationCandidate[];
};

export type SemanticUnderstandingRequest = {
  currentMessage: string;
  conversationHistory?: SemanticConversationMessage[];
  currentUnderstanding?: UnderstandingDraft | ValidatedUnderstanding;
  ontology?: CarDomainOntology;
};

export type SemanticUnderstandingResult = {
  providerId: string;
  providerKind: SemanticProviderKind;
  draft: UnderstandingDraft;
  warnings: string[];
  diagnostics?: SemanticUnderstandingDiagnostics;
  failure?: SemanticUnderstandingFailure;
};

export interface SemanticUnderstandingProvider {
  understand(request: SemanticUnderstandingRequest): Promise<SemanticUnderstandingResult>;
}

export type SemanticUnderstandingFailureCode =
  | "provider_not_configured"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_authentication_failed"
  | "invalid_structured_response"
  | "provider_unavailable"
  | "request_rejected";

export type SemanticUnderstandingFailure = {
  code: SemanticUnderstandingFailureCode;
  recoverable: boolean;
  message: string;
};

export type SemanticUnderstandingDiagnostics = {
  providerType: SemanticProviderKind;
  success: boolean;
  latencyMs: number;
  modelIdentifier?: string;
  schemaValidation: "passed" | "failed" | "not_run";
  fallbackUsed: boolean;
  interpretationCount: number;
  uncertaintyCount: number;
  clarificationCount: number;
};

export type ValidationGuardrail = {
  code:
    | "unknown_concept_rejected"
    | "inferred_required_downgraded"
    | "unsupported_profile_destination_rejected"
    | "vehicle_selection_blocked"
    | "low_confidence_retained"
    | "original_evidence_retained";
  message: string;
  interpretationId?: string;
};

export type ValidatedUnderstanding = {
  draft: UnderstandingDraft;
  ontologyVersion: string;
  vehicleLanguage: VehicleLanguageRecognitionResult;
  acceptedInterpretations: UnderstandingInterpretation[];
  rejectedInterpretations: UnderstandingInterpretation[];
  guardrails: ValidationGuardrail[];
  selectedClarification: ClarificationCandidate | null;
  currentMessage?: string;
};

export class DeterministicSemanticUnderstandingProvider implements SemanticUnderstandingProvider {
  readonly providerId = "deterministic-semantic-fallback-v1";
  readonly providerKind = "deterministic-fallback" as const;

  async understand(request: SemanticUnderstandingRequest): Promise<SemanticUnderstandingResult> {
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      draft: buildDeterministicDraft(request),
      warnings: [],
    };
  }
}

export class TestFixtureSemanticUnderstandingProvider implements SemanticUnderstandingProvider {
  readonly providerId = "test-fixture-semantic-provider";
  readonly providerKind = "test-fixture" as const;

  constructor(private readonly draft: UnderstandingDraft) {}

  async understand(): Promise<SemanticUnderstandingResult> {
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      draft: this.draft,
      warnings: [],
    };
  }
}

export class FunctionBackedSemanticUnderstandingProvider implements SemanticUnderstandingProvider {
  readonly providerKind = "model-backed" as const;

  constructor(
    readonly providerId: string,
    private readonly implementation: (request: SemanticUnderstandingRequest) => Promise<UnderstandingDraft>,
  ) {}

  async understand(request: SemanticUnderstandingRequest): Promise<SemanticUnderstandingResult> {
    const draft = await this.implementation(request);
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      draft,
      warnings: ["Model-backed semantic provider output must be validated before it can affect confirmation."],
    };
  }
}

export async function understandAndValidate(
  provider: SemanticUnderstandingProvider,
  request: SemanticUnderstandingRequest,
): Promise<ValidatedUnderstanding> {
  const result = await provider.understand(request);
  return {
    ...validateAndNormalizeUnderstanding(result, request.ontology || carDomainOntology),
    currentMessage: request.currentMessage,
  };
}

export function understandDeterministically(
  request: SemanticUnderstandingRequest,
): ValidatedUnderstanding {
  const result: SemanticUnderstandingResult = {
    providerId: "deterministic-semantic-fallback-v1",
    providerKind: "deterministic-fallback",
    draft: buildDeterministicDraft(request),
    warnings: [],
  };
  return {
    ...validateAndNormalizeUnderstanding(result, request.ontology || carDomainOntology),
    currentMessage: request.currentMessage,
  };
}

export function createEmptyUnderstandingDraft(summary = "No semantic interpretation was produced."): UnderstandingDraft {
  return {
    conversationSummary: summary,
    decisionPolicyInstructions: [],
    explicitPreferences: [],
    inferredPreferences: [],
    recognizedEntities: [],
    referenceEntities: [],
    emotionalGoals: [],
    practicalGoals: [],
    aversions: [],
    constraints: [],
    uncertainties: [],
    conflicts: [],
    assumptions: [],
    unresolvedConcepts: [],
    confidenceByInterpretation: [],
    suggestedClarifications: [],
  };
}

export function validateAndNormalizeUnderstanding(
  result: SemanticUnderstandingResult,
  ontology: CarDomainOntology = carDomainOntology,
): ValidatedUnderstanding {
  const guardrails: ValidationGuardrail[] = [];
  const acceptedInterpretations: UnderstandingInterpretation[] = [];
  const rejectedInterpretations: UnderstandingInterpretation[] = [];
  const vehicleLanguage = recognizeVehicleLanguage(collectEvidenceText(result.draft));
  const draft = normalizeDraft(result.draft, ontology, guardrails);
  const allInterpretations = getAllInterpretations(draft);

  for (const item of allInterpretations) {
    if (!isKnownSemanticConcept(item.concept)) {
      rejectedInterpretations.push(item);
      guardrails.push({ code: "unknown_concept_rejected", message: `Rejected unsupported concept ${item.concept}.`, interpretationId: item.id });
      continue;
    }
    if (item.confidence < 0.45 || item.status === "uncertain" || item.status === "unresolved") {
      guardrails.push({ code: "low_confidence_retained", message: `${item.concept} remains low confidence and requires confirmation.`, interpretationId: item.id });
    }
    acceptedInterpretations.push(item);
  }

  guardrails.push({ code: "original_evidence_retained", message: "Every interpretation keeps source text and message reference." });
  guardrails.push({ code: "vehicle_selection_blocked", message: "Semantic understanding produces no vehicle ranking, vehicleId, score, or recommendation decision." });

  return {
    draft,
    ontologyVersion: ontology.version,
    vehicleLanguage,
    acceptedInterpretations,
    rejectedInterpretations,
    guardrails,
    selectedClarification: selectClarification(draft),
  };
}

export function selectClarification(draft: UnderstandingDraft): ClarificationCandidate | null {
  const policies = resolveDecisionParticipationPolicies(undefined, draft.decisionPolicyInstructions);
  const candidates = draft.suggestedClarifications.filter((candidate) =>
    candidate.relatedConcepts.every((concept) => {
      const dimension = policyDimensionForSemanticConcept(concept);
      return !dimension || policies[dimension]?.participation !== "disabled";
    }),
  );

  for (const conflict of draft.conflicts) {
    candidates.push({
      id: `clarify-conflict:${conflict.id}`,
      question: getConflictQuestion(conflict),
      relatedConcepts: ["unknown"],
      reason: conflict.description,
      priorityScore: 95,
      expectedImpact: "conflict-resolution",
    });
  }

  for (const uncertainty of draft.uncertainties) {
    if (
      policies.purchaseBudget?.participation === "disabled"
      && /\bbudget|purchase price|price limit\b/i.test(`${uncertainty.topic} ${uncertainty.sourceText}`)
    ) {
      continue;
    }
    const impactBoost = uncertainty.impact === "high" ? 80 : uncertainty.impact === "medium" ? 55 : 25;
    candidates.push({
      id: `clarify-uncertainty:${uncertainty.id}`,
      question: uncertainty.question,
      relatedConcepts: ["unknown"],
      reason: `Clarifies ${uncertainty.topic}.`,
      priorityScore: impactBoost,
      expectedImpact: uncertainty.impact === "high" ? "qualification" : "interpretation-certainty",
    });
  }

  return candidates.sort((a, b) => b.priorityScore - a.priorityScore)[0] || null;
}

function buildDeterministicDraft(request: SemanticUnderstandingRequest): UnderstandingDraft {
  const draft = createEmptyUnderstandingDraft();
  const message = request.currentMessage.trim();
  const messageRef = request.conversationHistory?.at(-1)?.id || "current-message";
  const vehicleLanguage = recognizeVehicleLanguage(message);
  const lower = message.toLowerCase();

  draft.conversationSummary = summarizeConversation(message, request.conversationHistory);

  vehicleLanguage.recognizedEntities.forEach((entity, index) => {
    if (entity.kind === "make" && isExcludedVehicleEntity(message, entity.rawText)) {
      const item = interpretation({
        id: `entity-exclusion:${index}:${entity.canonicalName}`,
        concept: "make",
        proposedValue: entity.canonicalName,
        sourceText: findExclusionEvidence(message, entity.rawText),
        messageRef,
        status: "explicit",
        intent: "excluded",
        confidence: entity.confidence,
        strength: "required",
        explanation: `${entity.rawText} was explicitly excluded by the user.`,
        requiresConfirmation: false,
      });
      draft.aversions.push(item);
      return;
    }
    const required = entity.kind === "make" && isRequiredMakeLanguage(message, entity.rawText);
    const requiresConfirmation = entity.kind === "make" ? requiresMakeConfirmation(message, entity.rawText, required) : !required;
    const item = interpretation({
      id: `entity:${index}:${entity.canonicalName}`,
      concept: entity.concept,
      proposedValue: entity.canonicalName,
      sourceText: entity.rawText,
      messageRef,
      status: "explicit",
      intent: required
        ? "required"
        : isAllowedMakeLanguage(message, entity.rawText)
          ? "allowed"
          : isBareMakeLanguage(message, entity.rawText)
            ? "uncertain"
            : "preferred",
      confidence: entity.confidence,
      strength: required ? "required" : "preferred",
      explanation: required
        ? `${entity.rawText} was stated with requirement language.`
        : `${entity.rawText} was recognized as a vehicle entity, but not automatically treated as required.`,
      requiresConfirmation,
    });
    draft.recognizedEntities.push({ ...item, entityKind: entity.kind === "make" ? "make" : "model", canonicalValue: entity.canonicalName });
    if (required) draft.constraints.push(item);
    else draft.explicitPreferences.push(item);
  });

  vehicleLanguage.referenceEntities.forEach((entity, index) => {
    const item = interpretation({
      id: `reference:${index}:${entity.canonicalName}`,
      concept: entity.concept,
      proposedValue: entity.likelyReferencedQualities,
      sourceText: entity.rawText,
      messageRef,
      status: "inferred",
      intent: "preferred",
      confidence: entity.confidence - 0.08,
      strength: "flexible",
      explanation: `${entity.rawText} appears to describe qualities rather than a required vehicle.`,
      requiresConfirmation: entity.requiresClarification,
    });
    draft.referenceEntities.push({
      ...item,
      entityKind: "vehicle_reference",
      canonicalValue: entity.canonicalName,
      likelyReferencedQualities: entity.likelyReferencedQualities,
    });
  });

  vehicleLanguage.unresolvedVehicleLanguage.forEach((entity, index) => {
    draft.unresolvedConcepts.push(interpretation({
      id: `unknown-vehicle:${index}:${entity.rawText}`,
      concept: "unknown",
      proposedValue: entity.rawText,
      sourceText: entity.rawText,
      messageRef,
      status: "unresolved",
      confidence: entity.confidence,
      strength: "unresolved",
      explanation: isOutOfScopeVehicleTerm(entity.rawText)
        ? `${entity.rawText} is vehicle-domain language outside the current passenger-car and light-truck scope.`
        : `${entity.rawText} looks like vehicle language, but it was not recognized confidently.`,
      requiresConfirmation: true,
    }));
    draft.uncertainties.push({
      id: `uncertainty:unknown-vehicle:${index}`,
      topic: isOutOfScopeVehicleTerm(entity.rawText) ? "Outside current vehicle scope" : "Unknown vehicle language",
      sourceText: entity.rawText,
      messageRef,
      possibleInterpretations: isOutOfScopeVehicleTerm(entity.rawText)
        ? ["outside current recommendation scope"]
        : ["vehicle make", "vehicle model", "non-car term"],
      impact: "high",
      question: isOutOfScopeVehicleTerm(entity.rawText)
        ? `I understand you’re asking about a ${entity.rawText}. This version currently recommends passenger cars and light trucks.`
        : `I’m not sure what ${entity.rawText} refers to. Is it a make, model, or a type of vehicle?`,
    });
  });

  if (vehicleLanguage.unresolvedVehicleLanguage.some((entity) => isOutOfScopeVehicleTerm(entity.rawText))) {
    draft.suggestedClarifications = buildClarificationCandidates(draft);
    draft.confidenceByInterpretation = getAllInterpretations(draft).map((item) => ({
      interpretationId: item.id,
      confidence: item.confidence,
      reason: item.interpretationExplanation,
    }));
    return draft;
  }

  addBudget(message, messageRef, draft);
  addDecisionParticipationLanguage(message, messageRef, draft);
  addPracticalLanguage(message, messageRef, draft);
  addFinancialLanguage(message, messageRef, draft);
  addExperienceLanguage(message, messageRef, draft);
  addRiskLanguage(message, messageRef, draft);
  addReferenceClarifications(message, draft);
  addContextualInterpretation(message, request.conversationHistory || [], messageRef, draft);
  addEvolutionSignals(message, request.currentUnderstanding, messageRef, draft);

  if (!draft.explicitPreferences.length && !draft.inferredPreferences.length && !draft.recognizedEntities.length && !draft.referenceEntities.length) {
    draft.uncertainties.push({
      id: "uncertainty:start",
      topic: "Starting point",
      sourceText: message,
      messageRef,
      possibleInterpretations: ["budget", "primary use", "risk tolerance"],
      impact: "high",
      question: "What is the maximum budget or main use I should start with?",
    });
  }

  draft.suggestedClarifications = buildClarificationCandidates(draft);
  draft.confidenceByInterpretation = getAllInterpretations(draft).map((item) => ({
    interpretationId: item.id,
    confidence: item.confidence,
    reason: item.interpretationExplanation,
  }));

  return draft;
}

function addDecisionParticipationLanguage(
  message: string,
  messageRef: string,
  draft: UnderstandingDraft,
) {
  const lower = message.toLowerCase();
  const add = (
    dimension: SemanticDecisionPolicyInstruction["dimension"],
    participation: SemanticDecisionPolicyInstruction["participation"],
    evidence: string,
    explanation: string,
    importance: number | null = null,
    requiresConfirmation = false,
  ) => {
    draft.decisionPolicyInstructions.push({
      id: `policy:${dimension}:${draft.decisionPolicyInstructions.length + 1}`,
      dimension,
      participation,
      importance,
      sourceText: evidence,
      messageRef,
      status: requiresConfirmation ? "uncertain" : "explicit",
      confidence: requiresConfirmation ? 0.72 : 0.96,
      interpretationSource: "deterministic_fallback",
      explanation,
      requiresConfirmation,
    });
  };

  const moneyNoObject = /\b(?:money is no object|ignore all costs?|costs? do(?:es)? not matter)\b/i.exec(message)?.[0];
  const ignoreEverything = /\bignore everything\b/i.exec(message)?.[0];
  const repairsStillMatter = /\b(?:repairs?|maintenance)\b.*\b(?:matter|important|hate|avoid)\b|\b(?:hate|avoid)\b.*\b(?:repairs?|maintenance)\b/i.test(message);
  if (ignoreEverything) {
    for (const dimension of decisionPolicyDimensionValues) {
      add(
        dimension,
        "disabled",
        ignoreEverything,
        "The user explicitly removed this dimension from the current decision.",
      );
    }
  } else if (moneyNoObject) {
    for (const dimension of [
      "purchaseBudget",
      "monthlyPayment",
      "totalOwnershipBudget",
      "affordability",
      "insuranceCost",
      "fuelEnergyCost",
      "resaleValue",
    ] as const) {
      add(dimension, "disabled", moneyNoObject, "The user explicitly removed this cost dimension from the decision.");
    }
    add(
      "maintenanceRisk",
      repairsStillMatter ? "active" : "disabled",
      moneyNoObject,
      repairsStillMatter
        ? "The user removed general cost limits but explicitly preserved repair sensitivity."
        : "The user explicitly removed all cost dimensions from the decision.",
      repairsStillMatter ? 0.85 : null,
    );
  } else {
    const ignoreBudget = /\b(?:ignore (?:the )?budget|no (?:purchase )?budget limit)\b/i.exec(message)?.[0];
    const priceDoesNotMatter = /\b(?:price does not matter|price doesn't matter|purchase price does not matter)\b/i.exec(message)?.[0];
    if (ignoreBudget || priceDoesNotMatter) {
      const evidence = ignoreBudget || priceDoesNotMatter || "";
      add("purchaseBudget", "disabled", evidence, "The user explicitly removed a purchase-price limit.");
      add("monthlyPayment", "disabled", evidence, "No default monthly-payment ceiling may replace an explicitly removed purchase budget.");
      add("affordability", "disabled", evidence, "Purchase-price affordability was explicitly removed from consideration.");
      if (/no (?:purchase )?budget limit|price does(?: not|n't) matter/i.test(evidence)) {
        add(
          "totalOwnershipBudget",
          "unresolved",
          evidence,
          "It is unclear whether ongoing ownership costs should still influence the decision.",
          null,
          true,
        );
      }
    }
  }

  const budgetUnknown = /\b(?:i do not know|i don't know|not sure about|unsure about)\s+(?:my\s+)?budget\b/i.exec(message)?.[0];
  if (budgetUnknown) {
    add("purchaseBudget", "unresolved", budgetUnknown, "The user explicitly said the purchase budget is unknown.", null, true);
  }

  const budgetValue = parsePolicyBudget(message);
  if (budgetValue) {
    const required = /\b(?:under|below|maximum|max|up to|keep it under|no more than)\b/i.test(message);
    const flexible = /\b(?:around|about|roughly|stretch|flexible)\b/i.test(message);
    add(
      "purchaseBudget",
      required && !flexible ? "enforced" : "active",
      budgetValue.evidence,
      required && !flexible
        ? "The stated amount is an explicit maximum purchase-price constraint."
        : "The stated amount is a preferred purchase-price target with flexibility.",
      flexible ? 0.65 : 0.8,
      false,
    );
  } else if (/\bbudget is flexible\b/i.test(lower)) {
    add("purchaseBudget", "unresolved", "budget is flexible", "Budget should participate, but no usable target is known yet.", null, true);
  }

  const simplePolicies: Array<{
    pattern: RegExp;
    dimension: SemanticDecisionPolicyInstruction["dimension"];
    participation: SemanticDecisionPolicyInstruction["participation"];
    importance?: number;
    explanation: string;
  }> = [
    { pattern: /\bignore fuel economy\b/i, dimension: "fuelEnergyCost", participation: "disabled", explanation: "Fuel economy was explicitly removed from the decision." },
    { pattern: /\bfuel type (?:does not|doesn't) matter\b/i, dimension: "fuelType", participation: "disabled", explanation: "The user explicitly allowed any fuel type." },
    { pattern: /\breliability (?:is not|isn't) important\b/i, dimension: "reliability", participation: "deprioritized", importance: 0.2, explanation: "Reliability remains available but was explicitly lowered in priority." },
    { pattern: /\bsafety (?:is all that matters|matters most)\b/i, dimension: "safety", participation: "active", importance: 1, explanation: "Safety was explicitly identified as the top priority." },
    { pattern: /\bsafety above everything\b/i, dimension: "safety", participation: "active", importance: 1, explanation: "Safety was explicitly identified as the top priority." },
    { pattern: /\bperformance matters most\b/i, dimension: "performance", participation: "active", importance: 1, explanation: "Performance was explicitly identified as the top priority." },
    { pattern: /\bperformance only\b/i, dimension: "performance", participation: "active", importance: 1, explanation: "Performance was explicitly identified as the only ranking priority." },
    { pattern: /\b(?:do not|don't) care about resale value\b/i, dimension: "resaleValue", participation: "disabled", explanation: "Resale value was explicitly removed from the decision." },
    { pattern: /\bmaintenance costs? (?:are|is) not a concern\b/i, dimension: "maintenanceRisk", participation: "disabled", explanation: "Maintenance cost was explicitly removed from the decision." },
    { pattern: /\b(?:any|no preference (?:on|about|for)) body style(?: is fine)?\b/i, dimension: "bodyStyle", participation: "disabled", explanation: "The user explicitly allowed any body style." },
    { pattern: /\bautomatic or manual,? either is fine\b/i, dimension: "transmission", participation: "disabled", explanation: "The user explicitly allowed either transmission type." },
    { pattern: /\b(?:i have )?no preference (?:on|about|for) drivetrain\b/i, dimension: "drivetrain", participation: "disabled", explanation: "The user explicitly allowed any drivetrain." },
    { pattern: /\bno manual(?: transmission)?\b/i, dimension: "transmission", participation: "enforced", explanation: "Manual transmission was explicitly excluded." },
  ];

  for (const rule of simplePolicies) {
    const evidence = rule.pattern.exec(message)?.[0];
    if (evidence) add(rule.dimension, rule.participation, evidence, rule.explanation, rule.importance ?? null);
  }

  const reliabilityEvidence = /\b(?:reliable|reliability matters?)\b/i.exec(message)?.[0];
  if (
    reliabilityEvidence
    && !/\breliability (?:is not|isn't|does not|doesn't) (?:important|matter)\b/i.test(message)
  ) {
    add(
      "reliability",
      "active",
      reliabilityEvidence,
      "Reliability was explicitly identified as a positive decision criterion.",
      0.8,
    );
  }
}

function parsePolicyBudget(message: string) {
  const match = message.match(/\$?\s*(\d{1,3}(?:,\d{3})|\d{4,6}|\d{1,3})\s*(k)?/i);
  if (!match) return null;
  const numeric = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  const value = match[2] || numeric < 1000 ? numeric * 1000 : numeric;
  return value >= 1000 ? { value, evidence: match[0] } : null;
}

function addBudget(message: string, messageRef: string, draft: UnderstandingDraft) {
  const budget = message.match(/\$?\s?(\d{2,3})(?:,\d{3})?k?\b/i);
  if (!budget) return;
  const raw = budget[0];
  const parsed = parseMoney(raw);
  if (!parsed) return;
  draft.explicitPreferences.push(interpretation({
    id: `budget:${raw}`,
    concept: /month|monthly|payment/i.test(message) ? "monthly_budget" : "purchase_budget",
    proposedValue: parsed,
    sourceText: raw,
    messageRef,
    status: "explicit",
    confidence: /\b(under|max|up to|maximum|below)\b/i.test(message) ? 0.92 : 0.78,
    strength: /\b(under|max|maximum|below|must)\b/i.test(message) ? "required" : "preferred",
    explanation: `${raw} was stated as a financial boundary.`,
    requiresConfirmation: !/\b(under|max|maximum|below)\b/i.test(message),
  }));
}

function addPracticalLanguage(message: string, messageRef: string, draft: UnderstandingDraft) {
  const bodyStyleIntent = getBodyStyleIntent(message);
  if (bodyStyleIntent) {
    draft.explicitPreferences.push(interpretation({
      id: `practical:body-style:${bodyStyleIntent.bodyStyle}`,
      concept: "body_style",
      proposedValue: bodyStyleIntent.bodyStyle,
      sourceText: bodyStyleIntent.evidence,
      messageRef,
      status: "explicit",
      intent: bodyStyleIntent.intent,
      confidence: 0.9,
      strength: bodyStyleIntent.intent === "required" ? "required" : "preferred",
      explanation: bodyStyleIntent.intent !== "required"
        ? `${bodyStyleIntent.evidence} explicitly names a body style but allows a fallback.`
        : `${bodyStyleIntent.evidence} explicitly names an objective body-style requirement.`,
      requiresConfirmation: bodyStyleIntent.intent === "uncertain",
    }));
    const fallbackBodyStyle = getAllowedFallbackBodyStyle(message, bodyStyleIntent.bodyStyle);
    if (fallbackBodyStyle) {
      draft.explicitPreferences.push(interpretation({
        id: `practical:body-style-fallback:${fallbackBodyStyle.bodyStyle}`,
        concept: "body_style",
        proposedValue: fallbackBodyStyle.bodyStyle,
        sourceText: fallbackBodyStyle.evidence,
        messageRef,
        status: "explicit",
        intent: "allowed",
        confidence: 0.9,
        strength: "flexible",
        explanation: `${fallbackBodyStyle.evidence} is an explicitly allowed fallback body style.`,
        requiresConfirmation: false,
      }));
    }
  }
  addAdditionalBodyStyleAversions(message, messageRef, draft, bodyStyleIntent?.bodyStyle);

  for (const drivetrain of getDrivetrainIntents(message)) {
    draft.explicitPreferences.push(interpretation({
      id: `practical:drivetrain:${drivetrain.value}`,
      concept: "drivetrain",
      proposedValue: drivetrain.value,
      sourceText: drivetrain.evidence,
      messageRef,
      status: "explicit",
      intent: drivetrain.intent,
      confidence: 0.9,
      strength: drivetrain.intent === "required" ? "required" : drivetrain.intent === "preferred" ? "preferred" : "flexible",
      explanation: `${drivetrain.evidence} names an objective drivetrain preference.`,
      requiresConfirmation: drivetrain.intent === "uncertain",
    }));
  }
  addTransmissionLanguage(message, messageRef, draft);

  if (/\bsnow|icy|winter|mountain\b/i.test(message)) {
    draft.practicalGoals.push(interpretation({
      id: "practical:snow",
      concept: "snow_use",
      proposedValue: "regular snow or winter traction concern",
      sourceText: findEvidence(message, /\bsnow|icy|winter|mountain\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.88,
      strength: "preferred",
      explanation: "Snow or winter use was explicit; AWD may matter but should be confirmed before becoming required.",
      requiresConfirmation: true,
    }));
    draft.assumptions.push({
      id: "assumption:snow-awd",
      concept: "snow_use",
      assumption: "AWD or winter-tire suitability may be useful, but it is not a hard drivetrain requirement until confirmed.",
      sourceText: findEvidence(message, /\bsnow|icy|winter|mountain\b/i),
      requiresConfirmation: true,
    });
  }
  if (/\bfamily|kids|friends|passengers|(?:two|three|four|five|six|seven|eight|\d+)[-\s]?(?:seat|seats|seater)|room for\b/i.test(message)) {
    const explicitSeats = getSeatCount(message);
    draft.practicalGoals.push(interpretation({
      id: "practical:passengers",
      concept: "passenger_capacity",
      proposedValue: explicitSeats || "needs passenger space",
      sourceText: findEvidence(message, /\bfamily|kids|friends|passengers|(?:two|three|four|five|six|seven|eight|\d+)[-\s]?(?:seat|seats|seater)|room for\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.85,
      strength: explicitSeats || /\bneed|must|required\b/i.test(message) ? "required" : "preferred",
      explanation: "Passenger space was discussed as part of the use case.",
      requiresConfirmation: false,
    }));
  }
  if (/\bcity|street parking|parallel|tight parking|campus\b/i.test(message)) {
    draft.practicalGoals.push(interpretation({
      id: "practical:parking",
      concept: "parking",
      proposedValue: "easy to park or city friendly",
      sourceText: findEvidence(message, /\bcity|street parking|parallel|tight parking|campus\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.82,
      strength: "preferred",
      explanation: "Urban parking language points to size and maneuverability.",
      requiresConfirmation: false,
    }));
  }
  if (/\bcamping|campground|trailhead\b/i.test(message)) {
    draft.practicalGoals.push(interpretation({
      id: "practical:camping-context",
      concept: "vehicle_category",
      proposedValue: "camping use needs clarification",
      sourceText: findEvidence(message, /\bcamping|campground|trailhead\b/i),
      messageRef,
      status: "inferred",
      confidence: 0.74,
      strength: "flexible",
      explanation: "Camping is a use case, but it should not be silently converted into SUV, AWD, cargo, or towing without confirmation.",
      requiresConfirmation: true,
    }));
    draft.uncertainties.push({
      id: "uncertainty:camping-use",
      topic: "Camping use",
      sourceText: findEvidence(message, /\bcamping|campground|trailhead\b/i),
      messageRef,
      possibleInterpretations: ["extra cargo room", "rough-road or AWD capability", "sleeping space", "towing"],
      impact: "high",
      question: "What matters most for your camping trips: extra cargo room, rough-road/AWD capability, sleeping space, or towing?",
    });
  }
}

function getBodyStyleIntent(message: string): {
  bodyStyle: "sedan" | "suv" | "hatchback" | "truck" | "coupe" | "convertible" | "wagon" | "minivan";
  evidence: string;
  intent: CanonicalSemanticIntent;
} | null {
  if (/\btruck\s+(?:feeling|feel|vibe|energy)\b/i.test(message) || /\bpast a truck\b/i.test(message)) return null;
  const candidates: Array<{
    bodyStyle: "sedan" | "suv" | "hatchback" | "truck" | "coupe" | "convertible" | "wagon" | "minivan";
    pattern: RegExp;
    evidence: RegExp;
  }> = [
    {
      bodyStyle: "truck",
      pattern: /\b(?:want|need|looking for|look for|find|buy|get)?\s*(?:(?:a|an)\s+|something like a\s+)?(?:[\w-]+\s+){0,4}(?:pickup\s+)?truck\b|\bpickup\b|\btruck bed\b|\bwith a (?:truck )?bed\b/i,
      evidence: /\b(?:pickup\s+)?truck\b|\bpickup\b|\btruck bed\b|\bwith a (?:truck )?bed\b/i,
    },
    { bodyStyle: "suv", pattern: /\b(?:want|need|looking for|look for|find|buy|get)\s+(?:(?:a|an)\s+)?(?:[\w-]+\s+){0,3}(?:suvs?|crossovers?)\b|\bsuvs?\b/i, evidence: /\bsuvs?\b|\bcrossovers?\b/i },
    { bodyStyle: "sedan", pattern: /\b(?:want|need|looking for|look for|find|buy|get)\s+(?:(?:a|an)\s+)?(?:[\w-]+\s+){0,3}sedan\b|\bsedan\b/i, evidence: /\bsedan\b/i },
    { bodyStyle: "hatchback", pattern: /\b(?:hatchback|hatch)\b/i, evidence: /\bhatchback|hatch\b/i },
    { bodyStyle: "coupe", pattern: /\bcoupe|two door|2 door\b/i, evidence: /\bcoupe|two door|2 door\b/i },
    { bodyStyle: "convertible", pattern: /\bconvertible|cabriolet\b/i, evidence: /\bconvertible|cabriolet\b/i },
    { bodyStyle: "wagon", pattern: /\bwagon|estate\b/i, evidence: /\bwagon|estate\b/i },
    { bodyStyle: "minivan", pattern: /\bminivan|mini van|family van\b/i, evidence: /\bminivan|mini van|family van\b/i },
  ];
  const match = candidates.find((candidate) => candidate.pattern.test(message));
  if (match) {
    const evidence = findEvidence(message, match.evidence);
    const clause = message
      .split(/\s*(?:,|;|\bbut\b)\s*/i)
      .find((part) => part.toLowerCase().includes(evidence.toLowerCase())) || message;
    const excluded = isExcludedVehicleEntity(message, evidence);
    const allowed = /\b(?:acceptable|okay|ok|fine|if necessary|fallback)\b/i.test(clause);
    const preferred = /\b(?:prefer|preferred|maybe|would like)\b/i.test(message);
    const bare = message.trim().toLowerCase() === evidence.trim().toLowerCase();
    const hasAllowedFallback = Boolean(getAllowedFallbackBodyStyle(message, match.bodyStyle));
    return {
      bodyStyle: match.bodyStyle,
      evidence,
      intent: excluded
        ? "excluded"
        : allowed
          ? "allowed"
          : preferred || hasAllowedFallback
            ? "preferred"
            : bare
              ? "uncertain"
              : "required",
    };
  }

  return null;
}

function getAllowedFallbackBodyStyle(
  message: string,
  primary: "sedan" | "suv" | "hatchback" | "truck" | "coupe" | "convertible" | "wagon" | "minivan",
) {
  const aliases: Array<{
    bodyStyle: "sedan" | "suv" | "hatchback" | "truck" | "coupe" | "convertible" | "wagon" | "minivan";
    pattern: RegExp;
  }> = [
    { bodyStyle: "sedan", pattern: /\bsedan\b/i },
    { bodyStyle: "suv", pattern: /\b(?:suvs?|crossovers?)\b/i },
    { bodyStyle: "hatchback", pattern: /\b(?:hatchback|hatch)\b/i },
    { bodyStyle: "truck", pattern: /\b(?:truck|pickup)\b/i },
    { bodyStyle: "coupe", pattern: /\bcoupe\b/i },
    { bodyStyle: "convertible", pattern: /\b(?:convertible|cabriolet)\b/i },
    { bodyStyle: "wagon", pattern: /\b(?:wagon|estate)\b/i },
    { bodyStyle: "minivan", pattern: /\b(?:minivan|mini van)\b/i },
  ];
  const fallbackClause = message
    .split(/\s*(?:,|;|\bbut\b)\s*/i)
    .find((part) => /\b(?:acceptable|okay|ok|fine|if necessary|fallback)\b/i.test(part));
  if (!fallbackClause) return null;
  const match = aliases.find((item) => item.bodyStyle !== primary && item.pattern.test(fallbackClause));
  if (!match) return null;
  return { bodyStyle: match.bodyStyle, evidence: fallbackClause.trim() };
}

function getSeatCount(message: string) {
  const wordMatch = message.match(/\b(two|three|four|five|six|seven|eight)[-\s]?(?:seat|seats|seater)\b/i);
  if (wordMatch?.[1]) return wordNumber(wordMatch[1]);
  const numericMatch = message.match(/\b(\d+)[-\s]?(?:seat|seats|seater)\b/i);
  if (numericMatch?.[1]) return Number(numericMatch[1]);
  return 0;
}

function getDrivetrainIntents(message: string): Array<{ value: "AWD" | "4WD" | "FWD" | "RWD"; evidence: string; intent: CanonicalSemanticIntent }> {
  const pattern = /\b(AWD|4WD|FWD|RWD|all[-\s]?wheel drive|four[-\s]?wheel drive|front[-\s]?wheel drive|rear[-\s]?wheel drive)\b/gi;
  const matches = Array.from(message.matchAll(pattern));
  return matches.map((match) => {
    const raw = match[0];
    const lower = raw.toLowerCase();
    const value = /all|awd/i.test(lower) ? "AWD" : /four|4wd/i.test(lower) ? "4WD" : /front|fwd/i.test(lower) ? "FWD" : "RWD";
    const clause = clauseForVehicleTerm(message, raw);
    const relaxed = /\b(?:not required|isn't required|is not required|doesn't have to|does not have to)\b/i.test(clause);
    return {
      value,
      evidence: raw,
      intent: intentFromVehicleClause(clause, raw, relaxed),
    };
  });
}

function addAdditionalBodyStyleAversions(message: string, messageRef: string, draft: UnderstandingDraft, primary?: string) {
  const styles: Array<[string, RegExp]> = [
    ["sedan", /\bsedans?\b/i], ["suv", /\b(?:suvs?|crossovers?)\b/i], ["hatchback", /\b(?:hatchbacks?|hatches)\b/i],
    ["truck", /\b(?:trucks?|pickups?)\b/i], ["coupe", /\bcoupes?\b/i], ["wagon", /\b(?:wagons?|estates?)\b/i],
    ["minivan", /\b(?:minivan|mini van)\b/i],
  ];
  for (const [style, pattern] of styles) {
    const match = message.match(pattern);
    if (!match?.[0] || style === primary || !isExcludedVehicleEntity(message, match[0])) continue;
    draft.aversions.push(interpretation({
      id: `practical:excluded-body-style:${style}`,
      concept: "body_style",
      proposedValue: style,
      sourceText: findExclusionEvidence(message, match[0]),
      messageRef,
      status: "explicit",
      intent: "excluded",
      confidence: 0.9,
      strength: "required",
      explanation: "The user explicitly excluded this body style.",
      requiresConfirmation: false,
    }));
  }
}

function addTransmissionLanguage(message: string, messageRef: string, draft: UnderstandingDraft) {
  const values: Array<["automatic" | "manual" | "cvt", RegExp]> = [
    ["manual", /\b(?:manual|stick shift|stick)\b/i],
    ["automatic", /\b(?:automatic|auto(?:matic)? transmission)\b/i],
    ["cvt", /\bcvt\b/i],
  ];
  for (const [value, pattern] of values) {
    const match = message.match(pattern);
    if (!match?.[0]) continue;
    const intent = intentFromVehicleClause(clauseForVehicleTerm(message, match[0]), match[0]);
    draft.explicitPreferences.push(interpretation({
      id: `practical:transmission:${value}`,
      concept: "transmission",
      proposedValue: value,
      sourceText: match[0],
      messageRef,
      status: "explicit",
      intent,
      confidence: 0.9,
      strength: intent === "required" ? "required" : "preferred",
      explanation: "The user named a transmission preference.",
      requiresConfirmation: intent === "uncertain",
    }));
  }
}

function wordNumber(value: string) {
  const numbers: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
  };
  return numbers[value.toLowerCase()] || 0;
}

function isExcludedVehicleEntity(message: string, rawText: string) {
  const clause = clauseForVehicleTerm(message, rawText);
  return /\b(?:do not want|don't want|dont want|avoid|exclude|except|no|not)\b/i.test(clause);
}

function findExclusionEvidence(message: string, rawText: string) {
  const index = message.toLowerCase().indexOf(rawText.toLowerCase());
  if (index < 0) return rawText;
  return message.slice(Math.max(0, index - 30), Math.min(message.length, index + rawText.length + 20)).trim();
}

function clauseForVehicleTerm(message: string, rawText: string) {
  return message
    .split(/\s*(?:,|;|\bbut\b|\band\b)\s*/i)
    .find((part) => part.toLowerCase().includes(rawText.toLowerCase())) || message;
}

function intentFromVehicleClause(
  clause: string,
  rawText: string,
  relaxed = false,
): CanonicalSemanticIntent {
  const bare = clause.trim().replace(/[.!?]/g, "").toLowerCase() === rawText.trim().toLowerCase();
  if (/\b(?:do not want|don't want|dont want|avoid|exclude|except|no)\b/i.test(clause)) return "excluded";
  if (/\b(?:acceptable|okay|ok|fine|if necessary|fallback)\b/i.test(clause)) return "allowed";
  if (relaxed) return "uncertain";
  if (/\b(?:maybe|prefer|preferred|would like)\b/i.test(clause)) return "preferred";
  if (/\b(?:want|need|must|required|only|has to be|looking for|find|show me)\b/i.test(clause)) return "required";
  return bare ? "uncertain" : "required";
}

function isRequiredMakeLanguage(message: string, rawText: string) {
  const index = message.toLowerCase().indexOf(rawText.toLowerCase());
  if (index < 0) return false;
  const nearby = message.slice(Math.max(0, index - 26), Math.min(message.length, index + rawText.length + 26));
  if (/\b(prefer|preferred|would prefer|like|would like|acceptable|okay|ok|if necessary|flexible|look|looks|style|vibe|feeling|badge|image)\b/i.test(nearby)) {
    return false;
  }
  if (/\b(repairs?|maintenance|expensive to fix|ownership cost)\b/i.test(message) && !/\b(only|must|required|non[-\s]?negotiable)\b/i.test(nearby)) {
    return false;
  }
  return /\b(want|show me|find|looking for|look for|buy|get|need|must|required|only|has to be)\b/i.test(nearby);
}

function requiresMakeConfirmation(message: string, rawText: string, required: boolean) {
  if (required) return false;
  const index = message.toLowerCase().indexOf(rawText.toLowerCase());
  const nearby = index < 0
    ? message
    : message.slice(Math.max(0, index - 26), Math.min(message.length, index + rawText.length + 26));
  if (message.trim().toLowerCase() === rawText.trim().toLowerCase()) return true;
  if (/\b(prefer|preferred|acceptable|okay|ok|if necessary|fallback)\b/i.test(message)) return false;
  return /\b(like|would like|look|looks|style|vibe|feeling|badge|image|repairs?|maintenance|expensive to fix|ownership cost)\b/i.test(nearby + " " + message);
}

function isAllowedMakeLanguage(message: string, rawText: string) {
  const clause = message
    .split(/\s*(?:,|;|\bbut\b)\s*/i)
    .find((part) => part.toLowerCase().includes(rawText.toLowerCase())) || message;
  if (/\b(?:prefer|preferred|maybe)\b/i.test(clause)) return false;
  return /\b(?:acceptable|okay|ok|fine|allowed|either|or)\b/i.test(clause);
}

function isBareMakeLanguage(message: string, rawText: string) {
  return message.trim().toLowerCase() === rawText.trim().toLowerCase();
}

function isOutOfScopeVehicleTerm(value: string) {
  return /\b(?:motorcycle|motorbike|rv|camper van|atv|electric scooter|scooter|boat)\b/i.test(value);
}

function addFinancialLanguage(message: string, messageRef: string, draft: UnderstandingDraft) {
  const affordabilityPattern = /\b(?:cheap|low budget|affordable|don['’]?t want to spend much|dont want to spend much|do not want to spend much|costing too much)\b/i;
  if (affordabilityPattern.test(message)) {
    draft.inferredPreferences.push(interpretation({
      id: "financial:budget-sensitive",
      concept: "purchase_budget",
      proposedValue: "budget sensitive; needs a number before filtering",
      sourceText: findEvidence(message, affordabilityPattern),
      messageRef,
      status: "explicit",
      confidence: 0.74,
      strength: "preferred",
      explanation: "The user expressed affordability, but no concrete purchase budget was provided.",
      requiresConfirmation: true,
    }));
    draft.uncertainties.push({
      id: "uncertainty:budget-number",
      topic: "Budget amount",
      sourceText: findEvidence(message, affordabilityPattern),
      messageRef,
      possibleInterpretations: ["low purchase budget", "low monthly ownership cost", "low repair risk"],
      impact: "high",
      question: "What maximum purchase budget should I use?",
    });
  }
  if (/\brepair|maintenance|break|shop|expensive to fix|ownership cost|running cost|prices|paying|money\b/i.test(message)) {
    draft.aversions.push(interpretation({
      id: "aversion:repair-cost",
      concept: "maintenance_tolerance",
      proposedValue: "low tolerance for repair and maintenance risk",
      sourceText: findEvidence(message, /\brepair|maintenance|break|shop|expensive to fix|ownership cost|running cost|prices|paying|money\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.86,
      strength: "preferred",
      explanation: "The user is worried about ongoing ownership risk, not just purchase price.",
      requiresConfirmation: false,
    }));
  }
  if (/\b(?:hybrid|electric|ev|diesel)\b/i.test(message)) {
    const values: Array<["hybrid" | "electric" | "diesel", RegExp]> = [
      ["hybrid", /\bhybrid\b/i], ["electric", /\b(?:electric|ev)\b/i], ["diesel", /\bdiesel\b/i],
    ];
    for (const [value, pattern] of values) {
      const match = message.match(pattern);
      if (!match?.[0]) continue;
      const intent = intentFromVehicleClause(clauseForVehicleTerm(message, match[0]), match[0]);
      draft.explicitPreferences.push(interpretation({
        id: `financial:powertrain:${value}`,
        concept: "powertrain",
        proposedValue: value,
        sourceText: match[0],
        messageRef,
        status: "explicit",
        intent,
        confidence: 0.88,
        strength: intent === "required" ? "required" : "preferred",
        explanation: "The user named an objective fuel or powertrain requirement.",
        requiresConfirmation: intent === "uncertain",
      }));
    }
  } else if (/\bgas|fuel|mpg|efficient|commute cost\b/i.test(message)) {
    draft.inferredPreferences.push(interpretation({
      id: "financial:fuel",
      concept: "fuel_sensitivity",
      proposedValue: "fuel cost matters",
      sourceText: findEvidence(message, /\bgas|fuel|mpg|efficient|hybrid|commute cost\b/i),
      messageRef,
      status: "inferred",
      confidence: 0.78,
      strength: "preferred",
      explanation: "Fuel-related language maps to fuel cost sensitivity.",
      requiresConfirmation: !/mpg/i.test(message),
    }));
  }
}

function addExperienceLanguage(message: string, messageRef: string, draft: UnderstandingDraft) {
  const lower = message.toLowerCase();
  const accelerationPattern = /\bpowerful|effortless|merge|passing|move(?:s)?|quick|fast|acceleration|highway pull|freeway traffic|on-ramp\b/i;
  if (accelerationPattern.test(message)) {
    const ambiguous = /\bpowerful\b/i.test(message) && !/\bmerge|passing|highway|quick|fast|acceleration\b/i.test(message);
    draft.inferredPreferences.push(interpretation({
      id: "experience:acceleration",
      concept: "acceleration",
      proposedValue: ambiguous ? "possible acceleration, towing, or general power" : "passing and merging confidence",
      sourceText: findEvidence(message, accelerationPattern),
      messageRef,
      status: ambiguous ? "uncertain" : "inferred",
      confidence: ambiguous ? 0.52 : 0.82,
      strength: "preferred",
      explanation: ambiguous
        ? "Powerful is ambiguous without knowing whether the user means acceleration, handling, towing, or size."
        : "The language points to acceleration and highway passing confidence.",
      requiresConfirmation: ambiguous,
    }));
    if (ambiguous) {
      draft.uncertainties.push({
        id: "uncertainty:power",
        topic: "Meaning of power",
        sourceText: findEvidence(message, /\bpowerful\b/i),
        messageRef,
        possibleInterpretations: ["acceleration", "handling", "towing or carrying capability"],
        impact: "high",
        question: "When you say powerful, do you mean quick acceleration, sporty handling, or carrying/towing strength?",
      });
    }
  }

  const statusPattern = /\b(successful|grown[-\s]?up|professional|confident|premium|luxury|classy|expensive-looking|looks expensive|status|executive|elevated)\b/i;
  if (statusPattern.test(message)) {
    draft.emotionalGoals.push(interpretation({
      id: "emotion:status-image",
      concept: "status_image",
      proposedValue: "wants mature or elevated image",
      sourceText: findEvidence(message, statusPattern),
      messageRef,
      status: "inferred",
      confidence: 0.72,
      strength: "flexible",
      explanation: "Image language can affect styling and interior feel, but should stay tentative until confirmed.",
      requiresConfirmation: true,
    }));
  }
  const understatedPattern = /\bnot .*flashy|try(?:ing)? too hard|look like .*trying|understated|subtle|quiet style|low[-\s]?key|not .*loud|without .*loud\b/i;
  if (understatedPattern.test(lower)) {
    draft.aversions.push(interpretation({
      id: "aversion:flashy",
      concept: "styling",
      proposedValue: "avoid flashy or attention-seeking styling",
      sourceText: findEvidence(message, understatedPattern),
      messageRef,
      status: "inferred",
      confidence: 0.7,
      strength: "flexible",
      explanation: "The user appears to prefer understated styling rather than obvious status signaling.",
      requiresConfirmation: true,
    }));
  }
  if (/\bcomfortable|comfort\b/i.test(message)) {
    draft.emotionalGoals.push(interpretation({
      id: "experience:comfort",
      concept: "comfort",
      proposedValue: "comfort matters",
      sourceText: findEvidence(message, /\bcomfortable|comfort\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.82,
      strength: "preferred",
      explanation: "Comfort was stated, but the catalog has no verified comfort score.",
      requiresConfirmation: false,
    }));
  }
  if (/\bquiet|quietness|low cabin noise\b/i.test(message) && !understatedPattern.test(message)) {
    draft.emotionalGoals.push(interpretation({
      id: "experience:quietness",
      concept: "quietness",
      proposedValue: "quiet cabin matters",
      sourceText: findEvidence(message, /\bquiet|quietness|low cabin noise\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.82,
      strength: "preferred",
      explanation: "Cabin quietness was stated, but the catalog has no verified quietness score.",
      requiresConfirmation: false,
    }));
  }
  if (/\bembarrass|friends|parents approve|not regret|peaceful|calm|feels like me\b/i.test(message)) {
    draft.emotionalGoals.push(interpretation({
      id: "emotion:approval",
      concept: "first_car_suitability",
      proposedValue: "wants a socially comfortable and low-regret choice",
      sourceText: findEvidence(message, /\bembarrass|friends|parents approve|not regret|peaceful|calm|feels like me\b/i),
      messageRef,
      status: "inferred",
      confidence: 0.68,
      strength: "flexible",
      explanation: "Emotional comfort is relevant, but it should not override safety or ownership risk without confirmation.",
      requiresConfirmation: true,
    }));
  }
}

function addRiskLanguage(message: string, messageRef: string, draft: UnderstandingDraft) {
  if (/\bsafe|safety|crash|parents|protect\b/i.test(message)) {
    draft.inferredPreferences.push(interpretation({
      id: "risk:safety",
      concept: "safety",
      proposedValue: "safety matters",
      sourceText: findEvidence(message, /\bsafe|safety|crash|parents|protect\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.86,
      strength: /\bmust|need|required|only\b/i.test(message) ? "required" : "preferred",
      explanation: "Safety was directly mentioned.",
      requiresConfirmation: !/\bmust|need|required|only\b/i.test(message),
    }));
  }
  if (/\breliable|dependable|won't break|not regret|last\b/i.test(message)) {
    draft.inferredPreferences.push(interpretation({
      id: "risk:reliability",
      concept: "reliability",
      proposedValue: "reliability matters",
      sourceText: findEvidence(message, /\breliable|dependable|won't break|not regret|last\b/i),
      messageRef,
      status: "explicit",
      confidence: 0.86,
      strength: "preferred",
      explanation: "Reliability was directly mentioned, but no minimum score was specified.",
      requiresConfirmation: false,
    }));
  }
}

function addReferenceClarifications(message: string, draft: UnderstandingDraft) {
  if (draft.referenceEntities.length) {
    const entity = draft.referenceEntities[0];
    draft.uncertainties.push({
      id: `uncertainty:reference:${entity.canonicalValue}`,
      topic: "Vehicle reference meaning",
      sourceText: entity.sourceText,
      messageRef: entity.messageRef,
      possibleInterpretations: entity.likelyReferencedQualities || ["brand image", "driving feel", "styling"],
      impact: /\brequired|must|need\b/i.test(message) ? "high" : "medium",
      question: `When you mention ${entity.canonicalValue}, is the badge important, or is it the ${formatList(entity.likelyReferencedQualities || ["overall feel"])} you want?`,
    });
  }
}

function addContextualInterpretation(
  message: string,
  history: SemanticConversationMessage[],
  messageRef: string,
  draft: UnderstandingDraft,
) {
  const previousAdvisor = [...history].reverse().find((turn) => turn.role === "advisor");
  if (!previousAdvisor) return;
  if (/acceleration|handling|carrying|power/i.test(previousAdvisor.text) && /\bmerge|highway|passing|on-ramp|freeway\b/i.test(message)) {
    draft.inferredPreferences.push(interpretation({
      id: "context:power-merge",
      concept: "acceleration",
      proposedValue: "confidence merging and passing on highways",
      sourceText: message,
      messageRef,
      status: "inferred",
      confidence: 0.9,
      strength: "preferred",
      explanation: "The answer resolves the previous power clarification toward acceleration, not towing or vehicle size.",
      requiresConfirmation: false,
    }));
  }
}

function addEvolutionSignals(
  message: string,
  currentUnderstanding: UnderstandingDraft | ValidatedUnderstanding | undefined,
  messageRef: string,
  draft: UnderstandingDraft,
) {
  const previousDraft = "draft" in (currentUnderstanding || {}) ? (currentUnderstanding as ValidatedUnderstanding).draft : currentUnderstanding as UnderstandingDraft | undefined;
  if (!previousDraft) return;
  const priorRequiredMake = previousDraft.constraints.find((item) => item.concept === "make" && item.proposedConstraintStrength === "required");
  if (priorRequiredMake && /\bbadge|brand\b.*\bnot\b|\bnot .*important\b|\bdon't care.*badge\b/i.test(message)) {
    draft.conflicts.push({
      id: "conflict:make-relaxed",
      topic: "Make requirement relaxed",
      description: `${String(priorRequiredMake.proposedValue)} was previously required, but the latest message says the badge is less important.`,
      evidenceRefs: [priorRequiredMake.messageRef, messageRef],
      conflictType: "changed_mind",
      confidence: 0.86,
    });
    draft.inferredPreferences.push(interpretation({
      id: "evolution:make-preference",
      concept: "make",
      proposedValue: priorRequiredMake.proposedValue,
      sourceText: message,
      messageRef,
      status: "contradicted",
      confidence: 0.82,
      strength: "preferred",
      explanation: "The latest statement relaxes the earlier make requirement into a preference.",
      requiresConfirmation: true,
    }));
  }
  const priorBudget = getAllInterpretations(previousDraft).find((item) => item.concept === "purchase_budget");
  if (priorBudget && /\b45,?000|45k|worth it|if .* worth\b/i.test(message)) {
    draft.conflicts.push({
      id: "conflict:budget-changed",
      topic: "Budget changed",
      description: `Earlier budget evidence conflicts with the newer willingness to spend more if value is strong.`,
      evidenceRefs: [priorBudget.messageRef, messageRef],
      conflictType: "changed_mind",
      confidence: 0.8,
    });
  }
}

function validateStrength(
  item: UnderstandingInterpretation,
  ontology: CarDomainOntology,
  guardrails: ValidationGuardrail[],
): UnderstandingInterpretation {
  const concept = ontology.concepts[item.concept];
  if (!concept) return item;
  if (item.status !== "explicit" && item.proposedConstraintStrength === "required") {
    guardrails.push({
      code: "inferred_required_downgraded",
      message: `${item.concept} was inferred and cannot become a hard requirement without confirmation.`,
      interpretationId: item.id,
    });
    return {
      ...item,
      intent: item.intent === "required" ? "uncertain" : item.intent,
      proposedConstraintStrength: "preferred",
      requiresConfirmation: true,
    };
  }
  if (item.proposedConstraintStrength === "required" && !concept.canBecomeHardConstraint) {
    guardrails.push({
      code: "unsupported_profile_destination_rejected",
      message: `${item.concept} cannot become a hard constraint in the current BuyerProfile schema.`,
      interpretationId: item.id,
    });
    return {
      ...item,
      intent: item.intent === "required" ? "uncertain" : item.intent,
      proposedConstraintStrength: "preferred",
      requiresConfirmation: true,
    };
  }
  return item;
}

function normalizeDraft(draft: UnderstandingDraft, ontology: CarDomainOntology, guardrails: ValidationGuardrail[]): UnderstandingDraft {
  const normalize = (item: UnderstandingInterpretation) => validateStrength(item, ontology, guardrails);
  return {
    ...draft,
    explicitPreferences: draft.explicitPreferences.map(normalize),
    inferredPreferences: draft.inferredPreferences.map(normalize),
    emotionalGoals: draft.emotionalGoals.map(normalize),
    practicalGoals: draft.practicalGoals.map(normalize),
    aversions: draft.aversions.map(normalize),
    constraints: draft.constraints.map(normalize),
    unresolvedConcepts: draft.unresolvedConcepts.map(normalize),
    recognizedEntities: draft.recognizedEntities.map((item) => ({ ...normalize(item), entityKind: item.entityKind, canonicalValue: item.canonicalValue, likelyReferencedQualities: item.likelyReferencedQualities })),
    referenceEntities: draft.referenceEntities.map((item) => ({ ...normalize(item), entityKind: item.entityKind, canonicalValue: item.canonicalValue, likelyReferencedQualities: item.likelyReferencedQualities })),
  };
}

function buildClarificationCandidates(draft: UnderstandingDraft): ClarificationCandidate[] {
  const candidates: ClarificationCandidate[] = [];
  const policies = resolveDecisionParticipationPolicies(undefined, draft.decisionPolicyInstructions);
  if (draft.uncertainties.some((uncertainty) => uncertainty.id === "uncertainty:power")) {
    candidates.push({
      id: "clarify:power",
      question: "When you say powerful, do you mean quick acceleration, sporty handling, or carrying/towing strength?",
      relatedConcepts: ["acceleration", "handling", "towing"],
      reason: "Power meaning can materially change ranking priorities.",
      priorityScore: 88,
      expectedImpact: "ranking",
    });
  }
  if (draft.referenceEntities.length) {
    const reference = draft.referenceEntities[0];
    candidates.push({
      id: "clarify:reference",
      question: `When you mention ${reference.canonicalValue}, is the badge important, or is it the ${formatList(reference.likelyReferencedQualities || ["overall feel"])} you want?`,
      relatedConcepts: ["make", "styling", "luxury_feel", "status_image"],
      reason: "Reference vehicles can mean brand requirement or a softer experience preference.",
      priorityScore: 82,
      expectedImpact: "interpretation-certainty",
    });
  }
  if (draft.unresolvedConcepts.length) {
    candidates.push({
      id: "clarify:unknown",
      question: `I am not sure what ${String(draft.unresolvedConcepts[0].proposedValue)} refers to. Is that a vehicle, a feature, or something else?`,
      relatedConcepts: ["unknown"],
      reason: "Unknown vehicle-like language should not become a profile field.",
      priorityScore: 90,
      expectedImpact: "confidence",
    });
  }
  if (
    !draft.explicitPreferences.some((item) => item.concept === "purchase_budget")
    && policies.purchaseBudget?.participation !== "disabled"
  ) {
    candidates.push({
      id: "clarify:budget",
      question: "What is the maximum purchase budget I should stay within?",
      relatedConcepts: ["purchase_budget"],
      reason: "Budget has high impact on qualification.",
      priorityScore: 72,
      expectedImpact: "qualification",
    });
  }
  return candidates;
}

function policyDimensionForSemanticConcept(concept: SemanticConcept) {
  const dimensions: Partial<Record<SemanticConcept, SemanticDecisionPolicyInstruction["dimension"]>> = {
    purchase_budget: "purchaseBudget",
    monthly_budget: "monthlyPayment",
    insurance_sensitivity: "insuranceCost",
    fuel_sensitivity: "fuelEnergyCost",
    maintenance_tolerance: "maintenanceRisk",
    depreciation_concern: "resaleValue",
    reliability: "reliability",
    safety: "safety",
    resale_value: "resaleValue",
    acceleration: "performance",
    handling: "performance",
    engagement: "performance",
    make: "make",
    body_style: "bodyStyle",
    vehicle_category: "bodyStyle",
    powertrain: "fuelType",
    drivetrain: "drivetrain",
    transmission: "transmission",
    passenger_capacity: "seating",
  };
  return dimensions[concept];
}

function interpretation(input: {
  id: string;
  concept: SemanticConcept;
  proposedValue: string | number | boolean | string[];
  sourceText: string;
  messageRef: string;
  status: UnderstandingItemStatus;
  intent?: CanonicalSemanticIntent;
  confidence: number;
  strength: ProposedConstraintStrength;
  explanation: string;
  requiresConfirmation: boolean;
}): UnderstandingInterpretation {
  return {
    id: input.id,
    concept: input.concept,
    proposedValue: input.proposedValue,
    sourceText: input.sourceText,
    messageRef: input.messageRef,
    status: input.status,
    intent: input.intent
      || (input.status === "uncertain" || input.status === "unresolved"
        ? "uncertain"
        : input.strength === "required"
          ? "required"
          : "preferred"),
    confidence: clampConfidence(input.confidence),
    proposedConstraintStrength: input.strength,
    interpretationExplanation: input.explanation,
    requiresConfirmation: input.requiresConfirmation,
  };
}

function getAllInterpretations(draft: UnderstandingDraft): UnderstandingInterpretation[] {
  return [
    ...draft.explicitPreferences,
    ...draft.inferredPreferences,
    ...draft.recognizedEntities,
    ...draft.referenceEntities,
    ...draft.emotionalGoals,
    ...draft.practicalGoals,
    ...draft.aversions,
    ...draft.constraints,
    ...draft.unresolvedConcepts,
  ];
}

function collectEvidenceText(draft: UnderstandingDraft) {
  return getAllInterpretations(draft).map((item) => item.sourceText).join(" ");
}

function summarizeConversation(message: string, history: SemanticConversationMessage[] = []) {
  const previous = history.filter((turn) => turn.role === "user").slice(-2).map((turn) => turn.text);
  return [...previous, message].filter(Boolean).join(" / ").slice(0, 280);
}

function parseMoney(raw: string) {
  const cleaned = raw.toLowerCase().replace(/[$,\s]/g, "");
  const match = cleaned.match(/(\d+(?:\.\d+)?)(k)?/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(match[2] ? amount * 1000 : amount);
}

function findEvidence(message: string, pattern: RegExp) {
  return message.match(pattern)?.[0] || message;
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function formatList(items: string[]) {
  if (items.length <= 1) return items[0] || "quality";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function getConflictQuestion(conflict: SemanticConflict) {
  if (conflict.topic.toLowerCase().includes("make")) {
    return "Should I treat the brand as required, or only as a preference?";
  }
  if (conflict.topic.toLowerCase().includes("budget")) {
    return "Which budget should I use as the real limit for recommendations?";
  }
  return "Which of those statements should I treat as your current preference?";
}
