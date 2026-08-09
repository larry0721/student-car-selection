import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAdvisorCommunicationViewModel,
  buildConfirmationCommunicationViewModel,
  getOutOfScopeAdvisorMessage,
} from "../lib/advisorCommunication";
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
import { assessConfirmedProfileConversionReadiness } from "../lib/recommendationReadiness";
import {
  buildDecisionReport,
  defaultScoreWeights,
  runCandidatePipeline,
} from "../lib/recommendations";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

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

const inputs = [
  "I don't know what I want.",
  "Ignore budget.",
  "Money is no object.",
  "My parents care about safety.",
  "I want a Tesla.",
  "I want a motorcycle.",
  "Truck preferred.",
  "Hybrid or electric.",
  "No Toyota.",
  "Actually never mind...",
  "Safety above everything.",
  "Luxury matters.",
  "Looks expensive.",
  "Camping.",
  "Reliable first car.",
  "Performance only.",
  "Recommend anything.",
  "Ignore everything.",
] as const;

async function main() {
  loadLocalEnvWithoutPrintingSecrets();
  assert.ok(process.env.OPENAI_API_KEY, "OPENAI_API_KEY is required for live advisor communication tests");
  process.env.SEMANTIC_UNDERSTANDING_TIMEOUT_MS ||= "30000";
  process.env.SEMANTIC_UNDERSTANDING_MAX_RETRIES ||= "1";
  const service = createSemanticUnderstandingService({ providerMode: "model" });
  const rows: Array<Record<string, unknown>> = [];

  for (const [index, input] of inputs.entries()) {
    const result = await evaluate(input, baseProfile, service);
    assert.equal(result.provider, "model", `${index + 1}: model provider required`);
    assert.equal(result.fallback, false, `${index + 1}: fallback must remain false`);

    if (index === 0) {
      assert.equal(result.readiness.ready, false);
      assert.ok(result.question);
      assert.equal(result.view, undefined);
    }
    if (index === 1 || index === 2) {
      assert.ok(result.profile.decisionPolicies?.purchaseBudget?.participation === "disabled");
      assert.equal(result.readiness.ready, false);
      assert.equal(result.view, undefined);
    }
    if (index === 3) {
      assert.ok(
        result.profile.safetyPriority === "high"
          || result.profile.safetyPriority === "maximum"
          || ["active", "enforced"].includes(
            result.profile.decisionPolicies?.safety?.participation || "",
          ),
      );
    }
    if (index === 4) {
      assert.equal(result.question, undefined, "An unavailable required make must not trigger an irrelevant question");
      assert.equal(result.view?.mode, "no_match");
      assert.ok(result.view?.noMatch?.explanation.includes("Tesla"));
    }
    if (index === 5) {
      assert.equal(result.readiness.ready, false);
      assert.ok(getOutOfScopeAdvisorMessage(input)?.includes("motorcycle"));
      assert.equal(result.question, undefined, "Out-of-scope intent must not carry a hidden car question");
      assert.equal(result.view, undefined);
    }
    if (index === 6) {
      assert.ok(result.profile.preferredBodyStyles?.includes("truck"));
    }
    if (index === 7) {
      const projectedFuelTypes = [
        ...(result.profile.requiredFuelTypes || []),
        ...(result.profile.preferredFuelTypes || []),
        ...(result.profile.allowedFuelTypes || []),
      ];
      assert.ok(
        (["hybrid", "electric"] as const).every((fuelType) => projectedFuelTypes.includes(fuelType))
          || Boolean(result.question),
        "An underspecified fuel choice must be projected or clarified, never silently discarded",
      );
      assert.equal(result.session.currentQuestion?.id, "relationship_intent");
    }
    if (index === 8) {
      assert.ok(result.profile.excludedMakes?.includes("Toyota"));
      assert.ok(
        result.decisionSet?.primaryRecommendations.every((item) => item.vehicle.make !== "Toyota") ?? true,
      );
    }
    if (index === 9 || index === 16 || index === 17) {
      assert.equal(result.readiness.ready, false);
      assert.equal(result.view, undefined);
    }
    if (index === 10) {
      assert.ok(
        result.confirmation.policySummary.priorities.some((item) => /Safety/i.test(item))
          || ["active", "enforced"].includes(
            result.profile.decisionPolicies?.safety?.participation || "",
          ),
      );
    }
    if (index === 14) {
      assert.ok(
        result.profile.reliabilityImportance >= 4
          || ["active", "enforced"].includes(
            result.profile.decisionPolicies?.reliability?.participation || "",
          ),
      );
    }
    if (index === 15) {
      assert.ok(
        result.profile.performanceImportance >= 4
          || ["active", "enforced"].includes(
            result.profile.decisionPolicies?.performance?.participation || "",
          ),
      );
    }

    rows.push(toRow(index + 1, input, result));
  }

  const firstBudgetTruck = await evaluate(
    "Ignore budget; I want a reliable truck.",
    baseProfile,
    service,
  );
  assert.equal(firstBudgetTruck.provider, "model");
  assert.equal(firstBudgetTruck.fallback, false);
  const revisedBudgetTruck = await revise(
    "Actually, keep it under $35,000.",
    firstBudgetTruck,
    service,
  );
  assert.equal(revisedBudgetTruck.provider, "model");
  assert.equal(revisedBudgetTruck.fallback, false);
  assert.ok(
    revisedBudgetTruck.profile.decisionPolicies?.purchaseBudget?.participation === "enforced"
      || revisedBudgetTruck.profile.decisionPolicies?.purchaseBudget?.participation === "active",
  );
  assert.equal(revisedBudgetTruck.profile.maxPurchaseBudget, 35000);
  assert.ok(revisedBudgetTruck.confirmation.policySummary.requirements.some((item) => /Purchase price/i.test(item)));
  rows.push(toRow(11, "Ignore budget truck → under $35,000", revisedBudgetTruck));

  const firstToyota = await evaluate("I want a Toyota.", baseProfile, service);
  const revisedToyota = await revise("Actually, no Toyota.", firstToyota, service);
  assert.equal(revisedToyota.provider, "model");
  assert.equal(revisedToyota.fallback, false);
  assert.equal(revisedToyota.profile.requiredMakes?.includes("Toyota") || false, false);
  assert.equal(revisedToyota.profile.preferredMakes?.includes("Toyota") || false, false);
  assert.ok(revisedToyota.profile.excludedMakes?.includes("Toyota"));
  assert.ok(
    revisedToyota.decisionSet?.primaryRecommendations.every(
      (item) => item.vehicle.make !== "Toyota",
    ) ?? true,
  );
  rows.push(toRow(12, "Toyota required → no Toyota", revisedToyota));

  const revisedLexus = await revise("Actually Lexus.", revisedToyota, service);
  assert.equal(revisedLexus.provider, "model");
  assert.equal(revisedLexus.fallback, false);
  assert.ok(
    revisedLexus.profile.requiredMakes?.includes("Lexus")
      || revisedLexus.profile.preferredMakes?.includes("Lexus"),
  );
  assert.equal(revisedLexus.profile.excludedMakes?.includes("Toyota") || false, true);

  const noBudget = await revise("Budget doesn't matter.", revisedLexus, service);
  assert.equal(noBudget.profile.decisionPolicies?.purchaseBudget?.participation, "disabled");
  const restoredBudget = await revise("Actually keep it under $40,000.", noBudget, service);
  assert.equal(restoredBudget.profile.maxPurchaseBudget, 40000);
  assert.ok(
    ["active", "enforced"].includes(
      restoredBudget.profile.decisionPolicies?.purchaseBudget?.participation || "",
    ),
  );
  const safetyRevision = await revise("Safety matters most.", restoredBudget, service);
  assert.ok(
    safetyRevision.profile.safetyPriority === "high"
      || safetyRevision.profile.safetyPriority === "maximum"
      || ["active", "enforced"].includes(
        safetyRevision.profile.decisionPolicies?.safety?.participation || "",
      ),
  );
  assert.equal(safetyRevision.profile.maxPurchaseBudget, 40000);
  assert.ok(
    safetyRevision.profile.requiredMakes?.includes("Lexus")
      || safetyRevision.profile.preferredMakes?.includes("Lexus"),
  );
  rows.push(toRow(19, "Toyota → no Toyota → Lexus → no budget → $40k → safety", safetyRevision));

  console.table(rows);
  console.log("Live advisor communication journeys passed with provider=model and fallback=false.");
}

