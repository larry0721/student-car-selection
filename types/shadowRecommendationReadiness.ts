import type { BuyerProfile } from "./buyer";
import type { CanonicalVehicleFieldPath } from "./canonicalVehicle";
import type { VehicleDecisionDimension, VehicleDecisionReadiness } from "./vehicleFieldPolicy";
import type { DecisionReport, RecommendationObject } from "./vehicle";

export const shadowReadinessLevelValues = ["READY", "PARTIALLY_READY", "INSUFFICIENT", "BLOCKED"] as const;
export type ShadowReadinessLevel = (typeof shadowReadinessLevelValues)[number];

export const legacyCVREvidenceClassificationValues = [
  "LEGACY_SUPPORTED_BY_CVR",
  "LEGACY_NOT_YET_VERIFIED",
  "CVR_MORE_SPECIFIC",
  "CVR_MISSING",
  "CVR_STALE",
  "CVR_CONFLICTED",
  "DIFFERENT_SEMANTICS",
  "NOT_RELEVANT_TO_BUYER",
] as const;
export type LegacyCVREvidenceClassification = (typeof legacyCVREvidenceClassificationValues)[number];

export type ShadowRequirementEvaluation = Readonly<{
  dimension: VehicleDecisionDimension;
  requiredValue: unknown;
  actualValue: unknown;
  evidenceAvailable: boolean;
  status: "PASSED" | "FAILED" | "EVIDENCE_UNAVAILABLE";
  reason: string;
}>;

export type ShadowEvidenceComparison = Readonly<{
  dimension: VehicleDecisionDimension;
  classification: LegacyCVREvidenceClassification;
  legacyUsed: boolean;
  cvrSupported: boolean;
  fieldPaths: CanonicalVehicleFieldPath[];
  reason: string;
}>;

export type ShadowLegacyResult = Readonly<{
  catalogCount: number;
  candidateCount: number;
  qualifiedCount: number;
  compromiseCount: number;
  excludedCount: number;
  winner: RecommendationObject | null;
  runnerUp: RecommendationObject | null;
  decisionReport: DecisionReport;
}>;

export type ShadowVehicleReadinessComparison = Readonly<{
  vehicleId: string;
  vehicleLabel: string;
  publishedCVRVersion: number;
  publicationFingerprint: string;
  decisionReadiness: VehicleDecisionReadiness;
  readiness: ShadowReadinessLevel;
  relevantDimensions: VehicleDecisionDimension[];
  supportedDimensions: VehicleDecisionDimension[];
  unsupportedDimensions: VehicleDecisionDimension[];
  unsupportedRequiredDimensions: VehicleDecisionDimension[];
  failedRequiredDimensions: VehicleDecisionDimension[];
  staleRelevantDimensions: VehicleDecisionDimension[];
  conflictedRelevantDimensions: VehicleDecisionDimension[];
  disclosureRequirements: VehicleDecisionReadiness["disclosureRequirements"];
  decisionCoverage: number;
  legacyDimensionsCurrentlyUsed: VehicleDecisionDimension[];
  legacyDimensionsUnsupportedByCVR: VehicleDecisionDimension[];
  trustedCVRDimensionsUnusedByLegacy: VehicleDecisionDimension[];
  potentialConfidenceImpact: VehicleDecisionReadiness["confidenceImpact"];
  requirementEvaluations: ShadowRequirementEvaluation[];
  evidenceComparisons: ShadowEvidenceComparison[];
  diagnostics: string[];
}>;

export type ShadowRecommendationReadinessSummary = Readonly<{
  vehicleCount: number;
  averageDecisionCoverage: number;
  readinessCounts: Record<ShadowReadinessLevel, number>;
  unsupportedRequiredDimensions: VehicleDecisionDimension[];
  materialMissingDimensions: VehicleDecisionDimension[];
  disclosureRequiredCount: number;
}>;

export type ShadowRecommendationReadinessComparison = Readonly<{
  evaluationMode: "shadow_capability_only";
  buyerProfileId: string;
  buyerProfile: BuyerProfile;
  legacyResult: ShadowLegacyResult;
  vehicleComparisons: ShadowVehicleReadinessComparison[];
  summary: ShadowRecommendationReadinessSummary;
  rankingProduced: false;
  productionRecommendationMutated: false;
}>;
