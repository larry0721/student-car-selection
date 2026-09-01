import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answerConversationQuestionWithSemantic,
  createSemanticConversationIntakeSession,
  prepareConversationRevisionSession,
} from "../lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  carryForwardConfirmedPreferenceDraft,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import {
  buildProfilePatch,
  mapValidatedUnderstandingToProfile,
  mergeCanonicalConcepts,
} from "../lib/semanticMapping";
import {
  DeterministicSemanticUnderstandingProvider,
  understandAndValidate,
} from "../lib/semanticUnderstanding";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

const provider = new DeterministicSemanticUnderstandingProvider();
const service = createSemanticUnderstandingService({
  providerMode: "deterministic",
  providers: { deterministic: provider },
});
const catalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const defaults: BuyerProfile = {
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

async function mappingFor(input: string, messageRef = "turn-1") {
  const understanding = await understandAndValidate(provider, {
    currentMessage: input,
    conversationHistory: [{ id: messageRef, role: "user", text: input }],
  });
  return mapValidatedUnderstandingToProfile(understanding);
}

async function profileFor(input: string) {
  const session = await createSemanticConversationIntakeSession(input, service);
  const draft = createConfirmedPreferenceProfile(session, defaults);
  return {
    draft,
    profile: convertConfirmedPreferencesToBuyerProfile(
      defaults,
      approveConfirmedPreferenceProfile(draft, 99),
    ).buyerProfile,
  };
}

function expectSet(actual: unknown, expected: string[], message: string) {
  assert.deepEqual([...(actual as string[] || [])].sort(), [...expected].sort(), message);
}

async function main() {
  const passed: string[] = [];
  const check = async (name: string, assertion: () => void | Promise<void>) => {
    await assertion();
    passed.push(name);
  };

  await check("coordinated make negation applies to every list member", async () => {
    const result = await mappingFor("No Subaru, Toyota, or Honda.");
    expectSet(result.profilePatch.excludedMakes, ["Subaru", "Toyota", "Honda"], "all makes should be excluded");
    assert.equal(result.profilePatch.allowedMakes, undefined);
  });

  await check("do-not-want scope survives or coordination", async () => {
    const result = await mappingFor("I don't want Subaru or Toyota.");
    expectSet(result.profilePatch.excludedMakes, ["Subaru", "Toyota"], "both makes should be excluded");
  });

  await check("anything-but scope survives and coordination", async () => {
    const result = await mappingFor("Anything but Honda and Nissan.");
    expectSet(result.profilePatch.excludedMakes, ["Honda", "Nissan"], "both makes should be excluded");
  });

  await check("neither-nor scope excludes both values", async () => {
    const result = await mappingFor("Neither Toyota nor Honda.");
    expectSet(result.profilePatch.excludedMakes, ["Toyota", "Honda"], "both makes should be excluded");
  });

  await check("body-style negation applies to the complete list", async () => {
    const result = await mappingFor("No SUVs, trucks, or minivans.");
    expectSet(result.profilePatch.excludedBodyStyles, ["suv", "truck", "minivan"], "all body styles should be excluded");
    assert.equal(result.profilePatch.allowedBodyStyles, undefined);
  });

  await check("fuel-type negation applies to the complete list", async () => {
    const result = await mappingFor("No electric, hybrid, or diesel cars.");
    expectSet(result.profilePatch.excludedFuelTypes, ["electric", "hybrid", "diesel"], "all fuel types should be excluded");
  });

  await check("not scope excludes every coordinated fuel value", async () => {
    const result = await mappingFor("Not electric or hybrid.");
    expectSet(result.profilePatch.excludedFuelTypes, ["electric", "hybrid"], "not should exclude both fuel types");
  });

  await check("gasoline participates in reusable fuel exclusions", async () => {
    const result = await mappingFor("No gasoline or diesel.");
    expectSet(result.profilePatch.excludedFuelTypes, ["gas", "diesel"], "both fuel types should be excluded");
  });

  await check("drivetrain negation applies to the complete list", async () => {
    const result = await mappingFor("Avoid AWD, 4WD, and RWD.");
    expectSet(result.profilePatch.excludedDrivetrains, ["AWD", "4WD", "RWD"], "all drivetrains should be excluded");
  });

  await check("transmission negation applies to the complete list", async () => {
    const result = await mappingFor("No manual or CVT transmission.");
    expectSet(result.profilePatch.excludedTransmissions, ["manual", "cvt"], "both transmissions should be excluded");
  });

  await check("contrast boundary permits a positive make after exclusions", async () => {
    const result = await mappingFor("I don't want Toyota or Honda, but Subaru is fine.");
    expectSet(result.profilePatch.excludedMakes, ["Toyota", "Honda"], "negative set should remain excluded");
    expectSet(result.profilePatch.allowedMakes, ["Subaru"], "Subaru should be allowed");
  });

  await check("mixed performance language survives alongside exclusions", async () => {
    const result = await mappingFor("I want something fun, but no Toyota or Honda.");
    expectSet(result.profilePatch.excludedMakes, ["Toyota", "Honda"], "both makes should be excluded");
    assert.equal(result.profilePatch.performanceImportance, 5);
  });

  await check("positive then negative contrast keeps separate make sets", async () => {
    const result = await mappingFor("Toyota is okay but no Honda.");
    expectSet(result.profilePatch.allowedMakes, ["Toyota"], "Toyota should be allowed");
    expectSet(result.profilePatch.excludedMakes, ["Honda"], "Honda should be excluded");
  });

  await check("semicolon and suffix language reset polarity", async () => {
    const result = await mappingFor("Anything except Toyota; Honda is okay.");
    expectSet(result.profilePatch.excludedMakes, ["Toyota"], "Toyota should be excluded");
    expectSet(result.profilePatch.allowedMakes, ["Honda"], "Honda should be allowed");
  });

  await check("body-style contrast remains dimensionally consistent", async () => {
    const result = await mappingFor("No SUVs, but a wagon is fine.");
    expectSet(result.profilePatch.excludedBodyStyles, ["suv"], "SUV should be excluded");
    expectSet(result.profilePatch.allowedBodyStyles, ["wagon"], "wagon should be allowed");
  });

  await check("fuel contrast excludes electric and allows hybrid", async () => {
    const result = await mappingFor("No electric, but hybrid is okay.");
    expectSet(result.profilePatch.excludedFuelTypes, ["electric"], "electric should be excluded");
    expectSet(result.profilePatch.allowedFuelTypes, ["hybrid"], "hybrid should be allowed");
  });

  await check("dealbreaker suffix produces explicit exclusions", async () => {
    const result = await mappingFor("Toyota and Honda are dealbreakers.");
    expectSet(result.profilePatch.excludedMakes, ["Toyota", "Honda"], "both dealbreakers should be excluded");
  });

  await check("avoid and stay-away forms preserve exclusion polarity", async () => {
    const avoid = await mappingFor("Avoid Toyota and Honda.");
    expectSet(avoid.profilePatch.excludedMakes, ["Toyota", "Honda"], "avoid should exclude both makes");
    const stayAway = await mappingFor("Stay away from Toyota or Honda.");
    expectSet(stayAway.profilePatch.excludedMakes, ["Toyota", "Honda"], "stay away should exclude both makes");
    assert.equal(stayAway.profilePatch.allowedMakes, undefined);
  });

  await check("unsupported SUV-crossover distinction stays explicit and unresolved", async () => {
    const result = await mappingFor("No SUVs, but crossovers are fine.");
    expectSet(result.profilePatch.excludedBodyStyles, ["suv"], "the enforceable SUV exclusion should remain");
    assert.equal(result.profilePatch.allowedBodyStyles, undefined, "one catalog value cannot be both allowed and excluded");
    assert.ok(result.clarificationConcepts.some((item) => item.value === "crossover distinct from SUV"));
  });

  await check("unknown partial alias stays unresolved", async () => {
    const result = await mappingFor("No Merc.");
    assert.equal(result.profilePatch.excludedMakes, undefined);
    assert.equal(result.profilePatch.allowedMakes, undefined);
    assert.ok(result.clarificationConcepts.some((item) => item.value === "Merc" && item.intent === "excluded"));
  });

  await check("allowed and excluded sets never overlap", async () => {
    const first = await mappingFor("No Toyota or Honda.", "turn-1");
    const second = await mappingFor("Actually Toyota is okay.", "turn-2");
    const patch = buildProfilePatch(mergeCanonicalConcepts(first.concepts, second.concepts));
    expectSet(patch.excludedMakes, ["Honda"], "Honda exclusion should remain");
    expectSet(patch.allowedMakes, ["Toyota"], "latest Toyota revision should win");
    assert.equal(patch.excludedMakes?.some((make) => patch.allowedMakes?.includes(make)), false);
  });

  await check("later explicit exclusion reverses an allowed value", async () => {
    const first = await mappingFor("Toyota is okay.", "turn-1");
    const second = await mappingFor("Actually no Toyota.", "turn-2");
    const patch = buildProfilePatch(mergeCanonicalConcepts(first.concepts, second.concepts));
    expectSet(patch.excludedMakes, ["Toyota"], "latest exclusion should win");
    assert.equal(patch.allowedMakes, undefined);
  });

  await check("unrelated follow-up does not reset exclusions", async () => {
    const first = await mappingFor("No Toyota.", "turn-1");
    const second = await mappingFor("I mostly commute to school.", "turn-2");
    const patch = buildProfilePatch(mergeCanonicalConcepts(first.concepts, second.concepts));
    expectSet(patch.excludedMakes, ["Toyota"], "unrelated context should not clear Toyota");
  });

  await check("confirmation and BuyerProfile retain exclusions", async () => {
    const { draft, profile } = await profileFor("No Subaru, Toyota, or Honda.");
    const excludedItem = draft.items.find((item) => item.field === "excludedMakes");
    assert.equal(excludedItem?.label, "Excluded makes");
    expectSet(excludedItem?.value, ["Subaru", "Toyota", "Honda"], "confirmation should show excluded makes");
    expectSet(profile.excludedMakes, ["Subaru", "Toyota", "Honda"], "BuyerProfile should preserve exclusions");
    assert.equal(profile.allowedMakes, undefined);
  });

  await check("conversation revision clears stale exclusion state", async () => {
    const initial = await createSemanticConversationIntakeSession("No Toyota.", service);
    const initialDraft = createConfirmedPreferenceProfile(initial, defaults);
    const revised = await answerConversationQuestionWithSemantic(
      prepareConversationRevisionSession(initial, defaults),
      "Actually Toyota is okay.",
      service,
    );
    const revisedDraft = carryForwardConfirmedPreferenceDraft(
      createConfirmedPreferenceProfile(revised, defaults),
      initialDraft,
    );
    expectSet(revisedDraft.confirmedUpdates.allowedMakes, ["Toyota"], "revision should permit Toyota");
    assert.equal(revisedDraft.confirmedUpdates.excludedMakes, undefined);
    assert.equal(revised.unresolvedConflicts.length, 0, "resolved polarity revision must not retain a stale conflict");
  });

  await check("candidate qualification enforces make exclusions", async () => {
    const { profile } = await profileFor("No Subaru, Toyota, or Honda.");
    const result = runCandidatePipeline(profile, catalog, { includeCompromises: true, includeExcluded: true });
    const active = [...result.decisionSet.primaryRecommendations, ...result.decisionSet.compromiseRecommendations];
    assert.ok(active.length > 0);
    assert.ok(active.every((item) => !["Subaru", "Toyota", "Honda"].includes(item.vehicle.make)));
    assert.ok(result.decisionSet.excludedRecommendations.some((item) => ["Subaru", "Toyota", "Honda"].includes(item.vehicle.make)));
  });

  await check("unaffected vehicle ordering and scores remain unchanged", async () => {
    const before = runCandidatePipeline(defaults, catalog, { includeCompromises: true, includeExcluded: true });
    await mappingFor("No Toyota.");
    const after = runCandidatePipeline(defaults, catalog, { includeCompromises: true, includeExcluded: true });
    assert.deepEqual(
      after.rankedVehicles.map((item) => ({ id: item.id, score: item.score })),
      before.rankedVehicles.map((item) => ({ id: item.id, score: item.score })),
      "semantic polarity processing must not mutate ranking for an unchanged profile",
    );
  });

  assert.ok(passed.length >= 14);
  console.log(`Semantic polarity and exclusion semantics passed ${passed.length} scenarios.`);
  passed.forEach((name, index) => console.log(`PASS ${index + 1}: ${name}`));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
