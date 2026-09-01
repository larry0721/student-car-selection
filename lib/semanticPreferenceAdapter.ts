import type {
  BuyerProfilePatch,
  InferredPreference,
  InterpretationConfidence,
  PreferenceConflict,
  PreferenceFact,
  PreferenceFieldConfidence,
  PreferenceInterpretation,
  PreferenceUncertainty,
} from "./preferenceInterpretation";
import {
  mapValidatedUnderstandingToProfile,
  type CanonicalMappedConcept,
} from "./semanticMapping";
import type { SemanticUnderstandingServiceResult } from "./semanticUnderstandingService";
import type { ValidatedUnderstanding } from "./semanticUnderstanding";

export function preferenceInterpretationFromSemanticResult(
  rawUserMessage: string,
  result: SemanticUnderstandingServiceResult,
): PreferenceInterpretation {
  if (!result.validatedUnderstanding) {
    return failureInterpretation(
      rawUserMessage,
      result.fallbackReason || result.providerFailure?.message || "Semantic understanding needs clarification.",
    );
  }
  return preferenceInterpretationFromValidatedUnderstanding(
    rawUserMessage,
    result.validatedUnderstanding,
    result.fallbackUsed ? "fallback" : "semantic",
  );
}

export function preferenceInterpretationFromValidatedUnderstanding(
  rawUserMessage: string,
  understanding: ValidatedUnderstanding,
  parserSource: "semantic" | "fallback" = "semantic",
): PreferenceInterpretation {
  const mapping = mapValidatedUnderstandingToProfile(understanding);
  const explicitFacts: PreferenceFact[] = [];
  const inferredPreferences: InferredPreference[] = [];
  const confidenceByField: PreferenceFieldConfidence[] = [];

  mapping.concepts.forEach((item) => {
    if (item.destination && item.supportStatus === "supported_and_used" && item.intent !== "uncertain") {
      const fact = toFact(item);
      explicitFacts.push(fact);
      confidenceByField.push({
        field: item.destination,
        value: normalizeConfidenceValue(item),
        confidence: confidenceLabel(item.confidence),
        evidencePhrase: item.sourceText,
        requiresConfirmation: item.requiresConfirmation,
        mappingId: item.id,
        canonicalIntent: item.intent,
        supportStatus: item.supportStatus,
      });
      const supportingPreference = supportingPreferenceFor(item);
      if (supportingPreference) inferredPreferences.push(supportingPreference);
      return;
    }

    inferredPreferences.push({
      label: labelForConcept(item),
      value: displayValue(item),
      evidencePhrase: item.sourceText,
      requiresConfirmation: item.requiresConfirmation || item.intent === "uncertain",
      semanticConcept: item.semanticConcept,
      recommendationSupport: item.supportStatus === "supported_and_used"
        ? "used_in_recommendation"
        : "understood_not_ranked",
      mappingId: item.id,
      canonicalIntent: item.intent,
      supportStatus: item.supportStatus,
    });
  });

  const uncertainties: PreferenceUncertainty[] = understanding.draft.uncertainties.map((uncertainty) => ({
    topic: normalizeUncertaintyTopic(uncertainty.topic),
    evidencePhrase: uncertainty.sourceText,
    question: normalizeQuestion(uncertainty.question),
  }));
  if (
    understanding.selectedClarification
    && !uncertainties.some((uncertainty) => uncertainty.question === understanding.selectedClarification?.question)
  ) {
    uncertainties.push({
      topic: normalizeUncertaintyTopic(understanding.selectedClarification.relatedConcepts[0] || "Clarification"),
      evidencePhrase: rawUserMessage,
      question: normalizeQuestion(understanding.selectedClarification.question),
    });
  }

  const conflicts: PreferenceConflict[] = understanding.draft.conflicts.map((conflict) => ({
    topic: conflict.topic,
    description: conflict.description,
    evidencePhrases: conflict.evidenceRefs,
    conflictType: conflict.conflictType,
  }));

  return {
    rawUserMessage,
    interpretationSummary: buildSemanticSummary(explicitFacts, inferredPreferences, conflicts),
    explicitFacts: dedupeBy(explicitFacts, (fact) => fact.mappingId || `${fact.field}:${fact.value}`),
    inferredPreferences: dedupeBy(inferredPreferences, (preference) => preference.mappingId || preference.label),
    uncertainties: dedupeBy(uncertainties, (uncertainty) => uncertainty.topic),
    conflicts: dedupeBy(conflicts, (conflict) => conflict.topic),
    confidenceByField: dedupeBy(confidenceByField, (field) => field.mappingId || field.field),
    suggestedProfileUpdates: mapping.profilePatch as BuyerProfilePatch,
    nextClarifyingQuestion:
      uncertainties[0]?.question
      || mapping.clarificationConcepts[0]?.clarificationRule
      || "What is the maximum budget you want me to work within?",
    parserSource,
    canonicalMappings: mapping.concepts,
    decisionPolicies: mapping.decisionPolicies,
  };
}

