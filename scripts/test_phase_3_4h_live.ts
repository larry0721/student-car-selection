import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import {
  answerConversationQuestionWithSemantic,
  createSemanticConversationIntakeSession,
  prepareConversationRevisionSession,
} from "../lib/conversationIntake";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import {
  SemanticUnderstandingService,
  type SemanticUnderstandingServiceOptions,
  type SemanticUnderstandingServiceResult,
} from "../lib/semanticUnderstandingService";
import type { SemanticUnderstandingRequest, UnderstandingDraft } from "../lib/semanticUnderstanding";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

const reportPath = process.env.PHASE_3_4H_REPORT_PATH || "/private/tmp/phase-3-4h-live-report.json";
const caseFilter = process.env.PHASE_3_4H_CASE_FILTER?.toLowerCase();
const catalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const baseProfile: BuyerProfile = {
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
  reliabilityImportance: 3,
  performanceImportance: 3,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "not-sure",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "standard",
  scoreWeights: defaultScoreWeights,
};

const singleCases = [
  ["uncertainty", "idk my budget"],
  ["uncertainty", "I have no idea what I can spend"],
  ["uncertainty", "not sure about budget yet"],
  ["disabled", "no budget limit"],
  ["disabled", "budget doesn't matter"],
  ["disabled", "don't worry about price"],
  ["disabled", "I don't care about fuel economy"],
  ["exclusion", "no Subaru Toyota or Honda"],
  ["exclusion", "anything except Toyota and Honda"],
  ["exclusion", "keep me away from German cars"],
  ["exclusion", "I don't want an SUV"],
  ["allowed", "Toyota or Honda is fine"],
  ["allowed", "hybrid or electric works"],
  ["allowed", "SUV or hatchback"],
  ["emotional", "I want something fun"],
  ["emotional", "I want something that feels expensive"],
  ["emotional", "I don't want something that'll become a headache"],
  ["emotional", "give me something I won't get bored of"],
  ["emotional", "I want a car that feels planted on the highway"],
  ["emotional", "I care more about peace of mind than speed"],
  ["ambiguity", "I want something nice"],
  ["ambiguity", "something practical but not boring"],
  ["ambiguity", "reliable but still fun"],
  ["contradiction", "I want a Toyota but no Toyota"],
  ["contradiction", "I want an SUV but I hate SUVs"],
] as const;

const revisionCases = [
  ["no Toyota", "actually Toyota is okay"],
  ["I want an SUV", "actually I'd rather have a sedan"],
  ["budget doesn't matter", "actually keep it under $30k"],
] as const;

type CaseReport = ReturnType<typeof summarize>;

class CapturingSemanticUnderstandingService extends SemanticUnderstandingService {
  lastResult: SemanticUnderstandingServiceResult | null = null;

  constructor(options: SemanticUnderstandingServiceOptions) {
    super(options);
  }

  override async understand(
    request: SemanticUnderstandingRequest,
    options: SemanticUnderstandingServiceOptions = {},
  ) {
    this.lastResult = await super.understand(request, options);
    return this.lastResult;
  }
}

async function main() {
  loadLocalEnvWithoutPrintingSecrets();
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  if (process.env.SEMANTIC_UNDERSTANDING_PROVIDER !== "model") {
    throw new Error("SEMANTIC_UNDERSTANDING_PROVIDER must be model for Phase 3.4H.");
  }
  process.env.SEMANTIC_UNDERSTANDING_TIMEOUT_MS ||= "45000";
  process.env.SEMANTIC_UNDERSTANDING_MAX_RETRIES ||= "1";

  const service = new CapturingSemanticUnderstandingService({ providerMode: "model" });
  const reports: CaseReport[] = [];

  const selectedSingleCases = singleCases.filter(([, input]) => !caseFilter || input.toLowerCase().includes(caseFilter));
  const selectedRevisionCases = revisionCases.filter(([initial, revision]) =>
    !caseFilter || `${initial} ${revision}`.toLowerCase().includes(caseFilter)
  );

  for (const [category, input] of selectedSingleCases) {
    reports.push(await evaluateSingle(category, input, baseProfile, service));
  }

  for (const [initialInput, revisionInput] of selectedRevisionCases) {
    const initial = await evaluateSession("revision-initial", initialInput, baseProfile, service);
    const revisionSession = await answerConversationQuestionWithSemantic(
      prepareConversationRevisionSession(initial.session, initial.buyerProfile),
      revisionInput,
      service,
    );
    reports.push(summarize(
      "revision",
      `${initialInput} -> ${revisionInput}`,
      initial.buyerProfile,
      revisionSession,
      service.lastResult,
    ));
  }

  const providerSummary = {
    configured: Boolean(process.env.OPENAI_API_KEY),
    providerMode: process.env.SEMANTIC_UNDERSTANDING_PROVIDER,
    configuredModel: process.env.OPENAI_SEMANTIC_UNDERSTANDING_MODEL || process.env.OPENAI_RECOMMENDATION_MODEL || "default",
    scenarioCount: reports.length,
    callCount: selectedSingleCases.length + selectedRevisionCases.length * 2,
    modelCount: reports.filter((item) => item.providerActuallyUsed === "model").length,
    fallbackCount: reports.filter((item) => item.fallback).length,
    schemaPassedCount: reports.filter((item) => item.schemaValidation === "passed").length,
  };

  writeFileSync(reportPath, `${JSON.stringify({ providerSummary, reports }, null, 2)}\n`, "utf8");
  console.log("Phase 3.4H live stress run completed.");
  console.log(providerSummary);
  console.table(reports.map((item) => ({
    category: item.category,
    input: item.input,
    provider: item.providerActuallyUsed,
    fallback: item.fallback,
    schema: item.schemaValidation,
    clarification: item.clarification || "none",
  })));
  console.log(`Detailed report: ${reportPath}`);
}

