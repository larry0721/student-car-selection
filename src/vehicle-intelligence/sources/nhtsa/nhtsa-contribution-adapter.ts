import type {
  CanonicalBodyStyle,
  CanonicalConfidence,
  CanonicalDrivetrain,
  CanonicalFuelType,
  CanonicalIngestionContext,
  CanonicalMissingReason,
  CanonicalTransmission,
  CanonicalVehicleCategory,
  CanonicalVehicleFieldPath,
} from "../../../../types/canonicalVehicle";
import {
  canonicalContributionSchemaVersion,
  type CanonicalContributionDataUse,
  type CanonicalContributionDatum,
  type CanonicalContributionIngestionResult,
  type CanonicalContributionIssue,
  type CanonicalContributionIssueKind,
  type CanonicalContributionEvidence,
  type CanonicalVehicleContribution,
  type CanonicalVehicleContributionAdapter,
} from "../../../../types/canonicalVehicleContribution";
import { decodeVin, type DecodedVin } from "./nhtsa-client";

export const nhtsaContributionNormalizationVersion = "nhtsa-vpic-vin-1.0.0" as const;

const nhtsaProviderName = "NHTSA vPIC";
const nhtsaLicense = "United States government public data; verify applicable NHTSA terms.";
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

export type NhtsaSourceRecord = {
  vin: string;
  decoded: DecodedVin;
  dataUse?: CanonicalContributionDataUse;
  observedAt?: string | null;
};

export type NhtsaContributionNormalizationResult = {
  contribution: CanonicalVehicleContribution | null;
  issues: CanonicalContributionIssue[];
};

export type DecodeVinToContributionOptions = {
  ingestionId?: string;
  retrievedAt?: string;
  market?: string | null;
  dataUse?: CanonicalContributionDataUse;
};

type MappingFailure = {
  ok: false;
  value: null;
  confidenceScore: null;
  issueKind: CanonicalContributionIssueKind;
  issueCode: string;
  issueMessage: string;
  missingReason: CanonicalMissingReason;
};

type MappingSuccess<Value> = {
  ok: true;
  value: Value;
  confidenceScore: number;
  issueKind?: "reduced_specificity";
  issueCode?: string;
  issueMessage?: string;
};

type MappingResult<Value> = MappingSuccess<Value> | MappingFailure;

