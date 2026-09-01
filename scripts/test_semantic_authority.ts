import assert from "node:assert/strict";
import { ModelSemanticProviderError } from "../lib/modelBackedSemanticUnderstandingProvider";
import { mergeCanonicalConcepts, mapValidatedUnderstandingToProfile } from "../lib/semanticMapping";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import {
  createEmptyUnderstandingDraft,
  type SemanticUnderstandingProvider,
  type SemanticUnderstandingRequest,
  type SemanticUnderstandingResult,
  type UnderstandingDraft,
  type UnderstandingInterpretation,
} from "../lib/semanticUnderstanding";

class ModelFixtureProvider implements SemanticUnderstandingProvider {
  readonly providerId = "semantic-authority-model-fixture";
  readonly providerKind = "model-backed" as const;

  async understand(request: SemanticUnderstandingRequest): Promise<SemanticUnderstandingResult> {
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      draft: modelDraftFor(request.currentMessage),
      warnings: [],
    };
  }
}

class RecoverablyFailingModelProvider implements SemanticUnderstandingProvider {
  readonly providerId = "semantic-authority-failing-model-fixture";
  readonly providerKind = "model-backed" as const;

  async understand(): Promise<SemanticUnderstandingResult> {
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      draft: createEmptyUnderstandingDraft("Model provider failed."),
      warnings: ["timeout"],
      failure: {
        code: "provider_timeout",
        recoverable: true,
        message: "timeout",
      },
    };
  }
}

async function main() {
  const service = createSemanticUnderstandingService({
    providerMode: "model",
    providers: { model: new ModelFixtureProvider() },
  });

  const negatedList = await understandAndMap(service, "no Subaru Toyota or Honda");
  assert.deepEqual(negatedList.mapping.profilePatch.excludedMakes, ["Subaru", "Toyota", "Honda"]);
  assert.equal(negatedList.mapping.profilePatch.allowedMakes, undefined);

  const exceptList = await understandAndMap(service, "anything except Toyota and Honda");
  assert.deepEqual(exceptList.mapping.profilePatch.excludedMakes, ["Toyota", "Honda"]);
  assert.equal(exceptList.mapping.profilePatch.allowedMakes, undefined);

  const unknownBudget = await understandAndMap(service, "I don't know my budget");
  assert.equal(unknownBudget.mapping.profilePatch.maxPurchaseBudget, undefined);
  assert.equal(unknownBudget.result.validatedUnderstanding?.draft.decisionPolicyInstructions[0]?.participation, "unresolved");

  const noBudget = await understandAndMap(service, "no budget limit");
  assert.equal(noBudget.mapping.decisionPolicies.purchaseBudget?.participation, "disabled");
  assert.equal(noBudget.result.validatedUnderstanding?.draft.decisionPolicyInstructions[0]?.interpretationSource, "model_interpretation");
  assert.equal(noBudget.mapping.profilePatch.maxPurchaseBudget, undefined);

  const fun = await understandAndMap(service, "I want something fun");
  assert.equal(fun.mapping.profilePatch.performanceImportance, 5);
  assert.equal(fun.mapping.concepts.find((item) => item.semanticConcept === "engagement")?.source, "model_interpretation");

  const headache = await understandAndMap(service, "I don't want something that'll become a headache");
  assert.equal(headache.mapping.profilePatch.reliabilityImportance, 5);
  assert.equal(headache.mapping.concepts.find((item) => item.semanticConcept === "repair_risk")?.source, "model_interpretation");

  const powertrains = await understandAndMap(service, "hybrid or electric works");
  assert.deepEqual(powertrains.mapping.profilePatch.allowedFuelTypes, ["hybrid", "electric"]);
  const bodyStyles = await understandAndMap(service, "SUV or hatchback");
  assert.deepEqual(bodyStyles.mapping.profilePatch.allowedBodyStyles, ["suv", "hatchback"]);

  const excludesToyota = await understandAndMap(service, "no Toyota");
  const allowsToyota = await understandAndMap(service, "actually Toyota is okay", "turn-3");
  const revised = mergeCanonicalConcepts(excludesToyota.mapping.concepts, allowsToyota.mapping.concepts);
  const revisedPatch = mapCanonicalConcepts(revised);
  assert.deepEqual(revisedPatch.allowedMakes, ["Toyota"]);
  assert.equal(revisedPatch.excludedMakes, undefined);

  const requiresSuv = canonicalRelationship("body_style", "suv", "required");
  const requiresSedan = canonicalRelationship("body_style", "sedan", "required");
  const revisedBodyStyle = mergeCanonicalConcepts([requiresSuv], [requiresSedan]);
  assert.deepEqual(revisedBodyStyle.map((item) => item.value), ["sedan"]);

  const fallback = await createSemanticUnderstandingService({
    providerMode: "model",
    providers: { model: new RecoverablyFailingModelProvider() },
  }).understand({ currentMessage: "No Toyota" });
  assert.equal(fallback.providerUsed, "deterministic");
  assert.equal(fallback.fallbackUsed, true);
  assert.equal(fallback.providerFailure?.code, "provider_timeout");
  assert.ok(fallback.validatedUnderstanding?.acceptedInterpretations.some((item) => item.interpretationSource === "deterministic_fallback"));

  console.log("Semantic authority tests passed: successful model semantics survive validation, mapping, revision, and fallback boundaries.");
}

