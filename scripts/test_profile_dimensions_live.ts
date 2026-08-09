import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { assessConfirmedPreferenceDraftReadiness } from "../lib/recommendationReadiness";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import { createSemanticConversationIntakeSession } from "../lib/conversationIntake";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

type LiveCase = {
  input: string;
  expectedField: keyof Omit<BuyerProfile, "scoreWeights">;
  alternateExpectedField?: keyof Omit<BuyerProfile, "scoreWeights">;
  expectedValues: string[];
};

const cases: LiveCase[] = [
  { input: "No Honda", expectedField: "excludedMakes", expectedValues: ["Honda"] },
  { input: "Maybe BMW", expectedField: "preferredMakes", expectedValues: ["BMW"] },
  { input: "Lexus is okay", expectedField: "allowedMakes", expectedValues: ["Lexus"] },
  { input: "I only want Cadillac", expectedField: "requiredMakes", expectedValues: ["Cadillac"] },
  { input: "No SUVs", expectedField: "excludedBodyStyles", expectedValues: ["suv"] },
  { input: "Maybe a truck", expectedField: "preferredBodyStyles", alternateExpectedField: "preferredVehicleCategories", expectedValues: ["truck"] },
  { input: "A sedan is okay", expectedField: "allowedBodyStyles", expectedValues: ["sedan"] },
  { input: "Hybrid or electric is okay", expectedField: "allowedFuelTypes", expectedValues: ["hybrid", "electric"] },
  { input: "No diesel", expectedField: "excludedFuelTypes", expectedValues: ["diesel"] },
  { input: "I only want AWD", expectedField: "requiredDrivetrains", expectedValues: ["AWD"] },
  { input: "Manual is okay", expectedField: "allowedTransmissions", expectedValues: ["manual"] },
  { input: "No manual transmission", expectedField: "excludedTransmissions", expectedValues: ["manual"] },
  { input: "SUV preferred, but a wagon is okay", expectedField: "preferredBodyStyles", expectedValues: ["suv"] },
  { input: "Hybrid required, electric is acceptable", expectedField: "requiredFuelTypes", expectedValues: ["hybrid"] },
  { input: "AWD or 4WD is okay", expectedField: "allowedDrivetrains", expectedValues: ["AWD", "4WD"] },
  { input: "Automatic only", expectedField: "requiredTransmissions", expectedValues: ["automatic"] },
  { input: "No CVT", expectedField: "excludedTransmissions", expectedValues: ["cvt"] },
  { input: "Truck preferred, SUV acceptable, no sedans", expectedField: "preferredBodyStyles", expectedValues: ["truck"] },
];

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 50000,
  monthlyBudget: 1200,
  downPayment: 10000,
  loanTermMonths: 60,
  apr: 6,
  paymentMethod: "cash",
  purchaseCondition: "any",
  expectedAnnualMileage: 10000,
  fuelPrice: 4,
  insuranceBudget: 250,
  minYear: 2010,
  maxMileage: 180000,
  minMpg: 0,
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
  safetyPriority: "not-sure",
  scoreWeights: defaultScoreWeights,
};

const catalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

async function main() {
  loadLocalEnvWithoutPrintingSecrets();
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipped live profile-dimension verification because OPENAI_API_KEY is not configured.");
    return;
  }

  console.log("Live profile-dimension verification started.");
  const service = createSemanticUnderstandingService({ providerMode: "model" });
  const rows: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  const start = Number(process.env.LIVE_CASE_START || 0);
  const end = Number(process.env.LIVE_CASE_END || cases.length);

  for (const testCase of cases.slice(start, end)) {
    const session = await createSemanticConversationIntakeSession(testCase.input, service);
    const draft = createConfirmedPreferenceProfile(session, baseProfile);
    const readiness = assessConfirmedPreferenceDraftReadiness(draft);
    const buyerProfile = convertConfirmedPreferencesToBuyerProfile(
      baseProfile,
      approveConfirmedPreferenceProfile(draft, 99),
    ).buyerProfile;
    const pipeline = runCandidatePipeline(buyerProfile, catalog, {
      includeCompromises: true,
      includeExcluded: true,
    });
    const actual = buyerProfile[testCase.expectedField];
    const actualValues = Array.isArray(actual) ? actual.map(String) : actual === undefined ? [] : [String(actual)];
    const expectedPresent = testCase.expectedValues.every((value) => actualValues.includes(value));
    if (session.semanticProviderUsed !== "model") failures.push(`${testCase.input}: provider was ${session.semanticProviderUsed}`);
    if (session.semanticFallbackUsed) failures.push(`${testCase.input}: deterministic fallback was used`);

    const mapping = session.accumulatedInterpretation.canonicalMappings || [];
    const expectedDestinations = [testCase.expectedField, testCase.alternateExpectedField].filter(Boolean);
    const mappedValues = mapping
      .filter((item) => expectedDestinations.includes(item.destination as keyof Omit<BuyerProfile, "scoreWeights">))
      .flatMap((item) => Array.isArray(item.value) ? item.value.map(String) : [String(item.value)]);
    const mappingExpected = testCase.expectedValues.every((value) => mappedValues.includes(value));
    if (!mappingExpected) failures.push(`${testCase.input}: expected canonical ${expectedDestinations.join(" or ")} to include ${testCase.expectedValues.join(", ")}; got ${mappedValues.join(", ") || "none"}`);
    rows.push({
      input: testCase.input,
      provider: session.semanticProviderUsed,
      fallback: session.semanticFallbackUsed,
      model: process.env.OPENAI_SEMANTIC_UNDERSTANDING_MODEL || "gpt-4.1-mini (default)",
      concepts: mapping.map((item) => `${item.conceptType}:${String(item.value)}:${item.intent}`).join(" | "),
      confirmation: draft.items
        .filter((item) => item.field && ["confirmed", "inferred"].includes(item.certainty))
        .map((item) => `${item.field}=${item.displayValue} (${item.certainty})`)
        .join(" | "),
      buyerProfile: JSON.stringify({
        [testCase.expectedField]: buyerProfile[testCase.expectedField],
      }),
      applied: expectedPresent,
      readiness: readiness.ready ? "ready" : readiness.clarificationQuestion,
      candidateEffect: `qualified ${pipeline.pipelineDebug.qualifiedCount}, compromise ${pipeline.pipelineDebug.compromiseCount}, excluded ${pipeline.pipelineDebug.excludedCount}`,
      expectedPresent: mappingExpected,
    });
  }

  console.table(rows);
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log("Live multi-value profile matrix passed with provider=model and fallback=false.");
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

// The provider timeout is deliberately unreferenced; keep this CLI process alive
// until the live matrix has a result to report.
const keepAlive = setInterval(() => undefined, 1000);
main().then(
  () => clearInterval(keepAlive),
  (error) => {
    clearInterval(keepAlive);
    console.error(error);
    process.exitCode = 1;
  },
);
