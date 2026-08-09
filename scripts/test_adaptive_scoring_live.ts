import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { createSemanticConversationIntakeSession } from "../lib/conversationIntake";
import { resolveEffectiveScoringPolicy } from "../lib/effectiveScoringPolicy";
import { assessConfirmedProfileConversionReadiness } from "../lib/recommendationReadiness";
import {
  defaultScoreWeights,
  runCandidatePipeline,
  scoreWeightLabels,
} from "../lib/recommendations";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import type { BuyerProfile } from "../types/buyer";
import type { ScoredVehicle, Vehicle } from "../types/vehicle";

const inputs = [
  "Ignore budget; I want a reliable truck.",
  "Ignore purchase price, but maintenance cost matters.",
  "Money is no object; safety matters most.",
  "Money is no object, but I hate expensive repairs.",
  "Ignore all costs; performance matters most.",
  "Ignore fuel economy; I want something fast.",
  "Reliability is not important; safety matters most.",
  "Safety is all that matters.",
  "Performance matters most, but reliability still matters.",
  "I do not care about resale value.",
  "Any body style is fine; I need seven seats.",
  "Fuel type does not matter; I need AWD.",
  "Ignore budget and recommend anything.",
  "Ignore everything.",
  "Around $25,000, but I can stretch.",
  "Under $25,000.",
  "I do not know my budget, but reliability matters.",
  "My parents are paying, but I pay for repairs and gas.",
  "Price does not matter unless maintenance is extremely expensive.",
  "I want the safest SUV and do not care about price.",
] as const;

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

