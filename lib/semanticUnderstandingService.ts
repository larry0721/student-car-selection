import {
  createModelBackedSemanticUnderstandingProviderFromEnv,
  parseUnderstandingDraftFromModelResponse,
} from "./modelBackedSemanticUnderstandingProvider";
import {
  createEmptyUnderstandingDraft,
  DeterministicSemanticUnderstandingProvider,
  validateAndNormalizeUnderstanding,
  type InterpretationSource,
  type SemanticUnderstandingDiagnostics,
  type SemanticUnderstandingFailure,
  type SemanticUnderstandingFailureCode,
  type SemanticUnderstandingProvider,
  type SemanticUnderstandingRequest,
  type SemanticUnderstandingResult,
  type UnderstandingDraft,
  type UnderstandingInterpretation,
  type ValidatedUnderstanding,
} from "./semanticUnderstanding";

export type SemanticUnderstandingProviderMode = "model" | "deterministic" | "auto";
export type SemanticUnderstandingServiceStatus = "success" | "fallback_success" | "recoverable_failure" | "fatal_failure";
export type SemanticUnderstandingProviderUsed = "model" | "deterministic" | "fixture";

export type SemanticUnderstandingServiceOptions = {
  providerMode?: SemanticUnderstandingProviderMode;
  providers?: {
    model?: SemanticUnderstandingProvider;
    deterministic?: SemanticUnderstandingProvider;
    fixture?: SemanticUnderstandingProvider;
  };
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

export type SemanticUnderstandingServiceDiagnostics = {
  providerModeRequested: SemanticUnderstandingProviderMode;
  providerUsed: SemanticUnderstandingProviderUsed | null;
  fallbackUsed: boolean;
  providerLatencyMs: number;
  totalServiceLatencyMs: number;
  modelIdentifier?: string;
  schemaValidationResult: "passed" | "failed" | "not_run";
  normalizedInterpretationCount: number;
  uncertaintyCount: number;
  conflictCount: number;
  clarificationCandidateCount: number;
  failureCategory?: SemanticUnderstandingFailureCode | "fallback_insufficient" | "malformed_request";
};

export type SemanticUnderstandingServiceResult = {
  status: SemanticUnderstandingServiceStatus;
  validatedUnderstanding: ValidatedUnderstanding | null;
  providerUsed: SemanticUnderstandingProviderUsed | null;
  fallbackUsed: boolean;
  fallbackReason?: string;
  diagnostics: SemanticUnderstandingServiceDiagnostics;
  providerFailure?: SemanticUnderstandingFailure;
  originalUserMessagePreserved: boolean;
};

const DEFAULT_PROVIDER_MODE: SemanticUnderstandingProviderMode = "auto";

export class SemanticUnderstandingService {
  constructor(private readonly defaultOptions: SemanticUnderstandingServiceOptions = {}) {}

  async understand(
    request: SemanticUnderstandingRequest,
    options: SemanticUnderstandingServiceOptions = {},
  ): Promise<SemanticUnderstandingServiceResult> {
    assertServerOnly();
    const startedAt = getNow(options, this.defaultOptions)();
    const providerMode = resolveProviderMode(options, this.defaultOptions);
    const env = options.env || this.defaultOptions.env || process.env;
    const now = getNow(options, this.defaultOptions);
    const malformed = validateServiceRequest(request);

    if (malformed) {
      return failureResult({
        status: "recoverable_failure",
        providerMode,
        providerUsed: null,
        startedAt,
        now,
        failure: {
          code: "request_rejected",
          recoverable: true,
          message: malformed,
        },
        failureCategory: "malformed_request",
        originalUserMessagePreserved: false,
      });
    }

    const deterministicProvider = options.providers?.deterministic
      || this.defaultOptions.providers?.deterministic
      || new DeterministicSemanticUnderstandingProvider();
    const fixtureProvider = options.providers?.fixture || this.defaultOptions.providers?.fixture;
    const modelProvider = options.providers?.model
      || this.defaultOptions.providers?.model
      || createModelBackedSemanticUnderstandingProviderFromEnv(env);

    if (fixtureProvider) {
      return this.runProvider({
        provider: fixtureProvider,
        providerUsed: "fixture",
        providerMode,
        request,
        startedAt,
        now,
        source: "model_interpretation",
      });
    }

    if (providerMode === "deterministic") {
      return this.runProvider({
        provider: deterministicProvider,
        providerUsed: "deterministic",
        providerMode,
        request,
        startedAt,
        now,
        source: "deterministic_fallback",
      });
    }

    const modelConfigured = isModelConfigured(env);
    if (providerMode === "auto" && !modelConfigured) {
      return this.runDeterministicFallback({
        request,
        deterministicProvider,
        providerMode,
        startedAt,
        now,
        fallbackReason: "Model provider is not configured; auto mode used deterministic fallback.",
      });
    }

    const modelResult = await this.runProvider({
      provider: modelProvider,
      providerUsed: "model",
      providerMode,
      request,
      startedAt,
      now,
      source: "model_interpretation",
      allowProviderFailure: true,
    });

    if (modelResult.status === "success") return modelResult;
    if (modelResult.providerFailure && !modelResult.providerFailure.recoverable) return modelResult;

    return this.runDeterministicFallback({
      request,
      deterministicProvider,
      providerMode,
      startedAt,
      now,
      fallbackReason: modelResult.providerFailure
        ? `Model provider failed with ${modelResult.providerFailure.code}.`
        : "Model provider did not produce a validated understanding.",
      providerFailure: modelResult.providerFailure,
    });
  }

  private async runDeterministicFallback(input: {
    request: SemanticUnderstandingRequest;
    deterministicProvider: SemanticUnderstandingProvider;
    providerMode: SemanticUnderstandingProviderMode;
    startedAt: number;
    now: () => number;
    fallbackReason: string;
    providerFailure?: SemanticUnderstandingFailure;
  }): Promise<SemanticUnderstandingServiceResult> {
    const fallback = await this.runProvider({
      provider: input.deterministicProvider,
      providerUsed: "deterministic",
      providerMode: input.providerMode,
      request: input.request,
      startedAt: input.startedAt,
      now: input.now,
      source: "deterministic_fallback",
      fallbackUsed: true,
      fallbackReason: input.fallbackReason,
      inheritedFailure: input.providerFailure,
      allowProviderFailure: true,
    });

    if (!fallback.validatedUnderstanding || !isDeterministicFallbackSufficient(input.request, fallback.validatedUnderstanding)) {
      const validatedUnderstanding = fallback.validatedUnderstanding;
      return failureResult({
        status: "recoverable_failure",
        providerMode: input.providerMode,
        providerUsed: "deterministic",
        startedAt: input.startedAt,
        now: input.now,
        providerFailure: input.providerFailure,
        failure: input.providerFailure || {
          code: "provider_unavailable",
          recoverable: true,
          message: "Deterministic fallback could not responsibly interpret the request.",
        },
        failureCategory: input.providerFailure?.code || "fallback_insufficient",
        fallbackUsed: true,
        fallbackReason: `${input.fallbackReason} Deterministic fallback was insufficient for this request.`,
        validatedUnderstanding,
        providerDiagnostics: fallback.diagnostics,
        originalUserMessagePreserved: true,
      });
    }

    return {
      ...fallback,
      status: "fallback_success",
      fallbackUsed: true,
      fallbackReason: input.fallbackReason,
      providerFailure: input.providerFailure,
      diagnostics: {
        ...fallback.diagnostics,
        fallbackUsed: true,
        failureCategory: input.providerFailure?.code,
      },
    };
  }

  private async runProvider(input: {
    provider: SemanticUnderstandingProvider;
    providerUsed: SemanticUnderstandingProviderUsed;
    providerMode: SemanticUnderstandingProviderMode;
    request: SemanticUnderstandingRequest;
    startedAt: number;
    now: () => number;
    source: InterpretationSource;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    inheritedFailure?: SemanticUnderstandingFailure;
    allowProviderFailure?: boolean;
  }): Promise<SemanticUnderstandingServiceResult> {
    const providerStartedAt = input.now();
    try {
      const providerResult = await input.provider.understand(input.request);
      if (providerResult.failure) {
        return failureResult({
          status: providerResult.failure.recoverable ? "recoverable_failure" : "fatal_failure",
          providerMode: input.providerMode,
          providerUsed: input.providerUsed,
          startedAt: input.startedAt,
          now: input.now,
          providerFailure: input.inheritedFailure || providerResult.failure,
          failure: providerResult.failure,
          failureCategory: providerResult.failure.code,
          fallbackUsed: Boolean(input.fallbackUsed),
          fallbackReason: input.fallbackReason,
          providerDiagnostics: toServiceDiagnostics(
            input.providerMode,
            input.providerUsed,
            input.startedAt,
            input.now,
            providerResult,
            null,
            Boolean(input.fallbackUsed),
            providerResult.failure.code,
          ),
          originalUserMessagePreserved: preservesOriginalMessage(input.request, null),
        });
      }

      const schemaSafeDraft = parseUnderstandingDraftFromModelResponse(JSON.stringify(providerResult.draft));
      const validated = {
        ...validateAndNormalizeUnderstanding({ ...providerResult, draft: schemaSafeDraft }, input.request.ontology),
        currentMessage: input.request.currentMessage,
      };
      const withSources = addInterpretationSources(validated, input.source);

      return {
        status: input.fallbackUsed ? "fallback_success" : "success",
        validatedUnderstanding: withSources,
        providerUsed: input.providerUsed,
        fallbackUsed: Boolean(input.fallbackUsed),
        fallbackReason: input.fallbackReason,
        providerFailure: input.inheritedFailure,
        originalUserMessagePreserved: preservesOriginalMessage(input.request, withSources),
        diagnostics: toServiceDiagnostics(
          input.providerMode,
          input.providerUsed,
          input.startedAt,
          input.now,
          {
            ...providerResult,
            diagnostics: providerResult.diagnostics
              ? { ...providerResult.diagnostics, latencyMs: providerResult.diagnostics.latencyMs }
              : {
                  providerType: providerResult.providerKind,
                  success: true,
                  latencyMs: Math.max(0, input.now() - providerStartedAt),
                  schemaValidation: "passed",
                  fallbackUsed: Boolean(input.fallbackUsed),
                  interpretationCount: withSources.acceptedInterpretations.length,
                  uncertaintyCount: withSources.draft.uncertainties.length,
                  clarificationCount: withSources.draft.suggestedClarifications.length,
                },
          },
          withSources,
          Boolean(input.fallbackUsed),
          input.inheritedFailure?.code,
        ),
      };
    } catch (error) {
      const failure = normalizeUnknownFailure(error);
      if (!input.allowProviderFailure && !failure.recoverable) throw error;
      return failureResult({
        status: failure.recoverable ? "recoverable_failure" : "fatal_failure",
        providerMode: input.providerMode,
        providerUsed: input.providerUsed,
        startedAt: input.startedAt,
        now: input.now,
        failure,
        failureCategory: failure.code,
        fallbackUsed: Boolean(input.fallbackUsed),
        fallbackReason: input.fallbackReason,
        originalUserMessagePreserved: false,
      });
    }
  }
}

export function createSemanticUnderstandingService(options: SemanticUnderstandingServiceOptions = {}) {
  return new SemanticUnderstandingService(options);
}

export function getSemanticUnderstandingProviderMode(env: NodeJS.ProcessEnv = process.env): SemanticUnderstandingProviderMode {
  const raw = env.SEMANTIC_UNDERSTANDING_PROVIDER;
  if (raw === "model" || raw === "deterministic" || raw === "auto") return raw;
  return DEFAULT_PROVIDER_MODE;
}

export function validateSemanticUnderstandingRequestPayload(payload: unknown): SemanticUnderstandingRequest {
  const record = expectRecord(payload, "request");
  const currentMessage = expectString(record.currentMessage, "currentMessage").trim();
  const conversationHistory = record.conversationHistory === undefined
    ? undefined
    : expectConversationHistory(record.conversationHistory);
  return {
    currentMessage,
    conversationHistory,
    currentUnderstanding: record.currentUnderstanding && typeof record.currentUnderstanding === "object"
      ? record.currentUnderstanding as SemanticUnderstandingRequest["currentUnderstanding"]
      : undefined,
  };
}

function isModelConfigured(env: NodeJS.ProcessEnv) {
  return Boolean(env.OPENAI_API_KEY);
}

function resolveProviderMode(
  options: SemanticUnderstandingServiceOptions,
  defaults: SemanticUnderstandingServiceOptions,
): SemanticUnderstandingProviderMode {
  return options.providerMode || defaults.providerMode || getSemanticUnderstandingProviderMode(options.env || defaults.env || process.env);
}

function getNow(options: SemanticUnderstandingServiceOptions, defaults: SemanticUnderstandingServiceOptions) {
  return options.now || defaults.now || (() => Date.now());
}

function validateServiceRequest(request: SemanticUnderstandingRequest) {
  if (!request || typeof request !== "object") return "Semantic understanding request is required.";
  if (typeof request.currentMessage !== "string" || !request.currentMessage.trim()) return "currentMessage is required.";
  if (request.currentMessage.length > 4000) return "currentMessage is too long.";
  if (request.conversationHistory && request.conversationHistory.length > 20) return "conversationHistory is too long.";
  if (request.conversationHistory?.some((turn) => !turn.id || !turn.text || (turn.role !== "user" && turn.role !== "advisor"))) {
    return "conversationHistory contains an invalid turn.";
  }
  return "";
}

function isDeterministicFallbackSufficient(
  request: SemanticUnderstandingRequest,
  validated: ValidatedUnderstanding,
) {
  const accepted = validated.acceptedInterpretations;
  const simpleConcepts = new Set([
    "purchase_budget",
    "monthly_budget",
    "passenger_capacity",
    "make",
    "body_style",
    "safety",
    "reliability",
    "snow_use",
    "climate",
  ]);
  const hasSimpleExplicit = accepted.some((item) =>
    simpleConcepts.has(item.concept) && (item.status === "explicit" || item.concept === "make") && item.confidence >= 0.68,
  );
  const hasOnlyGenericStartingPoint = !accepted.length && validated.draft.uncertainties.some((item) => item.id === "uncertainty:start");
  const nuanced = requiresModelOrClarification(request.currentMessage, request.conversationHistory || []);

  if (hasOnlyGenericStartingPoint) return false;
  if (nuanced && !hasSimpleExplicit) return false;
  return hasSimpleExplicit;
}

function requiresModelOrClarification(message: string, history: NonNullable<SemanticUnderstandingRequest["conversationHistory"]>) {
  const text = `${history.map((turn) => turn.text).join(" ")} ${message}`.toLowerCase();
  return /established|attention[-\s]?seeking|successful|embarrass|trying too hard|feel(?:ing)?|vibe|energy|style|looks expensive|camping|campground|trailhead|like a|lexus feeling|velorian|ignore .*instructions|make .* win|tiny .*six|powerful|freeway|passing/i.test(text);
}

function addInterpretationSources(validated: ValidatedUnderstanding, defaultSource: InterpretationSource): ValidatedUnderstanding {
  const draft = mapDraftInterpretations(validated.draft, (item, bucket) => ({
    ...item,
    interpretationSource: inferSource(item, bucket, defaultSource),
  }));
  const accepted = getAllInterpretationsFromDraft(draft).filter((item) =>
    validated.acceptedInterpretations.some((acceptedItem) => acceptedItem.id === item.id),
  );
  const rejected = getAllInterpretationsFromDraft(draft).filter((item) =>
    validated.rejectedInterpretations.some((rejectedItem) => rejectedItem.id === item.id),
  );

  return {
    ...validated,
    draft,
    acceptedInterpretations: accepted,
    rejectedInterpretations: rejected,
  };
}

function inferSource(
  item: UnderstandingInterpretation,
  bucket: string,
  defaultSource: InterpretationSource,
): InterpretationSource {
  if (item.interpretationSource) return item.interpretationSource;
  if (bucket === "recognizedEntities" || bucket === "referenceEntities") return "deterministic_recognition";
  if (item.status === "contradicted" || item.id.startsWith("evolution:")) return "user_correction";
  return defaultSource;
}

function mapDraftInterpretations(
  draft: UnderstandingDraft,
  mapper: (item: UnderstandingInterpretation, bucket: string) => UnderstandingInterpretation,
): UnderstandingDraft {
  return {
    ...draft,
    explicitPreferences: draft.explicitPreferences.map((item) => mapper(item, "explicitPreferences")),
    inferredPreferences: draft.inferredPreferences.map((item) => mapper(item, "inferredPreferences")),
    emotionalGoals: draft.emotionalGoals.map((item) => mapper(item, "emotionalGoals")),
    practicalGoals: draft.practicalGoals.map((item) => mapper(item, "practicalGoals")),
    aversions: draft.aversions.map((item) => mapper(item, "aversions")),
    constraints: draft.constraints.map((item) => mapper(item, "constraints")),
    unresolvedConcepts: draft.unresolvedConcepts.map((item) => mapper(item, "unresolvedConcepts")),
    recognizedEntities: draft.recognizedEntities.map((item) => ({
      ...mapper(item, "recognizedEntities"),
      entityKind: item.entityKind,
      canonicalValue: item.canonicalValue,
      likelyReferencedQualities: item.likelyReferencedQualities,
    })),
    referenceEntities: draft.referenceEntities.map((item) => ({
      ...mapper(item, "referenceEntities"),
      entityKind: item.entityKind,
      canonicalValue: item.canonicalValue,
      likelyReferencedQualities: item.likelyReferencedQualities,
    })),
  };
}

function getAllInterpretationsFromDraft(draft: UnderstandingDraft) {
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

function toServiceDiagnostics(
  providerMode: SemanticUnderstandingProviderMode,
  providerUsed: SemanticUnderstandingProviderUsed | null,
  startedAt: number,
  now: () => number,
  providerResult: SemanticUnderstandingResult | null,
  validated: ValidatedUnderstanding | null,
  fallbackUsed: boolean,
  failureCategory?: SemanticUnderstandingServiceDiagnostics["failureCategory"],
): SemanticUnderstandingServiceDiagnostics {
  return {
    providerModeRequested: providerMode,
    providerUsed,
    fallbackUsed,
    providerLatencyMs: providerResult?.diagnostics?.latencyMs || 0,
    totalServiceLatencyMs: Math.max(0, now() - startedAt),
    modelIdentifier: providerResult?.diagnostics?.modelIdentifier,
    schemaValidationResult: providerResult?.failure
      ? providerResult.diagnostics?.schemaValidation || "failed"
      : providerResult
        ? "passed"
        : "not_run",
    normalizedInterpretationCount: validated?.acceptedInterpretations.length || 0,
    uncertaintyCount: validated?.draft.uncertainties.length || 0,
    conflictCount: validated?.draft.conflicts.length || 0,
    clarificationCandidateCount: validated?.draft.suggestedClarifications.length || 0,
    failureCategory,
  };
}

function failureResult(input: {
  status: SemanticUnderstandingServiceStatus;
  providerMode: SemanticUnderstandingProviderMode;
  providerUsed: SemanticUnderstandingProviderUsed | null;
  startedAt: number;
  now: () => number;
  failure: SemanticUnderstandingFailure;
  failureCategory?: SemanticUnderstandingServiceDiagnostics["failureCategory"];
  validatedUnderstanding?: ValidatedUnderstanding | null;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  providerFailure?: SemanticUnderstandingFailure;
  providerDiagnostics?: SemanticUnderstandingServiceDiagnostics;
  originalUserMessagePreserved: boolean;
}): SemanticUnderstandingServiceResult {
  return {
    status: input.status,
    validatedUnderstanding: input.validatedUnderstanding || null,
    providerUsed: input.providerUsed,
    fallbackUsed: Boolean(input.fallbackUsed),
    fallbackReason: input.fallbackReason,
    providerFailure: input.providerFailure || input.failure,
    originalUserMessagePreserved: input.originalUserMessagePreserved,
    diagnostics: input.providerDiagnostics || {
      providerModeRequested: input.providerMode,
      providerUsed: input.providerUsed,
      fallbackUsed: Boolean(input.fallbackUsed),
      providerLatencyMs: 0,
      totalServiceLatencyMs: Math.max(0, input.now() - input.startedAt),
      schemaValidationResult: input.failureCategory === "malformed_request" ? "not_run" : "failed",
      normalizedInterpretationCount: 0,
      uncertaintyCount: 0,
      conflictCount: 0,
      clarificationCandidateCount: 0,
      failureCategory: input.failureCategory || input.failure.code,
    },
  };
}

function normalizeUnknownFailure(error: unknown): SemanticUnderstandingFailure {
  if (error instanceof Error && error.message.includes("outside the semantic-understanding scope")) {
    return { code: "invalid_structured_response", recoverable: true, message: "Provider output included forbidden recommendation fields." };
  }
  if (error instanceof Error) {
    return { code: "invalid_structured_response", recoverable: true, message: error.message };
  }
  return { code: "provider_unavailable", recoverable: true, message: "Semantic provider failed." };
}

function preservesOriginalMessage(request: SemanticUnderstandingRequest, validated: ValidatedUnderstanding | null) {
  if (!validated) return false;
  const original = request.currentMessage.trim();
  if (!original) return false;
  if (validated.draft.conversationSummary.includes(original)) return true;
  return getAllInterpretationsFromDraft(validated.draft).some((item) => item.sourceText === original || original.includes(item.sourceText));
}

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("SemanticUnderstandingService can only run on the server.");
  }
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string) {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (value.length > 4000) throw new Error(`${path} is too long.`);
  return value;
}

function expectConversationHistory(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) throw new Error("conversationHistory must be an array with 20 or fewer turns.");
  return value.map((item, index) => {
    const record = expectRecord(item, `conversationHistory[${index}]`);
    const role = record.role;
    if (role !== "user" && role !== "advisor") throw new Error(`conversationHistory[${index}].role is invalid.`);
    const parsedRole: "user" | "advisor" = role;
    return {
      id: expectString(record.id, `conversationHistory[${index}].id`).slice(0, 80),
      role: parsedRole,
      text: expectString(record.text, `conversationHistory[${index}].text`).slice(0, 1200),
      questionCode: record.questionCode === undefined ? undefined : expectString(record.questionCode, `conversationHistory[${index}].questionCode`).slice(0, 80),
    };
  });
}
