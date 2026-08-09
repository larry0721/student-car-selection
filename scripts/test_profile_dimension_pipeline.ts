import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { getProfileDimensionState } from "../lib/profileDimensions";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import {
  DeterministicSemanticUnderstandingProvider,
  understandAndValidate,
} from "../lib/semanticUnderstanding";
import { mapValidatedUnderstandingToProfile } from "../lib/semanticMapping";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import { createSemanticConversationIntakeSession } from "../lib/conversationIntake";
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

async function mappingFor(input: string) {
  const understanding = await understandAndValidate(provider, {
    currentMessage: input,
    conversationHistory: [{ id: "turn-1", role: "user", text: input }],
  });
  return mapValidatedUnderstandingToProfile(understanding);
}

async function buyerProfileFor(input: string) {
  const session = await createSemanticConversationIntakeSession(input, service);
  const confirmation = approveConfirmedPreferenceProfile(
    createConfirmedPreferenceProfile(session, baseProfile),
    99,
  );
  return convertConfirmedPreferencesToBuyerProfile(baseProfile, confirmation).buyerProfile;
}

function returnedVehicles(profile: BuyerProfile) {
  const result = runCandidatePipeline(profile, catalog, {
    includeCompromises: true,
    includeExcluded: true,
  });
  return {
    result,
    active: [...result.decisionSet.primaryRecommendations, ...result.decisionSet.compromiseRecommendations],
  };
}

