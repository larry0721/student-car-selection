import type { BuyerProfile } from "@/types/buyer";
import {
  getMappingRuleForSemanticConcept,
  semanticMappingRegistry,
  type CanonicalSemanticIntent,
  type DecisionOntologyConcept,
  type SemanticProfileDestination,
  type SemanticSupportStatus,
  type VehicleDomainConcept,
} from "./carDomainOntology";
import { normalizeVehicleMake, recognizeMakesInText } from "./makeRegistry";
import type {
  ProposedConstraintStrength,
  UnderstandingInterpretation,
  ValidatedUnderstanding,
} from "./semanticUnderstanding";
import { resolveDecisionParticipationPolicies } from "./decisionParticipationPolicy";
import type { DecisionParticipationPolicyMap } from "@/types/decisionPolicy";
import { resolveScopedRelationshipIntent } from "./semanticPolarity";

export type SemanticConfirmationStatus = "confirmed" | "unconfirmed";
export type SemanticMappingSource =
  | "user_explicit"
  | "model_interpretation"
  | "deterministic_fallback"
  | "prior_confirmed_context"
  | "user_correction";

export type CanonicalMappedConcept = {
  id: string;
  semanticConcept: UnderstandingInterpretation["concept"];
  conceptType: VehicleDomainConcept;
  decisionConcept: DecisionOntologyConcept;
  value: string | number | boolean | string[];
  intent: CanonicalSemanticIntent;
  strength: number;
  confirmationStatus: SemanticConfirmationStatus;
  confidence: number;
  source: SemanticMappingSource;
  sourceText: string;
  messageRef: string;
  supportStatus: SemanticSupportStatus;
  destination?: SemanticProfileDestination;
  requiresConfirmation: boolean;
  interpretationExplanation: string;
  clarificationRule: string;
  preservationRule: string;
};

export type SemanticMappingResult = {
  concepts: CanonicalMappedConcept[];
  profilePatch: Partial<Omit<BuyerProfile, "scoreWeights">>;
  decisionPolicies: DecisionParticipationPolicyMap;
  preservedConcepts: CanonicalMappedConcept[];
  clarificationConcepts: CanonicalMappedConcept[];
};

type InterpretationBucket =
  | "explicitPreferences"
  | "inferredPreferences"
  | "recognizedEntities"
  | "referenceEntities"
  | "emotionalGoals"
  | "practicalGoals"
  | "aversions"
  | "constraints"
  | "unresolvedConcepts";

type BucketedInterpretation = {
  bucket: InterpretationBucket;
  item: UnderstandingInterpretation;
};

export function mapValidatedUnderstandingToProfile(
  understanding: ValidatedUnderstanding,
): SemanticMappingResult {
  const mapped = collectInterpretations(understanding)
    .map(({ bucket, item }) => mapInterpretation(item, bucket))
    .filter((item): item is CanonicalMappedConcept => Boolean(item));
  const concepts = resolveCanonicalConcepts(
    normalizeRelationshipSets(
      keepEvidenceSupportedObjectiveValues(
        keepEvidenceSupportedRequiredMakes(mapped),
      ),
      understanding.currentMessage || understanding.draft.conversationSummary,
    ),
  );
  const decisionPolicies = resolveDecisionParticipationPolicies(
    undefined,
    understanding.draft.decisionPolicyInstructions,
  );
  const profilePatch = {
    ...buildProfilePatch(concepts),
    ...(Object.keys(decisionPolicies).length ? { decisionPolicies } : {}),
  };
  const preservedConcepts = concepts.filter((item) => item.supportStatus !== "supported_and_used");
  const clarificationConcepts = concepts.filter(
    (item) => item.intent === "uncertain" || item.supportStatus === "supported_but_needs_confirmation" || item.supportStatus === "unresolved",
  );

  return { concepts, profilePatch, decisionPolicies, preservedConcepts, clarificationConcepts };
}