async function evaluateSingle(
  category: string,
  input: string,
  startingProfile: BuyerProfile,
  service: CapturingSemanticUnderstandingService,
) {
  const evaluated = await evaluateSession(category, input, startingProfile, service);
  return summarize(category, input, startingProfile, evaluated.session, service.lastResult);
}

async function evaluateSession(
  category: string,
  input: string,
  startingProfile: BuyerProfile,
  service: CapturingSemanticUnderstandingService,
) {
  const session = await createSemanticConversationIntakeSession(input, service);
  const confirmation = createConfirmedPreferenceProfile(session, startingProfile);
  const approved = approveConfirmedPreferenceProfile(confirmation, session.conversationTurns.length + 1);
  const conversion = convertConfirmedPreferencesToBuyerProfile(startingProfile, approved);
  return { category, input, session, confirmation, conversion, buyerProfile: conversion.buyerProfile };
}

function summarize(
  category: string,
  input: string,
  startingProfile: BuyerProfile,
  session: Awaited<ReturnType<typeof createSemanticConversationIntakeSession>>,
  result: SemanticUnderstandingServiceResult | null,
) {
  const confirmation = createConfirmedPreferenceProfile(session, startingProfile);
  const approved = approveConfirmedPreferenceProfile(confirmation, session.conversationTurns.length + 1);
  const conversion = convertConfirmedPreferencesToBuyerProfile(startingProfile, approved);
  const pipeline = !session.currentQuestion
    ? runCandidatePipeline(conversion.buyerProfile, catalog, { includeCompromises: true, includeExcluded: false })
    : undefined;
  const draft = result?.validatedUnderstanding?.draft;
  return {
    category,
    input,
    providerRequested: result?.diagnostics.providerModeRequested || "unknown",
    providerActuallyUsed: result?.providerUsed || null,
    fallback: result?.fallbackUsed || false,
    fallbackReason: result?.fallbackReason || null,
    providerFailure: result?.providerFailure || null,
    modelIdentifier: result?.diagnostics.modelIdentifier || null,
    schemaValidation: result?.diagnostics.schemaValidationResult || "not_run",
    understanding: interpretations(draft),
    decisionPolicies: draft?.decisionPolicyInstructions.map((item) => ({
      dimension: item.dimension,
      participation: item.participation,
      importance: item.importance,
      sourceText: item.sourceText,
      status: item.status,
      source: item.interpretationSource,
    })) || [],
    uncertainties: draft?.uncertainties.map((item) => ({
      topic: item.topic,
      sourceText: item.sourceText,
      impact: item.impact,
      question: item.question,
    })) || [],
    conflicts: draft?.conflicts.map((item) => ({
      topic: item.topic,
      type: item.conflictType,
      description: item.description,
    })) || [],
    clarification: result?.validatedUnderstanding?.selectedClarification?.question
      || session.currentQuestion?.text
      || null,
    confirmedProfileEffect: {
      updates: confirmation.confirmedUpdates,
      hardConstraints: confirmation.explicitHardConstraints.map((item) => `${item.label}: ${item.displayValue}`),
      flexiblePreferences: confirmation.flexiblePreferences.map((item) => `${item.label}: ${item.displayValue}`),
      unresolved: confirmation.unresolvedFields.map((item) => `${item.label}: ${item.displayValue}`),
    },
    buyerProfileEffect: changedProfileFields(startingProfile, conversion.buyerProfile),
    recommendation: pipeline?.decisionSet.primaryRecommendations[0]?.vehicleId || null,
    qualifiedCount: pipeline?.decisionSet.primaryRecommendations.length || 0,
  };
}

function interpretations(draft: UnderstandingDraft | undefined) {
  if (!draft) return [];
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
  ].map((item) => ({
    concept: item.concept,
    value: item.proposedValue,
    intent: item.intent,
    status: item.status,
    strength: item.proposedConstraintStrength,
    sourceText: item.sourceText,
    interpretationSource: item.interpretationSource,
    requiresConfirmation: item.requiresConfirmation,
  }));
}

function changedProfileFields(before: BuyerProfile, after: BuyerProfile) {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(after) as Array<keyof BuyerProfile>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed[key] = after[key];
  }
  return changed;
}

function loadLocalEnvWithoutPrintingSecrets() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, "");
    process.env[key] ||= value;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