export function normalizeDecodedVinToContribution(
  sourceRecord: NhtsaSourceRecord,
  context: CanonicalIngestionContext,
): NhtsaContributionNormalizationResult {
  const structuralIssues = validateSourceRecord(sourceRecord);
  if (structuralIssues.length) return { contribution: null, issues: structuralIssues };

  const vin = sourceRecord.vin.trim().toUpperCase();
  const decoded = sourceRecord.decoded;
  const dataUse = sourceRecord.dataUse || "production";
  const contributionId = `${context.ingestionId}:nhtsa-vpic:${vin}`;
  const directEvidenceId = `${contributionId}:direct`;
  const mappedEvidenceId = `${contributionId}:mapped`;
  const sourceUrl = getDecodeVinUrl(vin);
  const directEvidence = createEvidence({
    evidenceId: directEvidenceId,
    vin,
    decoded,
    context,
    dataUse,
    observedAt: sourceRecord.observedAt ?? null,
    method: "direct",
  });
  const mappedEvidence = createEvidence({
    evidenceId: mappedEvidenceId,
    vin,
    decoded,
    context,
    dataUse,
    observedAt: sourceRecord.observedAt ?? null,
    method: "mapped",
  });
  const issues: CanonicalContributionIssue[] = [];

  const make = normalizeDirectString({
    value: decoded.make,
    fieldPath: "identity.make",
    sourceField: "Make",
    evidenceId: directEvidenceId,
    asOfDate: context.retrievedAt,
    issues,
    normalize: normalizeMake,
  });
  const model = normalizeDirectString({
    value: decoded.model,
    fieldPath: "identity.model",
    sourceField: "Model",
    evidenceId: directEvidenceId,
    asOfDate: context.retrievedAt,
    issues,
    normalize: normalizeModel,
  });
  const modelYear = normalizeModelYear(
    decoded.modelYear,
    context.retrievedAt,
    directEvidenceId,
    issues,
  );
  const bodyStyle = normalizeMappedValue({
    sourceValue: decoded.bodyClass,
    sourceField: "BodyClass",
    fieldPath: "identity.bodyStyle",
    evidenceId: mappedEvidenceId,
    asOfDate: context.retrievedAt,
    map: mapBodyStyle,
  }, issues);
  const vehicleCategory = normalizeMappedValue({
    sourceValue: decoded.vehicleType,
    sourceField: "VehicleType",
    fieldPath: "identity.vehicleCategory",
    evidenceId: mappedEvidenceId,
    asOfDate: context.retrievedAt,
    map: mapVehicleCategory,
  }, issues);
  const drivetrain = normalizeMappedValue({
    sourceValue: decoded.driveType,
    sourceField: "DriveType",
    fieldPath: "identity.drivetrain",
    evidenceId: mappedEvidenceId,
    asOfDate: context.retrievedAt,
    map: mapDrivetrain,
  }, issues);
  const fuelType = normalizeMappedValue({
    sourceValue: decoded.fuelTypePrimary,
    sourceField: "FuelTypePrimary",
    fieldPath: "identity.fuelType",
    evidenceId: mappedEvidenceId,
    asOfDate: context.retrievedAt,
    map: mapFuelType,
  }, issues);
  const transmission = normalizeMappedValue({
    sourceValue: decoded.transmissionStyle,
    sourceField: "TransmissionStyle",
    fieldPath: "identity.transmission",
    evidenceId: mappedEvidenceId,
    asOfDate: context.retrievedAt,
    map: mapTransmission,
  }, issues);

  const populatedCount = Object.values(decoded).filter((value) => value !== null).length;
  const sourceConfidenceScore = roundConfidence(0.72 + (populatedCount / 8) * 0.24);
  const contribution = {
    schemaVersion: canonicalContributionSchemaVersion,
    contributionId,
    dataUse,
    normalizationVersion: nhtsaContributionNormalizationVersion,
    recordScope: "vin",
    source: {
      sourceType: "nhtsa",
      providerName: nhtsaProviderName,
      sourceRecordId: vin,
      sourceUrl,
      observedAt: sourceRecord.observedAt ?? null,
      retrievedAt: context.retrievedAt,
      market: context.market,
      methodology: "NHTSA vPIC DecodeVinValues response normalized deterministically into canonical identity fields.",
      license: nhtsaLicense,
    },
    linkage: {
      canonicalRecordId: null,
      vin,
      make: make.value,
      model: model.value,
      modelYear: modelYear.value,
      generation: null,
      trim: null,
      configurationId: null,
      externalIds: [{ namespace: "nhtsa_vin", value: vin }],
    },
    sourceConfidence: confidence(
      sourceConfidenceScore,
      [
        "NHTSA vPIC is authoritative for VIN-decoded identity data.",
        `${populatedCount} of 8 requested decoded fields contained source values.`,
      ],
    ),
    sourceMetadata: {
      dataset: "vPIC",
      service: "DecodeVinValues",
      requestedVin: vin,
      decodedFieldCount: populatedCount,
    },
    evidence: [directEvidence, mappedEvidence],
    data: {
      identity: {
        make,
        model,
        modelYear,
        bodyStyle,
        vehicleCategory,
        drivetrain,
        fuelType,
        transmission,
      },
    },
    issues,
  } satisfies CanonicalVehicleContribution;

  return { contribution, issues };
}

export const nhtsaContributionAdapter: CanonicalVehicleContributionAdapter<NhtsaSourceRecord> = {
  sourceType: "nhtsa",
  async normalize(sourceRecords, context) {
    if (context.sourceType !== "nhtsa") {
      const issues = sourceRecords.map((record) => createIssue({
        code: "nhtsa_invalid_ingestion_context",
        kind: "invalid_canonical_value",
        fieldPath: "record",
        message: "NHTSA contribution adapter requires context.sourceType to be nhtsa.",
        evidenceIds: [],
        sourceField: null,
      }));
      return {
        contributions: [],
        rejectedSourceRecordIds: sourceRecords.map((record) => normalizeSourceRecordId(record)),
        issues,
      };
    }

    const results = sourceRecords.map((record) => ({
      sourceRecordId: normalizeSourceRecordId(record),
      result: normalizeDecodedVinToContribution(record, context),
    }));

    return {
      contributions: results.flatMap(({ result }) => result.contribution ? [result.contribution] : []),
      rejectedSourceRecordIds: results.flatMap(({ sourceRecordId, result }) => result.contribution ? [] : [sourceRecordId]),
      issues: results.flatMap(({ result }) => result.issues),
    };
  },
};

