import type { CanonicalVehicleRecord } from "./canonicalVehicle";
import type { CanonicalVehicleContribution } from "./canonicalVehicleContribution";
import type { CatalogDataIssue, CatalogEnrichmentResult } from "./catalogEnrichment";
import type { EnrichmentDecision } from "./enrichmentDecision";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import type {
  NhtsaCatalogMatchCandidate,
  SourceMatchCandidateAssessment,
  SourceMatchDimension,
  SourceMatchResult,
  VehicleSourceMatchName,
} from "./vehicleSourceMatch";
import type { Vehicle } from "./vehicle";

export const catalogEnrichmentReviewStatuses = [
  "pending",
  "approved",
  "rejected",
  "deferred",
  "corrected",
  "not_found",
] as const;

export type CatalogEnrichmentReviewStatus = (typeof catalogEnrichmentReviewStatuses)[number];

export const catalogEnrichmentReviewActions = [
  "APPROVE_SOURCE",
  "REJECT_SOURCE",
  "DEFER",
  "CORRECT_CATALOG_METADATA",
  "MARK_NOT_FOUND",
] as const;

export type CatalogEnrichmentReviewAction = (typeof catalogEnrichmentReviewActions)[number];
export type CatalogEnrichmentReviewDataUse = "production" | "fixture";

export type CatalogEnrichmentReviewer = {
  reviewerId: string;
  displayName?: string;
};

export type CatalogReviewVehicleSnapshot = Vehicle & {
  trim?: string | null;
  vehicleCategory?: string | null;
  engineDisplacementLiters?: number | null;
  cylinders?: number | null;
  vin?: string | null;
  externalIds?: Array<{ namespace: string; value: string }>;
};

export type CatalogReviewComparisonSnapshot = {
  modelYear: number | null;
  make: string | null;
  model: string | null;
  bodyType: string | null;
  fuelType: string | null;
  drivetrain: string | null;
  transmission: string | null;
  trim: string | null;
  engineDisplacementLiters: number | null;
  cylinders: number | null;
};

export type CatalogEnrichmentReviewCandidate<SourceRecord> = {
  sourceRecordId: string;
  sourceRecord: SourceRecord;
  comparisonSnapshot: CatalogReviewComparisonSnapshot;
  eligible: boolean;
  confidence: number;
  matchedOn: SourceMatchDimension[];
  conflicts: string[];
  missingComparisonFields: SourceMatchDimension[];
  rationale: string[];
};

export type CatalogEnrichmentReviewComparison = {
  catalog: CatalogReviewComparisonSnapshot;
  leadingCandidateSourceRecordId: string | null;
  candidate: CatalogReviewComparisonSnapshot | null;
  differences: Array<{
    field: keyof CatalogReviewComparisonSnapshot;
    catalogValue: string | number | null;
    candidateValue: string | number | null;
  }>;
  unresolvedFields: SourceMatchDimension[];
  suggestedNextEvidence: string[];
};

export type CatalogEnrichmentReviewPriority = {
  tier: 1 | 2 | 3 | 4;
  score: number;
  reason: string;
  unlockFields: SourceMatchDimension[];
};

type CatalogEnrichmentReviewItemBase<SourceRecord> = {
  reviewId: string;
  catalogVehicleId: string;
  catalogSnapshot: CatalogReviewVehicleSnapshot;
  matchResult: SourceMatchResult<SourceRecord>;
  enrichmentDecision: EnrichmentDecision;
  candidates: CatalogEnrichmentReviewCandidate<SourceRecord>[];
  detectedCatalogIssues: CatalogDataIssue[];
  requestedReviewFields: SourceMatchDimension[];
  comparison: CatalogEnrichmentReviewComparison;
  priority: CatalogEnrichmentReviewPriority;
  status: CatalogEnrichmentReviewStatus;
  dataUse: CatalogEnrichmentReviewDataUse;
  createdAt: string;
  updatedAt: string;
};

export type NhtsaCatalogEnrichmentReviewItem = CatalogEnrichmentReviewItemBase<NhtsaCatalogMatchCandidate> & {
  source: "nhtsa";
};

export type EpaCatalogEnrichmentReviewItem = CatalogEnrichmentReviewItemBase<EpaVehicleRecord> & {
  source: "epa";
};

