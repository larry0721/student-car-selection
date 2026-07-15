import type { BuyerProfile } from "@/types/buyer";
import type { ConfirmedPreferenceItem, ConfirmedPreferenceProfile, ConstraintStrength } from "./confirmedPreferenceProfile";
import type { BuyerProfilePatch } from "./preferenceInterpretation";

export type ProfileConversionEntry = {
  field?: keyof BuyerProfile;
  label: string;
  value: string | number | boolean;
  displayValue: string;
  constraintStrength: ConstraintStrength;
  sourceItemId: string;
};

export type ConfirmedProfileConversion = {
  buyerProfile: BuyerProfile;
  appliedUpdates: Partial<BuyerProfile>;
  appliedHardConstraints: ProfileConversionEntry[];
  appliedSoftPreferences: ProfileConversionEntry[];
  preservedDefaults: ProfileConversionEntry[];
  unresolvedFields: ProfileConversionEntry[];
  disclosedAssumptions: string[];
  conversionWarnings: string[];
  mappingLimitations: string[];
};

const hardOnlyFields = new Set<keyof BuyerProfilePatch>([
  "maxPurchaseBudget",
  "purchaseCondition",
  "bodyStyle",
  "drivetrainPreference",
  "transmissionPreference",
  "maxMileage",
  "minYear",
  "familySize",
  "requiredFuelType",
  "reliabilityMinimum",
  "safetyMinimum",
  "performanceMinimum",
]);

const softPreferenceFields = new Set<keyof BuyerProfilePatch>([
  "preferredMake",
  "paymentMethod",
  "expectedAnnualMileage",
  "fuelPrice",
  "insuranceBudget",
  "minMpg",
  "fuelEconomyImportance",
  "reliabilityImportance",
  "performanceImportance",
  "cargoNeed",
  "climate",
  "resaleValueImportance",
  "modificationPlans",
  "advancedFeaturesImportance",
  "safetyPriority",
  "allowCompromises",
]);

const buyerProfileFields = new Set<keyof BuyerProfile>([
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
  "scoreWeights",
  "requiredMake",
  "preferredMake",
  "requiredFuelType",
  "reliabilityMinimum",
  "safetyMinimum",
  "performanceMinimum",
  "flexibleConstraints",
  "allowCompromises",
]);

export function convertConfirmedPreferencesToBuyerProfile(
  currentProfile: BuyerProfile,
  approvedProfile: ConfirmedPreferenceProfile,
): ConfirmedProfileConversion {
  const buyerProfile: BuyerProfile = { ...currentProfile, scoreWeights: { ...currentProfile.scoreWeights } };
  const appliedUpdates: Partial<BuyerProfile> = {};
  const appliedHardConstraints: ProfileConversionEntry[] = [];
  const appliedSoftPreferences: ProfileConversionEntry[] = [];
  const preservedDefaults: ProfileConversionEntry[] = [];
  const unresolvedFields: ProfileConversionEntry[] = [];
  const conversionWarnings: string[] = [];
  const mappingLimitations: string[] = [];

  if (!approvedProfile.userApproved) {
    conversionWarnings.push("The confirmed profile was not user-approved, so no conversational updates were applied.");
    return {
      buyerProfile,
      appliedUpdates,
      appliedHardConstraints,
      appliedSoftPreferences,
      preservedDefaults: getMaterialDefaultDisclosures(currentProfile, []),
      unresolvedFields,
      disclosedAssumptions: getMaterialDefaultDisclosures(currentProfile, []).map((item) => `${item.label}: ${item.displayValue}`),
      conversionWarnings,
      mappingLimitations,
    };
  }

  const confirmedItems = approvedProfile.items.filter((item) => item.certainty === "confirmed");
  const assumedDefaultItems = approvedProfile.items.filter((item) => item.certainty === "assumed_default");

  approvedProfile.unresolvedFields.forEach((item) => unresolvedFields.push(toEntry(item)));

  confirmedItems.forEach((item) => {
    const field = item.field;
    if (!field) {
      mappingLimitations.push(`${item.label} is preserved as advisor context because BuyerProfile has no matching field.`);
      return;
    }

    if (approvedProfile.removedItemIds.includes(item.id)) return;

    if (field === "preferredMake" || field === "requiredMake") {
      applyMakePreference(buyerProfile, appliedUpdates, appliedHardConstraints, appliedSoftPreferences, item);
      return;
    }

    if (field === "monthlyBudget") {
      applyFieldIfRequired(buyerProfile, appliedUpdates, appliedHardConstraints, mappingLimitations, item, "Monthly payment limit");
      return;
    }

    if (hardOnlyFields.has(field)) {
      applyFieldIfRequired(buyerProfile, appliedUpdates, appliedHardConstraints, mappingLimitations, item, item.label);
      return;
    }

    if (softPreferenceFields.has(field)) {
      applyBuyerProfileField(buyerProfile, appliedUpdates, item, field);
      appliedSoftPreferences.push(toEntry(item, field));
      return;
    }

    mappingLimitations.push(`${item.label} is confirmed but not mapped because BuyerProfile does not currently support ${String(field)}.`);
  });

  const materialDefaults = getMaterialDefaultDisclosures(buyerProfile, assumedDefaultItems);
  preservedDefaults.push(...materialDefaults);

  return {
    buyerProfile,
    appliedUpdates,
    appliedHardConstraints,
    appliedSoftPreferences,
    preservedDefaults,
    unresolvedFields,
    disclosedAssumptions: materialDefaults.map((item) => `${item.label}: ${item.displayValue}`),
    conversionWarnings,
    mappingLimitations,
  };
}

