import type {
  CanonicalConfidence,
  CanonicalEvidence,
  CanonicalMissingReason,
  CanonicalValueStatus,
  CanonicalVehicleFieldPath,
  CanonicalVehicleRecord,
} from "./canonicalVehicle";
import type { CVRPublishAuditRecord, CVRPublishingDecision } from "./cvrPublishing";

export const publishedCVRStatuses = [
  "active",
  "superseded",
  "withdrawn",
  "rollback_candidate",
] as const;

export type PublishedCVRStatus = (typeof publishedCVRStatuses)[number];
export type PublishedCVRDataClassification = "production" | "fixture" | "test";
export type PublishedCVRRepositoryDataUse = PublishedCVRDataClassification;

export type PublishedVehicleIntelligenceRecord = Readonly<{
  publicationId: string;
  vehicleId: string;
  canonicalRecord: CanonicalVehicleRecord;
  recordVersion: number;
  publicationStatus: PublishedCVRStatus;
  publishingDecisionId: string;
  publishingAuditRecord: CVRPublishAuditRecord;
  sourceKnowledgeSnapshotId: string | null;
  sourceKnowledgeSnapshotVersion: string | null;
  compilerVersion: string;
  trustPolicyVersion: string;
  publishingPolicyVersion: string;
  publishedAt: string;
  supersedesPublicationId: string | null;
  supersededByPublicationId: string | null;
  dataClassification: PublishedCVRDataClassification;
  fingerprint: string;
}>;

export type PublishedCVREventType =
  | "publication_created"
  | "publication_superseded"
  | "publication_withdrawn"
  | "rollback_candidate_marked";

export type PublishedCVREvent = Readonly<{
  eventId: string;
  eventType: PublishedCVREventType;
  publicationId: string;
  relatedPublicationIds: string[];
  occurredAt: string;
  reason: string;
}>;

export type PublishedCVRRepositoryState = Readonly<{
  schemaVersion: "1.0.0";
  repositoryId: string;
  dataUse: PublishedCVRRepositoryDataUse;
  storageBoundary: "shadow_published_cvr_only";
  originalCatalogMutated: false;
  knowledgeRepositoryMutated: false;
  recommendationRuntimeConnected: false;
  createdAt: string;
  updatedAt: string;
  publications: PublishedVehicleIntelligenceRecord[];
  events: PublishedCVREvent[];
}>;

export type PublishCanonicalVehicleInput = {
  vehicleId: string;
  canonicalRecord: CanonicalVehicleRecord;
  publishingDecision: CVRPublishingDecision;
  sourceKnowledgeSnapshotId?: string | null;
  sourceKnowledgeSnapshotVersion?: string | null;
  compilerVersion: string;
  trustPolicyVersion: string;
  publishingPolicyVersion: string;
  publishedAt: string;
  dataClassification: PublishedCVRDataClassification;
};

export type PublishedCVRTransitionInput = {
  occurredAt: string;
  reason: string;
};

export type PublishedCVRValueChange = {
  fieldPath: CanonicalVehicleFieldPath;
  previousValue: unknown;
  nextValue: unknown;
};

export type PublishedCVRStatusChange = {
  fieldPath: CanonicalVehicleFieldPath;
  previousStatus: CanonicalValueStatus;
  nextStatus: CanonicalValueStatus;
};

export type PublishedCVRConfidenceChange = {
  fieldPath: CanonicalVehicleFieldPath;
  previousConfidence: CanonicalConfidence;
  nextConfidence: CanonicalConfidence;
};

export type PublishedCVREvidenceChange = {
  fieldPath: CanonicalVehicleFieldPath;
  previousEvidenceIds: string[];
  nextEvidenceIds: string[];
};

export type PublishedCVRStaleConflictChange = {
  fieldPath: CanonicalVehicleFieldPath;
  previousMissingReason: CanonicalMissingReason | null;
  nextMissingReason: CanonicalMissingReason | null;
};

export type PublishedCVRDiff = {
  vehicleId: string;
  fromPublicationId: string;
  toPublicationId: string;
  fieldsAdded: CanonicalVehicleFieldPath[];
  fieldsRemoved: CanonicalVehicleFieldPath[];
  valuesChanged: PublishedCVRValueChange[];
  statusesChanged: PublishedCVRStatusChange[];
  confidenceChanged: PublishedCVRConfidenceChange[];
  evidenceChanged: PublishedCVREvidenceChange[];
  recordEvidenceAdded: CanonicalEvidence[];
  recordEvidenceRemoved: CanonicalEvidence[];
  staleConflictStateChanged: PublishedCVRStaleConflictChange[];
  hasMeaningfulChanges: boolean;
};

export type PublishedCVRRollbackPlan = {
  vehicleId: string;
  currentPublicationId: string | null;
  rollbackCandidatePublicationId: string | null;
  eligible: boolean;
  reason: string;
  diff: PublishedCVRDiff | null;
};

export interface PublishedCVRRepository {
  publish(input: PublishCanonicalVehicleInput): PublishedVehicleIntelligenceRecord;
  getPublication(publicationId: string): PublishedVehicleIntelligenceRecord | null;
  getActivePublicationForVehicle(vehicleId: string): PublishedVehicleIntelligenceRecord | null;
  getPublicationHistory(vehicleId: string): PublishedVehicleIntelligenceRecord[];
  supersedePublication(publicationId: string, replacementPublicationId: string, input: PublishedCVRTransitionInput): PublishedVehicleIntelligenceRecord;
  withdrawPublication(publicationId: string, input: PublishedCVRTransitionInput): PublishedVehicleIntelligenceRecord;
  markRollbackCandidate(publicationId: string, input: PublishedCVRTransitionInput): PublishedVehicleIntelligenceRecord;
  getRollbackPlan(vehicleId: string): PublishedCVRRollbackPlan;
  comparePublications(fromPublicationId: string, toPublicationId: string): PublishedCVRDiff;
  listPublishedVehicles(): PublishedVehicleIntelligenceRecord[];
  exportState(): PublishedCVRRepositoryState;
}
