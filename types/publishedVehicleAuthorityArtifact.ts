import type { CanonicalVehicleFieldPath } from "./canonicalVehicle";
import type { PublishedVehicleIntelligenceRecord } from "./publishedVehicleIntelligence";

export type PublishedVehicleAuthorityField = Readonly<{
  runtimeField: "make" | "model" | "year" | "bodyType" | "drivetrain" | "transmission" | "fuelType" | "mpg";
  canonicalFieldPath: CanonicalVehicleFieldPath;
}>;

export type PublishedVehicleAuthorityArtifact = Readonly<{
  schemaVersion: "1.0.0";
  artifactVersion: "golden-set-v1.0.0";
  artifactId: string;
  sourceRepositoryId: string;
  sourceRepositoryUpdatedAt: string;
  sourceRepositoryVersion: string;
  generationFingerprint: string;
  publicationTimestamp: string;
  publishedVehicleCount: number;
  recommendationRuntimeEligible: true;
  resolverContractVersion: "1.0.0";
  canonicalIdentityContractVersion: "1.0.0";
  publicationPolicyVersions: readonly string[];
  authorityFields: readonly PublishedVehicleAuthorityField[];
  explicitlyNonScoreableFields: readonly ["safetyScore", "reliabilityScore"];
  publications: readonly PublishedVehicleIntelligenceRecord[];
}>;