export function mergeCanonicalConcepts(
  current: CanonicalMappedConcept[] = [],
  updates: CanonicalMappedConcept[] = [],
): CanonicalMappedConcept[] {
  const resolvedUpdates = resolveCanonicalConcepts(updates);
  const positiveReplacementTypes = new Set(
    resolvedUpdates
      .filter((item) => relationshipConcepts.has(item.conceptType) && (item.intent === "required" || item.intent === "preferred"))
      .map((item) => item.conceptType),
  );
  const next = resolveCanonicalConcepts(current).filter((item) =>
    !(
      positiveReplacementTypes.has(item.conceptType)
      && (item.intent === "required" || item.intent === "preferred" || item.intent === "allowed")
    )
  );
  const updateKeys = new Set(
    resolvedUpdates.map((item) => `${item.conceptType}:${canonicalValueKey(item.value)}`),
  );

  // The caller supplies `updates` from the latest turn. That ordering is more
  // authoritative than provider-authored message references such as
  // "current-message", which are not guaranteed to be monotonic.
  return [
    ...next.filter((item) => !updateKeys.has(`${item.conceptType}:${canonicalValueKey(item.value)}`)),
    ...resolvedUpdates,
  ];
}

export function buildProfilePatch(
  concepts: CanonicalMappedConcept[],
): Partial<Omit<BuyerProfile, "scoreWeights">> {
  const patch: Partial<Omit<BuyerProfile, "scoreWeights">> = {};

  for (const item of concepts) {
    if (item.conceptType === "vehicle_make") continue;
    if (
      item.intent === "uncertain"
      || !["supported_and_used", "supported_but_needs_confirmation"].includes(item.supportStatus)
      || !item.destination
    ) continue;
    applyDestination(patch, item);
  }

  applyMakeState(patch, concepts.filter((item) => item.conceptType === "vehicle_make"));
  applyLegacyDimensionFields(patch);
  resolveMakeConflicts(patch);
  return patch;
}

function collectInterpretations(understanding: ValidatedUnderstanding): BucketedInterpretation[] {
  const draft = understanding.draft;
  return [
    ...draft.explicitPreferences.map((item) => ({ bucket: "explicitPreferences" as const, item })),
    ...draft.inferredPreferences.map((item) => ({ bucket: "inferredPreferences" as const, item })),
    ...draft.recognizedEntities.map((item) => ({ bucket: "recognizedEntities" as const, item })),
    ...draft.referenceEntities.map((item) => ({ bucket: "referenceEntities" as const, item })),
    ...draft.emotionalGoals.map((item) => ({ bucket: "emotionalGoals" as const, item })),
    ...draft.practicalGoals.map((item) => ({ bucket: "practicalGoals" as const, item })),
    ...draft.aversions.map((item) => ({ bucket: "aversions" as const, item })),
    ...draft.constraints.map((item) => ({ bucket: "constraints" as const, item })),
    ...draft.unresolvedConcepts.map((item) => ({ bucket: "unresolvedConcepts" as const, item })),
  ];
}

function mapInterpretation(
  item: UnderstandingInterpretation,
  bucket: InterpretationBucket,
): CanonicalMappedConcept | null {
  const conceptType = getVehicleDomainConcept(item);
  const rule = semanticMappingRegistry[conceptType] || getMappingRuleForSemanticConcept(item.concept);
  const intent = resolveIntent(item, bucket);
  const supportStatus = resolveSupportStatus(item, conceptType, intent, rule.supportByIntent[intent]);
  const destination = intent !== "uncertain"
    && (supportStatus === "supported_and_used" || supportStatus === "supported_but_needs_confirmation")
    ? rule.destinations[intent]
    : undefined;

  return {
    id: item.id,
    semanticConcept: item.concept,
    conceptType,
    decisionConcept: decisionConceptFor(intent, item),
    value: normalizeConceptValue(conceptType, item.proposedValue),
    intent,
    strength: strengthValue(item.proposedConstraintStrength),
    confirmationStatus: item.requiresConfirmation ? "unconfirmed" : "confirmed",
    confidence: item.confidence,
    source: sourceFor(item),
    sourceText: item.sourceText,
    messageRef: item.messageRef,
    supportStatus,
    destination,
    requiresConfirmation: item.requiresConfirmation,
    interpretationExplanation: item.interpretationExplanation,
    clarificationRule: rule.clarificationRule,
    preservationRule: rule.preservationRule,
  };
}

function resolveIntent(
  item: UnderstandingInterpretation,
  bucket: InterpretationBucket,
): CanonicalSemanticIntent {
  if (item.intent) return item.intent;
  if (bucket === "aversions") return "excluded";
  if (item.status === "uncertain" || item.status === "unresolved") return "uncertain";
  if (bucket === "constraints" || item.proposedConstraintStrength === "required") return "required";
  return "preferred";
}