export async function decodeVinToContribution(
  vin: string,
  options: DecodeVinToContributionOptions = {},
): Promise<CanonicalContributionIngestionResult> {
  const normalizedVin = vin.trim().toUpperCase();
  const retrievedAt = options.retrievedAt || new Date().toISOString();
  let decoded: DecodedVin;
  try {
    decoded = await decodeVin(normalizedVin);
  } catch (error) {
    return {
      contributions: [],
      rejectedSourceRecordIds: [normalizedVin || "unknown"],
      issues: [createIssue({
        code: "nhtsa_source_fetch_error",
        kind: "source_fetch_error",
        fieldPath: "record",
        message: error instanceof Error ? error.message : "NHTSA VIN decode request failed.",
        evidenceIds: [],
        sourceField: null,
      })],
    };
  }
  return nhtsaContributionAdapter.normalize(
    [{ vin: normalizedVin, decoded, dataUse: options.dataUse || "production", observedAt: null }],
    {
      ingestionId: options.ingestionId || `nhtsa-vpic-${retrievedAt}`,
      retrievedAt,
      market: options.market ?? "US",
      sourceType: "nhtsa",
    },
  );
}

function validateSourceRecord(sourceRecord: NhtsaSourceRecord): CanonicalContributionIssue[] {
  const issues: CanonicalContributionIssue[] = [];
  if (!sourceRecord || typeof sourceRecord !== "object") {
    return [structuralIssue("NHTSA source record must be an object.")];
  }
  const vin = typeof sourceRecord.vin === "string" ? sourceRecord.vin.trim().toUpperCase() : "";
  if (!vinPattern.test(vin)) issues.push(structuralIssue("NHTSA source record contains an invalid VIN."));
  if (!sourceRecord.decoded || typeof sourceRecord.decoded !== "object" || Array.isArray(sourceRecord.decoded)) {
    issues.push(structuralIssue("NHTSA source record must contain a DecodedVin object."));
    return issues;
  }

  const expectedFields: Array<keyof DecodedVin> = [
    "make",
    "model",
    "modelYear",
    "bodyClass",
    "driveType",
    "fuelTypePrimary",
    "transmissionStyle",
    "vehicleType",
  ];
  for (const field of expectedFields) {
    if (!(field in sourceRecord.decoded)) {
      issues.push(structuralIssue(`DecodedVin is missing required field ${field}.`, field));
      continue;
    }
    const value = sourceRecord.decoded[field];
    const valid = field === "modelYear"
      ? value === null || typeof value === "number"
      : value === null || typeof value === "string";
    if (!valid) issues.push(structuralIssue(`DecodedVin field ${field} has an invalid runtime type.`, field));
  }
  return issues;
}

function normalizeDirectString(options: {
  value: string | null;
  fieldPath: "identity.make" | "identity.model";
  sourceField: "Make" | "Model";
  evidenceId: string;
  asOfDate: string;
  issues: CanonicalContributionIssue[];
  normalize: (value: string) => string;
}): CanonicalContributionDatum<string, "none"> {
  const normalized = options.value === null ? "" : options.normalize(options.value);
  if (!normalized) {
    options.issues.push(missingIssue(options.fieldPath, options.sourceField, options.evidenceId));
    return missingDatum("none", options.evidenceId, "not_available");
  }
  return claimDatum(normalized, "none", options.evidenceId, options.asOfDate, 0.98);
}

function normalizeModelYear(
  value: number | null,
  retrievedAt: string,
  evidenceId: string,
  issues: CanonicalContributionIssue[],
): CanonicalContributionDatum<number, "year"> {
  if (value === null) {
    issues.push(missingIssue("identity.modelYear", "ModelYear", evidenceId));
    return missingDatum("year", evidenceId, "not_available");
  }
  const retrievedYear = Number.parseInt(retrievedAt.slice(0, 4), 10);
  const maximumYear = Number.isInteger(retrievedYear) ? retrievedYear + 1 : new Date().getUTCFullYear() + 1;
  if (!Number.isInteger(value) || value < 1886 || value > maximumYear) {
    issues.push(createIssue({
      code: "nhtsa_invalid_model_year",
      kind: "invalid_canonical_value",
      fieldPath: "identity.modelYear",
      message: `NHTSA ModelYear ${String(value)} is outside the supported range 1886-${maximumYear}.`,
      evidenceIds: [evidenceId],
      sourceField: "ModelYear",
    }));
    return missingDatum("year", evidenceId, "invalid");
  }
  return claimDatum(value, "year", evidenceId, retrievedAt, 0.99);
}

