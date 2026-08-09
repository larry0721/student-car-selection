import type {
  SourceMatchDimension,
  SourceMatchStatus,
  VehicleSourceMatchName,
} from "./vehicleSourceMatch";

export const enrichmentDecisionActions = [
  "AUTO_ENRICH",
  "REVIEW_REQUIRED",
  "DEFER",
  "SKIP",
] as const;

export type EnrichmentDecisionAction = (typeof enrichmentDecisionActions)[number];

export type EnrichmentSupportingEvidence = {
  source: VehicleSourceMatchName;
  matchStatus: SourceMatchStatus;
  selectedSourceRecordId: string | null;
  candidateCount: number;
  plausibleCandidateCount: number;
  matchedOn: SourceMatchDimension[];
  missingComparisonFields: SourceMatchDimension[];
  matchRationale: string[];
};

export type EnrichmentDecision = {
  action: EnrichmentDecisionAction;
  confidence: number;
  reason: string;
  supportingEvidence: EnrichmentSupportingEvidence;
  blockingConflicts: string[];
  reviewNotes: string[];
};
