import type { EnrichmentDecision } from "./enrichmentDecision";
import type {
  CanonicalValidationIssue,
  CanonicalVehicleFieldPath,
  CanonicalVehicleRecord,
} from "./canonicalVehicle";
import type { CanonicalVehicleContribution } from "./canonicalVehicleContribution";
import type { Vehicle } from "./vehicle";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import type {
  NhtsaCatalogMatchCandidate,
  SourceMatchResult,
  VehicleSourceMatchName,
} from "./vehicleSourceMatch";

export const catalogEnrichmentStatuses = [
  "enriched",
  "review_required",
  "deferred",
  "skipped",
  "failed",
] as const;

export type CatalogEnrichmentStatus = (typeof catalogEnrichmentStatuses)[number];

export type CatalogDataIssueKind =
  | "validation"
  | "duplicate_identity"
  | "missing_configuration";

export type CatalogDataIssue = {
  issueId: string;
  catalogVehicleId: string;
  kind: CatalogDataIssueKind;
  field: string;
  severity: "warning" | "error";
  message: string;
  relatedCatalogVehicleIds: string[];
};

export type CatalogEnrichmentIssue = {
  code: string;
  stage: "matching" | "policy" | "contribution" | "merge" | "integrity";
  source: VehicleSourceMatchName | null;
  severity: "warning" | "error";
  message: string;
};

export type CatalogEnrichmentSourceMatches = {
  nhtsa: SourceMatchResult<NhtsaCatalogMatchCandidate> | null;
  epa: SourceMatchResult<EpaVehicleRecord> | null;
};

export type CatalogEnrichmentDecisions = {
  nhtsa: EnrichmentDecision | null;
  epa: EnrichmentDecision | null;
};

export type CatalogEnrichmentContributionDisposition = {
  source: VehicleSourceMatchName;
  sourceRecordId: string | null;
  decisionAction: EnrichmentDecision["action"] | null;
  disposition: "accepted" | "withheld" | "rejected" | "unavailable";
  reason: string;
};

export type CatalogEnrichmentEvidenceSummary = {
  canonicalFieldCount: number;
  populatedFieldCount: number;
  missingFieldCount: number;
  evidenceCount: number;
  populatedFieldsWithoutEvidence: CanonicalVehicleFieldPath[];
  fixtureEvidenceIds: string[];
  sourceTypes: string[];
  sourceRecordIds: string[];
};

export type CatalogEnrichmentSummary = {
  acceptedSources: VehicleSourceMatchName[];
  reviewRequiredSources: VehicleSourceMatchName[];
  deferredSources: VehicleSourceMatchName[];
  skippedSources: VehicleSourceMatchName[];
  failedSources: VehicleSourceMatchName[];
  partial: boolean;
  productionCatalogMutated: false;
  stagingBoundary: "runtime_only";
};

export type CatalogEnrichmentIntegrity = {
  allCanonicalFieldsPresent: boolean;
  everyPopulatedFieldHasEvidence: boolean;
  fixtureEvidenceRejected: boolean;
  onlyAutoEnrichSourcesMerged: boolean;
  catalogSnapshotUnchanged: boolean;
  sourceMetadataPreserved: boolean;
};

export type CatalogEnrichmentTraceStep = {
  sequence: number;
  stage:
    | "catalog_snapshot"
    | "source_match"
    | "enrichment_policy"
    | "contribution_adapter"
    | "canonical_merger"
    | "integrity_check";
  source: VehicleSourceMatchName | null;
  outcome: string;
};

export type CatalogEnrichmentResult = {
  catalogVehicleId: string;
  catalogSnapshot: Vehicle;
  sourceMatches: CatalogEnrichmentSourceMatches;
  enrichmentDecisions: CatalogEnrichmentDecisions;
  contributions: {
    accepted: CanonicalVehicleContribution[];
    dispositions: CatalogEnrichmentContributionDisposition[];
  };
  canonicalRecord: CanonicalVehicleRecord | null;
  status: CatalogEnrichmentStatus;
  issues: CatalogEnrichmentIssue[];
  mergerIssues: CanonicalValidationIssue[];
  catalogDataIssues: CatalogDataIssue[];
  evidenceSummary: CatalogEnrichmentEvidenceSummary;
  enrichmentSummary: CatalogEnrichmentSummary;
  integrity: CatalogEnrichmentIntegrity;
  orchestrationTrace: CatalogEnrichmentTraceStep[];
};

export type CatalogEnrichmentBatchResult = {
  selectedCatalogVehicleIds: string[];
  results: CatalogEnrichmentResult[];
  stagingBoundary: "runtime_only";
  productionCatalogMutated: false;
};

export type GoldenSetSelection = {
  criterion: string;
  rationale: string;
  vehicle: Vehicle;
};