async function understandAndMap(
  service: ReturnType<typeof createSemanticUnderstandingService>,
  currentMessage: string,
  messageRef = "turn-1",
) {
  const result = await service.understand({
    currentMessage,
    conversationHistory: [{ id: messageRef, role: "user", text: currentMessage }],
  });
  assert.equal(result.providerUsed, "model");
  assert.equal(result.fallbackUsed, false);
  assert.ok(result.validatedUnderstanding);
  assert.ok(result.validatedUnderstanding?.acceptedInterpretations.every((item) => item.interpretationSource === "model_interpretation"));
  return { result, mapping: mapValidatedUnderstandingToProfile(result.validatedUnderstanding!) };
}

function mapCanonicalConcepts(concepts: ReturnType<typeof mapValidatedUnderstandingToProfile>["concepts"]) {
  const draft = createEmptyUnderstandingDraft("revision fixture");
  draft.explicitPreferences = concepts.map((concept) => ({
    id: concept.id,
    concept: concept.semanticConcept,
    proposedValue: concept.value,
    sourceText: concept.sourceText,
    messageRef: concept.messageRef,
    status: "explicit",
    intent: concept.intent,
    confidence: concept.confidence,
    proposedConstraintStrength: concept.intent === "required" ? "required" : concept.intent === "preferred" ? "preferred" : "flexible",
    interpretationExplanation: concept.interpretationExplanation,
    requiresConfirmation: concept.requiresConfirmation,
    interpretationSource: concept.source === "model_interpretation"
      ? "model_interpretation"
      : concept.source === "deterministic_fallback"
        ? "deterministic_fallback"
        : concept.source === "user_correction"
          ? "user_correction"
          : undefined,
  }));
  return mapValidatedUnderstandingToProfile({
    draft,
    ontologyVersion: "fixture",
    vehicleLanguage: { recognizedEntities: [], referenceEntities: [], unresolvedVehicleLanguage: [] },
    acceptedInterpretations: draft.explicitPreferences,
    rejectedInterpretations: [],
    guardrails: [],
    selectedClarification: null,
    currentMessage: "actually Toyota is okay",
  }).profilePatch;
}

