import type { BuyerProfile, ConstraintKey } from "@/types/buyer";
import {
  decisionParticipationValues,
  decisionPolicyConfirmationValues,
  decisionPolicyDimensionValues,
  decisionPolicySourceValues,
  type DecisionParticipation,
  type DecisionParticipationPolicy,
  type DecisionParticipationPolicyMap,
  type DecisionPolicyConfirmation,
  type DecisionPolicyDimension,
  type DecisionPolicySource,
  type SemanticDecisionPolicyInstruction,
} from "../types/decisionPolicy";

export const decisionPolicyDimensions = decisionPolicyDimensionValues;
export const decisionParticipationStates = decisionParticipationValues;

const scoreCategoryDimensions = new Set<DecisionPolicyDimension>([
  "affordability",
  "maintenanceRisk",
  "insuranceCost",
  "fuelEnergyCost",
  "resaleValue",
  "reliability",
  "safety",
  "performance",
]);

const constraintDimensions = new Set<DecisionPolicyDimension>([
  "purchaseBudget",
  "monthlyPayment",
  "make",
  "bodyStyle",
  "fuelType",
  "drivetrain",
  "transmission",
  "seating",
  "modelYear",
  "mileage",
]);

export function resolveDecisionParticipationPolicies(
  current: DecisionParticipationPolicyMap | undefined,
  updates: Array<DecisionParticipationPolicy | SemanticDecisionPolicyInstruction>,
): DecisionParticipationPolicyMap {
  const next: DecisionParticipationPolicyMap = { ...(current || {}) };
  const ordered = [...updates].sort(comparePolicyUpdates);

  for (const update of ordered) {
    const normalized = normalizeDecisionPolicy(update);
    const existing = next[normalized.dimension];
    if (!existing || shouldReplacePolicy(existing, normalized)) {
      next[normalized.dimension] = normalized;
    }
  }

  return next;
}

export function mergeDecisionParticipationPolicyMaps(
  current: DecisionParticipationPolicyMap | undefined,
  updates: DecisionParticipationPolicyMap | undefined,
) {
  return resolveDecisionParticipationPolicies(current, Object.values(updates || {}).filter(isPolicy));
}

export function validateDecisionParticipationPolicy(value: unknown): DecisionParticipationPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Decision participation policy must be an object.");
  }
  const record = value as Record<string, unknown>;
  const dimension = expectEnum(record.dimension, decisionPolicyDimensionValues, "dimension");
  const participation = expectEnum(record.participation, decisionParticipationValues, "participation");
  const source = expectEnum(record.source, decisionPolicySourceValues, "source");
  const confirmation = expectEnum(record.confirmation, decisionPolicyConfirmationValues, "confirmation");
  const confidence = clampConfidence(record.confidence);
  const importance = record.importance === undefined ? undefined : clampImportance(record.importance);
  return {
    dimension,
    participation,
    source,
    confirmation,
    confidence,
    importance,
    sourceText: expectString(record.sourceText, "sourceText"),
    messageRef: expectString(record.messageRef, "messageRef"),
    explanation: expectString(record.explanation, "explanation"),
  };
}

export function getDecisionPolicy(
  profile: Pick<BuyerProfile, "decisionPolicies">,
  dimension: DecisionPolicyDimension,
) {
  return profile.decisionPolicies?.[dimension];
}

export function isDecisionDimensionDisabled(
  profile: Pick<BuyerProfile, "decisionPolicies">,
  dimension: DecisionPolicyDimension,
) {
  if (getDecisionPolicy(profile, dimension)?.participation === "disabled") return true;
  if (
    (dimension === "purchaseBudget" || dimension === "monthlyPayment")
    && getDecisionPolicy(profile, "affordability")?.participation === "disabled"
  ) {
    return true;
  }
  return false;
}

export function isDecisionDimensionUnresolved(
  profile: Pick<BuyerProfile, "decisionPolicies">,
  dimension: DecisionPolicyDimension,
) {
  return getDecisionPolicy(profile, dimension)?.participation === "unresolved";
}

export function shouldEnforceDecisionDimension(
  profile: Pick<BuyerProfile, "decisionPolicies">,
  dimension: DecisionPolicyDimension,
) {
  if (isDecisionDimensionDisabled(profile, dimension)) return false;
  const policy = getDecisionPolicy(profile, dimension);
  return policy ? policy.participation === "enforced" : true;
}

export function policyAllowsClarification(
  policies: DecisionParticipationPolicyMap | undefined,
  dimension: DecisionPolicyDimension,
) {
  const participation = policies?.[dimension]?.participation;
  return participation !== "disabled" && participation !== "deprioritized";
}

export function policyIsPositiveCriterion(policy: DecisionParticipationPolicy) {
  return policy.participation === "active"
    || policy.participation === "enforced";
}

export function decisionDimensionForConstraint(code: ConstraintKey): DecisionPolicyDimension | undefined {
  const dimensions: Partial<Record<ConstraintKey, DecisionPolicyDimension>> = {
    totalBudget: "purchaseBudget",
    monthlyPayment: "monthlyPayment",
    make: "make",
    bodyStyle: "bodyStyle",
    drivetrain: "drivetrain",
    maxMileage: "mileage",
    minYear: "modelYear",
    transmission: "transmission",
    seating: "seating",
    fuelType: "fuelType",
    reliabilityMinimum: "reliability",
    safetyMinimum: "safety",
    performanceMinimum: "performance",
  };
  return dimensions[code];
}

