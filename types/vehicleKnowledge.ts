import type {
  CanonicalConfidence,
  CanonicalConfidenceLevel,
  CanonicalEvidence,
  CanonicalEvidenceDataUse,
  CanonicalEvidenceNormalizationMethod,
  CanonicalEvidenceSourceValue,
  CanonicalRecordScope,
  CanonicalSourceType,
  CanonicalUnit,
  CanonicalValueStatus,
  CanonicalVehicleFieldPath,
} from "./canonicalVehicle";
import type { CanonicalContributionSource } from "./canonicalVehicleContribution";
import type {
  CatalogEnrichmentReviewDecision,
  CatalogEnrichmentReviewer,
} from "./catalogEnrichmentReview";

export const vehicleKnowledgeClaimStatuses = [
  "proposed",
  "approved",
  "rejected",
  "superseded",
  "conflicted",
  "withdrawn",
] as const;

export type VehicleKnowledgeClaimStatus = (typeof vehicleKnowledgeClaimStatuses)[number];

export const vehicleKnowledgeTrustStates = [
  "TRUSTED",
  "REVIEW_REQUIRED",
  "CONFLICTED",
  "REJECTED",
  "STALE",
] as const;

export type VehicleKnowledgeTrustState = (typeof vehicleKnowledgeTrustStates)[number];
export type VehicleKnowledgeTrustLevel = CanonicalConfidenceLevel;
export type VehicleKnowledgeConflictState = "none" | "agrees" | "resolvable" | "blocking";
export type VehicleKnowledgeDataClassification =
  | "verified_source"
  | "reviewed_source"
  | "original_catalog"
  | "fixture"
  | "test";

export type VehicleKnowledgeTrustAssessment = {
  trustScore: number;
  trustLevel: VehicleKnowledgeTrustLevel;
  trustState: VehicleKnowledgeTrustState;
  sourceAuthority: number;
  evidenceQuality: number;
  sourceAgreement: number;
  freshness: number;
  scopeSpecificity: number;
  normalizationReliability: number;
  reviewerConfidence: number;
  conflictState: VehicleKnowledgeConflictState;
  basis: string[];
  assessedAt: string;
  policyVersion: string;
};

export type VehicleKnowledgeReviewContext = {
  reviewDecisionId: string;
  reviewer: CatalogEnrichmentReviewer;
  reason: string;
  evidence: CatalogEnrichmentReviewDecision["evidence"];
};

export type VehicleKnowledgeClaim = Readonly<{
  claimId: string;
  vehicleId: string;
  canonicalFieldPath: CanonicalVehicleFieldPath;
  canonicalValue: CanonicalEvidenceSourceValue;
  unit: CanonicalUnit;
  valueStatus: Exclude<CanonicalValueStatus, "missing">;
  estimationMethod: string | null;
  measurementContext: Record<string, string | number | boolean> | null;
  claimStatus: VehicleKnowledgeClaimStatus;
  source: CanonicalContributionSource;
  evidenceIds: string[];
  confidence: CanonicalConfidence;
  recordScope: CanonicalRecordScope;
  sourceRecordId: string;
  normalizationMethod: CanonicalEvidenceNormalizationMethod;
  observedAt: string | null;
  retrievedAt: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
  supersedesClaimId: string | null;
  supersededByClaimId: string | null;
  reviewDecisionId: string | null;
  reviewContext: VehicleKnowledgeReviewContext | null;
  trustAssessment: VehicleKnowledgeTrustAssessment;
  version: number;
  dataClassification: VehicleKnowledgeDataClassification;
}>;

export type VehicleKnowledgeProposal = {
  vehicleId: string;
  canonicalFieldPath: CanonicalVehicleFieldPath;
  canonicalValue: CanonicalEvidenceSourceValue;
  unit: CanonicalUnit;
  valueStatus: Exclude<CanonicalValueStatus, "missing">;
  estimationMethod: string | null;
  measurementContext: Record<string, string | number | boolean> | null;
  source: CanonicalContributionSource;
  evidence: CanonicalEvidence[];
  confidence: CanonicalConfidence;
  recordScope: CanonicalRecordScope;
  normalizationMethod: CanonicalEvidenceNormalizationMethod;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  createdAt: string;
  reviewDecision?: CatalogEnrichmentReviewDecision | null;
  dataClassification: VehicleKnowledgeDataClassification;
};