function supportingPreferenceFor(item: CanonicalMappedConcept): InferredPreference | null {
  const labels: Partial<Record<CanonicalMappedConcept["semanticConcept"], string>> = {
    acceleration: "Acceleration matters",
    handling: "Driving feel matters",
    engagement: "Driving feel matters",
    reliability: "Reliability matters",
    repair_risk: "Repair risk matters",
    fuel_sensitivity: "Fuel cost matters",
    cargo: "Cargo space matters",
  };
  const label = labels[item.semanticConcept];
  if (!label) return null;
  return {
    label,
    value: displayValue(item),
    evidencePhrase: item.sourceText,
    field: item.destination,
    requiresConfirmation: item.requiresConfirmation,
    semanticConcept: item.semanticConcept,
    recommendationSupport: "used_in_recommendation",
    mappingId: item.id,
    canonicalIntent: item.intent,
    supportStatus: item.supportStatus,
  };
}

function toFact(item: CanonicalMappedConcept): PreferenceFact {
  return {
    label: labelForDestination(item.destination),
    value: displayValue(item),
    evidencePhrase: item.sourceText,
    field: item.destination,
    mappingId: item.id,
    canonicalIntent: item.intent,
    supportStatus: item.supportStatus,
  };
}

function normalizeConfidenceValue(item: CanonicalMappedConcept) {
  if (item.destination === "allowedMakes" || item.destination === "excludedMakes") {
    return Array.isArray(item.value) ? item.value.map(String) : [String(item.value)];
  }
  if (["maxPurchaseBudget", "monthlyBudget", "familySize", "minYear", "maxMileage"].includes(item.destination || "")) {
    return Number(Array.isArray(item.value) ? item.value[0] : item.value);
  }
  if (item.destination === "reliabilityImportance" || item.destination === "fuelEconomyImportance" || item.destination === "performanceImportance" || item.destination === "resaleValueImportance") {
    return 5;
  }
  if (item.destination === "safetyPriority") return "high";
  return Array.isArray(item.value) ? item.value.map(String) : String(item.value);
}

function labelForDestination(destination: CanonicalMappedConcept["destination"]) {
  const labels: Partial<Record<NonNullable<CanonicalMappedConcept["destination"]>, string>> = {
    requiredMake: "Required make",
    preferredMake: "Preferred make",
    allowedMakes: "Allowed makes",
    excludedMakes: "Excluded makes",
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
    bodyStyle: "Body style",
    requiredFuelType: "Fuel type",
    drivetrainPreference: "Drivetrain",
    transmissionPreference: "Transmission",
    familySize: "Passenger capacity",
    maxPurchaseBudget: "Purchase budget",
    monthlyBudget: "Monthly budget",
    minYear: "Minimum year",
    maxMileage: "Maximum mileage",
    reliabilityImportance: "Reliability",
    safetyPriority: "Safety",
    fuelEconomyImportance: "Fuel economy",
    performanceImportance: "Performance",
    resaleValueImportance: "Resale value",
  };
  return destination ? labels[destination] || String(destination) : "Preference";
}

