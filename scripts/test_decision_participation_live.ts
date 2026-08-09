import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { createSemanticConversationIntakeSession } from "../lib/conversationIntake";
import { assessConfirmedProfileConversionReadiness } from "../lib/recommendationReadiness";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import { defaultScoreWeights } from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";
import type { DecisionPolicyDimension } from "../types/decisionPolicy";

const inputs = [
  "Ignore budget",
  "No budget limit",
  "Price does not matter",
  "Money is no object",
  "Ignore purchase price, but maintenance cost still matters",
  "Around $25,000",
  "Under $25,000",
  "I can stretch past $25,000",
  "I do not know my budget",
  "Budget is flexible",
  "Ignore fuel economy",
  "Fuel type does not matter",
  "Reliability is not important",
  "Safety is all that matters",
  "Performance matters most",
  "I do not care about resale value",
  "Maintenance costs are not a concern",
  "Any body style is fine",
  "Automatic or manual, either is fine",
  "I have no preference about drivetrain",
  "Ignore budget; I want the safest SUV",
  "Money is no object, but I hate expensive repairs",
  "Ignore fuel economy; I want something fast",
  "No body-style preference, but I need seven seats",
  "Ignore budget and recommend anything",
  "I do not know my budget, but reliability matters",
  "My parents are paying, but I will pay for maintenance",
  "Price is not important unless repairs are extremely expensive",
] as const;

const scorePolicyDimensions = new Set<DecisionPolicyDimension>([
  "affordability",
  "maintenanceRisk",
  "insuranceCost",
  "fuelEnergyCost",
  "resaleValue",
  "reliability",
  "safety",
  "performance",
]);

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
    console.log("Skipped live decision-policy matrix because OPENAI_API_KEY is not configured.");
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
    const semantic = session.semanticUnderstanding;
    const draft = createConfirmedPreferenceProfile(session, baseProfile);
    const conversion = convertConfirmedPreferencesToBuyerProfile(
      baseProfile,
      approveConfirmedPreferenceProfile(draft, index + 100),
    );
    const readiness = assessConfirmedProfileConversionReadiness(conversion);
    const rawInstructions = semantic?.draft.decisionPolicyInstructions || [];
    const policies = conversion.buyerProfile.decisionPolicies || {};
    const defaultSuppressed = Object.values(policies)
      .filter((item) => item?.participation === "disabled")
      .every((item) => {
        if (!item) return true;
        if (item.dimension === "purchaseBudget") {
          return !conversion.preservedDefaults.some((entry) => entry.field === "maxPurchaseBudget");
        }
        if (item.dimension === "monthlyPayment") {
          return !conversion.preservedDefaults.some((entry) => entry.field === "loanTermMonths");
        }
        if (item.dimension === "insuranceCost") {
          return !conversion.preservedDefaults.some((entry) => entry.field === "insuranceBudget");
        }
        if (item.dimension === "fuelEnergyCost") {
          return !conversion.preservedDefaults.some((entry) => entry.field === "fuelPrice");
        }
        return true;
      });
    const needsScoringWork = Object.values(policies).some(
      (item) =>
        item
        && scorePolicyDimensions.has(item.dimension)
        && (item.participation === "disabled" || item.participation === "deprioritized" || item.importance !== undefined),
    );

    if (session.semanticProviderUsed !== "model") failures.push(`${input}: provider=${session.semanticProviderUsed}`);
    if (session.semanticFallbackUsed) failures.push(`${input}: fallback=true`);
    if (!semantic) failures.push(`${input}: no validated understanding`);
    if (!defaultSuppressed) failures.push(`${input}: a disabled default remained visible`);

    rows.push({
      id: index + 1,
      input,
      provider: session.semanticProviderUsed,
      fallback: session.semanticFallbackUsed,
      fallbackReason: session.semanticFallbackReason || "none",
      providerFailure: session.semanticProviderFailure
        ? `${session.semanticProviderFailure.code}: ${session.semanticProviderFailure.message}`
        : "none",
      rawSemanticConcept: rawInstructions.map((item) => `${item.dimension}:${item.participation}`).join(" | ") || "none",
      canonicalDimension: Object.keys(policies).join(", ") || "none",
      participation: Object.values(policies).filter(Boolean).map((item) => `${item?.dimension}:${item?.participation}`).join(" | ") || "none",
      importance: Object.values(policies).filter(Boolean).map((item) => `${item?.dimension}:${item?.importance ?? "n/a"}`).join(" | ") || "none",
      source: Object.values(policies).filter(Boolean).map((item) => `${item?.dimension}:${item?.source}`).join(" | ") || "none",
      confidence: Object.values(policies).filter(Boolean).map((item) => `${item?.dimension}:${item?.confidence}`).join(" | ") || "none",
      buyerProfilePolicy: JSON.stringify(policies),
      conflictResolution: Object.values(policies).filter(Boolean).map((item) => `${item?.dimension}=${item?.participation}`).join(", ") || "none",
      clarification: session.currentQuestion?.text || "none",
      readiness: readiness.ready ? "ready" : readiness.clarificationQuestion,
      defaultSuppressed,
      requires31CB: needsScoringWork,
    });
  }

  console.table(rows.map((row) => ({
    id: row.id,
    input: row.input,
    provider: row.provider,
    fallback: row.fallback,
    providerFailure: row.providerFailure,
    policy: row.participation,
    clarification: row.clarification,
    readiness: row.readiness,
    defaultSuppressed: row.defaultSuppressed,
    requires31CB: row.requires31CB,
  })));
  console.log(JSON.stringify(rows, null, 2));
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log("Live decision participation matrix passed with provider=model and fallback=false.");
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
