import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { carDomainOntology } from "../lib/carDomainOntology";
import { normalizeVehicleMake, recognizeMakesInText } from "../lib/makeRegistry";
import { defaultScoreWeights, getRecommendationDecisionSet } from "../lib/recommendations";
import {
  createEmptyUnderstandingDraft,
  DeterministicSemanticUnderstandingProvider,
  FunctionBackedSemanticUnderstandingProvider,
  TestFixtureSemanticUnderstandingProvider,
  understandAndValidate,
  validateAndNormalizeUnderstanding,
  type SemanticUnderstandingResult,
  type UnderstandingDraft,
} from "../lib/semanticUnderstanding";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

const provider = new DeterministicSemanticUnderstandingProvider();
const vehicleCatalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 15000,
  monthlyBudget: 650,
  downPayment: 2000,
  loanTermMonths: 60,
  apr: 7,
  paymentMethod: "not-sure",
  purchaseCondition: "used",
  expectedAnnualMileage: 9000,
  fuelPrice: 3.8,
  insuranceBudget: 150,
  minYear: 2014,
  maxMileage: 120000,
  minMpg: 0,
  fuelEconomyImportance: 3,
  reliabilityImportance: 4,
  performanceImportance: 2,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "mild",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "high",
  scoreWeights: defaultScoreWeights,
};

async function main() {
assert.equal(normalizeVehicleMake("cadillac"), "Cadillac");
assert.equal(normalizeVehicleMake("Cadillacs"), "Cadillac");
assert.equal(normalizeVehicleMake("Caddy"), "Cadillac");
assert.equal(normalizeVehicleMake("cadilac"), "Cadillac");
assert.equal(recognizeMakesInText("show me Cadillacs")[0]?.canonicalName, "Cadillac");

const benz = await understandAndValidate(provider, {
  currentMessage: "I want a Benz, but I mostly care about the luxury feel and not expensive repairs.",
});
assert.equal(benz.draft.recognizedEntities[0]?.canonicalValue, "Mercedes-Benz");
assert.ok(benz.draft.referenceEntities.some((entity) => entity.canonicalValue === "Mercedes-Benz"));
assert.ok(benz.draft.aversions.some((item) => item.concept === "maintenance_tolerance"));
assert.equal(
  benz.draft.recognizedEntities.some((entity) => entity.proposedConstraintStrength === "required"),
  false,
  "Benz without requirement language must not become required",
);

const cadillacInputs = ["cadillac", "Cadillac", "I want a Cadillac", "show me Cadillacs", "Caddy", "I want a Caddy", "cadilac"];
for (const input of cadillacInputs) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.equal(result.draft.recognizedEntities[0]?.canonicalValue, "Cadillac", `${input} should normalize to Cadillac`);
  assert.equal(result.draft.recognizedEntities[0]?.concept, "make");
}

const toyotaFragments = ["toyota", "Toyota", "I want a Toyota", "looking for Toyota"];
for (const input of toyotaFragments) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.equal(result.draft.recognizedEntities[0]?.canonicalValue, "Toyota", `${input} should normalize to Toyota`);
}
const maybeToyota = await understandAndValidate(provider, { currentMessage: "maybe Toyota" });
assert.equal(maybeToyota.draft.recognizedEntities[0]?.canonicalValue, "Toyota");
assert.notEqual(maybeToyota.draft.recognizedEntities[0]?.proposedConstraintStrength, "required");

const lexusFragments = ["lexus", "Lexus", "I want a Lexus", "looking for Lexus"];
for (const input of lexusFragments) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.equal(result.draft.recognizedEntities[0]?.canonicalValue, "Lexus", `${input} should normalize to Lexus`);
}

const noToyota = await understandAndValidate(provider, { currentMessage: "no Toyota" });
assert.equal(noToyota.draft.aversions[0]?.proposedValue, "Toyota");
assert.equal(noToyota.draft.aversions[0]?.proposedConstraintStrength, "required");
assert.ok(/excluded/i.test(noToyota.draft.aversions[0]?.interpretationExplanation || ""));

for (const input of ["truck", "a truck", "need truck", "I want a truck", "pickup"]) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.ok(result.draft.explicitPreferences.some((item) => item.concept === "body_style" && item.proposedValue === "truck"), `${input} should normalize to truck`);
}

for (const input of ["hybrid", "want hybrid", "fuel efficient hybrid", "maybe a hybrid"]) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.ok(result.draft.explicitPreferences.some((item) => item.concept === "powertrain" && item.proposedValue === "hybrid"), `${input} should normalize to hybrid`);
}

for (const input of ["cheap", "something cheap", "low budget", "don’t want to spend much"]) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.ok(result.draft.inferredPreferences.some((item) => item.concept === "purchase_budget"), `${input} should preserve affordability meaning`);
  assert.ok(result.draft.uncertainties.some((item) => item.topic === "Budget amount"));
}

for (const input of ["idk", "I don’t know", "not sure", "no idea what I want", "help me choose"]) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.ok(result.draft.uncertainties.length > 0, `${input} should trigger guided discovery`);
}

for (const input of ["motorcycle", "motorbike", "RV", "camper van", "ATV", "electric scooter"]) {
  const result = await understandAndValidate(provider, { currentMessage: input });
  assert.ok(result.draft.unresolvedConcepts.some((item) => item.concept === "unknown"), `${input} should be outside current scope`);
  assert.ok(result.draft.uncertainties.some((item) => item.topic === "Outside current vehicle scope"));
}