async function main() {
  const semanticCases: Array<{
    input: string;
    field: keyof Omit<BuyerProfile, "scoreWeights">;
    value: string[];
  }> = [
    { input: "No SUVs", field: "excludedBodyStyles", value: ["suv"] },
    { input: "Maybe a truck", field: "preferredBodyStyles", value: ["truck"] },
    { input: "A sedan is okay", field: "allowedBodyStyles", value: ["sedan"] },
    { input: "Hybrid or electric is okay", field: "allowedFuelTypes", value: ["hybrid", "electric"] },
    { input: "No diesel", field: "excludedFuelTypes", value: ["diesel"] },
    { input: "I only want AWD", field: "requiredDrivetrains", value: ["AWD"] },
    { input: "Manual is okay", field: "allowedTransmissions", value: ["manual"] },
    { input: "No manual transmission", field: "excludedTransmissions", value: ["manual"] },
    { input: "SUV preferred, but a wagon is okay", field: "preferredBodyStyles", value: ["suv"] },
    { input: "Hybrid required, electric is acceptable", field: "requiredFuelTypes", value: ["hybrid"] },
    { input: "AWD or 4WD is okay", field: "allowedDrivetrains", value: ["AWD", "4WD"] },
    { input: "Automatic only", field: "requiredTransmissions", value: ["automatic"] },
    { input: "No CVT", field: "excludedTransmissions", value: ["cvt"] },
    { input: "Truck preferred, SUV acceptable, no sedans", field: "preferredBodyStyles", value: ["truck"] },
  ];

  for (const testCase of semanticCases) {
    const mapping = await mappingFor(testCase.input);
    const actual = mapping.profilePatch[testCase.field];
    assert.deepEqual(actual, testCase.value, `${testCase.input} should project ${testCase.field}`);
    const profile = await buyerProfileFor(testCase.input);
    assert.deepEqual(profile[testCase.field], testCase.value, `${testCase.input} should survive confirmation`);
  }

  const hybridElectric = await mappingFor("Hybrid or electric is okay");
  assert.deepEqual(hybridElectric.profilePatch.allowedFuelTypes, ["hybrid", "electric"]);
  const hybridRequiredElectricAllowed = await mappingFor("Hybrid required, electric is acceptable");
  assert.deepEqual(hybridRequiredElectricAllowed.profilePatch.requiredFuelTypes, ["hybrid"]);
  assert.deepEqual(hybridRequiredElectricAllowed.profilePatch.allowedFuelTypes, ["electric"]);

  const noSuvProfile = await buyerProfileFor("No SUVs");
  const noSuv = returnedVehicles(noSuvProfile);
  assert.ok(noSuv.active.every((recommendation) => recommendation.vehicle.bodyType !== "suv"));
  assert.ok(noSuv.result.decisionSet.excludedRecommendations.some((recommendation) =>
    recommendation.vehicle.bodyType === "suv" && recommendation.hardConstraintResults.some((constraint) => !constraint.passed),
  ));

  const allowedSedanProfile = await buyerProfileFor("A sedan is okay");
  const allowedSedan = returnedVehicles(allowedSedanProfile);
  assert.ok(allowedSedan.active.some((recommendation) => recommendation.vehicle.bodyType === "sedan"));
  assert.ok(allowedSedan.active.some((recommendation) => recommendation.vehicle.bodyType !== "sedan"), "An allowed body style alone must not exclude other body styles");

  const hybridElectricProfile = await buyerProfileFor("Hybrid or electric is okay");
  const hybridElectricResult = returnedVehicles(hybridElectricProfile);
  assert.ok(hybridElectricResult.active.some((recommendation) => recommendation.vehicle.fuelType === "hybrid"));
  assert.ok(hybridElectricResult.active.some((recommendation) => recommendation.vehicle.fuelType === "gas"), "Allowed fuel types alone must not exclude other fuel types");

  const noDieselProfile = await buyerProfileFor("No diesel");
  const noDiesel = returnedVehicles(noDieselProfile);
  assert.ok(noDiesel.active.every((recommendation) => recommendation.vehicle.fuelType !== "diesel"));
  if (catalog.some((vehicle) => vehicle.fuelType === "diesel")) {
    assert.ok(noDiesel.result.decisionSet.excludedRecommendations.some((recommendation) => recommendation.vehicle.fuelType === "diesel"));
  }

  const awdProfile = await buyerProfileFor("I only want AWD");
  const awd = returnedVehicles(awdProfile);
  assert.ok(awd.active.every((recommendation) => ["AWD", "4WD"].includes(recommendation.vehicle.drivetrain)));

  const manualAllowedProfile = await buyerProfileFor("Manual is okay");
  const manualAllowed = returnedVehicles(manualAllowedProfile);
  assert.ok(manualAllowed.active.some((recommendation) => recommendation.vehicle.transmission !== "manual"), "Manual allowed must not exclude automatics or CVTs");

  const noManualProfile = await buyerProfileFor("No manual transmission");
  const noManual = returnedVehicles(noManualProfile);
  assert.ok(noManual.active.every((recommendation) => recommendation.vehicle.transmission.toLowerCase() !== "manual"));

  const automaticOnlyProfile = await buyerProfileFor("Automatic only");
  const automaticOnly = returnedVehicles(automaticOnlyProfile);
  assert.ok(automaticOnly.active.every((recommendation) => recommendation.vehicle.transmission.toLowerCase() === "automatic"));

  const noCvtProfile = await buyerProfileFor("No CVT");
  const noCvt = returnedVehicles(noCvtProfile);
  assert.ok(noCvt.active.every((recommendation) => recommendation.vehicle.transmission.toLowerCase() !== "cvt"));

  const truckFallbackProfile = await buyerProfileFor("Truck preferred, SUV acceptable, no sedans");
  const truckFallback = returnedVehicles(truckFallbackProfile);
  assert.ok(
    truckFallback.active.every((recommendation) => ["truck", "suv"].includes(recommendation.vehicle.bodyType)),
    "A preferred body style plus explicit fallbacks must form the complete allowed universe",
  );
  assert.ok(
    truckFallback.result.decisionSet.excludedRecommendations.some((recommendation) =>
      !["truck", "suv"].includes(recommendation.vehicle.bodyType)
    ),
    "Unrelated body styles must be traceably excluded",
  );

  const closedUniverseCases: Array<{
    label: string;
    profile: BuyerProfile;
    accepted: (vehicle: Vehicle) => boolean;
  }> = [
    {
      label: "make",
      profile: { ...baseProfile, preferredMakes: ["Toyota"], allowedMakes: ["Honda"] },
      accepted: (vehicle) => ["Toyota", "Honda"].includes(vehicle.make),
    },
    {
      label: "vehicle category",
      profile: {
        ...baseProfile,
        preferredVehicleCategories: ["truck"],
        allowedVehicleCategories: ["suv"],
      },
      accepted: (vehicle) => ["truck", "suv"].includes(vehicle.bodyType),
    },
    {
      label: "fuel type",
      profile: {
        ...baseProfile,
        preferredFuelTypes: ["hybrid"],
        allowedFuelTypes: ["electric"],
      },
      accepted: (vehicle) => ["hybrid", "electric"].includes(vehicle.fuelType),
    },
    {
      label: "drivetrain",
      profile: {
        ...baseProfile,
        preferredDrivetrains: ["AWD"],
        allowedDrivetrains: ["FWD"],
      },
      accepted: (vehicle) => ["AWD", "4WD", "FWD"].includes(vehicle.drivetrain),
    },
    {
      label: "transmission",
      profile: {
        ...baseProfile,
        preferredTransmissions: ["automatic"],
        allowedTransmissions: ["manual"],
      },
      accepted: (vehicle) => ["automatic", "manual"].includes(vehicle.transmission),
    },
  ];
  for (const testCase of closedUniverseCases) {
    const outcome = returnedVehicles(testCase.profile);
    assert.ok(outcome.active.length > 0, `${testCase.label} closed universe needs candidates`);
    assert.ok(
      outcome.active.every((recommendation) => testCase.accepted(recommendation.vehicle)),
      `${testCase.label} must exclude values outside preferred plus explicitly allowed values`,
    );
  }

  const current = {
    ...baseProfile,
    requiredBodyStyles: ["suv" as const],
    bodyStyle: "sedan" as const,
  };
  assert.deepEqual(getProfileDimensionState(current, "bodyStyle").required, ["suv"], "Canonical state must win over contradictory legacy state");

  console.log("Multi-value profile projection and candidate filtering contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