async function evaluate(
  input: string,
  startingProfile: BuyerProfile,
  service: ReturnType<typeof createSemanticUnderstandingService>,
) {
  const session = await createSemanticConversationIntakeSession(input, service);
  return evaluateSession(input, startingProfile, session);
}

async function revise(
  input: string,
  previous: Awaited<ReturnType<typeof evaluate>>,
  service: ReturnType<typeof createSemanticUnderstandingService>,
) {
  const session = await answerConversationQuestionWithSemantic(
    prepareConversationRevisionSession(previous.session, previous.profile),
    input,
    service,
  );
  return evaluateSession(input, previous.profile, session);
}

function evaluateSession(
  input: string,
  startingProfile: BuyerProfile,
  session: Awaited<ReturnType<typeof createSemanticConversationIntakeSession>>,
) {
  const draft = createConfirmedPreferenceProfile(session, startingProfile);
  const approved = approveConfirmedPreferenceProfile(
    draft,
    session.conversationTurns.length + 1,
  );
  const conversion = convertConfirmedPreferencesToBuyerProfile(startingProfile, approved);
  const readiness = assessConfirmedProfileConversionReadiness(conversion);
  const confirmation = buildConfirmationCommunicationViewModel(draft, readiness);
  const pipeline = readiness.ready
    && !session.currentQuestion
    && !getOutOfScopeAdvisorMessage(input)
    ? runCandidatePipeline(conversion.buyerProfile, catalog, {
        includeCompromises: true,
        includeExcluded: true,
      })
    : undefined;
  const decisionSet = pipeline?.decisionSet;
  const view = decisionSet
    ? buildAdvisorCommunicationViewModel({
        decisionSet,
        decisionReport: buildDecisionReport(decisionSet),
        profile: conversion.buyerProfile,
      })
    : undefined;
  return {
    provider: session.semanticProviderUsed,
    fallback: session.semanticFallbackUsed,
    question: session.currentQuestion?.text,
    session,
    draft,
    confirmation,
    conversion,
    readiness,
    profile: conversion.buyerProfile,
    decisionSet,
    view,
  };
}

function toRow(
  id: number,
  input: string,
  result: Awaited<ReturnType<typeof evaluate>>,
) {
  return {
    id,
    input,
    provider: result.provider,
    fallback: result.fallback,
    ready: result.readiness.ready,
    question: result.question || result.readiness.clarificationQuestion || "none",
    mode: result.view?.mode || "not-ready",
    recommendation: result.view?.snapshotVehicleId || "none",
    ignored: result.confirmation.policySummary.ignored.join(" | ") || "none",
  };
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

void main();
