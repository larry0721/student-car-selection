import type { BuyerProfile } from "@/types/buyer";
import type {
  CanonicalSemanticIntent,
  SemanticSupportStatus,
  VehicleDomainConcept,
} from "./carDomainOntology";
import type { ConversationIntakeSession, ConversationTurn } from "./conversationIntake";
import type {
  BuyerProfilePatch,
  InferredPreference,
  PreferenceConflict,
  PreferenceFact,
  PreferenceInterpretation,
} from "./preferenceInterpretation";
import {
  decisionPolicyDimensionLabel,
  mergeDecisionParticipationPolicyMaps,
  policyParticipationDisplay,
} from "./decisionParticipationPolicy";
import type {
  DecisionParticipation,
  DecisionParticipationPolicyMap,
  DecisionPolicyDimension,
} from "@/types/decisionPolicy";

export type ConfirmationCertainty = "confirmed" | "inferred" | "needs_answer" | "assumed_default";
export type RecommendationSupportLevel = "used_in_recommendation" | "understood_not_ranked";
export type ConstraintStrength = "required" | "preferred" | "flexible";
export type ConfirmationGroup =
  | "your_situation"
  | "what_matters_most"
  | "preferences_and_requirements"
  | "uncertainty_and_tradeoffs";

export type ConfirmedPreferenceItem = {
  id: string;
  group: ConfirmationGroup;
  label: string;
  field?: keyof BuyerProfilePatch;
  value: string | number | boolean | string[];
  displayValue: string;
  certainty: ConfirmationCertainty;
  constraintStrength: ConstraintStrength;
  recommendationSupport: RecommendationSupportLevel;
  semanticConcept?: string;
  conceptType?: VehicleDomainConcept;
  canonicalIntent?: CanonicalSemanticIntent;
  supportStatus?: SemanticSupportStatus;
  mappingId?: string;
  sourceTurnId?: string;
  evidencePhrase: string;
  userEdited: boolean;
  editableType: "number" | "text" | "choice" | "importance";
  canRemove: boolean;
  policyDimension?: DecisionPolicyDimension;
  participation?: DecisionParticipation;
};

export type ConfirmationAssumption = {
  id: string;
  text: string;
  field?: keyof BuyerProfilePatch;
};

export type ConfirmedPreferenceProfile = {
  confirmedUpdates: BuyerProfilePatch;
  pendingInferences: ConfirmedPreferenceItem[];
  explicitHardConstraints: ConfirmedPreferenceItem[];
  flexiblePreferences: ConfirmedPreferenceItem[];
  unresolvedFields: ConfirmedPreferenceItem[];
  conflicts: PreferenceConflict[];
  assumptions: ConfirmationAssumption[];
  interpretationConfidence: ConversationIntakeSession["interpretationConfidence"];
  userApproved: boolean;
  approvedAtSequence?: number;
  removedItemIds: string[];
  items: ConfirmedPreferenceItem[];
  advisorSummary: string;
  decisionPolicies: DecisionParticipationPolicyMap;
};

const situationFields: Array<keyof BuyerProfilePatch> = [
  "maxPurchaseBudget",
  "paymentMethod",
  "expectedAnnualMileage",
  "familySize",
  "climate",
];