function getVehicleDomainConcept(item: UnderstandingInterpretation): VehicleDomainConcept {
  const value = valueText(item.proposedValue);
  switch (item.concept) {
    case "make": return "vehicle_make";
    case "model": return "vehicle_model";
    case "body_style": return "body_style";
    case "vehicle_category":
      if (isOutOfScopeValue(value)) return "unknown";
      if (/camping|campground|trailhead/i.test(value + " " + item.sourceText)) return "camping_use";
      return "vehicle_category";
    case "powertrain": return "fuel_type";
    case "drivetrain": return "drivetrain";
    case "transmission": return "transmission";
    case "passenger_capacity": return "seating_capacity";
    case "purchase_budget": return "purchase_budget";
    case "monthly_budget":
    case "insurance_sensitivity":
    case "maintenance_tolerance": return "ownership_budget";
    case "commute":
    case "trip_distance": return "mileage";
    case "reliability":
    case "repair_risk":
    case "long_term_ownership": return "reliability";
    case "safety": return "safety";
    case "fuel_sensitivity": return "fuel_economy";
    case "acceleration":
    case "handling":
    case "engagement": return "performance";
    case "resale_value":
    case "depreciation_concern": return "resale_value";
    case "styling":
    case "luxury_feel": return "premium_appearance";
    case "comfort": return "comfort";
    case "quietness": return "quietness";
    case "status_image": return "status_image";
    case "snow_use":
      return /\b(?:AWD|4WD|FWD|RWD|all-wheel|four-wheel|front-wheel|rear-wheel)\b/i.test(value)
        ? "drivetrain"
        : "unknown";
    case "unknown": return "unknown";
    default: return "unknown";
  }
}

function resolveSupportStatus(
  item: UnderstandingInterpretation,
  conceptType: VehicleDomainConcept,
  intent: CanonicalSemanticIntent,
  registryStatus: SemanticSupportStatus,
): SemanticSupportStatus {
  const text = `${valueText(item.proposedValue)} ${item.sourceText} ${item.interpretationExplanation}`;
  if (conceptType === "unknown" && isOutOfScopeValue(text)) return "recognized_out_of_scope";
  if (conceptType === "unknown") return "unresolved";
  if (intent === "uncertain") return "supported_but_needs_confirmation";
  if (item.requiresConfirmation && registryStatus === "supported_and_used") return "supported_but_needs_confirmation";
  return registryStatus;
}

function resolveCanonicalConcepts(items: CanonicalMappedConcept[]): CanonicalMappedConcept[] {
  const byEntity = new Map<string, CanonicalMappedConcept>();
  for (const item of items) {
    const key = `${item.conceptType}:${canonicalValueKey(item.value)}`;
    const current = byEntity.get(key);
    if (!current || shouldReplace(current, item)) byEntity.set(key, item);
  }
  return Array.from(byEntity.values());
}

function keepEvidenceSupportedRequiredMakes(items: CanonicalMappedConcept[]) {
  return items.flatMap((item) => {
    if (item.conceptType !== "vehicle_make" || item.intent !== "required") return [item];

    const mentionedMakes = new Set(
      recognizeMakesInText(item.sourceText).map((make) => make.canonicalName.toLowerCase()),
    );
    const supportedValues = asStringArray(item.value)
      .map((value) => normalizeVehicleMake(value) || value)
      .filter((value) => mentionedMakes.has(value.toLowerCase()));

    if (supportedValues.length === 0) return [withMakeIntent(item, "uncertain")];
    return supportedValues.map((value) => ({ ...item, value }));
  });
}

function keepEvidenceSupportedObjectiveValues(items: CanonicalMappedConcept[]) {
  return items.filter((item) => {
    if (
      !["body_style", "vehicle_category", "fuel_type", "drivetrain", "transmission"]
        .includes(item.conceptType)
    ) {
      return true;
    }
    if (item.source === "prior_confirmed_context") return true;
    return objectiveValueAppearsInEvidence(item);
  });
}

