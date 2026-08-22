import type { CatalogEnrichmentReviewDecision } from "./catalogEnrichmentReview";
import type { CVRPublishingDecision } from "./cvrPublishing";
import type { PublishCanonicalVehicleInput, PublishedVehicleIntelligenceRecord } from "./publishedVehicleIntelligence";
import type { VehicleKnowledgeSnapshot } from "./vehicleKnowledge";
import type { KnowledgeCompilationResult } from "./vehicleKnowledgeCompiler";

export type GoldenVehiclePublicationSpec = Readonly<{
  vehicleId: string;
  displayName: string;
  epaSourceId: string;
}>;

export type PreparedGoldenVehiclePublication = Readonly<{
  spec: GoldenVehiclePublicationSpec;
  ownerDecision: CatalogEnrichmentReviewDecision;
  knowledgeSnapshot: VehicleKnowledgeSnapshot;
  knowledgeSnapshotId: string;
  knowledgeSnapshotVersion: string;
  compilation: KnowledgeCompilationResult;
  publishingDecision: CVRPublishingDecision;
  publishInput: PublishCanonicalVehicleInput;
}>;

export type GoldenSetManifestVehicle = Readonly<{
  vehicleId: string;
  displayName: string;
  epaSourceId: string;
  publicationId: string;
  recordVersion: number;
  fingerprint: string;
  publicationDecision: "PUBLISH";
  publicationTimestamp: string;
  compilerVersion: string;
  trustPolicyVersion: string;
  publishingPolicyVersion: string;
  sourceKnowledgeSnapshotId: string;
  sourceKnowledgeSnapshotVersion: string;
}>;

export type GoldenSetV1Manifest = Readonly<{
  schemaVersion: "1.0.0";
  goldenDatasetVersion: "1.0.0";
  manifestId: "phase-3.2e-golden-set-v1";
  repositoryId: string;
  storageBoundary: "shadow_metadata_only";
  recommendationRuntimeConnected: false;
  publicationTimestamp: string;
  vehicles: GoldenSetManifestVehicle[];
}>;

export type GoldenVehiclePublicationResult = Readonly<{
  prepared: PreparedGoldenVehiclePublication;
  publication: PublishedVehicleIntelligenceRecord;
  replayPublicationId: string;
  replayRecognized: boolean;
}>;

export type GoldenSetV1PublicationResult = Readonly<{
  publicationsAttempted: number;
  publicationsSucceeded: number;
  publicationsBlocked: Array<{ vehicleId: string; reason: string }>;
  vehicles: GoldenVehiclePublicationResult[];
  manifest: GoldenSetV1Manifest;
  repositoryPublicationCount: number;
}>;