function normalizeMappedValue<Value extends string>(
  options: {
    sourceValue: string | null;
    sourceField: string;
    fieldPath: CanonicalVehicleFieldPath;
    evidenceId: string;
    asOfDate: string;
    map: (value: string) => MappingResult<Value>;
  },
  issues: CanonicalContributionIssue[],
): CanonicalContributionDatum<Value, "none"> {
  if (options.sourceValue === null || !options.sourceValue.trim()) {
    issues.push(missingIssue(options.fieldPath, options.sourceField, options.evidenceId));
    return missingDatum("none", options.evidenceId, "not_available");
  }

  const mapped = options.map(options.sourceValue);
  if (!mapped.ok) {
    issues.push(createIssue({
      code: mapped.issueCode,
      kind: mapped.issueKind,
      fieldPath: options.fieldPath,
      message: mapped.issueMessage,
      evidenceIds: [options.evidenceId],
      sourceField: options.sourceField,
    }));
    return missingDatum("none", options.evidenceId, mapped.missingReason);
  }
  if (mapped.issueKind && mapped.issueCode && mapped.issueMessage) {
    issues.push(createIssue({
      code: mapped.issueCode,
      kind: mapped.issueKind,
      fieldPath: options.fieldPath,
      message: mapped.issueMessage,
      evidenceIds: [options.evidenceId],
      sourceField: options.sourceField,
    }));
  }
  return claimDatum(mapped.value, "none", options.evidenceId, options.asOfDate, mapped.confidenceScore);
}

function mapDrivetrain(value: string): MappingResult<CanonicalDrivetrain> {
  const normalized = normalizeLookup(value);
  if (/\b(fwd|front wheel drive)\b/.test(normalized)) return mapped("FWD", 0.96);
  if (/\b(rwd|rear wheel drive)\b/.test(normalized)) return mapped("RWD", 0.96);
  if (/\b(awd|all wheel drive)\b/.test(normalized)) return mapped("AWD", 0.96);
  if (/\b(4wd|4 wheel drive|four wheel drive|4x4)\b/.test(normalized)) return mapped("4WD", 0.96);
  if (/\b(2wd|4x2|two wheel drive)\b/.test(normalized)) {
    return mappingFailure(
      "ambiguous_mapping",
      "nhtsa_ambiguous_drive_type",
      `NHTSA DriveType ${JSON.stringify(value)} does not identify which axle is driven.`,
      "insufficient_specificity",
    );
  }
  return unsupported("drive_type", value);
}

function mapFuelType(value: string): MappingResult<CanonicalFuelType> {
  const normalized = normalizeLookup(value);
  const mentionsElectric = /\b(electric|bev)\b/.test(normalized);
  const mentionsCombustion = /\b(gasoline|petrol|gas|diesel)\b/.test(normalized);
  const explicitlyHybrid = /\b(plug in hybrid|phev|hybrid electric vehicle|hybrid|hev)\b/.test(normalized);
  if (mentionsElectric && mentionsCombustion && !explicitlyHybrid) {
    return mappingFailure(
      "ambiguous_mapping",
      "nhtsa_ambiguous_fuel_type_primary",
      `NHTSA FuelTypePrimary ${JSON.stringify(value)} combines electrified and combustion terms without identifying a hybrid type.`,
      "insufficient_specificity",
    );
  }
  if (/\b(plug in hybrid|phev)\b/.test(normalized)) return mapped("plug_in_hybrid", 0.96);
  if (/\b(hybrid electric vehicle|hybrid|hev)\b/.test(normalized)) return mapped("hybrid", 0.94);
  if (/\b(battery electric vehicle|battery electric|bev|electric)\b/.test(normalized)) return mapped("electric", 0.96);
  if (normalized === "gas" || /\b(gasoline|petrol)\b/.test(normalized)) return mapped("gas", 0.98);
  if (/\bdiesel\b/.test(normalized)) return mapped("diesel", 0.98);
  if (/\b(hydrogen|fuel cell|fcev)\b/.test(normalized)) return mapped("hydrogen", 0.94);
  return unsupported("fuel_type_primary", value);
}

