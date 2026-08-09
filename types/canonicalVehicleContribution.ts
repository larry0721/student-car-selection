import type {
  CanonicalConfidence,
  CanonicalDatum,
  CanonicalEvidence,
  CanonicalEvidenceDataUse,
  CanonicalEvidenceNormalizationMethod,
  CanonicalEvidenceSourceClaim,
  CanonicalEvidenceSourceValue,
  CanonicalIngestionContext,
  CanonicalRecordScope,
  CanonicalSourceType,
  CanonicalUnit,
  CanonicalValidationIssue,
  CanonicalVehicleRecord,
  CanonicalVehicleSectionName,
} from "./canonicalVehicle";

export const canonicalContributionSchemaVersion = "1.0.0" as const;

export type CanonicalContributionDataUse = Exclude<CanonicalEvidenceDataUse, "example">;
export type CanonicalNormalizationMethod = CanonicalEvidenceNormalizationMethod;
export type CanonicalSourceMetadataValue = CanonicalEvidenceSourceValue;

export type CanonicalSourceMetadata = {
  [key: string]: CanonicalSourceMetadataValue;
};

export type CanonicalSourceClaim = CanonicalEvidenceSourceClaim;

export type CanonicalContributionEvidence = CanonicalEvidence & {
  dataUse: CanonicalContributionDataUse;
  sourceClaims: CanonicalSourceClaim[];
  normalizationMethod: CanonicalNormalizationMethod;
  normalizationNotes: string[];
};

/**
 * Contribution fields retain the complete CVR datum contract. The additional
 * references record an explicit source attempt when the canonical value is
 * missing; CVR missing datums themselves continue to have no evidenceIds.
 */
export type CanonicalContributionDatum<
  Value,
  Unit extends CanonicalUnit = CanonicalUnit,
> = CanonicalDatum<Value, Unit> & {
  attemptEvidenceIds: string[];
};

type ContributionDatumFrom<Datum> = Datum extends CanonicalDatum<infer Value, infer Unit>
  ? CanonicalContributionDatum<Value, Unit>
  : never;

type CanonicalVehicleSectionMap = Pick<CanonicalVehicleRecord, CanonicalVehicleSectionName>;

export type CanonicalVehicleContributionData = {
  [Section in CanonicalVehicleSectionName]?: {
    [Field in keyof CanonicalVehicleSectionMap[Section]]?: ContributionDatumFrom<
      CanonicalVehicleSectionMap[Section][Field]
    >;
  };
};

export type CanonicalExternalId = {
  namespace: string;
  value: string;
};

export type CanonicalVehicleLinkage = {
  canonicalRecordId: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  generation: string | null;
  trim: string | null;
  configurationId: string | null;
  externalIds: CanonicalExternalId[];
};

export type CanonicalContributionSource = Pick<
  CanonicalEvidence,
  | "sourceType"
  | "providerName"
  | "sourceRecordId"
  | "sourceUrl"
  | "observedAt"
  | "retrievedAt"
  | "market"
  | "methodology"
  | "license"
> & {
  sourceRecordId: string;
};

export type CanonicalContributionIssueKind =
  | "source_fetch_error"
  | "normalization_warning"
  | "invalid_canonical_value"
  | "ambiguous_mapping"
  | "reduced_specificity"
  | "explicit_source_missing";

export type CanonicalContributionIssue = CanonicalValidationIssue & {
  kind: CanonicalContributionIssueKind;
  sourceField: string | null;
};

export type CanonicalVehicleContribution<
  SourceMetadata extends CanonicalSourceMetadata = CanonicalSourceMetadata,
> = {
  schemaVersion: typeof canonicalContributionSchemaVersion;
  contributionId: string;
  dataUse: CanonicalContributionDataUse;
  normalizationVersion: string;
  recordScope: CanonicalRecordScope;
  source: CanonicalContributionSource;
  linkage: CanonicalVehicleLinkage;
  sourceConfidence: CanonicalConfidence;
  sourceMetadata: SourceMetadata;
  evidence: CanonicalContributionEvidence[];
  data: CanonicalVehicleContributionData;
  issues: CanonicalContributionIssue[];
};

export type CanonicalContributionIngestionResult = {
  contributions: CanonicalVehicleContribution[];
  rejectedSourceRecordIds: string[];
  issues: CanonicalContributionIssue[];
};

export interface CanonicalVehicleContributionAdapter<SourceRecord> {
  readonly sourceType: CanonicalSourceType;
  normalize(
    sourceRecords: readonly SourceRecord[],
    context: CanonicalIngestionContext,
  ): Promise<CanonicalContributionIngestionResult>;
}