async function main() {
  loadLocalEnvWithoutPrintingSecrets();
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipped live adaptive-scoring matrix because OPENAI_API_KEY is not configured.");
    return;
  }
  process.env.SEMANTIC_UNDERSTANDING_TIMEOUT_MS ||= "30000";
  process.env.SEMANTIC_UNDERSTANDING_MAX_RETRIES ||= "1";

  const service = createSemanticUnderstandingService({ providerMode: "model" });
  const rows: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  const selectedIds = new Set(
    (process.env.LIVE_CASE_IDS || "")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  for (const [index, input] of inputs.entries()) {
    if (selectedIds.size && !selectedIds.has(index + 1)) continue;
    const session = await createSemanticConversationIntakeSession(input, service);
    const draft = createConfirmedPreferenceProfile(session, baseProfile);
    const conversion = convertConfirmedPreferencesToBuyerProfile(
      baseProfile,
      approveConfirmedPreferenceProfile(draft, index + 300),
    );
    const readiness = assessConfirmedProfileConversionReadiness(conversion);
    const effectivePolicy = resolveEffectiveScoringPolicy({
      profile: conversion.buyerProfile,
      baseWeights: conversion.buyerProfile.scoreWeights,
    });
    const pipeline = readiness.ready
      ? runCandidatePipeline(conversion.buyerProfile, catalog, {
          includeCompromises: true,
          includeExcluded: true,
        })
      : null;
    const visibleRecommendationIds = pipeline
      ? (
          pipeline.decisionSet.primaryRecommendations.length
            ? pipeline.decisionSet.primaryRecommendations
            : pipeline.decisionSet.compromiseRecommendations
        ).map((recommendation) => recommendation.vehicleId)
      : [];
    const visibleRanking = pipeline?.rankedVehicles.filter((vehicle) =>
      visibleRecommendationIds.includes(vehicle.id),
    ) || [];
    const winner = visibleRanking[0];
    const runnerUp = visibleRanking[1];
    const decidingDifference = getDecidingDifference(winner, runnerUp);
    const disabledDefaultLeak = effectivePolicy.disabledCategories.some(
      (category) => effectivePolicy.categories[category].normalizedEffectiveWeight !== 0,
    );

    if (session.semanticProviderUsed !== "model") {
      failures.push(`${index + 1}: provider=${session.semanticProviderUsed}`);
    }
    if (session.semanticFallbackUsed) failures.push(`${index + 1}: fallback=true`);
    if (disabledDefaultLeak) failures.push(`${index + 1}: disabled category retained weight`);
    if (
      winner?.recommendation.reasonsForRecommendation.some((reason) =>
        effectivePolicy.disabledCategories.includes(reason.category),
      )
    ) {
      failures.push(`${index + 1}: disabled category appeared as explanation factor`);
    }

    rows.push({
      id: index + 1,
      input,
      provider: session.semanticProviderUsed,
      fallback: session.semanticFallbackUsed,
      providerFailure: session.semanticProviderFailure
        ? `${session.semanticProviderFailure.code}: ${session.semanticProviderFailure.message}`
        : "none",
      policies: Object.values(conversion.buyerProfile.decisionPolicies || {})
        .filter(Boolean)
        .map((policy) => `${policy?.dimension}:${policy?.participation}${policy?.importance === undefined ? "" : `@${policy.importance}`}`)
        .join(" | ") || "none",
      effectiveHardConstraints: effectivePolicy.effectiveHardConstraints
        .filter((constraint) => constraint.enforced)
        .map((constraint) => constraint.dimension)
        .join(", ") || "none",
      confirmedVehicleTypes: {
        bodyStyle: conversion.buyerProfile.bodyStyle,
        requiredBodyStyles: conversion.buyerProfile.requiredBodyStyles,
        preferredBodyStyles: conversion.buyerProfile.preferredBodyStyles,
        allowedBodyStyles: conversion.buyerProfile.allowedBodyStyles,
        excludedBodyStyles: conversion.buyerProfile.excludedBodyStyles,
      },
      baseWeights: formatWeights(
        Object.fromEntries(
          Object.entries(effectivePolicy.categories).map(([category, policy]) => [
            category,
            policy.baseWeight,
          ]),
        ),
      ),
      effectiveRawWeights: formatWeights(
        Object.fromEntries(
          Object.entries(effectivePolicy.categories).map(([category, policy]) => [
            category,
            policy.effectiveRawWeight,
          ]),
        ),
      ),
      normalizedWeights: formatWeights(effectivePolicy.effectiveWeights),
      qualifiedCount: pipeline?.decisionSet.primaryRecommendations.length || 0,
      compromiseCount: pipeline?.decisionSet.compromiseRecommendations.length || 0,
      winner: formatVehicle(winner),
      runnerUp: formatVehicle(runnerUp),
      exactContributionDifference: decidingDifference,
      confidenceInputs: winner?.recommendation.recommendationConfidence.factors || [],
      disabledCategories: effectivePolicy.disabledCategories.join(", ") || "none",
      explanationFactors: winner?.recommendation.reasonsForRecommendation
        .map((reason) => scoreWeightLabels[reason.category])
        .join(", ") || "none",
      winnerConstraintTrace: winner?.hardConstraintStatus.results || [],
      unexpectedDefault: disabledDefaultLeak,
      readiness: readiness.ready ? "ready" : readiness.clarificationQuestion,
      scoringMode: effectivePolicy.mode,
    });
  }

  console.table(
    rows.map((row) => ({
      id: row.id,
      input: row.input,
      provider: row.provider,
      fallback: row.fallback,
      policies: row.policies,
      qualified: row.qualifiedCount,
      compromises: row.compromiseCount,
      winner: row.winner,
      runnerUp: row.runnerUp,
      contributionDifference: row.exactContributionDifference,
      disabled: row.disabledCategories,
      unexpectedDefault: row.unexpectedDefault,
      readiness: row.readiness,
    })),
  );
  console.log(JSON.stringify(rows, null, 2));
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log("Live adaptive-scoring matrix passed with provider=model and fallback=false.");
}

function getDecidingDifference(winner?: ScoredVehicle, runnerUp?: ScoredVehicle) {
  if (!winner || !runnerUp) return "none";
  const difference = winner.scoreContributions
    .map((contribution) => ({
      category: contribution.category,
      difference:
        contribution.weightedContribution
        - (
          runnerUp.scoreContributions.find(
            (runnerUpContribution) =>
              runnerUpContribution.category === contribution.category,
          )?.weightedContribution || 0
        ),
    }))
    .sort((a, b) => b.difference - a.difference)[0];
  return difference
    ? `${difference.category}:${difference.difference} weighted points`
    : "none";
}

function formatVehicle(vehicle?: ScoredVehicle) {
  return vehicle
    ? `${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.score})`
    : "none";
}

function formatWeights(weights: Record<string, unknown>) {
  return Object.entries(weights)
    .filter(([, weight]) => Number(weight) > 0)
    .map(([category, weight]) => `${category}:${Number(weight).toFixed(2)}`)
    .join(" | ") || "none";
}

function loadLocalEnvWithoutPrintingSecrets() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const keepAlive = setInterval(() => undefined, 1000);
main().then(
  () => clearInterval(keepAlive),
  (error) => {
    clearInterval(keepAlive);
    console.error(error);
    process.exitCode = 1;
  },
);