function mapTransmission(value: string): MappingResult<CanonicalTransmission> {
  const normalized = normalizeLookup(value);
  if (/\b(continuously variable|cvt|e cvt)\b/.test(normalized)) return mapped("cvt", 0.96);
  if (/\bmanual\b/.test(normalized)) return mapped("manual", 0.98);
  if (/\bautomatic\b/.test(normalized)) return mapped("automatic", 0.98);
  return unsupported("transmission_style", value);
}

function mapBodyStyle(value: string): MappingResult<CanonicalBodyStyle> {
  const normalized = normalizeLookup(value);
  if (/\b(convertible|cabriolet|roadster)\b/.test(normalized)) return mapped("convertible", 0.94);
  if (/\b(coupe)\b/.test(normalized)) return mapped("coupe", 0.98);
  if (/\b(hatchback|liftback)\b/.test(normalized)) return mapped("hatchback", 0.94);
  if (/\b(sedan|saloon)\b/.test(normalized)) return mapped("sedan", 0.98);
  if (/\b(sport utility vehicle|suv|crossover utility vehicle)\b/.test(normalized)) return mapped("suv", 0.94);
  if (/\b(pickup)\b/.test(normalized)) return mapped("truck", 0.98);
  if (/\b(minivan)\b/.test(normalized)) return mapped("minivan", 0.98);
  if (/\b(station wagon|wagon)\b/.test(normalized)) return mapped("wagon", 0.96);
  return unsupported("body_class", value);
}

function mapVehicleCategory(value: string): MappingResult<CanonicalVehicleCategory> {
  const normalized = normalizeLookup(value);
  if (/\b(pickup)\b/.test(normalized)) return mapped("pickup", 0.96);
  if (/\b(minivan)\b/.test(normalized)) return mapped("minivan", 0.96);
  if (/\b(sport utility vehicle|suv)\b/.test(normalized)) return mapped("suv", 0.92);
  if (/\b(crossover)\b/.test(normalized)) return mapped("crossover", 0.92);
  if (/\b(van)\b/.test(normalized)) return mapped("van", 0.9);
  if (/\bpassenger car\b/.test(normalized)) {
    return mappingFailure(
      "reduced_specificity",
      "nhtsa_vehicle_type_too_broad",
      "NHTSA VehicleType identifies a passenger car but does not support a canonical size or purpose category.",
      "insufficient_specificity",
    );
  }
  if (/\btruck\b/.test(normalized)) {
    return mappingFailure(
      "ambiguous_mapping",
      "nhtsa_vehicle_type_truck_ambiguous",
      "NHTSA VehicleType identifies a truck but does not establish that it is a pickup.",
      "insufficient_specificity",
    );
  }
  if (/\bmultipurpose passenger vehicle|mpv\b/.test(normalized)) {
    return mappingFailure(
      "ambiguous_mapping",
      "nhtsa_vehicle_type_mpv_ambiguous",
      "NHTSA VehicleType MPV may describe an SUV, crossover, or van and is not mapped without more evidence.",
      "insufficient_specificity",
    );
  }
  return unsupported("vehicle_type", value);
}

function createEvidence(options: {
  evidenceId: string;
  vin: string;
  decoded: DecodedVin;
  context: CanonicalIngestionContext;
  dataUse: CanonicalContributionDataUse;
  observedAt: string | null;
  method: "direct" | "mapped";
}): CanonicalContributionEvidence {
  const direct = options.method === "direct";
  const fields: Array<[keyof DecodedVin, string]> = direct
    ? [["make", "Make"], ["model", "Model"], ["modelYear", "ModelYear"]]
    : [
        ["bodyClass", "BodyClass"],
        ["vehicleType", "VehicleType"],
        ["driveType", "DriveType"],
        ["fuelTypePrimary", "FuelTypePrimary"],
        ["transmissionStyle", "TransmissionStyle"],
      ];
  return {
    evidenceId: options.evidenceId,
    sourceType: "nhtsa",
    providerName: nhtsaProviderName,
    sourceRecordId: options.vin,
    sourceUrl: getDecodeVinUrl(options.vin),
    scope: "vin",
    observedAt: options.observedAt,
    retrievedAt: options.context.retrievedAt,
    market: options.context.market,
    methodology: direct
      ? "Direct vPIC identity projection with whitespace, casing, and type normalization only."
      : "Deterministic vPIC vocabulary mapping into existing canonical enums.",
    license: nhtsaLicense,
    dataUse: options.dataUse,
    sourceClaims: fields.map(([field, sourceField]) => ({
      sourceField,
      originalSourceValue: options.decoded[field],
    })),
    normalizationMethod: options.method,
    normalizationNotes: direct
      ? ["Original source values are retained; no vehicle facts are inferred."]
      : ["Unsupported or ambiguous values remain explicitly missing and emit typed issues."],
  };
}

