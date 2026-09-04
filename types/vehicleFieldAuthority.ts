import type {
  CanonicalConfidenceLevel,
  CanonicalValueStatus,
  CanonicalVehicleFieldPath,
} from "./canonicalVehicle";

export const decisionVehicleFieldNames = [
  "make",
  "model",
  "year",
  "bodyType",
  "drivetrain",
  "transmission",
  "fuelType",
  "mpg",
  "safetyScore",
  "reliabilityScore",
] as const;

export type DecisionVehicleFieldName = (typeof decisionVehicleFieldNames)[number];

export type VehicleFieldAuthority = "legacy" | "published_cvr";

export type VehicleFieldResolutionStatus =
  | "identical"
  | "cvr_override_eligible"
  | "cvr_unavailable"
  | "cvr_rejected_due_to_identity"
  | "cvr_rejected_due_to_evidence_or_confidence"
  | "legacy_fallback";

export type PublishedVehicleIdentityMatchStatus =
  | "exact"
  | "not_found"
  | "ambiguous"
  | "conflict";

export type VehicleFieldAuthorityResolution = Readonly<{
  field: DecisionVehicleFieldName;
  canonicalFieldPath: CanonicalVehicleFieldPath | null;
  legacyValue: unknown;
  canonicalValue: unknown;
  selectedValue: unknown;
  authority: VehicleFieldAuthority;
  status: VehicleFieldResolutionStatus;
  fallbackUsed: boolean;
  reason: string;
  publicationId: string | null;
  canonicalStatus: CanonicalValueStatus | null;
  confidenceScore: number | null;
  confidenceLevel: CanonicalConfidenceLevel | null;
  evidenceIds: readonly string[];
}>;

export type VehicleFieldAuthorityTrace = Readonly<{
  resolverVersion: string;
  vehicleId: string;
  identityMatchStatus: PublishedVehicleIdentityMatchStatus;
  publicationId: string | null;
  publishedRecordVersion: number | null;
  fields: readonly VehicleFieldAuthorityResolution[];
  diagnostics: readonly string[];
}>;

export type ResolvedDecisionVehicleResult<VehicleType> = Readonly<{
  vehicle: VehicleType;
  trace: VehicleFieldAuthorityTrace;
}>;

export type VehicleFieldAuthorityShadowSummary = Readonly<{
  catalogCount: number;
  publishedVehicleCount: number;
  unchangedVehicleCount: number;
  changedVehicleCount: number;
  identicalFieldCount: number;
  eligibleOverrideCount: number;
  unavailableFieldCount: number;
  identityRejectedFieldCount: number;
  evidenceRejectedFieldCount: number;
  legacyFallbackCount: number;
}>;

export type VehicleFieldAuthorityShadowReport<VehicleType> = Readonly<{
  resolverVersion: string;
  results: readonly ResolvedDecisionVehicleResult<VehicleType>[];
  summary: VehicleFieldAuthorityShadowSummary;
}>;