export type CatalogEnrichmentReviewItem =
  | NhtsaCatalogEnrichmentReviewItem
  | EpaCatalogEnrichmentReviewItem;

export type CatalogCorrectionField =
  | "model"
  | "bodyType"
  | "fuelType"
  | "drivetrain"
  | "transmission"
  | "trim"
  | "engineDisplacementLiters"
  | "cylinders";

export type CatalogMetadataCorrection = {
  field: CatalogCorrectionField;
  originalValue: string | number | null;
  correctedValue: string | number | null;
  reason: string;
  supportingEvidence: string[];
};

export type CatalogEnrichmentReviewEvidence = {
  kind: "source_record" | "catalog_issue" | "reviewer_note";
  reference: string;
  note: string;
};

export type CatalogEnrichmentReviewDecision = Readonly<{
  decisionId: string;
  reviewId: string;
  catalogVehicleId: string;
  source: VehicleSourceMatchName;
  action: CatalogEnrichmentReviewAction;
  selectedSourceRecordId: string | null;
  selectedCandidateSnapshot: NhtsaCatalogMatchCandidate | EpaVehicleRecord | null;
  reason: string;
  evidence: CatalogEnrichmentReviewEvidence[];
  catalogCorrections: CatalogMetadataCorrection[];
  resolvedConflicts: string[];
  unresolvedFields: SourceMatchDimension[];
  reviewedCandidateIds: string[];
  reviewer: CatalogEnrichmentReviewer;
  decidedAt: string;
  reviewVersion: number;
  supersedesDecisionId: string | null;
  dataUse: CatalogEnrichmentReviewDataUse;
}>;

export type CatalogEnrichmentReviewDecisionInput = {
  action: CatalogEnrichmentReviewAction;
  selectedSourceRecordId?: string | null;
  reason: string;
  evidence?: CatalogEnrichmentReviewEvidence[];
  catalogCorrections?: CatalogMetadataCorrection[];
  resolvedConflicts?: string[];
  unresolvedFields?: SourceMatchDimension[];
  reviewedCandidateIds?: string[];
  reviewer?: CatalogEnrichmentReviewer;
  decidedAt: string;
};

export type CatalogEnrichmentReviewManifest = Readonly<{
  schemaVersion: "1.0.0";
  manifestId: string;
  dataUse: CatalogEnrichmentReviewDataUse;
  storageBoundary: "local_staging_only";
  productionCatalogMutated: false;
  createdAt: string;
  updatedAt: string;
  decisions: CatalogEnrichmentReviewDecision[];
}>;

export type CatalogEnrichmentReviewExecutionResult = {
  reviewItem: CatalogEnrichmentReviewItem;
  decision: CatalogEnrichmentReviewDecision;
  correctedCatalogSnapshot: CatalogReviewVehicleSnapshot;
  refreshedMatchResult: SourceMatchResult<NhtsaCatalogMatchCandidate> | SourceMatchResult<EpaVehicleRecord> | null;
  refreshedEnrichmentDecision: EnrichmentDecision | null;
  contributions: CanonicalVehicleContribution[];
  canonicalRecord: CanonicalVehicleRecord | null;
  issues: string[];
  auditMetadata: {
    reviewId: string;
    decisionId: string;
    reviewVersion: number;
    sourceRecordId: string | null;
  };
  stagingBoundary: "runtime_only";
  productionCatalogMutated: false;
};

export type CatalogEnrichmentReviewQueue = {
  items: CatalogEnrichmentReviewItem[];
  sourceResultCount: number;
  queuedResultCount: number;
  generatedAt: string;
};

export type CatalogEnrichmentReviewQueueSummary = {
  totalPending: number;
  readyForApproval: number;
  needsCatalogCorrection: number;
  needsAdditionalData: number;
  rejectedOrNotFound: number;
};

export type CatalogEnrichmentReviewContext = {
  result: CatalogEnrichmentResult;
  item: CatalogEnrichmentReviewItem;
};

export type NhtsaReviewAssessment = SourceMatchCandidateAssessment<NhtsaCatalogMatchCandidate>;
export type EpaReviewAssessment = SourceMatchCandidateAssessment<EpaVehicleRecord>;
