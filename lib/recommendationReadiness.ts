import type { BuyerProfile } from "@/types/buyer";
import type { ConfirmedPreferenceItem, ConfirmedPreferenceProfile } from "./confirmedPreferenceProfile";
import type { ConfirmedProfileConversion, ProfileConversionEntry } from "./confirmedProfileConversion";
import type { BuyerProfilePatch } from "./preferenceInterpretation";
import {
  decisionPolicyDimensionLabel,
  policyIsPositiveCriterion,
  policyParticipationDisplay,
} from "./decisionParticipationPolicy";
import type { DecisionParticipationPolicyMap } from "@/types/decisionPolicy";

export type ActionableProfileAssessment = {
  ready: boolean;
  actionableFields: Array<keyof BuyerProfile>;
  actionableItems: Array<{
    field?: keyof BuyerProfile;
    label: string;
    displayValue: string;
    constraintStrength: string;
    source: "user_provided" | "manual_edit";
  }>;
  preservedContext: Array<{
    label: string;
    displayValue: string;
  }>;
  reasons: string[];
  clarificationQuestion: string;
};

const actionableFields = new Set<keyof BuyerProfilePatch>([
  "requiredMake",
  "preferredMake",
  "allowedMakes",
  "excludedMakes",
  "bodyStyle",
  "requiredFuelType",
  "drivetrainPreference",
  "familySize",
  "maxPurchaseBudget",
  "monthlyBudget",
  "minYear",
  "maxMileage",
  "transmissionPreference",
  "purchaseCondition",
  "reliabilityImportance",
  "safetyPriority",
  "performanceImportance",
  "cargoNeed",
  "climate",
  "fuelEconomyImportance",
  "resaleValueImportance",
  "advancedFeaturesImportance",
  "insuranceBudget",
  "expectedAnnualMileage",
  "reliabilityMinimum",
  "safetyMinimum",
  "performanceMinimum",
  "requiredMakes",
  "preferredMakes",
  "requiredBodyStyles",
  "preferredBodyStyles",
  "allowedBodyStyles",
  "excludedBodyStyles",
  "requiredVehicleCategories",
  "preferredVehicleCategories",
  "allowedVehicleCategories",
  "excludedVehicleCategories",
  "requiredFuelTypes",
  "preferredFuelTypes",
  "allowedFuelTypes",
  "excludedFuelTypes",
  "requiredDrivetrains",
  "preferredDrivetrains",
  "allowedDrivetrains",
  "excludedDrivetrains",
  "requiredTransmissions",
  "preferredTransmissions",
  "allowedTransmissions",
  "excludedTransmissions",
]);

export function assessConfirmedPreferenceDraftReadiness(draft: ConfirmedPreferenceProfile): ActionableProfileAssessment {
  const activeItems = draft.items.filter((item) => !draft.removedItemIds.includes(item.id));
  const actionableItems = activeItems
    .filter((item) => item.certainty === "confirmed")
    .filter((item) => item.recommendationSupport === "used_in_recommendation")
    .filter((item) => Boolean(item.field && actionableFields.has(item.field)))
    .filter((item) => item.certainty !== "assumed_default")
    .filter((item) => hasMaterialValue(item));
  const preservedContext = activeItems
    .filter((item) => item.recommendationSupport === "understood_not_ranked")
    .map((item) => ({ label: item.label, displayValue: item.displayValue }));

  return buildAssessment(
    [
      ...actionableItems.map((item) => ({
      field: item.field as keyof BuyerProfile,
      label: item.label,
      displayValue: item.displayValue,
      constraintStrength: item.constraintStrength,
      source: "user_provided" as const,
      })),
      ...policyActionableItems(draft.decisionPolicies),
    ],
    preservedContext,
  );
}

export function assessConfirmedProfileConversionReadiness(
  conversion: ConfirmedProfileConversion | null | undefined,
): ActionableProfileAssessment {
  if (!conversion) {
    return buildAssessment([], [], ["No confirmed profile conversion exists for the current search."]);
  }

  const entries = [...conversion.appliedHardConstraints, ...conversion.appliedSoftPreferences]
    .filter((entry) => Boolean(entry.field && actionableFields.has(entry.field as keyof BuyerProfilePatch)))
    .filter(hasMaterialEntryValue)
    .map((entry) => toActionableItem(entry));
  const preservedContext = conversion.preservedSemanticPreferences.map((entry) => ({
    label: entry.label,
    displayValue: entry.displayValue,
  }));

  return buildAssessment(
    [...entries, ...policyActionableItems(conversion.buyerProfile.decisionPolicies)],
    preservedContext,
  );
}