export function createConfirmedPreferenceProfile(
  session: ConversationIntakeSession,
  defaults: BuyerProfile,
): ConfirmedPreferenceProfile {
  const items: ConfirmedPreferenceItem[] = [];
  const factsByField = new Map<keyof BuyerProfilePatch, PreferenceFact>();
  const inferencesByField = new Map<keyof BuyerProfilePatch | string, InferredPreference>();
  const mappingsByDestination = new Map<keyof BuyerProfilePatch, NonNullable<PreferenceInterpretation["canonicalMappings"]>[number]>(
    (session.accumulatedInterpretation.canonicalMappings || [])
      .filter((mapping) => mapping.destination)
      .map((mapping) => [mapping.destination as keyof BuyerProfilePatch, mapping]),
  );

  session.accumulatedInterpretation.explicitFacts.forEach((fact) => {
    if (fact.field) factsByField.set(fact.field, fact);
  });
  session.accumulatedInterpretation.inferredPreferences.forEach((preference) => {
    inferencesByField.set(preference.field || preference.label, preference);
  });

  for (const [field, value] of Object.entries(session.accumulatedInterpretation.suggestedProfileUpdates) as Array<
    [keyof BuyerProfilePatch, BuyerProfilePatch[keyof BuyerProfilePatch]]
  >) {
    if (value === undefined) continue;
    if (field === "decisionPolicies") continue;
    const fact = factsByField.get(field);
    const inference = inferencesByField.get(field);
    const mapping = mappingsByDestination.get(field);
    const confidence = session.accumulatedInterpretation.confidenceByField.find((entry) => entry.field === field);
    const certainty: ConfirmationCertainty = fact && confidence?.confidence === "high" && !confidence.requiresConfirmation ? "confirmed" : "inferred";
    const evidencePhrase = mapping?.sourceText || fact?.evidencePhrase || inference?.evidencePhrase || confidence?.evidencePhrase || "";
    const sourceTurn = findSourceTurn(session.conversationTurns, evidencePhrase);
    items.push({
      id: `field:${field}`,
      group: groupForField(field),
      label: labelForField(field),
      field,
      value: Array.isArray(value) ? value.map(String) : value as string | number | boolean,
      displayValue: displayValueForField(field, value),
      certainty,
      constraintStrength: mapping ? constraintStrengthForIntent(mapping.intent) : constraintStrengthForField(field, fact, confidence),
      recommendationSupport: supportLevelFor(mapping?.supportStatus) || "used_in_recommendation",
      semanticConcept: mapping?.semanticConcept || inference?.semanticConcept,
      conceptType: mapping?.conceptType,
      canonicalIntent: mapping?.intent || fact?.canonicalIntent || inference?.canonicalIntent,
      supportStatus: mapping?.supportStatus || fact?.supportStatus || inference?.supportStatus,
      mappingId: mapping?.id || fact?.mappingId || inference?.mappingId,
      sourceTurnId: sourceTurn?.id,
      evidencePhrase,
      userEdited: false,
      editableType: editableTypeForField(field),
      canRemove: !["maxPurchaseBudget"].includes(field),
    });
  }

  session.accumulatedInterpretation.inferredPreferences.forEach((preference) => {
    const id = `preference:${preference.label}`;
    if (items.some((item) => item.id === id || (preference.field && item.field === preference.field))) return;
    const sourceTurn = findSourceTurn(session.conversationTurns, preference.evidencePhrase);
    const mapping = (session.accumulatedInterpretation.canonicalMappings || [])
      .find((candidate) => candidate.id === preference.mappingId);
    items.push({
      id,
      group: "what_matters_most",
      label: preference.label,
      value: preference.value,
      displayValue: preference.value,
      certainty: "inferred",
      constraintStrength: mapping ? constraintStrengthForIntent(mapping.intent) : "flexible",
      recommendationSupport: supportLevelFor(mapping?.supportStatus)
        || preference.recommendationSupport
        || (preference.field ? "used_in_recommendation" : "understood_not_ranked"),
      semanticConcept: mapping?.semanticConcept || preference.semanticConcept,
      conceptType: mapping?.conceptType,
      canonicalIntent: mapping?.intent || preference.canonicalIntent,
      supportStatus: mapping?.supportStatus || preference.supportStatus,
      mappingId: mapping?.id || preference.mappingId,
      sourceTurnId: sourceTurn?.id,
      evidencePhrase: preference.evidencePhrase,
      userEdited: false,
      editableType: "text",
      canRemove: true,
    });
  });

  const decisionPolicies = session.accumulatedInterpretation.decisionPolicies || {};
  suppressPolicyControlledItems(items, decisionPolicies);
  addPolicyItems(items, decisionPolicies);
  addMissingOrDefaultItems(items, defaults, decisionPolicies);

  const assumptions = buildAssumptions(items);
  return deriveProfileCollections({
    confirmedUpdates: {},
    pendingInferences: [],
    explicitHardConstraints: [],
    flexiblePreferences: [],
    unresolvedFields: [],
    conflicts: session.unresolvedConflicts,
    assumptions,
    interpretationConfidence: session.interpretationConfidence,
    userApproved: false,
    removedItemIds: [],
    items,
    advisorSummary: "",
    decisionPolicies,
  });
}

function suppressPolicyControlledItems(
  items: ConfirmedPreferenceItem[],
  policies: DecisionParticipationPolicyMap,
) {
  const suppressedDimensions = new Set(
    Object.values(policies)
      .filter((policy) =>
        policy
        && ["disabled", "deprioritized", "unresolved"].includes(policy.participation),
      )
      .map((policy) => policy?.dimension)
      .filter(Boolean),
  );
  if (!suppressedDimensions.size) return;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const field = items[index].field;
    const dimension = field ? policyDimensionForProfileField(field) : undefined;
    if (dimension && suppressedDimensions.has(dimension)) items.splice(index, 1);
  }
}

