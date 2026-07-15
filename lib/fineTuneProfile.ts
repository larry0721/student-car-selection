import type { BuyerProfile } from "@/types/buyer";
import type { ConfirmedProfileConversion } from "./confirmedProfileConversion";
import type { ConfirmationCertainty, ConstraintStrength } from "./confirmedPreferenceProfile";

export type FineTuneSource = "conversation" | "user-confirmation" | "manual-edit" | "default";
export type FineTuneCertainty = ConfirmationCertainty | "assumed" | "unresolved";

export type FineTuneFieldMeta = {
  source: FineTuneSource;
  certainty: FineTuneCertainty;
  constraintStrength: ConstraintStrength | "not-set";
  label: string;
};

export type FineTuneMetadata = Partial<Record<keyof BuyerProfile, FineTuneFieldMeta>>;

export type FineTuneChangeSummary = {
  changedFields: Array<keyof BuyerProfile>;
  labels: string[];
  message: string;
};

export type RecommendationChangeSummary = {
  message: string;
  topBefore: string;
  topAfter: string;
  qualifiedBefore: number;
  qualifiedAfter: number;
};

const fieldLabels: Partial<Record<keyof BuyerProfile, string>> = {
  maxPurchaseBudget: "budget",
  monthlyBudget: "monthly budget",
  downPayment: "down payment",
  paymentMethod: "cash or financing",
  insuranceBudget: "insurance comfort",
  expectedAnnualMileage: "annual mileage",
  familySize: "family size",
  cargoNeed: "cargo space",
  climate: "climate",
  preferredMake: "preferred make",
  requiredMake: "required make",
  bodyStyle: "body style",
  drivetrainPreference: "drivetrain",
  transmissionPreference: "transmission",
  requiredFuelType: "fuel type",
  purchaseCondition: "new or used",
  performanceImportance: "performance",
  reliabilityImportance: "reliability",
  reliabilityMinimum: "reliability minimum",
  safetyPriority: "safety",
  safetyMinimum: "safety minimum",
  maxMileage: "maximum mileage",
  minYear: "minimum model year",
};

export function createFineTuneMetadataFromConversion(conversion: ConfirmedProfileConversion | null): FineTuneMetadata {
  const metadata: FineTuneMetadata = {};
  if (!conversion) return metadata;

  conversion.appliedHardConstraints.forEach((item) => {
    if (!item.field) return;
    metadata[item.field] = {
      source: "user-confirmation",
      certainty: "confirmed",
      constraintStrength: "required",
      label: item.label,
    };
  });

  conversion.appliedSoftPreferences.forEach((item) => {
    if (!item.field) return;
    metadata[item.field] = {
      source: "conversation",
      certainty: "confirmed",
      constraintStrength: item.constraintStrength,
      label: item.label,
    };
  });

  conversion.preservedDefaults.forEach((item) => {
    if (!item.field || metadata[item.field]) return;
    metadata[item.field] = {
      source: "default",
      certainty: "assumed",
      constraintStrength: "flexible",
      label: item.label,
    };
  });

  conversion.unresolvedFields.forEach((item) => {
    if (!item.field || metadata[item.field]) return;
    metadata[item.field] = {
      source: "conversation",
      certainty: "unresolved",
      constraintStrength: item.constraintStrength,
      label: item.label,
    };
  });

  return metadata;
}

export function markManualFieldEdit(
  metadata: FineTuneMetadata,
  field: keyof BuyerProfile,
  label: string = getFineTuneFieldLabel(field),
  constraintStrength: ConstraintStrength | "not-set" = metadata[field]?.constraintStrength || "not-set",
): FineTuneMetadata {
  return {
    ...metadata,
    [field]: {
      source: "manual-edit",
      certainty: "confirmed",
      constraintStrength,
      label,
    },
  };
}

export function summarizeFineTuneChanges(fields: Array<keyof BuyerProfile>): FineTuneChangeSummary {
  const uniqueFields = Array.from(new Set(fields));
  const labels = uniqueFields.map(getFineTuneFieldLabel);
  return {
    changedFields: uniqueFields,
    labels,
    message: labels.length
      ? `You changed ${labels.length} preference${labels.length === 1 ? "" : "s"}: ${formatList(labels)}. Your current result still uses the previous profile.`
      : "No unapplied fine-tuning changes.",
  };
}

export function summarizeRecommendationChange({
  changedFields,
  qualifiedAfter,
  qualifiedBefore,
  topAfter,
  topBefore,
}: {
  changedFields: Array<keyof BuyerProfile>;
  qualifiedAfter: number;
  qualifiedBefore: number;
  topAfter: string;
  topBefore: string;
}): RecommendationChangeSummary {
  const labels = changedFields.map(getFineTuneFieldLabel);
  const firstSentence = labels.length
    ? `I updated the recommendation after you changed ${formatList(labels)}.`
    : "I updated the recommendation with the latest confirmed profile.";
  const topSentence = topAfter === topBefore
    ? `Best overall stayed the same: ${topAfter}.`
    : `Best overall changed from ${topBefore} to ${topAfter}.`;
  const qualificationSentence =
    qualifiedAfter === qualifiedBefore
      ? `${qualifiedAfter} vehicles qualified, same as before.`
      : qualifiedAfter > qualifiedBefore
        ? `${qualifiedAfter} vehicles qualified, up from ${qualifiedBefore}.`
        : `${qualifiedAfter} vehicles qualified, down from ${qualifiedBefore}.`;

  return {
    message: `${firstSentence} ${topSentence} ${qualificationSentence}`,
    topBefore,
    topAfter,
    qualifiedBefore,
    qualifiedAfter,
  };
}

export function getFineTuneFieldLabel(field: keyof BuyerProfile) {
  return fieldLabels[field] || String(field);
}

export function getProfileSourceLabel({
  hasConversation,
  hasManualEdits,
}: {
  hasConversation: boolean;
  hasManualEdits: boolean;
}) {
  if (hasConversation && hasManualEdits) return "Advisor conversation with manual edits";
  if (hasConversation) return "Advisor conversation";
  if (hasManualEdits) return "Manual details";
  return "App defaults";
}

function formatList(labels: string[]) {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
