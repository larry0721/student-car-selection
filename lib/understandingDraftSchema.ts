import { canonicalSemanticIntentValues, carDomainOntology } from "./carDomainOntology";
import {
  decisionParticipationValues,
  decisionPolicyDimensionValues,
} from "../types/decisionPolicy";

type JsonSchema = Record<string, unknown>;

type ObjectJsonSchema = JsonSchema & {
  type: "object";
  properties: Record<string, JsonSchema>;
  required: string[];
  additionalProperties: false;
};

const semanticConcepts = Object.keys(carDomainOntology.concepts);
const normalizedScoreSchema: JsonSchema = {
  type: "number",
  minimum: 0,
  maximum: 1,
};

export const understandingDraftSchemaValues = {
  statuses: ["explicit", "inferred", "uncertain", "contradicted", "unresolved"],
  intents: canonicalSemanticIntentValues,
  strengths: ["required", "preferred", "flexible", "unresolved"],
  interpretationSources: [
    "deterministic_recognition",
    "model_interpretation",
    "deterministic_fallback",
    "prior_confirmed_context",
    "user_correction",
  ],
  entityKinds: ["make", "model", "vehicle_reference", "unknown_vehicle_language"],
  uncertaintyImpacts: ["high", "medium", "low"],
  conflictTypes: ["correction", "refinement", "changed_mind", "contradiction", "hypothetical"],
  clarificationImpacts: ["qualification", "ranking", "conflict-resolution", "confidence", "interpretation-certainty"],
  decisionPolicyDimensions: decisionPolicyDimensionValues,
  decisionParticipation: decisionParticipationValues,
} as const;

function strictObject(properties: Record<string, JsonSchema>): ObjectJsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const interpretationProperties: Record<string, JsonSchema> = {
  id: { type: "string" },
  concept: { type: "string", enum: semanticConcepts },
  proposedValue: {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "boolean" },
      { type: "array", items: { type: "string" } },
    ],
  },
  sourceText: { type: "string" },
  messageRef: { type: "string" },
  status: { type: "string", enum: understandingDraftSchemaValues.statuses },
  intent: { type: "string", enum: understandingDraftSchemaValues.intents },
  confidence: normalizedScoreSchema,
  proposedConstraintStrength: { type: "string", enum: understandingDraftSchemaValues.strengths },
  interpretationExplanation: { type: "string" },
  requiresConfirmation: { type: "boolean" },
  interpretationSource: {
    anyOf: [
      { type: "string", enum: understandingDraftSchemaValues.interpretationSources },
      { type: "null" },
    ],
  },
};

const interpretationSchema = strictObject(interpretationProperties);
const recognizedEntitySchema = strictObject({
  ...interpretationProperties,
  entityKind: {
    type: "string",
    enum: understandingDraftSchemaValues.entityKinds,
  },
  canonicalValue: {
    anyOf: [
      { type: "string" },
      { type: "null" },
    ],
  },
  likelyReferencedQualities: {
    anyOf: [
      { type: "array", items: { type: "string" } },
      { type: "null" },
    ],
  },
});

const uncertaintySchema = strictObject({
  id: { type: "string" },
  topic: { type: "string" },
  sourceText: { type: "string" },
  messageRef: { type: "string" },
  possibleInterpretations: { type: "array", items: { type: "string" } },
  impact: { type: "string", enum: understandingDraftSchemaValues.uncertaintyImpacts },
  question: { type: "string" },
});

const conflictSchema = strictObject({
  id: { type: "string" },
  topic: { type: "string" },
  description: { type: "string" },
  evidenceRefs: { type: "array", items: { type: "string" } },
  conflictType: {
    type: "string",
    enum: understandingDraftSchemaValues.conflictTypes,
  },
  confidence: normalizedScoreSchema,
});

const assumptionSchema = strictObject({
  id: { type: "string" },
  concept: { type: "string", enum: semanticConcepts },
  assumption: { type: "string" },
  sourceText: { type: "string" },
  requiresConfirmation: { type: "boolean" },
});

const confidenceSchema = strictObject({
  interpretationId: { type: "string" },
  confidence: normalizedScoreSchema,
  reason: { type: "string" },
});

const clarificationSchema = strictObject({
  id: { type: "string" },
  question: { type: "string" },
  relatedConcepts: {
    type: "array",
    items: { type: "string", enum: semanticConcepts },
  },
  reason: { type: "string" },
  priorityScore: { type: "number" },
  expectedImpact: {
    type: "string",
    enum: understandingDraftSchemaValues.clarificationImpacts,
  },
});

const decisionPolicyInstructionSchema = strictObject({
  id: { type: "string" },
  dimension: { type: "string", enum: understandingDraftSchemaValues.decisionPolicyDimensions },
  participation: { type: "string", enum: understandingDraftSchemaValues.decisionParticipation },
  importance: {
    anyOf: [
      normalizedScoreSchema,
      { type: "null" },
    ],
  },
  sourceText: { type: "string" },
  messageRef: { type: "string" },
  status: { type: "string", enum: understandingDraftSchemaValues.statuses },
  confidence: normalizedScoreSchema,
  interpretationSource: { type: "string", enum: understandingDraftSchemaValues.interpretationSources },
  explanation: { type: "string" },
  requiresConfirmation: { type: "boolean" },
});

export const understandingDraftSchemaDefinitions = {
  interpretation: interpretationSchema,
  recognizedEntity: recognizedEntitySchema,
  uncertainty: uncertaintySchema,
  conflict: conflictSchema,
  assumption: assumptionSchema,
  confidence: confidenceSchema,
  clarification: clarificationSchema,
  decisionPolicyInstruction: decisionPolicyInstructionSchema,
} as const;

export const understandingDraftJsonSchema = {
  ...strictObject({
    conversationSummary: { type: "string" },
    decisionPolicyInstructions: { type: "array", items: { $ref: "#/$defs/decisionPolicyInstruction" } },
    explicitPreferences: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    inferredPreferences: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    recognizedEntities: { type: "array", items: { $ref: "#/$defs/recognizedEntity" } },
    referenceEntities: { type: "array", items: { $ref: "#/$defs/recognizedEntity" } },
    emotionalGoals: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    practicalGoals: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    aversions: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    constraints: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    uncertainties: { type: "array", items: { $ref: "#/$defs/uncertainty" } },
    conflicts: { type: "array", items: { $ref: "#/$defs/conflict" } },
    assumptions: { type: "array", items: { $ref: "#/$defs/assumption" } },
    unresolvedConcepts: { type: "array", items: { $ref: "#/$defs/interpretation" } },
    confidenceByInterpretation: { type: "array", items: { $ref: "#/$defs/confidence" } },
    suggestedClarifications: { type: "array", items: { $ref: "#/$defs/clarification" } },
  }),
  $defs: understandingDraftSchemaDefinitions,
} as const;

export function schemaKeys(schema: ObjectJsonSchema) {
  return new Set(Object.keys(schema.properties));
}