function claimDatum<Value, Unit extends "none" | "year">(
  value: Value,
  unit: Unit,
  evidenceId: string,
  asOfDate: string,
  confidenceScore: number,
): CanonicalContributionDatum<Value, Unit> {
  return {
    value,
    unit,
    status: "sourced",
    confidence: confidence(confidenceScore, ["Normalized from one VIN-scoped NHTSA vPIC source claim."]),
    evidenceIds: [evidenceId],
    attemptEvidenceIds: [],
    estimated: false,
    estimationMethod: null,
    asOfDate,
    measurementContext: null,
    missingReason: null,
  };
}

function missingDatum<Value, Unit extends "none" | "year">(
  unit: Unit,
  attemptEvidenceId: string,
  missingReason: CanonicalMissingReason,
): CanonicalContributionDatum<Value, Unit> {
  return {
    value: null,
    unit,
    status: "missing",
    confidence: confidence(null, ["NHTSA exposed the decoded field but supplied no safely usable canonical value."], "not_applicable"),
    evidenceIds: [],
    attemptEvidenceIds: [attemptEvidenceId],
    estimated: false,
    estimationMethod: null,
    asOfDate: null,
    measurementContext: null,
    missingReason,
  };
}

function confidence(
  score: number | null,
  basis: string[],
  sourceAgreement: CanonicalConfidence["sourceAgreement"] = "single_source",
): CanonicalConfidence {
  return {
    score,
    level: score === null ? "unknown" : score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low",
    sourceAgreement,
    basis,
  };
}

function missingIssue(
  fieldPath: CanonicalVehicleFieldPath,
  sourceField: string,
  evidenceId: string,
) {
  return createIssue({
    code: `nhtsa_missing_${toSnakeCase(sourceField)}`,
    kind: "explicit_source_missing",
    fieldPath,
    message: `NHTSA returned no usable value for ${sourceField}.`,
    evidenceIds: [evidenceId],
    sourceField,
  });
}

function structuralIssue(message: string, sourceField: string | null = null) {
  return createIssue({
    code: "nhtsa_invalid_decoded_vin_structure",
    kind: "invalid_canonical_value",
    fieldPath: "record",
    message,
    evidenceIds: [],
    sourceField,
  });
}

function createIssue(input: Omit<CanonicalContributionIssue, "severity">): CanonicalContributionIssue {
  return { ...input, severity: input.kind === "invalid_canonical_value" ? "error" : "warning" };
}

function mapped<Value>(value: Value, confidenceScore: number): MappingSuccess<Value> {
  return { ok: true, value, confidenceScore };
}

function mappingFailure(
  issueKind: MappingFailure["issueKind"],
  issueCode: string,
  issueMessage: string,
  missingReason: CanonicalMissingReason,
): MappingFailure {
  return { ok: false, value: null, confidenceScore: null, issueKind, issueCode, issueMessage, missingReason };
}

function unsupported(concept: string, sourceValue: string): MappingFailure {
  return mappingFailure(
    "normalization_warning",
    `nhtsa_unsupported_${concept}`,
    `NHTSA value ${JSON.stringify(sourceValue)} has no safe canonical ${concept.replaceAll("_", " ")} mapping.`,
    "unsupported",
  );
}

function normalizeMake(value: string) {
  const trimmed = collapseWhitespace(value);
  if (!trimmed || /[a-z]/.test(trimmed)) return trimmed;
  return trimmed
    .split(" ")
    .map((word) => word.length <= 3 ? word : titleCaseWord(word))
    .join(" ");
}

function normalizeModel(value: string) {
  return collapseWhitespace(value);
}

function normalizeLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function titleCaseWord(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[-'])\p{L}/gu, (letter) => letter.toUpperCase());
}

function normalizeSourceRecordId(record: NhtsaSourceRecord) {
  return typeof record?.vin === "string" && record.vin.trim() ? record.vin.trim().toUpperCase() : "unknown";
}

function getDecodeVinUrl(vin: string) {
  return `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
}

function toSnakeCase(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}