function objectiveValueAppearsInEvidence(item: CanonicalMappedConcept) {
  const evidence = item.sourceText;
  const patterns: Partial<Record<CanonicalMappedConcept["conceptType"], Record<string, RegExp>>> = {
    body_style: bodyStyleEvidencePatterns,
    vehicle_category: bodyStyleEvidencePatterns,
    fuel_type: {
      gas: /\b(?:gas|gasoline)\b/i,
      hybrid: /\bhybrid\b/i,
      electric: /\b(?:electric|ev)\b/i,
      diesel: /\bdiesel\b/i,
    },
    drivetrain: {
      awd: /\b(?:awd|all[-\s]?wheel)\b/i,
      "4wd": /\b(?:4wd|four[-\s]?wheel)\b/i,
      fwd: /\b(?:fwd|front[-\s]?wheel)\b/i,
      rwd: /\b(?:rwd|rear[-\s]?wheel)\b/i,
    },
    transmission: {
      automatic: /\bautomatic\b/i,
      manual: /\b(?:manual|stick(?: shift)?)\b/i,
      cvt: /\bcvt\b/i,
    },
  };
  const values = asStringArray(item.value).map((value) => value.toLowerCase());
  return values.length > 0 && values.every(
    (value) => patterns[item.conceptType]?.[value]?.test(evidence) ?? false,
  );
}

const bodyStyleEvidencePatterns: Record<string, RegExp> = {
  sedan: /\bsedans?\b/i,
  suv: /\b(?:suvs?|crossovers?)\b/i,
  hatchback: /\bhatch(?:backs?)?\b/i,
  truck: /\b(?:trucks?|pickups?|truck beds?)\b/i,
  coupe: /\bcoupes?\b/i,
  convertible: /\b(?:convertibles?|cabriolets?)\b/i,
  wagon: /\b(?:wagons?|estates?)\b/i,
  minivan: /\b(?:minivans?|mini vans?)\b/i,
};