export type VehicleKnowledgeEventType =
  | "proposal_added"
  | "claim_approved"
  | "claim_rejected"
  | "claim_superseded"
  | "claim_withdrawn"
  | "conflict_detected";

export type VehicleKnowledgeEvent = Readonly<{
  eventId: string;
  eventType: VehicleKnowledgeEventType;
  claimId: string;
  relatedClaimIds: string[];
  occurredAt: string;
  reason: string;
  reviewDecisionId: string | null;
}>;

export type VehicleKnowledgeRepositoryDataUse = Extract<CanonicalEvidenceDataUse, "production" | "fixture" | "test">;

export type VehicleKnowledgeRepositoryState = Readonly<{
  schemaVersion: "1.0.0";
  repositoryId: string;
  dataUse: VehicleKnowledgeRepositoryDataUse;
  storageBoundary: "vehicle_knowledge_only";
  originalCatalogMutated: false;
  createdAt: string;
  updatedAt: string;
  claims: VehicleKnowledgeClaim[];
  evidence: CanonicalEvidence[];
  events: VehicleKnowledgeEvent[];
}>;

export type VehicleKnowledgeConflict = {
  vehicleId: string;
  canonicalFieldPath: CanonicalVehicleFieldPath;
  claimIds: string[];
  values: CanonicalEvidenceSourceValue[];
  reason: string;
  blocking: boolean;
};

export type VehicleKnowledgeSnapshot = Readonly<{
  vehicleId: string;
  generatedAt: string;
  activeClaims: VehicleKnowledgeClaim[];
  inactiveClaims: VehicleKnowledgeClaim[];
  conflictedClaims: VehicleKnowledgeClaim[];
  unresolvedConflicts: VehicleKnowledgeConflict[];
  /** Stale claims for fields that have no current trusted resolution. */
  staleClaims: VehicleKnowledgeClaim[];
  /** Stale claims retained only as superseded, terminal, or resolved history. */
  historicalStaleClaims: VehicleKnowledgeClaim[];
  evidence: CanonicalEvidence[];
  rejectedHistoryCount: number;
  supersededHistoryCount: number;
  evidenceSummary: {
    evidenceCount: number;
    sourceTypes: CanonicalSourceType[];
    providerNames: string[];
    sourceRecordIds: string[];
  };
  trustSummary: {
    trustedCount: number;
    reviewRequiredCount: number;
    conflictedCount: number;
    staleCount: number;
    historicalStaleCount: number;
    unresolvedStaleFieldCount: number;
    averageTrustScore: number | null;
  };
  coverageSummary: {
    activeFieldCount: number;
    proposedFieldCount: number;
    conflictedFieldCount: number;
    canonicalFieldPaths: CanonicalVehicleFieldPath[];
  };
}>;

export interface VehicleKnowledgeRepository {
  addProposal(proposal: VehicleKnowledgeProposal): VehicleKnowledgeClaim;
  approveClaim(claimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim;
  rejectClaim(claimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim;
  supersedeClaim(claimId: string, replacementClaimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim;
  withdrawClaim(claimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim;
  getClaim(claimId: string): VehicleKnowledgeClaim | null;
  getClaimsForVehicle(vehicleId: string): VehicleKnowledgeClaim[];
  getClaimsForField(vehicleId: string, canonicalFieldPath: CanonicalVehicleFieldPath): VehicleKnowledgeClaim[];
  getActiveClaimsForVehicle(vehicleId: string, asOf: string): VehicleKnowledgeClaim[];
  getKnowledgeHistory(vehicleId: string): VehicleKnowledgeEvent[];
  getConflictsForVehicle(vehicleId: string): VehicleKnowledgeConflict[];
  getKnowledgeSnapshot(vehicleId: string, asOf: string): VehicleKnowledgeSnapshot;
  exportState(): VehicleKnowledgeRepositoryState;
}

export type VehicleKnowledgeTransitionInput = {
  occurredAt: string;
  reason: string;
  reviewDecision?: CatalogEnrichmentReviewDecision | null;
};