function labelForConcept(item: CanonicalMappedConcept) {
  if (item.supportStatus === "recognized_out_of_scope") return "Outside current scope";
  if (item.semanticConcept === "maintenance_tolerance" || item.semanticConcept === "repair_risk") return "Repair risk matters";
  if (item.supportStatus === "unresolved") return item.semanticConcept === "unknown" ? "Unrecognized vehicle term" : "Unresolved preference";
  if (item.semanticConcept === "luxury_feel") return "Premium feel matters";
  const labels: Partial<Record<CanonicalMappedConcept["conceptType"], string>> = {
    premium_appearance: "Premium appearance matters",
    comfort: "Comfort matters",
    quietness: "Quietness matters",
    camping_use: "Camping use",
    status_image: "Image matters",
    vehicle_model: "Vehicle model reference",
    vehicle_category: "Vehicle category",
    ownership_budget: "Ownership cost matters",
    unknown: "Unresolved preference",
  };
  return labels[item.conceptType] || labelForDestination(item.destination) || "Preference";
}

function displayValue(item: CanonicalMappedConcept) {
  const raw = Array.isArray(item.value) ? item.value.join(", ") : String(item.value);
  if (item.destination === "maxPurchaseBudget" || item.destination === "monthlyBudget") {
    const value = Number(item.value);
    if (Number.isFinite(value)) return `${item.intent === "required" ? "Up to " : "Around "}$${value.toLocaleString()}`;
  }
  if (item.destination === "reliabilityImportance" || item.destination === "fuelEconomyImportance" || item.destination === "performanceImportance" || item.destination === "resaleValueImportance") {
    return "Very important";
  }
  if (item.destination === "safetyPriority") return "High";
  return raw;
}

function confidenceLabel(confidence: number): InterpretationConfidence {
  return confidence >= 0.82 ? "high" : confidence >= 0.62 ? "medium" : "low";
}

function failureInterpretation(rawUserMessage: string, reason: string): PreferenceInterpretation {
  return {
    rawUserMessage,
    interpretationSummary: "I need to clarify that before I turn it into preferences.",
    explicitFacts: [],
    inferredPreferences: [],
    uncertainties: [{
      topic: "Understanding",
      evidencePhrase: rawUserMessage,
      question: "What is the most important thing you want this car to do for you?",
    }],
    conflicts: [{
      topic: "Understanding unavailable",
      description: reason,
      evidencePhrases: [rawUserMessage],
    }],
    confidenceByField: [],
    suggestedProfileUpdates: {},
    nextClarifyingQuestion: "What is the most important thing you want this car to do for you?",
    parserSource: "fallback",
    canonicalMappings: [],
    decisionPolicies: {},
  };
}

function buildSemanticSummary(
  facts: PreferenceFact[],
  preferences: InferredPreference[],
  conflicts: PreferenceConflict[],
) {
  const pieces = [
    ...facts.slice(0, 2).map((fact) => fact.value),
    ...preferences.slice(0, 2).map((preference) => preference.value),
  ];
  const base = pieces.length
    ? `I’m reading this as ${formatList(pieces)}.`
    : "I’m still turning that into clear car-buying preferences.";
  if (conflicts.length) return `${base} There is one tradeoff I want to clarify before I treat it as settled.`;
  return base;
}

function normalizeQuestion(question: string) {
  if (/powerful|power/i.test(question)) {
    return "What kind of power matters most: quick acceleration, sporty handling, or truck-like capability?";
  }
  return question;
}

function normalizeUncertaintyTopic(topic: string) {
  if (/power/i.test(topic)) return "Meaning of powerful";
  return topic;
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string | number | symbol | undefined) {
  const map = new Map<string | number | symbol, T>();
  items.forEach((item) => {
    const key = keyFor(item);
    if (key) map.set(key, item);
  });
  return Array.from(map.values());
}

function formatList(values: string[]) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (unique.length <= 1) return unique[0] || "your priorities";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique.at(-1)}`;
}