function policyDimensionForProfileField(
  field: keyof BuyerProfilePatch,
): DecisionPolicyDimension | undefined {
  const dimensions: Partial<Record<keyof BuyerProfilePatch, DecisionPolicyDimension>> = {
    maxPurchaseBudget: "purchaseBudget",
    monthlyBudget: "monthlyPayment",
    insuranceBudget: "insuranceCost",
    minMpg: "fuelEnergyCost",
    fuelEconomyImportance: "fuelEnergyCost",
    reliabilityImportance: "reliability",
    reliabilityMinimum: "reliability",
    safetyPriority: "safety",
    safetyMinimum: "safety",
    performanceImportance: "performance",
    performanceMinimum: "performance",
    resaleValueImportance: "resaleValue",
    requiredMake: "make",
    preferredMake: "make",
    requiredMakes: "make",
    preferredMakes: "make",
    allowedMakes: "make",
    excludedMakes: "make",
    bodyStyle: "bodyStyle",
    requiredBodyStyles: "bodyStyle",
    preferredBodyStyles: "bodyStyle",
    allowedBodyStyles: "bodyStyle",
    excludedBodyStyles: "bodyStyle",
    requiredFuelType: "fuelType",
    requiredFuelTypes: "fuelType",
    preferredFuelTypes: "fuelType",
    allowedFuelTypes: "fuelType",
    excludedFuelTypes: "fuelType",
    drivetrainPreference: "drivetrain",
    requiredDrivetrains: "drivetrain",
    preferredDrivetrains: "drivetrain",
    allowedDrivetrains: "drivetrain",
    excludedDrivetrains: "drivetrain",
    transmissionPreference: "transmission",
    requiredTransmissions: "transmission",
    preferredTransmissions: "transmission",
    allowedTransmissions: "transmission",
    excludedTransmissions: "transmission",
    familySize: "seating",
    minYear: "modelYear",
    maxMileage: "mileage",
  };
  return dimensions[field];
}

export function updateConfirmedPreferenceItem(
  draft: ConfirmedPreferenceProfile,
  itemId: string,
  updates: Partial<Pick<ConfirmedPreferenceItem, "value" | "displayValue" | "certainty" | "constraintStrength" | "evidencePhrase">>,
): ConfirmedPreferenceProfile {
  return deriveProfileCollections({
    ...draft,
    userApproved: false,
    approvedAtSequence: undefined,
    items: draft.items.map((item) => {
      if (item.id !== itemId) return item;
      const nextStrength = updates.constraintStrength ?? item.constraintStrength;
      return {
        ...item,
        ...updates,
        canonicalIntent:
          item.canonicalIntent === "excluded" || item.canonicalIntent === "allowed"
            ? item.canonicalIntent
            : nextStrength === "required"
              ? "required"
              : "preferred",
        displayValue: updates.displayValue ?? displayValueForField(item.field, updates.value ?? item.value),
        userEdited: true,
      };
    }),
  });
}

export function confirmPreferenceItem(draft: ConfirmedPreferenceProfile, itemId: string) {
  return updateConfirmedPreferenceItem(draft, itemId, { certainty: "confirmed" });
}

export function removePreferenceItem(draft: ConfirmedPreferenceProfile, itemId: string) {
  return deriveProfileCollections({
    ...draft,
    userApproved: false,
    approvedAtSequence: undefined,
    removedItemIds: Array.from(new Set([...draft.removedItemIds, itemId])),
    items: draft.items.filter((item) => item.id !== itemId),
  });
}

export function approveConfirmedPreferenceProfile(
  draft: ConfirmedPreferenceProfile,
  approvedAtSequence: number,
): ConfirmedPreferenceProfile {
  return deriveProfileCollections({
    ...draft,
    userApproved: true,
    approvedAtSequence,
  });
}

export function hasBlockingConfirmationIssue(draft: ConfirmedPreferenceProfile) {
  return draft.decisionPolicies.purchaseBudget?.participation === "unresolved"
    || draft.unresolvedFields.some((item) => item.id === "field:maxPurchaseBudget" && item.certainty === "needs_answer");
}

