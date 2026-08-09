import assert from "node:assert/strict";
import {
  answerConversationQuestionWithSemantic,
  createDeterministicSemanticConversationIntakeSession,
  createSemanticConversationIntakeSession,
} from "../lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { defaultScoreWeights } from "../lib/recommendations";
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

const provider = new DeterministicSemanticUnderstandingProvider();
const service = createSemanticUnderstandingService({
  providerMode: "deterministic",
  providers: { deterministic: provider },
});

const defaults: BuyerProfile = {
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

async function trace(input: string, messageRef = "turn-1") {
  const understanding = await understandAndValidate(provider, {
    currentMessage: input,
    conversationHistory: [{ id: messageRef, role: "user", text: input }],
  });
  return mapValidatedUnderstandingToProfile(understanding);
}

async function main() {
  const cases = [
    ["Toyota", "uncertain", undefined],
    ["I want a Toyota", "required", "requiredMakes"],
    ["I only want Toyota", "required", "requiredMakes"],
    ["Maybe Toyota", "preferred", "preferredMakes"],
    ["I prefer Toyota", "preferred", "preferredMakes"],
    ["Toyota is okay", "allowed", "allowedMakes"],
    ["No Toyota", "excluded", "excludedMakes"],
    ["Anything except Toyota", "excluded", "excludedMakes"],
  ] as const;

  for (const [input, expectedIntent, expectedDestination] of cases) {
    const result = await trace(input);
    const toyota = result.concepts.find((item) => item.conceptType === "vehicle_make" && item.value === "Toyota");
    assert.ok(toyota, `${input} should preserve Toyota`);
    assert.equal(toyota.intent, expectedIntent, `${input} intent`);
    assert.equal(toyota.destination, expectedDestination, `${input} destination`);
    if (expectedIntent === "excluded") {
      assert.deepEqual(result.profilePatch.excludedMakes, ["Toyota"]);
      assert.equal(result.profilePatch.requiredMake, undefined);
      assert.equal(result.profilePatch.preferredMake, undefined);
      assert.equal(result.profilePatch.allowedMakes, undefined);
    }
    if (expectedIntent === "uncertain") {
      assert.equal(result.profilePatch.requiredMake, undefined);
      assert.equal(result.profilePatch.preferredMake, undefined);
      assert.equal(result.clarificationConcepts.some((item) => item.id === toyota.id), true);
    }
  }

  const cadillacUnderstanding = await understandAndValidate(provider, {
    currentMessage: "I only want Cadillac",
    conversationHistory: [{ id: "turn-1", role: "user", text: "I only want Cadillac" }],
  });
  const cadillacInterpretation = cadillacUnderstanding.draft.recognizedEntities[0]
    || cadillacUnderstanding.draft.explicitPreferences[0];
  assert.ok(cadillacInterpretation);
  const duplicateMakeUnderstanding = {
    ...cadillacUnderstanding,
    draft: {
      ...cadillacUnderstanding.draft,
      explicitPreferences: [
        cadillacInterpretation,
        {
          ...cadillacInterpretation,
          id: "unsupported-required-makes",
          proposedValue: ["Cadillac", "Toyota", "Honda", "not Cadillac"],
        },
      ],
    },
  };
  const evidenceConstrainedCadillac = mapValidatedUnderstandingToProfile(duplicateMakeUnderstanding);
  assert.equal(evidenceConstrainedCadillac.profilePatch.requiredMake, "Cadillac");
  assert.equal(evidenceConstrainedCadillac.concepts.some((item) => item.value === "Toyota"), false);
  assert.equal(evidenceConstrainedCadillac.concepts.some((item) => item.value === "Honda"), false);
  assert.equal(evidenceConstrainedCadillac.profilePatch.requiredMakes?.includes("not Cadillac"), false);

  const relationshipUnderstanding = await understandAndValidate(provider, {
    currentMessage: "Truck preferred, SUV acceptable, no sedans",
    conversationHistory: [{
      id: "turn-1",
      role: "user",
      text: "Truck preferred, SUV acceptable, no sedans",
    }],
  });
  const wrongModelRelationship = {
    ...relationshipUnderstanding,
    draft: {
      ...relationshipUnderstanding.draft,
      explicitPreferences: relationshipUnderstanding.draft.explicitPreferences.map((item) =>
        String(item.proposedValue).toLowerCase() === "suv"
          ? {
              ...item,
              intent: "required" as const,
              proposedConstraintStrength: "required" as const,
            }
          : item
      ),
    },
  };
  const reconciledRelationship = mapValidatedUnderstandingToProfile(wrongModelRelationship);
  assert.deepEqual(reconciledRelationship.profilePatch.preferredBodyStyles, ["truck"]);
  assert.deepEqual(reconciledRelationship.profilePatch.allowedBodyStyles, ["suv"]);
  assert.deepEqual(reconciledRelationship.profilePatch.excludedBodyStyles, ["sedan"]);

  const noManualUnderstanding = await understandAndValidate(provider, {
    currentMessage: "No manual transmission",
    conversationHistory: [{
      id: "turn-1",
      role: "user",
      text: "No manual transmission",
    }],
  });
  const manualInterpretation = [
    ...noManualUnderstanding.draft.explicitPreferences,
    ...noManualUnderstanding.draft.aversions,
    ...noManualUnderstanding.draft.constraints,
  ].find((item) => item.concept === "transmission");
  assert.ok(manualInterpretation);
  const unsupportedAutomaticUnderstanding = {
    ...noManualUnderstanding,
    draft: {
      ...noManualUnderstanding.draft,
      explicitPreferences: [
        ...noManualUnderstanding.draft.explicitPreferences,
        {
          ...manualInterpretation,
          id: "unsupported-automatic-exclusion",
          proposedValue: "automatic",
          sourceText: "No manual transmission",
          intent: "excluded" as const,
        },
      ],
    },
  };
  const evidenceConstrainedTransmission = mapValidatedUnderstandingToProfile(
    unsupportedAutomaticUnderstanding,
  );
  assert.deepEqual(evidenceConstrainedTransmission.profilePatch.excludedTransmissions, ["manual"]);

  const toyotaRequired = await trace("I only want Toyota", "turn-1");
  const cadillacRequired = await trace("I only want Cadillac", "turn-2");
  const hondaRequired = await trace("I only want Honda", "turn-3");
  assert.equal(buildProfilePatch(mergeCanonicalConcepts(toyotaRequired.concepts, cadillacRequired.concepts)).requiredMake, "Cadillac");
  assert.equal(buildProfilePatch(mergeCanonicalConcepts(cadillacRequired.concepts, hondaRequired.concepts)).requiredMake, "Honda");

  let sequentialSession = await createSemanticConversationIntakeSession("I only want Toyota", service);
  sequentialSession = await answerConversationQuestionWithSemantic(sequentialSession, "I only want Cadillac", service);
  assert.equal(sequentialSession.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Cadillac");
  sequentialSession = await answerConversationQuestionWithSemantic(sequentialSession, "I only want Honda", service);
  assert.equal(sequentialSession.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Honda");
  sequentialSession = await answerConversationQuestionWithSemantic(sequentialSession, "I only want Lexus", service);
  assert.equal(sequentialSession.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Lexus");

  for (const make of ["Toyota", "Cadillac", "Honda", "Lexus"]) {
    const isolated = await trace(`I only want ${make}`);
    assert.equal(isolated.profilePatch.requiredMake, make, `${make} should not inherit make state from a fresh session`);
  }

  for (let run = 0; run < 5; run += 1) {
    const repeated = await trace("I only want Cadillac", `turn-${run + 1}`);
    assert.equal(repeated.profilePatch.requiredMake, "Cadillac");
  }

  const cadillacSession = await createSemanticConversationIntakeSession("I only want Cadillac", service);
  const cadillacConversion = convertConfirmedPreferencesToBuyerProfile(
    { ...defaults, preferredMake: "Cadillac", allowedMakes: ["Cadillac"], excludedMakes: ["Cadillac"] },
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(cadillacSession, defaults), 99),
  );
  assert.equal(cadillacConversion.buyerProfile.requiredMake, "Cadillac");
  assert.equal(cadillacConversion.buyerProfile.preferredMake, undefined);
  assert.equal(Boolean(cadillacConversion.buyerProfile.allowedMakes?.includes("Cadillac")), false);
  assert.equal(Boolean(cadillacConversion.buyerProfile.excludedMakes?.includes("Cadillac")), false);

  const noCadillacSession = await createSemanticConversationIntakeSession("No Cadillac", service);
  const noCadillacConversion = convertConfirmedPreferencesToBuyerProfile(
    { ...defaults, requiredMake: "Cadillac", preferredMake: "Cadillac", allowedMakes: ["Cadillac"] },
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(noCadillacSession, defaults), 99),
  );
  assert.equal(noCadillacConversion.buyerProfile.requiredMake, undefined);
  assert.equal(noCadillacConversion.buyerProfile.preferredMake, undefined);
  assert.equal(Boolean(noCadillacConversion.buyerProfile.allowedMakes?.includes("Cadillac")), false);
  assert.deepEqual(noCadillacConversion.buyerProfile.excludedMakes, ["Cadillac"]);

  const allowedSet = await trace("Toyota or Honda");
  assert.deepEqual(allowedSet.profilePatch.allowedMakes?.sort(), ["Honda", "Toyota"]);
  assert.equal(allowedSet.profilePatch.requiredMake, undefined);

  const preferredWithFallback = await trace("Toyota preferred, but Honda is okay");
  assert.equal(preferredWithFallback.profilePatch.preferredMake, "Toyota");
  assert.deepEqual(preferredWithFallback.profilePatch.allowedMakes, ["Honda"]);

  const mixed = await trace("I said no Toyota, but Lexus is fine");
  assert.deepEqual(mixed.profilePatch.excludedMakes, ["Toyota"]);
  assert.deepEqual(mixed.profilePatch.allowedMakes, ["Lexus"]);

  const noToyotaSession = await createSemanticConversationIntakeSession("No Toyota", service);
  const noToyotaDraft = createConfirmedPreferenceProfile(noToyotaSession, defaults);
  const excludedItem = noToyotaDraft.items.find((item) => item.field === "excludedMakes");
  assert.equal(excludedItem?.canonicalIntent, "excluded");
  assert.equal(excludedItem?.constraintStrength, "required");
  const renamedDraft = {
    ...noToyotaDraft,
    items: noToyotaDraft.items.map((item) => item.id === excludedItem?.id ? { ...item, label: "A deliberately misleading label" } : item),
  };
  const noToyotaProfile = convertConfirmedPreferencesToBuyerProfile(
    defaults,
    approveConfirmedPreferenceProfile(renamedDraft, 99),
  ).buyerProfile;
  assert.deepEqual(noToyotaProfile.excludedMakes, ["Toyota"]);
  assert.equal(noToyotaProfile.requiredMake, undefined, "UI labels must not determine mapping");

  const clientFallbackNoToyota = createDeterministicSemanticConversationIntakeSession("No Toyota");
  assert.deepEqual(clientFallbackNoToyota.accumulatedInterpretation.suggestedProfileUpdates.excludedMakes, ["Toyota"]);
  assert.equal(clientFallbackNoToyota.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
  const clientFallbackBareToyota = createDeterministicSemanticConversationIntakeSession("Toyota");
  assert.equal(clientFallbackBareToyota.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
  assert.equal(clientFallbackBareToyota.currentQuestion?.id, "make_flexibility");

  const preferenceSession = await createSemanticConversationIntakeSession("I want Toyota", service);
  const revisedSession = await answerConversationQuestionWithSemantic(preferenceSession, "Actually, no Toyota.", service);
  assert.equal(revisedSession.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
  assert.equal(revisedSession.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, undefined);
  assert.equal(revisedSession.accumulatedInterpretation.suggestedProfileUpdates.allowedMakes, undefined);
  assert.deepEqual(revisedSession.accumulatedInterpretation.suggestedProfileUpdates.excludedMakes, ["Toyota"]);

  const suvRequired = await trace("I want an SUV", "turn-1");
  const sedanAllowed = await trace("A sedan is okay too", "turn-2");
  const suvWithFallback = mergeCanonicalConcepts(suvRequired.concepts, sedanAllowed.concepts);
  assert.equal(buildProfilePatch(suvWithFallback).bodyStyle, "suv");
  assert.ok(suvWithFallback.some((item) => item.conceptType === "body_style" && item.value === "sedan" && item.intent === "allowed"));

  const awdRequired = await trace("I need AWD", "turn-1");
  const awdRelaxed = await trace("Actually, AWD is not required", "turn-2");
  const relaxedAwd = mergeCanonicalConcepts(awdRequired.concepts, awdRelaxed.concepts);
  const relaxedAwdPatch = buildProfilePatch(relaxedAwd);
  assert.equal(relaxedAwd.find((item) => item.conceptType === "drivetrain")?.intent, "uncertain");
  assert.equal(relaxedAwdPatch.requiredDrivetrains, undefined);
  assert.equal(relaxedAwdPatch.drivetrainPreference, undefined);

  const suv = await trace("I want an SUV");
  assert.equal(suv.concepts.find((item) => item.conceptType === "body_style")?.intent, "required");
  assert.equal(suv.profilePatch.bodyStyle, "suv");
  const maybeSuv = await trace("Maybe an SUV");
  assert.equal(maybeSuv.concepts.find((item) => item.conceptType === "body_style")?.intent, "preferred");
  assert.deepEqual(maybeSuv.profilePatch.preferredBodyStyles, ["suv"]);
  assert.equal(maybeSuv.profilePatch.bodyStyle, undefined);
  const noSuv = await trace("No SUV");
  assert.equal(noSuv.concepts.find((item) => item.conceptType === "body_style")?.intent, "excluded");
  assert.equal(noSuv.profilePatch.bodyStyle, undefined);

  const hybrid = await trace("I need a hybrid");
  assert.equal(hybrid.profilePatch.requiredFuelType, "hybrid");
  const maybeHybrid = await trace("Maybe a hybrid");
  assert.equal(maybeHybrid.concepts.find((item) => item.conceptType === "fuel_type")?.intent, "preferred");
  assert.equal(maybeHybrid.profilePatch.requiredFuelType, undefined);

  for (const input of ["looks expensive", "classy", "comfortable", "quiet", "good for camping", "feels successful"]) {
    const result = await trace(input);
    assert.ok(result.preservedConcepts.length > 0, `${input} should be preserved`);
    assert.equal(Object.keys(result.profilePatch).length, 0, `${input} must not invent a scored profile field`);
    assert.ok(result.preservedConcepts.every((item) => item.supportStatus !== "supported_and_used"));
  }

  for (const input of ["motorcycle", "RV", "ATV", "electric scooter", "boat"]) {
    const result = await trace(input);
    assert.ok(result.concepts.some((item) => item.supportStatus === "recognized_out_of_scope"), `${input} should be out of scope`);
    assert.equal(Object.keys(result.profilePatch).length, 0);
  }

  const explicitExclusion = await trace("No Toyota");
  const conflictingPatch = buildProfilePatch([
    ...explicitExclusion.concepts,
    {
      ...explicitExclusion.concepts[0],
      id: "default-required-toyota",
      intent: "required",
      destination: "requiredMake",
      messageRef: "turn-0",
    },
  ]);
  assert.deepEqual(conflictingPatch.excludedMakes, ["Toyota"]);
  assert.equal(conflictingPatch.requiredMake, undefined, "defaults cannot overwrite an explicit exclusion");

  console.log("Authoritative semantic mapping contract passed.");
  console.table(cases.map(([input, intent, destination]) => ({ input, intent, destination: destination || "clarification" })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
