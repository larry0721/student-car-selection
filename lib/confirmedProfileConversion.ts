import type { BuyerProfile } from "@/types/buyer";
import type { ConfirmedPreferenceItem, ConfirmedPreferenceProfile, ConstraintStrength } from "./confirmedPreferenceProfile";
import type { BuyerProfilePatch } from "./preferenceInterpretation";
import {
  applyDimensionIntent,
  applyDimensionState,
  dimensionIntentForField,
  getProfileDimensionState,
  normalizeProfileDimensions,
  type ProfileDimension,
} from "./profileDimensions";
import {
  isDecisionDimensionDisabled,
  mergeDecisionParticipationPolicyMaps,
} from "./decisionParticipationPolicy";

export type ProfileConversionEntry = {
  field?: keyof BuyerProfile;
  label: string;
  value: string | number | boolean | string[];
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
  preservedSemanticPreferences: ProfileConversionEntry[];
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
  "allowedMakes",
  "excludedMakes",
  "requiredFuelType",
  "reliabilityMinimum",
  "safetyMinimum",
  "performanceMinimum",
  "requiredMakes",
  "requiredBodyStyles",
  "allowedBodyStyles",
  "excludedBodyStyles",
  "requiredVehicleCategories",
  "allowedVehicleCategories",
  "excludedVehicleCategories",
  "requiredFuelTypes",
  "allowedFuelTypes",
  "excludedFuelTypes",
  "requiredDrivetrains",
  "allowedDrivetrains",
  "excludedDrivetrains",
  "requiredTransmissions",
  "allowedTransmissions",
  "excludedTransmissions",
]);

