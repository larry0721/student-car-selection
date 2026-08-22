import type {
  CanonicalEvidence,
  CanonicalMissingReason,
  CanonicalRecordScope,
  CanonicalValidationSeverity,
  CanonicalVehicleFieldPath,
  CanonicalVehicleRecord,
} from "./canonicalVehicle";
import type {
  VehicleKnowledgeClaim,
  VehicleKnowledgeTrustState,
} from "./vehicleKnowledge";

export const vehicleKnowledgeCompilerDiagnosticCodes = [
  "missing_trusted_claim",
  "stale_claim_available",
  "unresolved_conflict",
  "invalid_active_claim",
  "evidence_reference_missing",
  "unsupported_value",
  "unit_mismatch",
  "claim_scope_mismatch",
  "repository_invariant_violation",
] as const;

export type VehicleKnowledgeCompilerDiagnosticCode = (typeof vehicleKnowledgeCompilerDiagnosticCodes)[number];

export type VehicleKnowledgeCompilerDiagnostic = {
  code: VehicleKnowledgeCompilerDiagnosticCode;
  fieldPath: CanonicalVehicleFieldPath;
  severity: CanonicalValidationSeverity;
  message: string;
  claimIds: string[];
  evidenceIds: string[];
};

export type VehicleKnowledgeCompilationLineage = {
  canonicalFieldPath: CanonicalVehicleFieldPath;
  activeClaimIds: string[];
  evidenceIds: string[];
  trust: Array<{
    claimId: string;
    trustScore: number;
    trustState: VehicleKnowledgeTrustState;
  }>;
  sources: Array<{
    sourceType: CanonicalEvidence["sourceType"];
    providerName: string;
    sourceRecordId: string;
  }>;
  compilationRule:
    | "single_active_trusted_claim"
    | "compatible_active_trusted_claims"
    | "compiler_confidence_summary";
};

export type VehicleKnowledgeCompilerOptions = {
  recordScope?: CanonicalRecordScope;
  recordStatus?: CanonicalVehicleRecord["recordStatus"];
};

export type KnowledgeCompilationResult = {
  record: CanonicalVehicleRecord;
  diagnostics: VehicleKnowledgeCompilerDiagnostic[];
  lineage: VehicleKnowledgeCompilationLineage[];
  claimLineage: Record<string, VehicleKnowledgeClaim>;
  evidenceLineage: Record<string, CanonicalEvidence>;
  unresolvedFields: Array<{
    fieldPath: CanonicalVehicleFieldPath;
    missingReason: CanonicalMissingReason;
    staleClaimIds: string[];
    conflictingClaimIds: string[];
  }>;
  summary: {
    populatedFields: number;
    missingFields: number;
    staleFields: number;
    conflictedFields: number;
    trustedClaimsUsed: number;
    evidenceRecordsUsed: number;
    coverage: number;
  };
};
