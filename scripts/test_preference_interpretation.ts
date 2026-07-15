import assert from "node:assert/strict";
import {
  interpretPreferenceMessage,
  interpretPreferenceMessageWithOptionalAi,
  type PreferenceInterpretation,
} from "../lib/preferenceInterpretation";
import type { BuyerProfile } from "../types/buyer";

type ProfilePatch = Partial<Omit<BuyerProfile, "scoreWeights">>;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const powerful = interpretPreferenceMessage("I want something powerful.");
  assert.equal(powerful.suggestedProfileUpdates.performanceImportance, 5);
  assert.ok(hasUncertainty(powerful, "powerful"), "ambiguous performance language should create uncertainty");
  assert.ok(powerful.nextClarifyingQuestion.includes("quick acceleration"));
  assertValidPatch(powerful.suggestedProfileUpdates);
  assertEvidenceTraces(powerful);

  const safeFirstCar = interpretPreferenceMessage("I need a safe first car under $15,000.");
  assert.equal(safeFirstCar.suggestedProfileUpdates.maxPurchaseBudget, 15000);
  assert.equal(safeFirstCar.suggestedProfileUpdates.safetyPriority, "high");
  assert.ok(hasFact(safeFirstCar, "Purchase budget"));
  assert.ok(hasFact(safeFirstCar, "Safety priority"));
  assert.ok(safeFirstCar.confidenceByField.some((entry) => entry.field === "maxPurchaseBudget" && entry.value === 15000));
  assertEvidenceTraces(safeFirstCar);

  const bmwRepairs = interpretPreferenceMessage("I want a BMW, but repairs cannot be expensive.");
  assert.equal(bmwRepairs.suggestedProfileUpdates.preferredMake, "BMW", "BMW should be preferred unless user says it is required");
  assert.equal(bmwRepairs.suggestedProfileUpdates.requiredMake, undefined);
  assert.ok(bmwRepairs.conflicts.some((conflict) => conflict.topic.includes("Premium preference")));
  assert.ok(bmwRepairs.nextClarifyingQuestion.includes("BMW"));
  assertEvidenceTraces(bmwRepairs);

  const snowFamily = interpretPreferenceMessage("I drive in snow and need room for my family.");
  assert.equal(snowFamily.suggestedProfileUpdates.climate, "snow");
  assert.equal(snowFamily.suggestedProfileUpdates.cargoNeed, "high");
  assert.equal(snowFamily.suggestedProfileUpdates.drivetrainPreference, undefined, "snow alone must not become an AWD hard constraint");
  assert.ok(snowFamily.inferredPreferences.some((preference) => preference.label.includes("Family")));
  assertEvidenceTraces(snowFamily);

  const snowFamilyRequired = interpretPreferenceMessage(
    "Budget $25,000. SUV. Snow or ice. AWD required. Family of 4. Cargo high. Safety maximum.",
  );
  assert.equal(snowFamilyRequired.suggestedProfileUpdates.maxPurchaseBudget, 25000);
  assert.equal(snowFamilyRequired.suggestedProfileUpdates.bodyStyle, "suv");
  assert.equal(snowFamilyRequired.suggestedProfileUpdates.drivetrainPreference, "AWD");
  assert.equal(snowFamilyRequired.suggestedProfileUpdates.familySize, 4);
  assert.equal(snowFamilyRequired.suggestedProfileUpdates.cargoNeed, "high");
  assert.equal(snowFamilyRequired.suggestedProfileUpdates.safetyPriority, "maximum");
  assert.ok(hasFact(snowFamilyRequired, "Required body style"));
  assert.ok(hasFact(snowFamilyRequired, "Required drivetrain"));
  assertEvidenceTraces(snowFamilyRequired);

  const premiumCheap = interpretPreferenceMessage("I want something that looks expensive without costing too much.");
  assert.equal(premiumCheap.suggestedProfileUpdates.maxPurchaseBudget, undefined, "vague low-cost language must not invent a budget");
  assert.ok(premiumCheap.inferredPreferences.some((preference) => preference.label.includes("Design")));
  assert.ok(premiumCheap.conflicts.some((conflict) => conflict.topic.includes("Premium image")));
  assertEvidenceTraces(premiumCheap);

  const unsure = interpretPreferenceMessage("I don't know much about cars.");
  assert.equal(Object.keys(unsure.suggestedProfileUpdates).length, 0);
  assert.ok(unsure.nextClarifyingQuestion.includes("maximum budget"));

  const empty = interpretPreferenceMessage("   ");
  assert.equal(Object.keys(empty.suggestedProfileUpdates).length, 0);
  assert.ok(empty.interpretationSummary.includes("couldn't confidently interpret"));
  assert.ok(empty.nextClarifyingQuestion.includes("maximum budget"));

  const openAiUnavailable = await interpretPreferenceMessageWithOptionalAi("I want something powerful.");
  assert.equal(openAiUnavailable.parserSource, "local");
  assert.equal(openAiUnavailable.suggestedProfileUpdates.performanceImportance, 5);

  const invalidAiOutput = await interpretPreferenceMessageWithOptionalAi("I need a safe first car under $15,000.", async () => ({
    interpretationSummary: "Invalid output",
    suggestedProfileUpdates: {
      maxPurchaseBudget: 15000,
      inventedField: "should not pass",
    },
  }));
  assert.equal(invalidAiOutput.parserSource, "fallback");
  assert.equal(invalidAiOutput.suggestedProfileUpdates.maxPurchaseBudget, 15000);

  assertNoRecommendationPayload(powerful);
  assertNoRecommendationPayload(safeFirstCar);
  assertNoRecommendationPayload(bmwRepairs);
  assertNoRecommendationPayload(snowFamily);
  assertNoRecommendationPayload(premiumCheap);

  console.log("Preference interpretation contract passed.");
  console.log("Visible interpretation examples:");
  for (const [label, interpretation] of [
    ["Powerful", powerful],
    ["Safe first car", safeFirstCar],
    ["BMW repairs", bmwRepairs],
  ] as const) {
    console.log(`${label}: ${interpretation.interpretationSummary}`);
    console.log(`  updates: ${JSON.stringify(interpretation.suggestedProfileUpdates)}`);
    console.log(`  question: ${interpretation.nextClarifyingQuestion}`);
  }
}