function modelDraftFor(message: string): UnderstandingDraft {
  const draft = createEmptyUnderstandingDraft(message);
  const normalized = message.toLowerCase();
  if (normalized === "no subaru toyota or honda") {
    draft.aversions.push(make("Subaru", "excluded"), make("Toyota", "excluded"), make("Honda", "excluded"));
  } else if (normalized === "anything except toyota and honda") {
    draft.aversions.push(make("Toyota", "excluded"), make("Honda", "excluded"));
  } else if (normalized === "i don't know my budget") {
    draft.uncertainties.push(uncertainty("purchase budget", message));
    draft.decisionPolicyInstructions.push(policy("purchaseBudget", "unresolved", message));
  } else if (normalized === "no budget limit") {
    draft.decisionPolicyInstructions.push(policy("purchaseBudget", "disabled", message));
  } else if (normalized === "i want something fun") {
    draft.inferredPreferences.push(interpretation("engagement", "engaging driving feel", "preferred", message));
  } else if (normalized.includes("become a headache")) {
    draft.inferredPreferences.push(interpretation("repair_risk", "avoid frequent costly repairs", "preferred", message));
  } else if (normalized === "hybrid or electric works") {
    draft.explicitPreferences.push(interpretation("powertrain", ["hybrid", "electric"], "allowed", message));
  } else if (normalized === "suv or hatchback") {
    draft.explicitPreferences.push(interpretation("body_style", ["SUV", "hatchback"], "allowed", message));
  } else if (normalized === "no toyota") {
    draft.aversions.push(make("Toyota", "excluded"));
  } else if (normalized === "actually toyota is okay") {
    draft.explicitPreferences.push(make("Toyota", "allowed", "turn-3"));
  } else {
    throw new Error(`No model fixture for ${message}`);
  }
  draft.confidenceByInterpretation = allInterpretations(draft).map((item) => ({
    interpretationId: item.id,
    confidence: item.confidence,
    reason: item.interpretationExplanation,
  }));
  return draft;
}

function make(value: string, intent: "allowed" | "excluded", messageRef = "turn-1") {
  return interpretation("make", value, intent, value, messageRef);
}

function interpretation(
  concept: UnderstandingInterpretation["concept"],
  proposedValue: UnderstandingInterpretation["proposedValue"],
  intent: UnderstandingInterpretation["intent"],
  sourceText: string,
  messageRef = "turn-1",
): UnderstandingInterpretation {
  return {
    id: `${messageRef}:${concept}:${String(proposedValue)}`,
    concept,
    proposedValue,
    sourceText,
    messageRef,
    status: "explicit",
    intent,
    confidence: 0.92,
    proposedConstraintStrength: intent === "required" ? "required" : intent === "preferred" ? "preferred" : "flexible",
    interpretationExplanation: `The model interpreted ${sourceText} as ${concept}.`,
    requiresConfirmation: false,
    // A model response cannot make itself deterministic by setting metadata.
    interpretationSource: "deterministic_recognition",
  };
}

function canonicalRelationship(
  conceptType: "body_style",
  value: string,
  intent: "required",
) {
  return {
    id: `current-message:${conceptType}:${value}`,
    semanticConcept: "body_style" as const,
    conceptType,
    decisionConcept: "hard_constraint" as const,
    value,
    intent,
    strength: 1,
    confirmationStatus: "confirmed" as const,
    confidence: 0.95,
    source: "model_interpretation" as const,
    sourceText: value,
    messageRef: "current-message",
    supportStatus: "supported_and_used" as const,
    destination: "requiredBodyStyles" as const,
    requiresConfirmation: false,
    interpretationExplanation: `The model interpreted ${value} as required.`,
    clarificationRule: "Clarify only when ambiguous.",
    preservationRule: "Preserve explicit intent.",
  };
}

function uncertainty(topic: string, sourceText: string) {
  return {
    id: "uncertainty:budget",
    topic,
    sourceText,
    messageRef: "turn-1",
    possibleInterpretations: ["leave the budget open", "set a maximum budget"],
    impact: "high" as const,
    question: "What is the most you would want to spend?",
  };
}

function policy(
  dimension: "purchaseBudget",
  participation: "disabled" | "unresolved",
  sourceText: string,
) {
  return {
    id: `policy:${participation}`,
    dimension,
    participation,
    importance: null,
    sourceText,
    messageRef: "turn-1",
    status: "explicit" as const,
    confidence: 0.95,
    interpretationSource: "model_interpretation" as const,
    explanation: `The model interpreted ${sourceText} as ${participation} budget participation.`,
    requiresConfirmation: false,
  };
}

function allInterpretations(draft: UnderstandingDraft) {
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

void main();