function normalizeRelationshipSets(
  items: CanonicalMappedConcept[],
  conversationSummary: string,
) {
  const latestMessage = conversationSummary.split(/\s+\/\s+/).at(-1) || conversationSummary;
  let normalized = items.map((item) => {
    if (!relationshipConcepts.has(item.conceptType) || !isDeterministicRelationshipRecovery(item)) return item;
    const value = String(item.value);
    if (item.conceptType === "vehicle_make" && !normalizeVehicleMake(value)) {
      return item;
    }
    const evidence = relationshipEvidence(latestMessage, item);
    const bare = latestMessage.trim().replace(/[.!?]/g, "").toLowerCase() === evidence.toLowerCase();
    const explicitIntent = resolveScopedRelationshipIntent(latestMessage, {
      canonicalValue: value,
      evidence,
    });
    if (explicitIntent) return withCanonicalIntent(item, explicitIntent);
    if (bare) return withCanonicalIntent(item, "uncertain");
    return item;
  });
  if (
    /\b(?:or|either)\b/i.test(latestMessage)
    && !normalized.some((item) => relationshipConcepts.has(item.conceptType) && item.intent === "excluded")
    && !/\b(?:no|not|neither|except|exclude|avoid|stay away from|deal[-\s]?breaker|don['’]?t want|do not want|anything (?:but|except))\b/i.test(latestMessage)
    && !/\b(?:prefer|preferred|acceptable|okay|ok|fine|allowed|only|must|required|need|want)\b/i.test(latestMessage)
  ) {
    for (const conceptType of relationshipConcepts) {
      const related = normalized.filter(
        (item) => item.conceptType === conceptType && isDeterministicRelationshipRecovery(item),
      );
      if (related.length < 2) continue;
      const relatedIds = new Set(related.map((item) => item.id));
      const intent = conceptType === "vehicle_make" ? "allowed" : "uncertain";
      normalized = normalized.map((item) =>
        relatedIds.has(item.id) ? withCanonicalIntent(item, intent) : item
      );
    }
  }
  if (/\b(?:acceptable|okay|ok|fine|allowed|fallback|if necessary)\b/i.test(latestMessage)) {
    for (const conceptType of relationshipConcepts) {
      const related = normalized.filter(
        (item) => item.conceptType === conceptType && isDeterministicRelationshipRecovery(item),
      );
      if (!related.some((item) => item.intent === "allowed")) continue;
      const requiredIds = new Set(
        related
          .filter((item) => {
            if (item.intent !== "required") return false;
            const value = String(item.value);
            const evidence = relationshipEvidence(latestMessage, item);
            const intent = resolveScopedRelationshipIntent(latestMessage, { canonicalValue: value, evidence });
            // An explicitly allowed fallback makes the primary fallback value
            // flexible, even though it remains the user's first choice.
            return intent !== "required" || related.some((candidate) => candidate.intent === "allowed");
          })
          .map((item) => item.id),
      );
      normalized = normalized.map((item) =>
        requiredIds.has(item.id)
          ? withCanonicalIntent(item, "preferred")
          : related.some((relatedItem) => relatedItem.id === item.id && relatedItem.intent === "uncertain")
            ? withCanonicalIntent(item, "allowed")
            : item
      );
    }
  }
  return normalized;
}

// Relationship recovery is only for deterministic fallback output. A
// successful model already returned the user's intent and must not be recast
// by keyword or coordination heuristics during mapping.
function isDeterministicRelationshipRecovery(item: CanonicalMappedConcept) {
  return item.source === "deterministic_fallback"
    || item.source === "user_explicit";
}

function relationshipEvidence(message: string, item: CanonicalMappedConcept) {
  if (item.conceptType === "vehicle_make") {
    return recognizeMakesInText(message)
      .find((make) => make.canonicalName.toLowerCase() === String(item.value).toLowerCase())
      ?.rawText || item.sourceText;
  }
  const pattern = objectiveEvidencePattern(item);
  return pattern ? message.match(pattern)?.[0] || item.sourceText : item.sourceText;
}

function objectiveEvidencePattern(item: CanonicalMappedConcept) {
  const value = String(item.value).toLowerCase();
  const patterns: Partial<Record<CanonicalMappedConcept["conceptType"], Record<string, RegExp>>> = {
    body_style: bodyStyleEvidencePatterns,
    vehicle_category: bodyStyleEvidencePatterns,
    fuel_type: {
      gas: /\b(?:gas|gasoline)\b/i,
      hybrid: /\bhybrid\b/i,
      electric: /\b(?:electric|ev)\b/i,
      diesel: /\bdiesel\b/i,
    },
    drivetrain: {
      awd: /\b(?:awd|all[-\s]?wheel(?: drive)?)\b/i,
      "4wd": /\b(?:4wd|four[-\s]?wheel(?: drive)?)\b/i,
      fwd: /\b(?:fwd|front[-\s]?wheel(?: drive)?)\b/i,
      rwd: /\b(?:rwd|rear[-\s]?wheel(?: drive)?)\b/i,
    },
    transmission: {
      automatic: /\bautomatic(?: transmission)?\b/i,
      manual: /\b(?:manual(?: transmission)?|stick(?: shift)?)\b/i,
      cvt: /\bcvt\b/i,
    },
  };
  return patterns[item.conceptType]?.[value];
}

const relationshipConcepts = new Set<VehicleDomainConcept>([
  "vehicle_make",
  "body_style",
  "vehicle_category",
  "fuel_type",
  "drivetrain",
  "transmission",
]);

function applyMakeState(
  patch: Partial<Omit<BuyerProfile, "scoreWeights">>,
  makeMappings: CanonicalMappedConcept[],
) {
  const active = makeMappings.filter(
    (item) =>
      item.intent !== "uncertain"
      && (item.supportStatus === "supported_and_used" || item.supportStatus === "supported_but_needs_confirmation")
      && item.destination,
  );
  if (active.length === 0) return;

  const excludedMakes = collectMakeValues(active.filter((item) => item.intent === "excluded"));
  const allowedMakes = collectMakeValues(active.filter((item) => item.intent === "allowed"));
  const requiredMakes = latestMakeValues(active.filter((item) => item.intent === "required"));
  const preferredMakes = latestMakeValues(active.filter((item) => item.intent === "preferred"));
  const requiredMake = resolveSingleMakeRequirement(requiredMakes);
  const preferredMake = resolveSingleMakeRequirement(preferredMakes);

  if (excludedMakes.length) patch.excludedMakes = excludedMakes;
  if (requiredMakes.length) {
    patch.requiredMakes = requiredMakes;
    patch.requiredMake = requiredMake;
    patch.preferredMake = undefined;
  } else if (preferredMakes.length) {
    patch.preferredMakes = preferredMakes;
    patch.preferredMake = preferredMake;
    patch.requiredMake = undefined;
  }
  if (allowedMakes.length) patch.allowedMakes = allowedMakes;
  if (excludedMakes.length) patch.excludedMakes = excludedMakes;
}

function collectMakeValues(items: CanonicalMappedConcept[]) {
  return Array.from(new Set(items.flatMap((item) => asStringArray(item.value))
    .map((value) => normalizeVehicleMake(value) || value)
    .filter(Boolean)));
}

function latestMakeValues(items: CanonicalMappedConcept[]) {
  if (items.length === 0) return [];
  const latestReference = items.reduce(
    (latest, item) => compareMessageRefs(item.messageRef, latest) > 0 ? item.messageRef : latest,
    items[0].messageRef,
  );
  return collectMakeValues(items.filter((item) => item.messageRef === latestReference));
}

function resolveSingleMakeRequirement(values: string[]) {
  return values.length === 1 ? values[0] : undefined;
}

function withMakeIntent(
  item: CanonicalMappedConcept,
  intent: CanonicalSemanticIntent,
): CanonicalMappedConcept {
  return withCanonicalIntent(item, intent);
}

function withCanonicalIntent(
  item: CanonicalMappedConcept,
  intent: CanonicalSemanticIntent,
): CanonicalMappedConcept {
  const destination = intent === "uncertain"
    ? undefined
    : semanticMappingRegistry[item.conceptType]?.destinations[intent];
  return {
    ...item,
    intent,
    decisionConcept: intent === "required"
      ? "hard_constraint"
      : intent === "allowed"
        ? "allowed_fallback"
        : intent === "excluded"
          ? "exclusion"
          : intent === "uncertain"
            ? "uncertainty"
            : "preference",
    destination,
    supportStatus: intent === "uncertain" ? "supported_but_needs_confirmation" : "supported_and_used",
    confirmationStatus: intent === "uncertain" ? "unconfirmed" : item.confirmationStatus,
    requiresConfirmation: intent === "uncertain" || item.requiresConfirmation,
  };
}

function shouldReplace(current: CanonicalMappedConcept, next: CanonicalMappedConcept) {
  if (next.messageRef !== current.messageRef) return compareMessageRefs(next.messageRef, current.messageRef) >= 0;
  const precedence: Record<CanonicalSemanticIntent, number> = {
    excluded: 5,
    required: 4,
    preferred: 3,
    allowed: 2,
    uncertain: 1,
  };
  if (precedence[next.intent] !== precedence[current.intent]) return precedence[next.intent] > precedence[current.intent];
  if (next.confirmationStatus !== current.confirmationStatus) return next.confirmationStatus === "confirmed";
  return next.confidence >= current.confidence;
}

function compareMessageRefs(a: string, b: string) {
  const aNumber = Number(a.match(/\d+/)?.[0] || 0);
  const bNumber = Number(b.match(/\d+/)?.[0] || 0);
  return aNumber - bNumber;
}

function applyDestination(
  patch: Partial<Omit<BuyerProfile, "scoreWeights">>,
  item: CanonicalMappedConcept,
) {
  const destination = item.destination;
  if (!destination) return;
  const value = normalizeDestinationValue(destination, item.value);
  if (value === undefined) return;

  if (isMultiValueDestination(destination)) {
    const record = patch as Record<string, unknown>;
    const current = Array.isArray(record[destination]) ? record[destination] as string[] : [];
    record[destination] = Array.from(new Set([...current, ...asStringArray(value)]));
    return;
  }

  (patch as Record<string, unknown>)[destination] = value;
  if (destination === "bodyStyle" && item.intent === "preferred") {
    patch.flexibleConstraints = Array.from(new Set([...(patch.flexibleConstraints || []), "bodyStyle"]));
    patch.allowCompromises = true;
  }
  if (destination === "drivetrainPreference" && item.intent === "preferred") {
    patch.flexibleConstraints = Array.from(new Set([...(patch.flexibleConstraints || []), "drivetrain"]));
    patch.allowCompromises = true;
  }
  if (destination === "transmissionPreference" && item.intent === "preferred") {
    patch.flexibleConstraints = Array.from(new Set([...(patch.flexibleConstraints || []), "transmission"]));
    patch.allowCompromises = true;
  }
}

function normalizeDestinationValue(destination: SemanticProfileDestination, value: CanonicalMappedConcept["value"]) {
  if (["requiredMake", "preferredMake", "allowedMakes", "excludedMakes", "requiredMakes", "preferredMakes"].includes(destination)) {
    const makes = asStringArray(value).map((make) => normalizeVehicleMake(make) || make).filter(Boolean);
    return destination === "requiredMake" || destination === "preferredMake" ? makes[0] : makes;
  }
  if (["bodyStyle", "requiredBodyStyles", "preferredBodyStyles", "allowedBodyStyles", "excludedBodyStyles", "requiredVehicleCategories", "preferredVehicleCategories", "allowedVehicleCategories", "excludedVehicleCategories"].includes(destination)) {
    const normalized = asStringArray(value).map((item) => normalizeBodyStyle(item)).filter(Boolean);
    return destination === "bodyStyle" ? normalized[0] : normalized;
  }
  if (["requiredFuelType", "requiredFuelTypes", "preferredFuelTypes", "allowedFuelTypes", "excludedFuelTypes"].includes(destination)) {
    const normalized = asStringArray(value).map((item) => normalizeFuelType(item)).filter(Boolean);
    return destination === "requiredFuelType" ? normalized[0] : normalized;
  }
  if (["drivetrainPreference", "requiredDrivetrains", "preferredDrivetrains", "allowedDrivetrains", "excludedDrivetrains"].includes(destination)) {
    const normalized = asStringArray(value).map((item) => normalizeDrivetrain(item)).filter(Boolean);
    return destination === "drivetrainPreference" ? normalized[0] : normalized;
  }
  if (["transmissionPreference", "requiredTransmissions", "preferredTransmissions", "allowedTransmissions", "excludedTransmissions"].includes(destination)) {
    const normalized = asStringArray(value).map((item) => normalizeTransmission(item)).filter(Boolean);
    return destination === "transmissionPreference" ? normalized[0] : normalized;
  }
  if (destination === "familySize" || destination === "maxPurchaseBudget" || destination === "monthlyBudget" || destination === "minYear" || destination === "maxMileage") {
    const number = Number(Array.isArray(value) ? value[0] : value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
  }
  if (destination === "safetyPriority") return "high";
  if (["reliabilityImportance", "fuelEconomyImportance", "performanceImportance", "resaleValueImportance"].includes(destination)) return 5;
  return value;
}

function isMultiValueDestination(destination: SemanticProfileDestination) {
  return [
    "requiredMakes", "preferredMakes", "allowedMakes", "excludedMakes",
    "requiredBodyStyles", "preferredBodyStyles", "allowedBodyStyles", "excludedBodyStyles",
    "requiredVehicleCategories", "preferredVehicleCategories", "allowedVehicleCategories", "excludedVehicleCategories",
    "requiredFuelTypes", "preferredFuelTypes", "allowedFuelTypes", "excludedFuelTypes",
    "requiredDrivetrains", "preferredDrivetrains", "allowedDrivetrains", "excludedDrivetrains",
    "requiredTransmissions", "preferredTransmissions", "allowedTransmissions", "excludedTransmissions",
  ].includes(destination);
}

function applyLegacyDimensionFields(patch: Partial<Omit<BuyerProfile, "scoreWeights">>) {
  if (patch.requiredBodyStyles?.length === 1) patch.bodyStyle = patch.requiredBodyStyles[0];
  if (patch.requiredFuelTypes?.length === 1) patch.requiredFuelType = patch.requiredFuelTypes[0];
  const drivetrain = patch.requiredDrivetrains?.[0] || patch.preferredDrivetrains?.[0];
  if (drivetrain) patch.drivetrainPreference = drivetrain;
  const transmission = patch.requiredTransmissions?.[0] || patch.preferredTransmissions?.[0];
  if (transmission && transmission !== "cvt") {
    patch.transmissionPreference = transmission;
  }
}

function resolveMakeConflicts(patch: Partial<Omit<BuyerProfile, "scoreWeights">>) {
  const excluded = new Set((patch.excludedMakes || []).map((make) => make.toLowerCase()));
  if (patch.requiredMake && excluded.has(patch.requiredMake.toLowerCase())) patch.requiredMake = undefined;
  if (patch.preferredMake && excluded.has(patch.preferredMake.toLowerCase())) patch.preferredMake = undefined;
  if (patch.allowedMakes) patch.allowedMakes = patch.allowedMakes.filter((make) => !excluded.has(make.toLowerCase()));
  if (patch.requiredMake) {
    const required = patch.requiredMake.toLowerCase();
    patch.preferredMake = undefined;
    if (patch.allowedMakes) patch.allowedMakes = patch.allowedMakes.filter((make) => make.toLowerCase() !== required);
  }
}

function decisionConceptFor(intent: CanonicalSemanticIntent, item: UnderstandingInterpretation): DecisionOntologyConcept {
  if (item.status === "contradicted") return "conflict";
  if (intent === "required") return "hard_constraint";
  if (intent === "allowed") return "allowed_fallback";
  if (intent === "excluded") return "exclusion";
  if (intent === "uncertain") return "uncertainty";
  return "preference";
}

function sourceFor(item: UnderstandingInterpretation): SemanticMappingSource {
  if (item.interpretationSource === "deterministic_fallback") return "deterministic_fallback";
  if (item.interpretationSource === "prior_confirmed_context") return "prior_confirmed_context";
  if (item.interpretationSource === "user_correction") return "user_correction";
  if (item.interpretationSource === "model_interpretation") return "model_interpretation";
  return item.status === "explicit" ? "user_explicit" : "model_interpretation";
}

function strengthValue(strength: ProposedConstraintStrength) {
  if (strength === "required") return 1;
  if (strength === "preferred") return 0.7;
  if (strength === "flexible") return 0.4;
  return 0;
}

function normalizeConceptValue(concept: VehicleDomainConcept, value: CanonicalMappedConcept["value"]) {
  if (concept === "vehicle_make") {
    if (Array.isArray(value)) return value.map((item) => normalizeVehicleMake(item) || item);
    return normalizeVehicleMake(String(value)) || value;
  }
  if (concept === "body_style" || concept === "vehicle_category") return normalizeRelationshipValue(value, normalizeBodyStyle);
  if (concept === "fuel_type") return normalizeRelationshipValue(value, normalizeFuelType);
  if (concept === "drivetrain") return normalizeRelationshipValue(value, normalizeDrivetrain);
  if (concept === "transmission") return normalizeRelationshipValue(value, normalizeTransmission);
  return value;
}

function normalizeRelationshipValue(
  value: CanonicalMappedConcept["value"],
  normalizer: (item: CanonicalMappedConcept["value"]) => string | undefined,
) {
  if (!Array.isArray(value)) return normalizer(value) || value;
  const normalized = Array.from(new Set(value.map((item) => normalizer(item)).filter(Boolean))) as string[];
  return normalized.length ? normalized : value;
}

function normalizeBodyStyle(value: CanonicalMappedConcept["value"]) {
  const text = valueText(value);
  if (/sedan/i.test(text)) return "sedan";
  if (/suv|crossover/i.test(text)) return "suv";
  if (/hatch/i.test(text)) return "hatchback";
  if (/truck|pickup/i.test(text)) return "truck";
  if (/coupe/i.test(text)) return "coupe";
  if (/convertible|cabriolet/i.test(text)) return "convertible";
  if (/wagon|estate/i.test(text)) return "wagon";
  if (/minivan|mini van/i.test(text)) return "minivan";
  return undefined;
}

function normalizeFuelType(value: CanonicalMappedConcept["value"]) {
  const text = valueText(value);
  if (/hybrid/i.test(text)) return "hybrid";
  if (/electric|\bev\b/i.test(text)) return "electric";
  if (/diesel/i.test(text)) return "diesel";
  if (/\bgas|gasoline\b/i.test(text)) return "gas";
  return undefined;
}

function normalizeDrivetrain(value: CanonicalMappedConcept["value"]) {
  const text = valueText(value);
  if (/\bAWD\b|all[-\s]?wheel/i.test(text)) return "AWD";
  if (/\b4WD\b|four[-\s]?wheel/i.test(text)) return "4WD";
  if (/\bFWD\b|front[-\s]?wheel/i.test(text)) return "FWD";
  if (/\bRWD\b|rear[-\s]?wheel/i.test(text)) return "RWD";
  return undefined;
}

function normalizeTransmission(value: CanonicalMappedConcept["value"]) {
  const text = valueText(value);
  if (/\bcvt\b/i.test(text)) return "cvt";
  if (/automatic/i.test(text)) return "automatic";
  if (/manual|stick/i.test(text)) return "manual";
  return undefined;
}

function isOutOfScopeValue(value: string) {
  return /\b(?:motorcycle|motorbike|rv|recreational vehicle|camper van|atv|electric scooter|scooter|boat)\b/i.test(value);
}

function canonicalValueKey(value: CanonicalMappedConcept["value"]) {
  return asStringArray(value).map((item) => item.trim().toLowerCase()).sort().join("|");
}

function valueText(value: CanonicalMappedConcept["value"]) {
  return Array.isArray(value) ? value.join(" ") : String(value);
}

function asStringArray(value: unknown) {
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
}