export function carryForwardConfirmedPreferenceDraft(
  nextDraft: ConfirmedPreferenceProfile,
  previousDraft: ConfirmedPreferenceProfile,
): ConfirmedPreferenceProfile {
  const previousById = new Map(previousDraft.items.map((item) => [item.id, item]));
  const previousByField = new Map(previousDraft.items.filter((item) => item.field).map((item) => [item.field, item]));
  const removedItemIds = Array.from(new Set([...nextDraft.removedItemIds, ...previousDraft.removedItemIds]));
  const removedSet = new Set(removedItemIds);
  const carriedItemIds = new Set<string>();
  const items: ConfirmedPreferenceItem[] = [];

  nextDraft.items.forEach((item) => {
    if (removedSet.has(item.id)) return;
    const previous = previousById.get(item.id) || (item.field ? previousByField.get(item.field) : undefined);
    if (!previous || !shouldCarryForward(previous, item)) {
      items.push(item);
      return;
    }

    carriedItemIds.add(previous.id);
    items.push({
      ...item,
      value: previous.value,
      displayValue: previous.displayValue,
      certainty: previous.certainty,
      constraintStrength: previous.constraintStrength,
      canonicalIntent: previous.canonicalIntent,
      supportStatus: previous.supportStatus,
      mappingId: previous.mappingId,
      evidencePhrase: previous.evidencePhrase,
      userEdited: previous.userEdited,
    });
  });

  previousDraft.items.forEach((item) => {
    if (removedSet.has(item.id) || carriedItemIds.has(item.id)) return;
    if (!nextDraft.items.some((candidate) => candidate.id === item.id || (item.field && candidate.field === item.field)) && shouldCarryForward(item)) {
      items.push(item);
    }
  });

  return deriveProfileCollections({
    ...nextDraft,
    userApproved: false,
    approvedAtSequence: undefined,
    removedItemIds,
    items,
    decisionPolicies: mergeDecisionParticipationPolicyMaps(
      nextDraft.decisionPolicies,
      previousDraft.decisionPolicies,
    ),
  });
}

function deriveProfileCollections(draft: ConfirmedPreferenceProfile): ConfirmedPreferenceProfile {
  const confirmedUpdates: BuyerProfilePatch = {};
  draft.items.forEach((item) => {
    if (item.field && item.certainty === "confirmed") {
      (confirmedUpdates as Record<string, unknown>)[item.field] = item.value;
    }
  });

  const pendingInferences = draft.items.filter((item) => item.certainty === "inferred");
  const explicitHardConstraints = draft.items.filter((item) => item.constraintStrength === "required");
  const flexiblePreferences = draft.items.filter((item) => item.constraintStrength !== "required" && item.certainty !== "needs_answer");
  const unresolvedFields = draft.items.filter((item) => item.certainty === "needs_answer");

  return {
    ...draft,
    confirmedUpdates,
    pendingInferences,
    explicitHardConstraints,
    flexiblePreferences,
    unresolvedFields,
    assumptions: buildAssumptions(draft.items),
    advisorSummary: buildAdvisorSummary(draft.items),
  };
}

function shouldCarryForward(previous: ConfirmedPreferenceItem, next?: ConfirmedPreferenceItem) {
  if (next && nextShouldReplacePrevious(previous, next)) return false;
  return (
    previous.userEdited ||
    previous.certainty === "confirmed" ||
    Boolean(next && previous.constraintStrength !== next.constraintStrength)
  );
}

function nextShouldReplacePrevious(
  previous: ConfirmedPreferenceItem,
  next: ConfirmedPreferenceItem,
) {
  if (next.certainty === "assumed_default" || next.certainty === "needs_answer") return false;
  if (previous.certainty === "assumed_default") return true;

  const previousSequence = sourceTurnSequence(previous.sourceTurnId);
  const nextSequence = sourceTurnSequence(next.sourceTurnId);
  return nextSequence !== undefined
    && (previousSequence === undefined || nextSequence > previousSequence);
}

function sourceTurnSequence(sourceTurnId: string | undefined) {
  const sequence = sourceTurnId?.match(/^turn-(\d+)$/)?.[1];
  return sequence ? Number(sequence) : undefined;
}

