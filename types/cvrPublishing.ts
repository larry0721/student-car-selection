import type {
  CanonicalValidationSeverity,
  CanonicalVehicleFieldPath,
  CanonicalVehicleRecord,
} from "./canonicalVehicle";

export const cvrPublishingActions = [
  "PUBLISH",
  "REVIEW_REQUIRED",
  "HOLD",
  "REJECT",
] as const;

export type CVRPublishingAction = (typeof cvrPublishingActions)[number];

export const cvrPublishingDiagnosticCodes = [
  "missing_required_identity",
  "invalid_identity_value",
  "compiler_error_unresolved",
  "blocking_conflict",
  "stale_knowledge_present",
  "insufficient_trusted_claim_coverage",
  "data_quality_below_threshold",
  "evidence_quality_below_threshold",
  "source_agreement_below_threshold",
  "repository_trust_below_threshold",
  "publishability_score_below_threshold",
  "evidence_reference_missing",
  "claim_lineage_missing",
  "untrusted_claim_used",
  "record_integrity_violation",
] as const;

export type CVRPublishingDiagnosticCode = (typeof cvrPublishingDiagnosticCodes)[number];

export type CVRPublishingDiagnostic = {
  code: CVRPublishingDiagnosticCode;
  severity: CanonicalValidationSeverity;
  message: string;
  fieldPath: CanonicalVehicleFieldPath | "record";
  claimIds: string[];
  evidenceIds: string[];
};

export type CVRPublishingThresholds = {
  requiredIdentityFields: readonly CanonicalVehicleFieldPath[];
  minimumTrustedClaims: number;
  minimumDataQualityCoverage: number;
  minimumEvidenceQuality: number;
  minimumSourceAgreement: number;
  minimumRepositoryTrust: number;
  minimumPublishabilityScore: number;
  maximumBlockingStaleFields: number;
  maximumConflictedFields: number;
};

export type CVRPublishingMetrics = {
  requiredIdentityFieldsPresent: number;
  requiredIdentityFieldsTotal: number;
  identityIntegrity: number;
  populatedSourceFields: number;
  trustedClaimsUsed: number;
  trustedClaimCoverage: number;
  sourceEvidenceRecords: number;
  evidenceCompleteness: number;
  dataQualityCoverage: number;
  evidenceQuality: number;
  sourceAgreement: number;
  repositoryTrust: number;
  staleFields: number;
  blockingStaleFields: number;
  nonBlockingStaleFields: number;
  blockingStaleFieldPaths: CanonicalVehicleFieldPath[];
  nonBlockingStaleFieldPaths: CanonicalVehicleFieldPath[];
  conflictedFields: number;
  compilerErrors: number;
};

export type CVRPublishingCheck = {
  check: string;
  passed: boolean;
  actual: string | number | boolean;
  required: string | number | boolean;
};

export type CVRPublishAuditRecord = Readonly<{
  auditId: string;
  policyVersion: string;
  candidateRecordId: string;
  candidateFingerprint: string;
  evaluatedAt: string;
  action: CVRPublishingAction;
  publishabilityScore: number;
  thresholds: CVRPublishingThresholds;
  metrics: CVRPublishingMetrics;
  checks: CVRPublishingCheck[];
  diagnosticCodes: CVRPublishingDiagnosticCode[];
  trustedClaimIds: string[];
  evidenceIds: string[];
}>;

export type PublishedCanonicalVehicleRecord = Readonly<{
  record: CanonicalVehicleRecord;
  publication: {
    status: "published";
    active: true;
    publishedAt: string;
    policyVersion: string;
    auditId: string;
    sourceCompilationRecordId: string;
  };
}>;

export type CVRPublishingDecision = Readonly<{
  action: CVRPublishingAction;
  publishable: boolean;
  publishabilityScore: number;
  reason: string;
  candidateRecordId: string;
  metrics: CVRPublishingMetrics;
  thresholds: CVRPublishingThresholds;
  checks: CVRPublishingCheck[];
  diagnostics: CVRPublishingDiagnostic[];
  reviewNotes: string[];
  auditRecord: CVRPublishAuditRecord;
  publishedRecord: PublishedCanonicalVehicleRecord | null;
}>;