export function policyDimensionForScoreCategory(category: string): DecisionPolicyDimension | undefined {
  const dimensions: Record<string, DecisionPolicyDimension> = {
    affordability: "affordability",
    reliability: "reliability",
    safety: "safety",
    fuelEnergyCost: "fuelEnergyCost",
    insuranceCost: "insuranceCost",
    maintenanceRisk: "maintenanceRisk",
    resaleValue: "resaleValue",
    drivingPreferenceFit: "performance",
  };
  return dimensions[category];
}

export function policyParticipationDisplay(
  dimension: DecisionPolicyDimension,
  participation: DecisionParticipation,
) {
  if (participation === "disabled") {
    return constraintDimensions.has(dimension) ? "No restriction" : "Not part of this recommendation";
  }
  if (participation === "deprioritized") return "Lower priority";
  if (participation === "unresolved") return "Needs clarification";
  if (participation === "enforced") return "Required";
  return scoreCategoryDimensions.has(dimension) ? "Active priority" : "Preferred";
}

export function decisionPolicyDimensionLabel(dimension: DecisionPolicyDimension) {
  const labels: Record<DecisionPolicyDimension, string> = {
    purchaseBudget: "Purchase price",
    monthlyPayment: "Monthly payment",
    totalOwnershipBudget: "Total ownership cost",
    affordability: "Affordability",
    maintenanceRisk: "Maintenance cost",
    insuranceCost: "Insurance cost",
    fuelEnergyCost: "Fuel and energy cost",
    resaleValue: "Resale value",
    reliability: "Reliability",
    safety: "Safety",
    performance: "Performance",
    make: "Make",
    bodyStyle: "Body style",
    fuelType: "Fuel type",
    drivetrain: "Drivetrain",
    transmission: "Transmission",
    seating: "Seating",
    modelYear: "Model year",
    mileage: "Mileage",
  };
  return labels[dimension];
}

export function policySourceFromInstruction(
  instruction: SemanticDecisionPolicyInstruction,
): DecisionPolicySource {
  if (instruction.status === "explicit") {
    return instruction.interpretationSource === "user_correction" ? "user_correction" : "user_explicit";
  }
  if (instruction.interpretationSource === "deterministic_fallback") return "deterministic_fallback";
  if (instruction.interpretationSource === "prior_confirmed_context") return "user_confirmed";
  if (instruction.interpretationSource === "user_correction") return "user_correction";
  if (instruction.interpretationSource === "model_interpretation") return "model_interpretation";
  return "inferred";
}

function normalizeDecisionPolicy(
  update: DecisionParticipationPolicy | SemanticDecisionPolicyInstruction,
): DecisionParticipationPolicy {
  if ("confirmation" in update) return validateDecisionParticipationPolicy(update);
  const inferred = update.status !== "explicit";
  const scoreOnlyEnforcement = scoreCategoryDimensions.has(update.dimension)
    && update.participation === "enforced";
  const participation = inferred && update.participation === "enforced"
    ? "unresolved"
    : scoreOnlyEnforcement
      ? "active"
      : update.participation;
  return {
    dimension: update.dimension,
    participation,
    importance: update.importance === null ? undefined : clampImportance(update.importance),
    source: policySourceFromInstruction(update),
    confidence: clampConfidence(update.confidence),
    confirmation: update.requiresConfirmation || inferred ? "inferred" : "explicit",
    sourceText: update.sourceText,
    messageRef: update.messageRef,
    explanation: update.explanation,
  };
}

function shouldReplacePolicy(existing: DecisionParticipationPolicy, update: DecisionParticipationPolicy) {
  const existingSequence = sequenceFromMessageRef(existing.messageRef);
  const updateSequence = sequenceFromMessageRef(update.messageRef);
  if (updateSequence !== existingSequence) return updateSequence > existingSequence;
  const sourceDifference = policyPrecedence(update) - policyPrecedence(existing);
  if (sourceDifference !== 0) return sourceDifference > 0;
  return update.confidence >= existing.confidence;
}

function comparePolicyUpdates(
  a: DecisionParticipationPolicy | SemanticDecisionPolicyInstruction,
  b: DecisionParticipationPolicy | SemanticDecisionPolicyInstruction,
) {
  return sequenceFromMessageRef(a.messageRef) - sequenceFromMessageRef(b.messageRef);
}

function policyPrecedence(policy: DecisionParticipationPolicy) {
  const byConfirmation: Record<DecisionPolicyConfirmation, number> = {
    explicit: 5,
    confirmed: 4,
    inferred: 2,
    defaulted: 1,
  };
  const correctionBoost = policy.source === "user_correction" ? 2 : 0;
  return byConfirmation[policy.confirmation] + correctionBoost;
}

function sequenceFromMessageRef(messageRef: string) {
  const match = messageRef.match(/\d+/g);
  return match?.length ? Number(match.at(-1)) : 0;
}

function isPolicy(value: DecisionParticipationPolicy | undefined): value is DecisionParticipationPolicy {
  return Boolean(value);
}

function expectEnum<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    throw new Error(`${field} must be one of ${allowed.join(", ")}.`);
  }
  return value as Value;
}

function expectString(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function clampConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error("confidence must be between 0 and 1.");
  }
  return Number(number.toFixed(2));
}

function clampImportance(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error("importance must be between 0 and 1.");
  }
  return Number(number.toFixed(2));
}