function addMissingOrDefaultItems(
  items: ConfirmedPreferenceItem[],
  defaults: BuyerProfile,
  policies: DecisionParticipationPolicyMap,
) {
  if (
    !items.some((item) => item.field === "maxPurchaseBudget")
    && !policies.purchaseBudget
  ) {
    items.push({
      id: "field:maxPurchaseBudget",
      group: "your_situation",
      label: "Purchase budget",
      field: "maxPurchaseBudget",
      value: defaults.maxPurchaseBudget,
      displayValue: `Using app default of $${defaults.maxPurchaseBudget.toLocaleString()}`,
      certainty: "assumed_default",
      constraintStrength: "flexible",
      recommendationSupport: "used_in_recommendation",
      evidencePhrase: "",
      userEdited: false,
      editableType: "number",
      canRemove: false,
    });
  }

  if (!items.some((item) => item.field === "paymentMethod")) {
    items.push({
      id: "field:paymentMethod",
      group: "your_situation",
      label: "Cash or financing",
      field: "paymentMethod",
      value: "not-sure",
      displayValue: "Not specified",
      certainty: "needs_answer",
      constraintStrength: "flexible",
      recommendationSupport: "used_in_recommendation",
      evidencePhrase: "",
      userEdited: false,
      editableType: "choice",
      canRemove: false,
    });
  }

  if (!items.some((item) => item.field === "expectedAnnualMileage")) {
    items.push({
      id: "field:expectedAnnualMileage",
      group: "your_situation",
      label: "Annual mileage",
      field: "expectedAnnualMileage",
      value: defaults.expectedAnnualMileage,
      displayValue: `Using app default of ${defaults.expectedAnnualMileage.toLocaleString()} miles`,
      certainty: "assumed_default",
      constraintStrength: "flexible",
      recommendationSupport: "used_in_recommendation",
      evidencePhrase: "",
      userEdited: false,
      editableType: "number",
      canRemove: false,
    });
  }

  situationFields.forEach((field) => {
    const item = items.find((candidate) => candidate.field === field);
    if (item) item.group = "your_situation";
  });
}

function addPolicyItems(
  items: ConfirmedPreferenceItem[],
  policies: DecisionParticipationPolicyMap,
) {
  for (const policy of Object.values(policies)) {
    if (!policy) continue;
    const existing = items.find((item) => item.policyDimension === policy.dimension);
    if (existing) continue;
    const representedField = fieldForPolicyDimension(policy.dimension);
    if (
      representedField
      && items.some((item) => item.field === representedField)
      && (policy.participation === "enforced" || policy.participation === "active")
    ) {
      continue;
    }
    items.push({
      id: `policy:${policy.dimension}`,
      group: groupForPolicyDimension(policy.dimension),
      label: decisionPolicyDimensionLabel(policy.dimension),
      value: policy.participation,
      displayValue: policyParticipationDisplay(policy.dimension, policy.participation),
      certainty:
        policy.participation === "unresolved"
          ? "needs_answer"
          : policy.confirmation === "explicit" || policy.confirmation === "confirmed"
            ? "confirmed"
            : "inferred",
      constraintStrength:
        policy.participation === "enforced"
          ? "required"
          : policy.participation === "active"
            ? "preferred"
            : "flexible",
      recommendationSupport:
        policy.participation === "disabled" || policy.participation === "unresolved"
          ? "understood_not_ranked"
          : "used_in_recommendation",
      evidencePhrase: policy.sourceText,
      userEdited: false,
      editableType: "choice",
      canRemove: false,
      policyDimension: policy.dimension,
      participation: policy.participation,
    });
  }
}

function fieldForPolicyDimension(
  dimension: DecisionPolicyDimension,
): keyof BuyerProfilePatch | undefined {
  const fields: Partial<Record<DecisionPolicyDimension, keyof BuyerProfilePatch>> = {
    purchaseBudget: "maxPurchaseBudget",
    monthlyPayment: "monthlyBudget",
    reliability: "reliabilityImportance",
    safety: "safetyPriority",
    performance: "performanceImportance",
    make: "requiredMakes",
    bodyStyle: "requiredBodyStyles",
    fuelType: "requiredFuelTypes",
    drivetrain: "requiredDrivetrains",
    transmission: "requiredTransmissions",
    seating: "familySize",
    modelYear: "minYear",
    mileage: "maxMileage",
  };
  return fields[dimension];
}