function assertValidPatch(patch: ProfilePatch) {
  const allowed = new Set<keyof ProfilePatch>([
    "maxPurchaseBudget",
    "monthlyBudget",
    "downPayment",
    "loanTermMonths",
    "apr",
    "paymentMethod",
    "purchaseCondition",
    "expectedAnnualMileage",
    "fuelPrice",
    "insuranceBudget",
    "minYear",
    "maxMileage",
    "minMpg",
    "fuelEconomyImportance",
    "reliabilityImportance",
    "performanceImportance",
    "cargoNeed",
    "familySize",
    "drivetrainPreference",
    "transmissionPreference",
    "bodyStyle",
    "climate",
    "resaleValueImportance",
    "modificationPlans",
    "advancedFeaturesImportance",
    "safetyPriority",
    "requiredMake",
    "preferredMake",
    "requiredFuelType",
    "reliabilityMinimum",
    "safetyMinimum",
    "performanceMinimum",
    "flexibleConstraints",
    "allowCompromises",
  ]);
  Object.keys(patch).forEach((key) => assert.ok(allowed.has(key as keyof ProfilePatch), `${key} must be a valid BuyerProfile field`));
}

function assertEvidenceTraces(interpretation: PreferenceInterpretation) {
  assertValidPatch(interpretation.suggestedProfileUpdates);
  for (const entry of interpretation.confidenceByField) {
    assert.ok(entry.evidencePhrase.length > 0, `${entry.field} should include evidence phrase`);
    assert.ok(
      interpretation.rawUserMessage.toLowerCase().includes(entry.evidencePhrase.toLowerCase()),
      `${entry.evidencePhrase} should trace to the raw message`,
    );
  }
}

function assertNoRecommendationPayload(interpretation: PreferenceInterpretation) {
  const record = interpretation as unknown as Record<string, unknown>;
  assert.equal(record.recommendations, undefined);
  assert.equal(record.rankedVehicles, undefined);
  assert.equal(record.vehicleResults, undefined);
}

function hasUncertainty(interpretation: PreferenceInterpretation, evidence: string) {
  return interpretation.uncertainties.some((uncertainty) => uncertainty.evidencePhrase.toLowerCase().includes(evidence));
}

function hasFact(interpretation: PreferenceInterpretation, label: string) {
  return interpretation.explicitFacts.some((fact) => fact.label === label);
}
