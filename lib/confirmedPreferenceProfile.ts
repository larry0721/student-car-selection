import type { BuyerProfile } from "@/types/buyer";
import type { ConversationIntakeSession, ConversationTurn } from "./conversationIntake";
import type {
  BuyerProfilePatch,
  InferredPreference,
  PreferenceConflict,
  PreferenceFact,
} from "./preferenceInterpretation";

export type ConfirmationCertainty = "confirmed" | "inferred" | "needs_answer" | "assumed_default";
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
  value: string | number | boolean;
  displayValue: string;
  certainty: ConfirmationCertainty;
  constraintStrength: ConstraintStrength;
  sourceTurnId?: string;
  evidencePhrase: string;
  userEdited: boolean;
  editableType: "number" | "text" | "choice" | "importance";
  canRemove: boolean;
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
    const fact = factsByField.get(field);
    const inference = inferencesByField.get(field);
    const confidence = session.accumulatedInterpretation.confidenceByField.find((entry) => entry.field === field);
    const certainty: ConfirmationCertainty = fact && confidence?.confidence === "high" && !confidence.requiresConfirmation ? "confirmed" : "inferred";
    const evidencePhrase = fact?.evidencePhrase || inference?.evidencePhrase || confidence?.evidencePhrase || "";
    const sourceTurn = findSourceTurn(session.conversationTurns, evidencePhrase);
    items.push({
      id: `field:${field}`,
      group: groupForField(field),
      label: labelForField(field),
      field,
      value: value as string | number | boolean,
      displayValue: displayValueForField(field, value),
      certainty,
      constraintStrength: constraintStrengthForField(field, fact, confidence),
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
    items.push({
      id,
      group: "what_matters_most",
      label: preference.label,
      value: preference.value,
      displayValue: preference.value,
      certainty: "inferred",
      constraintStrength: "flexible",
      sourceTurnId: sourceTurn?.id,
      evidencePhrase: preference.evidencePhrase,
      userEdited: false,
      editableType: "text",
      canRemove: true,
    });
  });

  addMissingOrDefaultItems(items, defaults);

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
  });
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
    items: draft.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...updates,
            displayValue: updates.displayValue ?? displayValueForField(item.field, updates.value ?? item.value),
            userEdited: true,
          }
        : item,
    ),
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
  return draft.unresolvedFields.some((item) => item.id === "field:maxPurchaseBudget" && item.certainty === "needs_answer");
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
  return (
    previous.userEdited ||
    previous.certainty === "confirmed" ||
    Boolean(next && previous.constraintStrength !== next.constraintStrength)
  );
}

function addMissingOrDefaultItems(items: ConfirmedPreferenceItem[], defaults: BuyerProfile) {
  if (!items.some((item) => item.field === "maxPurchaseBudget")) {
    items.push({
      id: "field:maxPurchaseBudget",
      group: "your_situation",
      label: "Purchase budget",
      field: "maxPurchaseBudget",
      value: defaults.maxPurchaseBudget,
      displayValue: `Using app default of $${defaults.maxPurchaseBudget.toLocaleString()}`,
      certainty: "assumed_default",
      constraintStrength: "flexible",
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
  const style = items.find((item) => item.label.toLowerCase().includes("style") || item.label.toLowerCase().includes("design"));
  const performance = items.find((item) => item.field === "performanceImportance");
  const drivetrain = items.find((item) => item.field === "drivetrainPreference");

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
    style ? "style matters" : "",
    drivetrain ? `${drivetrain.displayValue} is ${drivetrain.constraintStrength}` : "",
  ].filter(Boolean);
  const sentenceTwo = sentenceTwoParts.length
    ? `${sentenceTwoParts.join(", ")}, and I’ll keep the risk tradeoffs visible.`
    : "I’ll keep unresolved items visible instead of pretending they are known.";

  return `${sentenceOne} ${sentenceTwo}`;
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
    requiredFuelType: "Fuel type",
  };
  return labels[field] || String(field);
}

function displayValueForField(field: keyof BuyerProfilePatch | undefined, value: unknown) {
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
  confidence: { confidence: string; requiresConfirmation: boolean; evidencePhrase: string } | undefined,
): ConstraintStrength {
  if (field === "requiredMake" || field === "requiredFuelType") return "required";
  if (fact?.label.toLowerCase().includes("required")) return "required";
  if (fact?.label.toLowerCase().includes("preferred")) return "preferred";
  if (field === "maxPurchaseBudget" && confidence?.confidence === "high" && !confidence.requiresConfirmation) return "required";
  if (field === "preferredMake") return "preferred";
  return "flexible";
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