function groupForPolicyDimension(dimension: DecisionPolicyDimension): ConfirmationGroup {
  if (["purchaseBudget", "monthlyPayment", "totalOwnershipBudget"].includes(dimension)) return "your_situation";
  if (["make", "bodyStyle", "fuelType", "drivetrain", "transmission", "seating", "modelYear", "mileage"].includes(dimension)) {
    return "preferences_and_requirements";
  }
  return "what_matters_most";
}

function buildAssumptions(items: ConfirmedPreferenceItem[]): ConfirmationAssumption[] {
  return items
    .filter((item) => item.certainty === "assumed_default")
    .map((item) => ({
      id: `assumption:${item.id}`,
      text: `${item.label}: ${item.displayValue}`,
      field: item.field,
    }));
}

function buildAdvisorSummary(items: ConfirmedPreferenceItem[]) {
  const budget = items.find((item) => item.field === "maxPurchaseBudget");
  const make = items.find((item) => item.field === "preferredMake" || item.field === "requiredMake");
  const reliability = items.find((item) => item.field === "reliabilityImportance" || item.label.toLowerCase().includes("ownership risk"));
  const safety = items.find((item) => item.field === "safetyPriority");
  const style = items.find((item) => {
    const label = item.label.toLowerCase();
    return label.includes("style") || label.includes("design") || label.includes("image") || label.includes("premium");
  });
  const performance = items.find((item) => item.field === "performanceImportance");
  const drivetrain = items.find((item) => item.field === "drivetrainPreference");
  const preservedContext = items.find((item) => item.recommendationSupport === "understood_not_ranked");

  const sentenceOneParts = [
    reliability ? "low ownership risk" : "",
    safety ? "safety" : "",
    performance ? "driving feel" : "",
  ].filter(Boolean);
  const budgetPhrase = budget
    ? budget.certainty === "assumed_default"
      ? ` using the app default budget of $${Number(budget.value).toLocaleString()}`
      : ` with ${budget.displayValue.toLowerCase()}`
    : "";
  const sentenceOne = `You’re looking for ${sentenceOneParts.length ? sentenceOneParts.join(", ") : "a responsible first-car match"}${budgetPhrase}.`;
  const sentenceTwoParts = [
    make ? `${make.displayValue} is ${make.constraintStrength === "required" ? "required" : "preferred"}` : "",
    style ? "your style or image preference is noted" : "",
    drivetrain ? `${drivetrain.displayValue} is ${drivetrain.constraintStrength}` : "",
  ].filter(Boolean);
  const sentenceTwo = sentenceTwoParts.length
    ? `${sentenceTwoParts.join(", ")}, and I’ll keep the risk tradeoffs visible.`
    : "I’ll keep unresolved items visible instead of pretending they are known.";
  const sentenceThree = preservedContext
    ? "I understand this preference is part of what you care about, even if today's recommendation cannot use it directly."
    : "";

  return `${sentenceOne} ${sentenceTwo}${sentenceThree ? ` ${sentenceThree}` : ""}`;
}

function groupForField(field: keyof BuyerProfilePatch): ConfirmationGroup {
  if (["maxPurchaseBudget", "paymentMethod", "expectedAnnualMileage", "familySize", "climate"].includes(field)) return "your_situation";
  if (
    [
      "reliabilityImportance",
      "safetyPriority",
      "performanceImportance",
      "fuelEconomyImportance",
      "resaleValueImportance",
      "advancedFeaturesImportance",
    ].includes(field)
  ) {
    return "what_matters_most";
  }
  return "preferences_and_requirements";
}

