import type { VehicleDefectIdentity } from "./nhtsaReliabilityEvidence";
import type {
  ReliabilityAssessmentState,
  ReliabilityInterpretationConfidenceLevel,
  ReliabilityIssueCluster,
  ReliabilitySeveritySignal,
} from "./reliabilityInterpretation";
import type {
  ExposureNormalizedReliabilityEvidence,
  VehicleExposureResult,
} from "./vehicleExposure";

export const reliabilityConcernLevels = [
  "INSUFFICIENT_EVIDENCE",
  "NO_MEANINGFUL_SIGNAL",
  "LIMITED_CONCERN",
  "MEANINGFUL_CONCERN",
  "ELEVATED_CONCERN",
] as const;

export type ReliabilityConcernLevel = (typeof reliabilityConcernLevels)[number];

export type ReliabilityConcern = Readonly<{
  component: ReliabilityIssueCluster["component"];
  complaintCount: number;
  recallCount: number;
  seriousSignalPresent: boolean;
  corroboration: ReliabilityIssueCluster["corroboration"];
  confidence: ReliabilityIssueCluster["confidence"];
  evidenceIds: readonly string[];
  selectionReasons: readonly ("CORROBORATED" | "RECURRING" | "SERIOUS_SIGNAL" | "DECISION_RELEVANT_COMPONENT")[];
}>;

export type ReliabilityExplanationFact = Readonly<{
  factId: string;
  kind:
    | "RECURRING_COMPONENT_PATTERN"
    | "CORROBORATED_BY_RECALL"
    | "SERIOUS_SIGNAL_PRESENT"
    | "MODEL_YEAR_APPLICABILITY"
    | "EXPOSURE_RATE_UNAVAILABLE"
    | "COMPLAINTS_REMAIN_ALLEGATIONS"
    | "NO_MEANINGFUL_SIGNAL_IS_NOT_PERFECT_RELIABILITY";
  component: ReliabilityIssueCluster["component"] | null;
  evidenceIds: readonly string[];
  value: string | number | boolean | null;
  qualifier: string;
}>;

export type ReliabilityRiskAssessment = Readonly<{
  schemaVersion: "1.0.0";
  policyVersion: string;
  assessmentId: string;
  vehicleId: string;
  vehicle: VehicleDefectIdentity;
  sourceInterpretationId: string;
  generatedAt: string;
  assessmentState: ReliabilityAssessmentState;
  concernLevel: ReliabilityConcernLevel;
  issueClusters: readonly ReliabilityIssueCluster[];
  primaryConcerns: readonly ReliabilityConcern[];
  corroboratedConcerns: readonly ReliabilityConcern[];
  seriousSignals: Readonly<{
    signals: readonly ReliabilitySeveritySignal[];
    criticalCount: number;
    seriousCount: number;
    materialCount: number;
    limitedCount: number;
    unknownCount: number;
  }>;
  applicability: Readonly<{
    scope: "model_year";
    confidence: "MEDIUM" | "LOW" | "UNKNOWN";
    configurationSpecific: false;
    vinSpecific: false;
    basis: readonly string[];
  }>;
  evidenceConfidence: Readonly<{
    level: ReliabilityInterpretationConfidenceLevel;
    basis: readonly string[];
  }>;
  exposureContext: Readonly<{
    providerResult: VehicleExposureResult;
    normalizedEvidence: ExposureNormalizedReliabilityEvidence;
  }>;
  limitations: readonly string[];
  explanationFacts: readonly ReliabilityExplanationFact[];
  comparativeReliabilitySupported: false;
  recommendationScoringEligible: false;
  reliabilityScore: null;
  comparativeRank: null;
  productionRecommendationConnected: false;
}>;