const softPreferenceFields = new Set<keyof BuyerProfilePatch>([
  "preferredMake",
  "allowedMakes",
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
  "preferredMakes",
  "preferredBodyStyles",
  "preferredVehicleCategories",
  "preferredFuelTypes",
  "preferredDrivetrains",
  "preferredTransmissions",
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
  "allowedMakes",
  "excludedMakes",
  "requiredFuelType",
  "reliabilityMinimum",
  "safetyMinimum",
  "performanceMinimum",
  "flexibleConstraints",
  "allowCompromises",
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

export function convertConfirmedPreferencesToBuyerProfile(
  currentProfile: BuyerProfile,
  approvedProfile: ConfirmedPreferenceProfile,
): ConfirmedProfileConversion {
  const buyerProfile: BuyerProfile = {
    ...currentProfile,
    scoreWeights: { ...currentProfile.scoreWeights },
    decisionPolicies: { ...(currentProfile.decisionPolicies || {}) },
  };
  const appliedUpdates: Partial<BuyerProfile> = {};
  const appliedHardConstraints: ProfileConversionEntry[] = [];
  const appliedSoftPreferences: ProfileConversionEntry[] = [];
  const preservedDefaults: ProfileConversionEntry[] = [];
  const preservedSemanticPreferences: ProfileConversionEntry[] = [];
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
      preservedSemanticPreferences,
      unresolvedFields,
      disclosedAssumptions: getMaterialDefaultDisclosures(currentProfile, []).map((item) => `${item.label}: ${item.displayValue}`),
      conversionWarnings,
      mappingLimitations,
    };
  }


  const confirmedItems = approvedProfile.items.filter(
    (item) =>
      item.certainty === "confirmed"
      || isApprovedPolicyTarget(item, approvedProfile),
  );
  const assumedDefaultItems = approvedProfile.items.filter((item) => item.certainty === "assumed_default");
  const preservedSemanticItems = approvedProfile.items.filter(
    (item) =>
      !approvedProfile.removedItemIds.includes(item.id)
      && item.recommendationSupport === "understood_not_ranked"
      && (item.certainty === "confirmed" || item.certainty === "inferred"),
  );

  buyerProfile.decisionPolicies = mergeDecisionParticipationPolicyMaps(
    buyerProfile.decisionPolicies,
    approvedProfile.decisionPolicies,
  );
  for (const [dimension, policy] of Object.entries(approvedProfile.decisionPolicies)) {
    if (!policy) continue;
    if (
      policy.confirmation === "explicit"
      || policy.confirmation === "confirmed"
      || policy.source === "user_correction"
    ) {
      buyerProfile.decisionPolicies[dimension as keyof typeof buyerProfile.decisionPolicies] = policy;
    }
  }
  prepareRelationshipRevisionState(buyerProfile, confirmedItems, approvedProfile);
  appliedUpdates.decisionPolicies = buyerProfile.decisionPolicies;

  preservedSemanticPreferences.push(...preservedSemanticItems.map((item) => toEntry(item, undefined)));

  approvedProfile.unresolvedFields.forEach((item) => unresolvedFields.push(toEntry(item)));

  confirmedItems.forEach((item) => {
    const field = item.field;
    if (!field) {
      if (item.recommendationSupport === "understood_not_ranked") return;
      mappingLimitations.push(`${item.label} is preserved as advisor context because the current recommendation does not use it directly.`);
      return;
    }

    if (approvedProfile.removedItemIds.includes(item.id)) return;

    if (isMultiValueIntentField(field)) {
      applyMultiValueIntentField(buyerProfile, appliedUpdates, item, field);
      if (item.canonicalIntent === "preferred") appliedSoftPreferences.push(toEntry(item, field));
      else appliedHardConstraints.push(toEntry(item, field));
      return;
    }

    if (field === "allowedMakes" || field === "excludedMakes") {
      if (field === "excludedMakes") {
        applyMakeExclusion(buyerProfile, appliedUpdates, item);
      } else {
        applyAllowedMakes(buyerProfile, appliedUpdates, item);
      }
      const entry = toEntry(item, field);
      if (item.canonicalIntent === "excluded") appliedHardConstraints.push(entry);
      else appliedSoftPreferences.push(entry);
      return;
    }

    if (field === "preferredMake" || field === "requiredMake") {
      applyMakePreference(buyerProfile, appliedUpdates, appliedHardConstraints, appliedSoftPreferences, item);
      return;
    }

    if (field === "monthlyBudget") {
      applyFinancialTarget(
        buyerProfile,
        appliedUpdates,
        appliedHardConstraints,
        appliedSoftPreferences,
        mappingLimitations,
        item,
        "monthlyPayment",
        "Monthly payment limit",
      );
      return;
    }

    if (field === "maxPurchaseBudget") {
      applyFinancialTarget(
        buyerProfile,
        appliedUpdates,
        appliedHardConstraints,
        appliedSoftPreferences,
        mappingLimitations,
        item,
        "purchaseBudget",
        "Purchase budget",
      );
      return;
    }

    if (field === "bodyStyle") {
      applyBodyStylePreference(buyerProfile, appliedUpdates, appliedHardConstraints, appliedSoftPreferences, item);
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

  // Canonical dimension arrays are authoritative; this re-derives compatibility fields
  // after every confirmed update and resolves any stale legacy overlap.
  Object.assign(buyerProfile, normalizeProfileDimensions(buyerProfile));

  const materialDefaults = getMaterialDefaultDisclosures(buyerProfile, assumedDefaultItems);
  preservedDefaults.push(...materialDefaults);

  return {
    buyerProfile,
    appliedUpdates,
    appliedHardConstraints,
    appliedSoftPreferences,
    preservedDefaults,
    preservedSemanticPreferences,
    unresolvedFields,
    disclosedAssumptions: materialDefaults.map((item) => `${item.label}: ${item.displayValue}`),
    conversionWarnings,
    mappingLimitations,
  };
}

function prepareRelationshipRevisionState(
  buyerProfile: BuyerProfile,
  confirmedItems: ConfirmedPreferenceItem[],
  approvedProfile: ConfirmedPreferenceProfile,
) {
  const itemsByDimension = new Map<ProfileDimension, ConfirmedPreferenceItem[]>();
  for (const item of confirmedItems) {
    if (!item.field || approvedProfile.removedItemIds.includes(item.id)) continue;
    const relationship = dimensionIntentForField(item.field as keyof BuyerProfile);
    if (!relationship) continue;
    const current = itemsByDimension.get(relationship.dimension) || [];
    current.push(item);
    itemsByDimension.set(relationship.dimension, current);
  }

  for (const [dimension, items] of itemsByDimension) {
    const replacesPositiveState = items.some(
      (item) => item.canonicalIntent === "required" || item.canonicalIntent === "preferred",
    );
    if (replacesPositiveState) {
      const state = getProfileDimensionState(buyerProfile, dimension);
      Object.assign(buyerProfile, applyDimensionState(buyerProfile, dimension, {
        required: [],
        preferred: [],
        allowed: [],
        excluded: state.excluded,
      }));
    }

    const policyDimension = policyDimensionForProfileDimension(dimension);
    if (!approvedProfile.decisionPolicies[policyDimension]) {
      delete buyerProfile.decisionPolicies?.[policyDimension];
    }
  }
}

function policyDimensionForProfileDimension(
  dimension: ProfileDimension,
): "make" | "bodyStyle" | "fuelType" | "drivetrain" | "transmission" {
  if (dimension === "vehicleCategory") return "bodyStyle";
  return dimension;
}

function isApprovedPolicyTarget(
  item: ConfirmedPreferenceItem,
  profile: ConfirmedPreferenceProfile,
) {
  if (!profile.userApproved || item.certainty !== "inferred") return false;
  if (item.field === "maxPurchaseBudget") {
    const policy = profile.decisionPolicies.purchaseBudget;
    return policy?.confirmation === "explicit" && policy.participation === "active";
  }
  if (item.field === "monthlyBudget") {
    const policy = profile.decisionPolicies.monthlyPayment;
    return policy?.confirmation === "explicit" && policy.participation === "active";
  }
  return false;
}

function applyFinancialTarget(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  appliedHardConstraints: ProfileConversionEntry[],
  appliedSoftPreferences: ProfileConversionEntry[],
  mappingLimitations: string[],
  item: ConfirmedPreferenceItem,
  dimension: "purchaseBudget" | "monthlyPayment",
  label: string,
) {
  const policy = buyerProfile.decisionPolicies?.[dimension];
  if (policy?.participation === "disabled" || policy?.participation === "unresolved") return;
  if (!item.field) return;
  applyBuyerProfileField(buyerProfile, appliedUpdates, item, item.field);
  if (policy?.participation === "enforced" || item.constraintStrength === "required") {
    appliedHardConstraints.push(toEntry(item, item.field as keyof BuyerProfile));
  } else {
    appliedSoftPreferences.push(toEntry(item, item.field as keyof BuyerProfile));
    if (!policy) mappingLimitations.push(`${label} is treated as a soft target until the user confirms it as a maximum.`);
  }
}

function applyMultiValueIntentField(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  item: ConfirmedPreferenceItem,
  field: keyof BuyerProfilePatch,
) {
  const dimensionIntent = dimensionIntentForField(field as keyof BuyerProfile);
  if (!dimensionIntent) {
    applyBuyerProfileField(buyerProfile, appliedUpdates, item, field);
    return;
  }
  const values = normalizeValueForField(field, item.value) as string[];
  const next = applyDimensionIntent(buyerProfile, dimensionIntent.dimension, dimensionIntent.intent, values);
  Object.assign(buyerProfile, next);
  (appliedUpdates as unknown as Record<string, unknown>)[field] = next[field as keyof BuyerProfile];
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

  if (item.canonicalIntent === "required" || (!item.canonicalIntent && (item.constraintStrength === "required" || item.field === "requiredMake"))) {
    removeMakeFromCollections(buyerProfile, make);
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

function applyMakeExclusion(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  item: ConfirmedPreferenceItem,
) {
  const excluded = normalizeValueForField("excludedMakes", item.value) as string[];
  buyerProfile.excludedMakes = excluded;
  appliedUpdates.excludedMakes = excluded;
  excluded.forEach((make) => {
    if (buyerProfile.requiredMake?.toLowerCase() === make.toLowerCase()) buyerProfile.requiredMake = undefined;
    if (buyerProfile.preferredMake?.toLowerCase() === make.toLowerCase()) buyerProfile.preferredMake = undefined;
    buyerProfile.allowedMakes = buyerProfile.allowedMakes?.filter((candidate) => candidate.toLowerCase() !== make.toLowerCase());
  });
  appliedUpdates.requiredMake = buyerProfile.requiredMake;
  appliedUpdates.preferredMake = buyerProfile.preferredMake;
  appliedUpdates.allowedMakes = buyerProfile.allowedMakes;
}

function applyAllowedMakes(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  item: ConfirmedPreferenceItem,
) {
  const allowed = normalizeValueForField("allowedMakes", item.value) as string[];
  buyerProfile.allowedMakes = allowed;
  buyerProfile.excludedMakes = buyerProfile.excludedMakes?.filter(
    (candidate) => !allowed.some((make) => make.toLowerCase() === candidate.toLowerCase()),
  );
  appliedUpdates.allowedMakes = buyerProfile.allowedMakes;
  appliedUpdates.excludedMakes = buyerProfile.excludedMakes;
}

function removeMakeFromCollections(buyerProfile: BuyerProfile, make: string) {
  const normalized = make.toLowerCase();
  buyerProfile.allowedMakes = buyerProfile.allowedMakes?.filter((candidate) => candidate.toLowerCase() !== normalized);
  buyerProfile.excludedMakes = buyerProfile.excludedMakes?.filter((candidate) => candidate.toLowerCase() !== normalized);
}

function applyBodyStylePreference(
  buyerProfile: BuyerProfile,
  appliedUpdates: Partial<BuyerProfile>,
  appliedHardConstraints: ProfileConversionEntry[],
  appliedSoftPreferences: ProfileConversionEntry[],
  item: ConfirmedPreferenceItem,
) {
  applyBuyerProfileField(buyerProfile, appliedUpdates, item, "bodyStyle");

  if (item.canonicalIntent === "required" || (!item.canonicalIntent && item.constraintStrength === "required")) {
    buyerProfile.flexibleConstraints = buyerProfile.flexibleConstraints?.filter((constraint) => constraint !== "bodyStyle");
    appliedUpdates.flexibleConstraints = buyerProfile.flexibleConstraints;
    appliedHardConstraints.push(toEntry(item, "bodyStyle"));
    return;
  }

  buyerProfile.flexibleConstraints = Array.from(new Set([...(buyerProfile.flexibleConstraints || []), "bodyStyle"]));
  buyerProfile.allowCompromises = true;
  appliedUpdates.flexibleConstraints = buyerProfile.flexibleConstraints;
  appliedUpdates.allowCompromises = true;
  appliedSoftPreferences.push(toEntry(item, "bodyStyle"));
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
  if (
    item.canonicalIntent
      ? item.canonicalIntent !== "required" && item.canonicalIntent !== "excluded"
      : item.constraintStrength !== "required"
  ) {
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

function normalizeValueForField(field: keyof BuyerProfilePatch, value: string | number | boolean | string[]) {
  if (isMultiValueIntentField(field) || field === "excludedMakes" || field === "allowedMakes") {
    return Array.isArray(value) ? value.map(String) : [String(value)];
  }
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

function isMultiValueIntentField(field: keyof BuyerProfilePatch) {
  return [
    "requiredMakes", "preferredMakes",
    "requiredBodyStyles", "preferredBodyStyles", "allowedBodyStyles", "excludedBodyStyles",
    "requiredVehicleCategories", "preferredVehicleCategories", "allowedVehicleCategories", "excludedVehicleCategories",
    "requiredFuelTypes", "preferredFuelTypes", "allowedFuelTypes", "excludedFuelTypes",
    "requiredDrivetrains", "preferredDrivetrains", "allowedDrivetrains", "excludedDrivetrains",
    "requiredTransmissions", "preferredTransmissions", "allowedTransmissions", "excludedTransmissions",
  ].includes(field);
}

function getMaterialDefaultDisclosures(profile: BuyerProfile, assumedDefaultItems: ConfirmedPreferenceItem[]) {
  const entries: ProfileConversionEntry[] = [];
  const assumedByField = new Map(assumedDefaultItems.filter((item) => item.field).map((item) => [item.field, item]));

  addDefault(entries, assumedByField.get("expectedAnnualMileage"), "Annual mileage", `${profile.expectedAnnualMileage.toLocaleString()} miles/year`, "expectedAnnualMileage");
  if (!isDecisionDimensionDisabled(profile, "purchaseBudget")) {
    addDefault(entries, assumedByField.get("maxPurchaseBudget"), "Purchase budget", `$${profile.maxPurchaseBudget.toLocaleString()}`, "maxPurchaseBudget");
  }
  if (!isDecisionDimensionDisabled(profile, "insuranceCost")) {
    addDefault(entries, undefined, "Insurance target", `${formatMoney(profile.insuranceBudget)}/mo`, "insuranceBudget");
  }
  if (!isDecisionDimensionDisabled(profile, "fuelEnergyCost")) {
    addDefault(entries, undefined, "Fuel price", `${formatMoney(profile.fuelPrice)}/gal`, "fuelPrice");
  }
  if (!isDecisionDimensionDisabled(profile, "monthlyPayment")) {
    addDefault(entries, undefined, "Financing assumptions", `${profile.loanTermMonths} months, ${profile.apr}% APR, ${formatMoney(profile.downPayment)} down`, "loanTermMonths");
  }
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
  value: string | number | boolean | string[] = item.value,
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