function applyMakePreference(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  appliedHardConstraints: ProfileConversionEntry[],
  appliedSoftPreferences: ProfileConversionEntry[],
  item: ConfirmedPreferenceItem,
) {
  const make = String(item.value).trim();
  if (!make) return;

  if (item.constraintStrength === "required" || item.field === "requiredMake") {
    buyerProfile.requiredMake = make;
    buyerProfile.preferredMake = undefined;
    appliedUpdates.requiredMake = make;
    appliedUpdates.preferredMake = undefined;
    appliedHardConstraints.push(toEntry(item, "requiredMake", make, make));
    return;
  }

  buyerProfile.preferredMake = make;
  buyerProfile.requiredMake = undefined;
  appliedUpdates.preferredMake = make;
  appliedUpdates.requiredMake = undefined;
  appliedSoftPreferences.push(toEntry(item, "preferredMake", make, make));
}

function applyFieldIfRequired(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  appliedHardConstraints: ProfileConversionEntry[],
  mappingLimitations: string[],
  item: ConfirmedPreferenceItem,
  label: string,
) {
  if (!item.field || !buyerProfileFields.has(item.field as keyof BuyerProfile)) return;
  if (item.constraintStrength !== "required") {
    mappingLimitations.push(`${label} was ${item.constraintStrength}, but the current engine treats ${label.toLowerCase()} as a hard filter when applied.`);
    return;
  }

  applyBuyerProfileField(buyerProfile, appliedUpdates, item, item.field);
  appliedHardConstraints.push(toEntry(item, item.field as keyof BuyerProfile));
}

function applyBuyerProfileField(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  item: ConfirmedPreferenceItem,
  field: keyof BuyerProfilePatch,
) {
  if (!buyerProfileFields.has(field as keyof BuyerProfile)) return;
  const typedField = field as keyof BuyerProfile;
  const value = normalizeValueForField(field, item.value);
  (buyerProfile as unknown as Record<string, unknown>)[typedField] = value;
  (appliedUpdates as unknown as Record<string, unknown>)[typedField] = value;
}

function normalizeValueForField(field: keyof BuyerProfilePatch, value: string | number | boolean) {
  if (
    [
      "maxPurchaseBudget",
      "monthlyBudget",
      "downPayment",
      "loanTermMonths",
      "apr",
      "expectedAnnualMileage",
      "fuelPrice",
      "insuranceBudget",
      "minYear",
      "maxMileage",
      "minMpg",
      "fuelEconomyImportance",
      "reliabilityImportance",
      "performanceImportance",
      "familySize",
      "resaleValueImportance",
      "advancedFeaturesImportance",
      "reliabilityMinimum",
      "safetyMinimum",
      "performanceMinimum",
    ].includes(field)
  ) {
    return Number(value);
  }
  return value;
}

function getMaterialDefaultDisclosures(profile: BuyerProfile, assumedDefaultItems: ConfirmedPreferenceItem[]) {
  const entries: ProfileConversionEntry[] = [];
  const assumedByField = new Map(assumedDefaultItems.filter((item) => item.field).map((item) => [item.field, item]));

  addDefault(entries, assumedByField.get("expectedAnnualMileage"), "Annual mileage", `${profile.expectedAnnualMileage.toLocaleString()} miles/year`, "expectedAnnualMileage");
  addDefault(entries, assumedByField.get("maxPurchaseBudget"), "Purchase budget", `$${profile.maxPurchaseBudget.toLocaleString()}`, "maxPurchaseBudget");
  addDefault(entries, undefined, "Insurance target", `${formatMoney(profile.insuranceBudget)}/mo`, "insuranceBudget");
  addDefault(entries, undefined, "Fuel price", `${formatMoney(profile.fuelPrice)}/gal`, "fuelPrice");
  addDefault(entries, undefined, "Financing assumptions", `${profile.loanTermMonths} months, ${profile.apr}% APR, ${formatMoney(profile.downPayment)} down`, "loanTermMonths");
  if (profile.purchaseCondition === "any") {
    addDefault(entries, undefined, "Purchase condition", "new or used", "purchaseCondition");
  }

  return entries;
}

function addDefault(
  entries: ProfileConversionEntry[],
  item: ConfirmedPreferenceItem | undefined,
  label: string,
  displayValue: string,
  field: keyof BuyerProfile,
) {
  entries.push({
    field,
    label,
    value: item?.value ?? displayValue,
    displayValue: item?.displayValue ?? displayValue,
    constraintStrength: item?.constraintStrength ?? "flexible",
    sourceItemId: item?.id ?? `default:${String(field)}`,
  });
}

function toEntry(
  item: ConfirmedPreferenceItem,
  field: keyof BuyerProfile | undefined = item.field as keyof BuyerProfile | undefined,
  value: string | number | boolean = item.value,
  displayValue: string = item.displayValue,
): ProfileConversionEntry {
  return {
    field,
    label: item.label,
    value,
    displayValue,
    constraintStrength: item.constraintStrength,
    sourceItemId: item.id,
  };
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}
