import type {
  DefectComponentCategory,
  DefectEvidenceScope,
  DefectEvidenceType,
} from "./nhtsaReliabilityEvidence";

export const reliabilityAssessmentStates = [
  "INSUFFICIENT_EVIDENCE",
  "EVIDENCE_AVAILABLE",
  "POTENTIAL_PATTERN",
  "CORROBORATED_PATTERN",
  "STRONG_NEGATIVE_SIGNAL",
] as const;

export type ReliabilityAssessmentState = (typeof reliabilityAssessmentStates)[number];

export const reliabilityCorroborationStates = [
  "NONE",
  "ISOLATED_ALLEGATION",
  "REPEATED_ALLEGATIONS",
  "OFFICIAL_RECORD_ONLY",
  "COMPLAINT_PATTERN_WITH_RECALL",
  "COMPLAINT_PATTERN_WITH_INVESTIGATION",
  "MULTIPLE_AUTHORITATIVE_EVIDENCE_TYPES",
] as const;

export type ReliabilityCorroborationState = (typeof reliabilityCorroborationStates)[number];
export type ReliabilitySignalLevel = "CRITICAL_SIGNAL" | "SERIOUS_SIGNAL" | "MATERIAL_SIGNAL" | "LIMITED_SIGNAL" | "UNKNOWN";
export type ReliabilityInterpretationConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type ReliabilityExposureState = "KNOWN" | "PARTIAL" | "UNKNOWN";

export type ReliabilitySeveritySignal = Readonly<{
  evidenceId: string;
  evidenceType: Extract<DefectEvidenceType, "RECALL" | "COMPLAINT">;
  components: readonly DefectComponentCategory[];
  level: ReliabilitySignalLevel;
  reasons: readonly string[];
  allegation: boolean;
}>;

export type ReliabilityIssueCluster = Readonly<{
  component: DefectComponentCategory;
  complaintCount: number;
  recallCount: number;
  investigationCount: number;
  manufacturerCommunicationCount: number;
  seriousSignalCount: number;
  evidenceIds: readonly string[];
  sourceTypes: readonly DefectEvidenceType[];
  firstEvidenceDate: string | null;
  lastEvidenceDate: string | null;
  corroboration: ReliabilityCorroborationState;
  sameDefectConfirmed: false;
  confidence: Readonly<{
    level: ReliabilityInterpretationConfidenceLevel;
    basis: readonly string[];
  }>;
}>;

export type ReliabilityExposureContext = Readonly<{
  state: ReliabilityExposureState;
  vehiclePopulation: number | null;
  salesVolume: number | null;
  mileageDistribution: null;
  timeOnRoadYears: number | null;
  reportingBehaviorAdjustment: null;
  complaintRateAvailable: false;
  complaintRate: null;
  basis: readonly string[];
}>;

export type ReliabilityInterpretation = Readonly<{
  schemaVersion: "1.0.0";
  policyVersion: string;
  interpretationId: string;
  vehicleId: string;
  generatedAt: string;
  sourceSnapshotId: string;
  scope: DefectEvidenceScope;
  evidenceAvailable: boolean;
  issueClusters: readonly ReliabilityIssueCluster[];
  seriousSignals: Readonly<{
    signals: readonly ReliabilitySeveritySignal[];
    criticalCount: number;
    seriousCount: number;
    materialCount: number;
    limitedCount: number;
    unknownCount: number;
  }>;
  corroboration: Readonly<{
    state: ReliabilityCorroborationState;
    strongestComponents: readonly DefectComponentCategory[];
    basis: readonly string[];
  }>;
  exposureContext: ReliabilityExposureContext;
  applicability: Readonly<{
    scope: DefectEvidenceScope;
    confidence: "MEDIUM" | "LOW" | "UNKNOWN";
    configurationSpecific: false;
    vinSpecific: false;
    basis: readonly string[];
  }>;
  limitations: readonly string[];
  confidence: Readonly<{
    level: ReliabilityInterpretationConfidenceLevel;
    evidenceCompleteness: "PARTIAL" | "LIMITED" | "NONE";
    sourceDiversity: number;
    corroboration: ReliabilityCorroborationState;
    applicability: "MEDIUM" | "LOW" | "UNKNOWN";
    exposure: ReliabilityExposureState;
    basis: readonly string[];
  }>;
  assessmentState: ReliabilityAssessmentState;
  reliabilityScore: null;
  comparativeRank: null;
  productionRecommendationConnected: false;
}>;