export function assessManualProfileReadiness(profile: BuyerProfile, changedFields: Array<keyof BuyerProfile> = []): ActionableProfileAssessment {
  const entries = changedFields
    .filter((field) => actionableFields.has(field as keyof BuyerProfilePatch))
    .flatMap((field) => {
      const value = profile[field];
      if (value === undefined || value === "" || value === "any" || value === "not-sure") return [];
      return [{
        field,
        label: String(field),
        displayValue: Array.isArray(value) ? value.join(", ") : String(value),
        constraintStrength: "manual",
        source: "manual_edit" as const,
      }];
    });
  return buildAssessment(entries, []);
}

function buildAssessment(
  actionableItems: ActionableProfileAssessment["actionableItems"],
  preservedContext: ActionableProfileAssessment["preservedContext"],
  extraReasons: string[] = [],
): ActionableProfileAssessment {
  const actionableFields = Array.from(new Set(actionableItems.flatMap((item) => item.field ? [item.field] : [])));
  const reasons = [...extraReasons];
  if (actionableItems.length) {
    reasons.push(`User-provided actionable fields: ${actionableItems.map((item) => item.label).join(", ")}.`);
  } else if (preservedContext.length) {
    reasons.push("The request is understood as advisor context, but none of it maps to a supported search field yet.");
  } else {
    reasons.push("The request does not yet contain a supported make, body style, budget, drivetrain, fuel type, seating, or scoreable priority.");
  }

  return {
    ready: actionableItems.length > 0,
    actionableFields,
    actionableItems,
    preservedContext,
    reasons,
    clarificationQuestion: actionableItems.length ? "" : getClarificationQuestion(preservedContext),
  };
}

function toActionableItem(entry: ProfileConversionEntry): ActionableProfileAssessment["actionableItems"][number] {
  return {
    field: entry.field,
    label: entry.label,
    displayValue: entry.displayValue,
    constraintStrength: entry.constraintStrength,
    source: "user_provided",
  };
}

function hasMaterialValue(item: ConfirmedPreferenceItem) {
  if (!item.field) return false;
  if (item.value === undefined || item.value === "" || item.value === "any" || item.value === "not-sure") return false;
  if (Array.isArray(item.value)) return item.value.length > 0;
  if (typeof item.value === "number") return Number.isFinite(item.value);
  return true;
}

function hasMaterialEntryValue(entry: ProfileConversionEntry) {
  if (entry.value === undefined || entry.value === "" || entry.value === "any" || entry.value === "not-sure") return false;
  if (Array.isArray(entry.value)) return entry.value.length > 0;
  if (typeof entry.value === "number") return Number.isFinite(entry.value);
  return true;
}

function getClarificationQuestion(preservedContext: ActionableProfileAssessment["preservedContext"]) {
  const text = preservedContext.map((item) => `${item.label} ${item.displayValue}`).join(" ").toLowerCase();
  if (/camping/.test(text)) {
    return "What matters most for your camping trips: extra cargo room, rough-road/AWD capability, sleeping space, or towing?";
  }
  if (/premium|image|luxury|expensive|successful/.test(text)) {
    return "Since I cannot directly score appearance yet, should I narrow the search by a premium brand, a sedan/SUV body style, or a specific budget?";
  }
  return "I need one supported detail before I look for cars: budget, make, body style, drivetrain, fuel type, seating, or the priority that matters most.";
}

function policyActionableItems(
  policies: DecisionParticipationPolicyMap | undefined,
): ActionableProfileAssessment["actionableItems"] {
  return Object.values(policies || {}).flatMap((policy) => {
    if (!policy || !policyIsPositiveCriterion(policy)) return [];
    if (["purchaseBudget", "monthlyPayment", "totalOwnershipBudget"].includes(policy.dimension)) return [];
    return [{
      label: decisionPolicyDimensionLabel(policy.dimension),
      displayValue: policyParticipationDisplay(policy.dimension, policy.participation),
      constraintStrength: policy.participation,
      source: "user_provided" as const,
    }];
  });
}