function labelForField(field: keyof BuyerProfilePatch) {
  const labels: Partial<Record<keyof BuyerProfilePatch, string>> = {
    maxPurchaseBudget: "Purchase budget",
    monthlyBudget: "Monthly payment limit",
    paymentMethod: "Cash or financing",
    purchaseCondition: "New or used",
    expectedAnnualMileage: "Annual mileage",
    insuranceBudget: "Insurance budget",
    maxMileage: "Maximum mileage",
    minMpg: "Minimum MPG",
    reliabilityImportance: "Reliability",
    performanceImportance: "Performance",
    cargoNeed: "Cargo space",
    familySize: "Family or seating",
    drivetrainPreference: "Drivetrain",
    bodyStyle: "Body style",
    climate: "Climate",
    resaleValueImportance: "Resale value",
    advancedFeaturesImportance: "Advanced features",
    safetyPriority: "Safety",
    requiredMake: "Required make",
    preferredMake: "Preferred make",
    allowedMakes: "Allowed makes",
    excludedMakes: "Excluded make",
    requiredMakes: "Required make",
    preferredMakes: "Preferred make",
    requiredBodyStyles: "Required body style",
    preferredBodyStyles: "Preferred body style",
    allowedBodyStyles: "Allowed body style",
    excludedBodyStyles: "Excluded body style",
    requiredVehicleCategories: "Required vehicle type",
    preferredVehicleCategories: "Preferred vehicle type",
    allowedVehicleCategories: "Allowed vehicle type",
    excludedVehicleCategories: "Excluded vehicle type",
    requiredFuelTypes: "Required fuel type",
    preferredFuelTypes: "Preferred fuel type",
    allowedFuelTypes: "Allowed fuel type",
    excludedFuelTypes: "Excluded fuel type",
    requiredDrivetrains: "Required drivetrain",
    preferredDrivetrains: "Preferred drivetrain",
    allowedDrivetrains: "Allowed drivetrain",
    excludedDrivetrains: "Excluded drivetrain",
    requiredTransmissions: "Required transmission",
    preferredTransmissions: "Preferred transmission",
    allowedTransmissions: "Allowed transmission",
    excludedTransmissions: "Excluded transmission",
    requiredFuelType: "Fuel type",
  };
  return labels[field] || String(field);
}

function displayValueForField(field: keyof BuyerProfilePatch | undefined, value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (field === "maxPurchaseBudget" || field === "monthlyBudget" || field === "insuranceBudget") {
    return `Up to $${Number(value).toLocaleString()}`;
  }
  if (field === "expectedAnnualMileage" || field === "maxMileage") {
    return `${Number(value).toLocaleString()} miles`;
  }
  if (field === "reliabilityImportance" || field === "performanceImportance" || field === "resaleValueImportance") {
    return importanceLabel(Number(value));
  }
  if (field === "safetyPriority") {
    return String(value) === "maximum" ? "Maximum" : String(value) === "high" ? "High" : "Standard";
  }
  if (field === "paymentMethod" && value === "not-sure") return "Not specified";
  if (typeof value === "string") return value.charAt(0).toUpperCase() + value.slice(1);
  return String(value);
}

function importanceLabel(value: number) {
  if (value >= 5) return "Very important";
  if (value >= 4) return "Important";
  if (value <= 2) return "Low priority";
  return "Normal";
}

function constraintStrengthForField(
  field: keyof BuyerProfilePatch,
  fact: PreferenceFact | undefined,
  confidence: {
    confidence: string;
    requiresConfirmation: boolean;
    evidencePhrase: string;
    canonicalIntent?: CanonicalSemanticIntent;
  } | undefined,
): ConstraintStrength {
  if (confidence?.canonicalIntent) return constraintStrengthForIntent(confidence.canonicalIntent);
  if (field === "requiredMake" || field === "requiredFuelType") return "required";
  if (field === "allowedMakes" || field === "excludedMakes") return "required";
  if (fact?.canonicalIntent) return constraintStrengthForIntent(fact.canonicalIntent);
  if (field === "maxPurchaseBudget" && confidence?.confidence === "high" && !confidence.requiresConfirmation) return "required";
  if (field === "preferredMake") return "preferred";
  return "flexible";
}

function constraintStrengthForIntent(intent: CanonicalSemanticIntent): ConstraintStrength {
  if (intent === "required" || intent === "excluded") return "required";
  if (intent === "preferred") return "preferred";
  return "flexible";
}

function supportLevelFor(status?: SemanticSupportStatus): RecommendationSupportLevel | undefined {
  if (!status) return undefined;
  return status === "supported_and_used" || status === "supported_but_needs_confirmation"
    ? "used_in_recommendation"
    : "understood_not_ranked";
}

function editableTypeForField(field: keyof BuyerProfilePatch): ConfirmedPreferenceItem["editableType"] {
  if (["maxPurchaseBudget", "monthlyBudget", "insuranceBudget", "expectedAnnualMileage", "maxMileage", "familySize"].includes(field)) {
    return "number";
  }
  if (["reliabilityImportance", "performanceImportance", "resaleValueImportance", "fuelEconomyImportance"].includes(field)) {
    return "importance";
  }
  return "choice";
}

function findSourceTurn(turns: ConversationTurn[], evidencePhrase: string) {
  if (!evidencePhrase) return undefined;
  return turns.find((turn) => turn.role === "user" && turn.text.toLowerCase().includes(evidencePhrase.toLowerCase()));
}
