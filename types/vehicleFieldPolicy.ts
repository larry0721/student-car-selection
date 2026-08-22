import type { ScoreWeights } from "./buyer";
import type { CanonicalVehicleFieldPath } from "./canonicalVehicle";
import type { DecisionPolicyDimension, DecisionParticipation } from "./decisionPolicy";

export const publicationCriticalityValues = [
  "REQUIRED_IDENTITY",
  "CORE_VEHICLE",
  "DECISION_RELEVANT",
  "OPTIONAL_ENRICHMENT",
] as const;

export type PublicationCriticality = (typeof publicationCriticalityValues)[number];

export const vehicleFieldFreshnessClassValues = [
  "STATIC",
  "SLOW_CHANGING",
  "DYNAMIC",
  "HIGHLY_DYNAMIC",
] as const;

export type VehicleFieldFreshnessClass = (typeof vehicleFieldFreshnessClassValues)[number];

export const vehicleFieldRecommendationRoleValues = [
  "QUALIFICATION",
  "SCORING",
  "EXPLANATION",
  "CONFIDENCE",
] as const;

export type VehicleFieldRecommendationRole = (typeof vehicleFieldRecommendationRoleValues)[number];

export const fieldMissingBehaviorValues = [
  "BLOCK_PUBLICATION",
  "ALLOW_WITH_DIAGNOSTIC",
] as const;

export type FieldMissingBehavior = (typeof fieldMissingBehaviorValues)[number];

export const fieldStaleBehaviorValues = [
  "BLOCK_PUBLICATION",
  "DIAGNOSE_AND_EXCLUDE_FROM_DECISION",
] as const;

export type FieldStaleBehavior = (typeof fieldStaleBehaviorValues)[number];

export const vehicleDecisionDimensionValues = [
  "purchaseBudget",
  "monthlyPayment",
  "totalOwnershipBudget",
  "affordability",
  "maintenanceRisk",
  "insuranceCost",
  "fuelEnergyCost",
  "fuelEconomy",
  "resaleValue",
  "reliability",
  "safety",
  "performance",
  "make",
  "model",
  "bodyStyle",
  "vehicleCategory",
  "fuelType",
  "drivetrain",
  "transmission",
  "seating",
  "modelYear",
  "mileage",
  "condition",
  "practicality",
  "comfort",
  "technology",
  "evRange",
  "charging",
  "emissions",
  "image",
  "lifestyle",
] as const;

export type VehicleDecisionDimension = (typeof vehicleDecisionDimensionValues)[number];

export type CanonicalVehicleFieldPolicy = Readonly<{
  fieldPath: CanonicalVehicleFieldPath;
  ontologyConcept: string;
  publicationCriticality: PublicationCriticality;
  recommendationRoles: readonly VehicleFieldRecommendationRole[];
  scoringCategories: readonly (keyof ScoreWeights)[];
  freshnessClass: VehicleFieldFreshnessClass;
  missingBehavior: FieldMissingBehavior;
  staleBehavior: FieldStaleBehavior;
  supportedDecisionDimensions: readonly VehicleDecisionDimension[];
}>;

export type VehicleKnowledgeAvailability =
  | "TRUSTED"
  | "ESTIMATED"
  | "MISSING"
  | "STALE"
  | "CONFLICTED"
  | "UNTRUSTED";

export type DecisionDisclosureRequirement = Readonly<{
  dimension: VehicleDecisionDimension;
  level: "REQUIRED" | "CONFIDENCE_ONLY";
  reason: string;
  fieldPaths: CanonicalVehicleFieldPath[];
}>;

export type VehicleDecisionFieldEvaluation = Readonly<{
  fieldPath: CanonicalVehicleFieldPath;
  availability: VehicleKnowledgeAvailability;
  decisionEligible: boolean;
  estimated: boolean;
  reason: string;
}>;

export type VehicleDecisionDimensionEvaluation = Readonly<{
  dimension: VehicleDecisionDimension;
  participation: DecisionParticipation;
  materiality: "REQUIRED" | "IMPORTANT" | "SUPPORTING";
  relevant: true;
  weight: number;
  fieldEvaluations: VehicleDecisionFieldEvaluation[];
  supportedFieldPaths: CanonicalVehicleFieldPath[];
  unsupportedFieldPaths: CanonicalVehicleFieldPath[];
  supportRatio: number;
  scoreEligible: boolean;
  estimatedSupport: boolean;
}>;

export type VehicleDecisionReadiness = Readonly<{
  vehicleRecordId: string;
  relevantDimensions: VehicleDecisionDimensionEvaluation[];
  supportedDimensions: VehicleDecisionDimension[];
  unsupportedDimensions: VehicleDecisionDimension[];
  staleRelevantDimensions: VehicleDecisionDimension[];
  conflictedRelevantDimensions: VehicleDecisionDimension[];
  decisionCoverage: number;
  confidenceImpact: {
    coveragePenalty: number;
    estimatedDataPenalty: number;
    level: "NONE" | "LOW" | "MODERATE" | "HIGH";
    reasons: string[];
  };
  disclosureRequirements: DecisionDisclosureRequirement[];
  scoringEligibleDimensions: VehicleDecisionDimension[];
  scoringIneligibleDimensions: VehicleDecisionDimension[];
}>;

export type DecisionPolicyDimensionBridge = Partial<
  Record<DecisionPolicyDimension, readonly VehicleDecisionDimension[]>
>;
