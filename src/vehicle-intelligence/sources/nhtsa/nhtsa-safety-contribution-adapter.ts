import type { CanonicalIngestionContext, CanonicalEvidenceSourceClaim } from "../../../../types/canonicalVehicle";
import {
  canonicalContributionSchemaVersion,
  type CanonicalContributionDataUse,
  type CanonicalContributionIngestionResult,
  type CanonicalContributionIssue,
  type CanonicalVehicleContribution,
  type CanonicalVehicleContributionAdapter,
} from "../../../../types/canonicalVehicleContribution";
import type { NhtsaSafetyRecord } from "./nhtsa-safety-client";

export const nhtsaSafetyContributionNormalizationVersion = "nhtsa-ncap-1.0.0" as const;
const providerName = "NHTSA Safety Ratings / NCAP";

export type NhtsaSafetySourceRecord = Readonly<{
  record: NhtsaSafetyRecord;
  dataUse?: CanonicalContributionDataUse;
}>;

export type NhtsaSafetyContributionResult = Readonly<{
  contribution: CanonicalVehicleContribution | null;
  issues: CanonicalContributionIssue[];
}>;

export function normalizeNhtsaSafetyToContribution(
  sourceRecord: NhtsaSafetySourceRecord,
  context: CanonicalIngestionContext,
): NhtsaSafetyContributionResult {
  const record = sourceRecord.record;
  const sourceRecordId = String(record.vehicleId);
  const contributionId = `${context.ingestionId}:nhtsa-safety:${sourceRecordId}`;
  const evidenceId = `${contributionId}:ncap`;
  const sourceUrl = `https://api.nhtsa.gov/SafetyRatings/VehicleId/${sourceRecordId}?format=json`;
  const sourceClaims: CanonicalEvidenceSourceClaim[] = Object.entries(record.rawFields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceField, originalSourceValue]) => ({ sourceField, originalSourceValue }));
  const evidence = {
    evidenceId,
    sourceType: "nhtsa" as const,
    providerName,
    sourceRecordId,
    sourceUrl,
    scope: "configuration" as const,
    observedAt: null,
    retrievedAt: context.retrievedAt,
    market: context.market,
    methodology: "Official NHTSA NCAP tested-configuration record; component ratings are retained without recomputing a safety judgment.",
    license: "United States government public data; verify applicable NHTSA terms.",
    dataUse: sourceRecord.dataUse ?? "production",
    sourceClaims,
    normalizationMethod: "mapped" as const,
    normalizationNotes: [
      "OverallRating is linearly represented as stars × 20 only for the existing crashSafety 0-100 field.",
      "Frontal, side, rollover, technology, history, and media details remain in source claims and measurement context.",
      "RolloverPossibility is retained as a decimal ratio and an explicit percentage.",
    ],
  };
  const issues: CanonicalContributionIssue[] = [];
  const measurementContext = createMeasurementContext(record);
  const crashSafety = record.ratingState === "RATED" && record.ratings.overall !== null
    ? {
        value: record.ratings.overall * 20,
        unit: "score_0_100" as const,
        status: "sourced" as const,
        confidence: { score: 0.98, level: "high" as const, sourceAgreement: "single_source" as const, basis: ["Official NHTSA NCAP overall star rating for an applicable tested configuration."] },
        evidenceIds: [evidenceId],
        attemptEvidenceIds: [evidenceId],
        estimated: false,
        estimationMethod: null,
        asOfDate: context.retrievedAt,
        measurementContext,
        missingReason: null,
      }
    : undefined;
  if (!crashSafety) {
    issues.push({
      code: record.ratingState === "NOT_RATED" ? "nhtsa_safety_not_rated" : "nhtsa_safety_overall_rating_missing",
      kind: "explicit_source_missing",
      fieldPath: "safety.crashSafety",
      severity: "warning",
      message: record.ratingState === "NOT_RATED"
        ? "NHTSA identified the tested configuration but explicitly reported it as Not Rated; no numeric claim was created."
        : "NHTSA returned component data without a usable overall rating; no aggregate crashSafety claim was derived.",
      evidenceIds: [evidenceId],
      sourceField: "OverallRating",
    });
  }
  const contribution = {
    schemaVersion: canonicalContributionSchemaVersion,
    contributionId,
    dataUse: sourceRecord.dataUse ?? "production",
    normalizationVersion: nhtsaSafetyContributionNormalizationVersion,
    recordScope: "configuration",
    source: {
      sourceType: "nhtsa",
      providerName,
      sourceRecordId,
      sourceUrl,
      observedAt: null,
      retrievedAt: context.retrievedAt,
      market: context.market,
      methodology: "NHTSA NCAP safety ratings normalized with lossless component evidence retention.",
      license: "United States government public data; verify applicable NHTSA terms.",
    },
    linkage: {
      canonicalRecordId: null,
      vin: null,
      make: record.make,
      model: record.model,
      modelYear: record.modelYear,
      generation: null,
      trim: null,
      configurationId: sourceRecordId,
      externalIds: [{ namespace: "nhtsa_safety_vehicle_id", value: sourceRecordId }],
    },
    sourceConfidence: { score: 0.98, level: "high", sourceAgreement: "single_source", basis: ["Official NHTSA NCAP configuration record."] },
    sourceMetadata: {
      dataset: "NHTSA Safety Ratings",
      service: "SafetyRatings/VehicleId",
      ratingState: record.ratingState,
      vehicleDescription: record.vehicleDescription,
      ratings: record.ratings,
      safetyTechnology: record.safetyTechnology,
      safetyHistory: record.safetyHistory,
      media: record.media,
    },
    evidence: [evidence],
    data: crashSafety ? { safety: { crashSafety } } : {},
    issues,
  } satisfies CanonicalVehicleContribution;
  return { contribution, issues };
}

export const nhtsaSafetyContributionAdapter: CanonicalVehicleContributionAdapter<NhtsaSafetySourceRecord> = {
  sourceType: "nhtsa",
  async normalize(sourceRecords, context): Promise<CanonicalContributionIngestionResult> {
    if (context.sourceType !== "nhtsa") {
      return {
        contributions: [],
        rejectedSourceRecordIds: sourceRecords.map((item) => String(item.record.vehicleId)),
        issues: sourceRecords.map((item) => ({ code: "nhtsa_safety_invalid_context", kind: "invalid_canonical_value", fieldPath: "record", severity: "error", message: "NHTSA Safety adapter requires context.sourceType nhtsa.", evidenceIds: [], sourceField: String(item.record.vehicleId) })),
      };
    }
    const results = sourceRecords.map((item) => normalizeNhtsaSafetyToContribution(item, context));
    return { contributions: results.map((item) => item.contribution).filter((item): item is CanonicalVehicleContribution => Boolean(item)), rejectedSourceRecordIds: [], issues: results.flatMap((item) => item.issues) };
  },
};

function createMeasurementContext(record: NhtsaSafetyRecord) {
  const context: Record<string, string | number | boolean> = { nhtsaVehicleId: record.vehicleId, ncapRatingState: record.ratingState };
  for (const [key, value] of Object.entries(record.ratings)) if (value !== null) context[key] = value;
  if (record.ratings.rolloverPossibilityRatio !== null) context.rolloverPossibilityPercent = record.ratings.rolloverPossibilityRatio * 100;
  for (const [key, value] of Object.entries(record.safetyTechnology)) if (value !== null) context[key] = value;
  for (const [key, value] of Object.entries(record.safetyHistory)) if (value !== null) context[key] = value;
  return context;
}