const snow = await understandAndValidate(provider, {
  currentMessage: "I am moving somewhere snowy and would feel better if the car handles winter well.",
});
assert.ok(snow.draft.practicalGoals.some((item) => item.concept === "snow_use"));
assert.ok(snow.draft.assumptions.some((item) => item.assumption.includes("not a hard drivetrain requirement")));

const power = await understandAndValidate(provider, { currentMessage: "I want something powerful." });
assert.ok(power.draft.uncertainties.some((item) => item.topic === "Meaning of power"));
assert.equal(power.selectedClarification?.id, "clarify:power");

const context = await understandAndValidate(provider, {
  currentMessage: "Mostly how it feels when I merge onto the highway.",
  conversationHistory: [
    { id: "u1", role: "user", text: "I want something powerful." },
    { id: "a1", role: "advisor", text: "Do you mean acceleration, handling, or carrying capability?", questionCode: "performance_meaning" },
    { id: "u2", role: "user", text: "Mostly how it feels when I merge onto the highway." },
  ],
});
assert.ok(context.draft.inferredPreferences.some((item) => item.id === "context:power-merge"));
assert.equal(context.draft.inferredPreferences.find((item) => item.id === "context:power-merge")?.concept, "acceleration");

const prior = createEmptyUnderstandingDraft("Earlier requirement");
prior.constraints.push({
  id: "prior-make",
  concept: "make",
  proposedValue: "BMW",
  sourceText: "BMW is required",
  messageRef: "u1",
  status: "explicit",
  intent: "required",
  confidence: 0.95,
  proposedConstraintStrength: "required",
  interpretationExplanation: "Earlier required make.",
  requiresConfirmation: false,
});
const relaxed = await understandAndValidate(provider, {
  currentMessage: "Actually the badge is not that important.",
  conversationHistory: [{ id: "u2", role: "user", text: "Actually the badge is not that important." }],
  currentUnderstanding: prior,
});
assert.ok(relaxed.draft.conflicts.some((conflict) => conflict.conflictType === "changed_mind"));
assert.ok(relaxed.draft.inferredPreferences.some((item) => item.status === "contradicted" && item.proposedConstraintStrength === "preferred"));

const unsafeDraft = createEmptyUnderstandingDraft("Unsafe model output");
unsafeDraft.inferredPreferences.push({
  id: "unsafe-awd",
  concept: "snow_use",
  proposedValue: "AWD",
  sourceText: "I am moving somewhere snowy.",
  messageRef: "u1",
  status: "inferred",
  intent: "required",
  confidence: 0.7,
  proposedConstraintStrength: "required",
  interpretationExplanation: "Model tried to make inferred snow use a hard requirement.",
  requiresConfirmation: false,
});
const fixtureResult: SemanticUnderstandingResult = {
  providerId: "unsafe-fixture",
  providerKind: "test-fixture",
  draft: unsafeDraft,
  warnings: [],
};
const guarded = validateAndNormalizeUnderstanding(fixtureResult, carDomainOntology);
assert.ok(guarded.guardrails.some((guardrail) => guardrail.code === "inferred_required_downgraded"));
assert.equal(guarded.draft.inferredPreferences[0].proposedConstraintStrength, "preferred");
assert.equal(guarded.draft.inferredPreferences[0].requiresConfirmation, true);

const empty = await understandAndValidate(new TestFixtureSemanticUnderstandingProvider(createEmptyUnderstandingDraft()), {
  currentMessage: "",
});
assert.equal(empty.acceptedInterpretations.length, 0);
assert.equal(empty.selectedClarification, null);

const modelProvider = new FunctionBackedSemanticUnderstandingProvider("future-model", async () => {
  const draft = createEmptyUnderstandingDraft("Model-backed draft");
  draft.explicitPreferences.push({
    id: "model-budget",
    concept: "purchase_budget",
    proposedValue: 12000,
    sourceText: "under 12k",
    messageRef: "u1",
    status: "explicit",
    intent: "required",
    confidence: 0.9,
    proposedConstraintStrength: "required",
    interpretationExplanation: "Budget was explicit.",
    requiresConfirmation: false,
  });
  return draft;
});
const modelResult = await modelProvider.understand({ currentMessage: "under 12k" });
assert.equal(modelResult.providerKind, "model-backed");
assert.ok(modelResult.warnings[0].includes("validated"));

const before = getRecommendationDecisionSet(baseProfile, vehicleCatalog).primaryRecommendations[0]?.vehicleId;
await understandAndValidate(provider, {
  currentMessage: "I want something grown-up and calm, but still cheap to own.",
});
const after = getRecommendationDecisionSet(baseProfile, vehicleCatalog).primaryRecommendations[0]?.vehicleId;
assert.equal(after, before, "semantic understanding must not mutate profile or ranking");

const serialized = JSON.stringify(benz.draft);
assert.equal(serialized.includes("overallMatchScore"), false);
assert.equal(serialized.includes("vehicleId"), false);

console.log("Semantic understanding contract passed.");
console.log("Selected clarification examples:");
console.log("Power:", power.selectedClarification?.question);
console.log("Reference:", benz.selectedClarification?.question);
console.log("Guardrails:", guarded.guardrails.map((guardrail) => guardrail.code).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
