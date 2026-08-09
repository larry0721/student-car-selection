import type {
  CanonicalBodyStyle,
  CanonicalConfidence,
  CanonicalDrivetrain,
  CanonicalFuelType,
  CanonicalIngestionContext,
  CanonicalMissingReason,
  CanonicalTransmission,
  CanonicalUnit,
  CanonicalVehicleCategory,
  CanonicalVehicleFieldPath,
  CanonicalValueStatus,
} from "../../../../types/canonicalVehicle";
import {
  canonicalContributionSchemaVersion,
  type CanonicalContributionDataUse,
  type CanonicalContributionDatum,
  type CanonicalContributionEvidence,
  type CanonicalContributionIssue,
  type CanonicalContributionIssueKind,
  type CanonicalVehicleContribution,
  type CanonicalVehicleContributionAdapter,
} from "../../../../types/canonicalVehicleContribution";
import type { EpaVehicleRecord } from "./epa-client";

export const epaContributionNormalizationVersion = "fueleconomy-vehicle-1.0.0" as const;

const epaProviderName = "FuelEconomy.gov / EPA";
const epaLicense = "U.S. government public data; verify applicable FuelEconomy.gov terms.";
const annualFuelCostMethodology = "FuelEconomy.gov annual fuel cost assumes 15,000 miles per year, 55% city driving, and the source fuel prices for the vehicle.";

export type EpaContributionNormalizationOptions = {
  dataUse?: CanonicalContributionDataUse;
};

export type EpaContributionNormalizationResult = {
  contribution: CanonicalVehicleContribution | null;
  issues: CanonicalContributionIssue[];
};

type MappingFailure = {
  ok: false;
  missingReason: CanonicalMissingReason;
  issueKind: CanonicalContributionIssueKind;
  issueCode: string;
  issueMessage: string;
};

type MappingSuccess<Value> = {
  ok: true;
  value: Value;
  confidenceScore: number;
  issue?: {
    kind: CanonicalContributionIssueKind;
    code: string;
    message: string;
  };
};

type MappingResult<Value> = MappingFailure | MappingSuccess<Value>;
type SourceFieldState = "omitted" | "missing" | "invalid" | "value";
type NumericSourceValue = {
  state: SourceFieldState;
  value: number | null;
};

const directSourceFields = [
  "id",
  "year",
  "make",
  "model",
  "cylinders",
  "displ",
  "city08",
  "highway08",
  "comb08",
  "cityA08",
  "highwayA08",
  "combA08",
  "range",
  "rangeCity",
  "rangeHwy",
  "charge240",
  "charge120",
  "cityE",
  "highwayE",
  "combE",
  "co2",
  "co2TailpipeGpm",
  "co2TailpipeAGpm",
  "ghgScore",
  "ghgScoreA",
  "feScore",
  "feScoreA",
  "createdOn",
  "modifiedOn",
] as const satisfies readonly (keyof EpaVehicleRecord)[];

const mappedSourceFields = [
  "VClass",
  "drive",
  "trany",
  "fuelType",
  "fuelType1",
  "fuelType2",
  "atvType",
] as const satisfies readonly (keyof EpaVehicleRecord)[];

const derivedSourceFields = [
  "fuelCost08",
  "fuelCostA08",
] as const satisfies readonly (keyof EpaVehicleRecord)[];

export function normalizeEpaVehicleToContribution(
  sourceRecord: EpaVehicleRecord,
  context: CanonicalIngestionContext,
  options: EpaContributionNormalizationOptions = {},
): EpaContributionNormalizationResult {
  const contextIssues = validateContext(context);
  const recordIssues = validateRequiredIdentity(sourceRecord, context);
  if (contextIssues.length || recordIssues.length) {
    return { contribution: null, issues: [...contextIssues, ...recordIssues] };
  }

  const record = sourceRecord as EpaVehicleRecord;
  const dataUse = options.dataUse || "production";
  const sourceId = record.id.trim();
  const contributionId = `${context.ingestionId}:fueleconomy:${sourceId}`;
  const directEvidenceId = `${contributionId}:direct`;
  const mappedEvidenceId = `${contributionId}:mapped`;
  const derivedEvidenceId = `${contributionId}:derived`;
  const sourceDate = record.modifiedOn || record.createdOn || context.retrievedAt;
  const issues: CanonicalContributionIssue[] = [];
  const normalizedMake = collapseWhitespace(record.make);
  const normalizedModel = collapseWhitespace(record.model);

  const evidence = [
    createEvidence(record, context, dataUse, directEvidenceId, "direct", directSourceFields),
    createEvidence(record, context, dataUse, mappedEvidenceId, "mapped", mappedSourceFields),
    createEvidence(record, context, dataUse, derivedEvidenceId, "derived", derivedSourceFields),
  ].filter((item): item is CanonicalContributionEvidence => item !== null);

  const identity: NonNullable<CanonicalVehicleContribution["data"]["identity"]> = {
    make: claimDatum(normalizedMake, "none", directEvidenceId, sourceDate, 0.98),
    model: claimDatum(normalizedModel, "none", directEvidenceId, sourceDate, 0.98),
    modelYear: claimDatum(record.year, "year", directEvidenceId, sourceDate, 0.99),
  };

  applyVehicleClass(record, identity, mappedEvidenceId, sourceDate, issues);
  applyMappedStringField({
    record,
    sourceField: "drive",
    fieldPath: "identity.drivetrain",
    evidenceId: mappedEvidenceId,
    asOfDate: sourceDate,
    map: mapDrivetrain,
    assign: (datum) => { identity.drivetrain = datum; },
  }, issues);
  applyMappedStringField({
    record,
    sourceField: "trany",
    fieldPath: "identity.transmission",
    evidenceId: mappedEvidenceId,
    asOfDate: sourceDate,
    map: mapTransmission,
    assign: (datum) => { identity.transmission = datum; },
  }, issues);

  const fuelMapping = mapFuelType(record);
  if (fuelMapping.present) {
    identity.fuelType = datumFromMapping(
      fuelMapping.result,
      "none",
      mappedEvidenceId,
      sourceDate,
      "identity.fuelType",
      fuelMapping.sourceField,
      issues,
    );
  }

  const environment: NonNullable<CanonicalVehicleContribution["data"]["environment"]> = {};
  applyFuelEconomy(record, fuelMapping, environment, directEvidenceId, sourceDate, issues);
  applyEvRange(record, fuelMapping, environment, directEvidenceId, sourceDate, issues);
  applyEmissions(record, environment, directEvidenceId, sourceDate, issues);

  const financial: NonNullable<CanonicalVehicleContribution["data"]["financial"]> = {};
  applyFuelCost(record, financial, derivedEvidenceId, sourceDate, issues);
  preserveUnsupportedMeasurements(record, issues, directEvidenceId, derivedEvidenceId);

  const sourceConfidenceScore = calculateSourceConfidence(record, issues, context.retrievedAt);
  const contribution = {
    schemaVersion: canonicalContributionSchemaVersion,
    contributionId,
    dataUse,
    normalizationVersion: epaContributionNormalizationVersion,
    recordScope: "configuration",
    source: {
      sourceType: "epa",
      providerName: epaProviderName,
      sourceRecordId: sourceId,
      sourceUrl: getVehicleUrl(sourceId),
      observedAt: record.modifiedOn || record.createdOn || null,
      retrievedAt: context.retrievedAt,
      market: context.market,
      methodology: "Caller-selected FuelEconomy.gov vehicle record normalized deterministically; no configuration matching was performed.",
      license: epaLicense,
    },
    linkage: {
      canonicalRecordId: null,
      vin: null,
      make: normalizedMake,
      model: normalizedModel,
      modelYear: record.year,
      generation: null,
      trim: null,
      configurationId: `fueleconomy:${sourceId}`,
      externalIds: [{ namespace: "fueleconomy_gov_vehicle_id", value: sourceId }],
    },
    sourceConfidence: confidence(sourceConfidenceScore, [
      "FuelEconomy.gov is an authoritative source for published EPA vehicle configuration, efficiency, cost, and emissions data.",
      `${issues.length} typed normalization issue${issues.length === 1 ? "" : "s"} were retained without fabricating values.`,
      record.modifiedOn || record.createdOn
        ? "Source creation or modification metadata was available."
        : "The source record did not include creation or modification metadata.",
    ]),
    sourceMetadata: {
      dataset: "FuelEconomy.gov Find a Car vehicle data",
      service: "vehicle",
      epaVehicleId: sourceId,
      vehicleClass: record.VClass ?? null,
      createdOn: record.createdOn ?? null,
      modifiedOn: record.modifiedOn ?? null,
      sourceFieldCount: Object.keys(record).length,
      sourceUnits: {
        city08: "mpg_or_mpge",
        highway08: "mpg_or_mpge",
        comb08: "mpg_or_mpge",
        cityE: "kwh_per_100_miles",
        highwayE: "kwh_per_100_miles",
        combE: "kwh_per_100_miles",
        range: "miles",
        rangeCity: "miles",
        rangeHwy: "miles",
        charge120: "hours",
        charge240: "hours",
        fuelCost08: "usd_per_year",
        fuelCostA08: "usd_per_year",
        co2: "grams_per_mile",
        co2TailpipeGpm: "grams_per_mile",
        co2TailpipeAGpm: "grams_per_mile",
        ghgScore: "score_0_10",
        ghgScoreA: "score_0_10",
        feScore: "score_0_10",
        feScoreA: "score_0_10",
      },
      annualFuelCostAssumptions: {
        annualMiles: 15000,
        cityDrivingPercent: 55,
        personalized: false,
      },
    },
    evidence,
    data: {
      identity,
      ...(Object.keys(financial).length ? { financial } : {}),
      ...(Object.keys(environment).length ? { environment } : {}),
    },
    issues,
  } satisfies CanonicalVehicleContribution;

  return { contribution, issues };
}

export const epaContributionAdapter: CanonicalVehicleContributionAdapter<EpaVehicleRecord> = {
  sourceType: "epa",
  async normalize(sourceRecords, context) {
    const results = sourceRecords.map((record) => ({
      sourceRecordId: normalizeSourceRecordId(record),
      result: normalizeEpaVehicleToContribution(record, context),
    }));
    return {
      contributions: results.flatMap(({ result }) => result.contribution ? [result.contribution] : []),
      rejectedSourceRecordIds: results.flatMap(({ sourceRecordId, result }) => result.contribution ? [] : [sourceRecordId]),
      issues: results.flatMap(({ result }) => result.issues),
    };
  },
};

function validateContext(context: CanonicalIngestionContext) {
  if (
    !context
    || context.sourceType !== "epa"
    || typeof context.ingestionId !== "string"
    || !context.ingestionId.trim()
    || typeof context.retrievedAt !== "string"
    || !Number.isFinite(Date.parse(context.retrievedAt))
  ) {
    return [createIssue({
      code: "epa_invalid_ingestion_context",
      kind: "invalid_canonical_value",
      fieldPath: "record",
      message: "EPA contribution normalization requires sourceType epa, a non-blank ingestion ID, and a valid retrieval timestamp.",
      evidenceIds: [],
      sourceField: null,
    })];
  }
  return [];
}

function validateRequiredIdentity(sourceRecord: EpaVehicleRecord, context: CanonicalIngestionContext) {
  if (!sourceRecord || typeof sourceRecord !== "object" || Array.isArray(sourceRecord)) {
    return [invalidIdentityIssue("EPA source record must be an object.")];
  }
  const issues: CanonicalContributionIssue[] = [];
  if (typeof sourceRecord.id !== "string" || !/^\d+$/.test(sourceRecord.id.trim()) || Number(sourceRecord.id) <= 0) {
    issues.push(invalidIdentityIssue("EPA source record contains an invalid vehicle ID.", "id"));
  }
  if (typeof sourceRecord.make !== "string" || !sourceRecord.make.trim()) {
    issues.push(invalidIdentityIssue("EPA source record contains an invalid make.", "make"));
  }
  if (typeof sourceRecord.model !== "string" || !sourceRecord.model.trim()) {
    issues.push(invalidIdentityIssue("EPA source record contains an invalid model.", "model"));
  }
  const retrievedYear = Number.parseInt(context?.retrievedAt?.slice(0, 4), 10);
  const maximumYear = Number.isInteger(retrievedYear) ? retrievedYear + 2 : new Date().getUTCFullYear() + 2;
  if (!Number.isInteger(sourceRecord.year) || sourceRecord.year < 1984 || sourceRecord.year > maximumYear) {
    issues.push(createIssue({
      code: "epa_invalid_model_year",
      kind: "invalid_canonical_value",
      fieldPath: "identity.modelYear",
      message: `EPA source model year must be an integer from 1984 through ${maximumYear}.`,
      evidenceIds: [],
      sourceField: "year",
    }));
  }
  return issues;
}

function applyVehicleClass(
  record: EpaVehicleRecord,
  identity: NonNullable<CanonicalVehicleContribution["data"]["identity"]>,
  evidenceId: string,
  asOfDate: string,
  issues: CanonicalContributionIssue[],
) {
  if (!Object.hasOwn(record, "VClass")) return;
  if (record.VClass === null || !record.VClass?.trim()) {
    identity.vehicleCategory = missingDatum("none", evidenceId, "not_available", "EPA exposed VClass but supplied no value.");
    identity.bodyStyle = missingDatum("none", evidenceId, "not_available", "EPA exposed VClass but supplied no value.");
    issues.push(missingIssue("identity.vehicleCategory", "VClass", evidenceId));
    issues.push(missingIssue("identity.bodyStyle", "VClass", evidenceId));
    return;
  }

  const mapping = mapVehicleClass(record.VClass);
  identity.vehicleCategory = datumFromMapping(
    mapping.category,
    "none",
    evidenceId,
    asOfDate,
    "identity.vehicleCategory",
    "VClass",
    issues,
  );
  identity.bodyStyle = datumFromMapping(
    mapping.bodyStyle,
    "none",
    evidenceId,
    asOfDate,
    "identity.bodyStyle",
    "VClass",
    issues,
  );
}

function applyMappedStringField<Value extends string>(
  options: {
    record: EpaVehicleRecord;
    sourceField: "drive" | "trany";
    fieldPath: "identity.drivetrain" | "identity.transmission";
    evidenceId: string;
    asOfDate: string;
    map: (value: string) => MappingResult<Value>;
    assign: (datum: CanonicalContributionDatum<Value, "none">) => void;
  },
  issues: CanonicalContributionIssue[],
) {
  if (!Object.hasOwn(options.record, options.sourceField)) return;
  const sourceValue = options.record[options.sourceField];
  if (sourceValue === null || typeof sourceValue !== "string" || !sourceValue.trim()) {
    options.assign(missingDatum("none", options.evidenceId, "not_available", `EPA exposed ${options.sourceField} but supplied no usable value.`));
    issues.push(missingIssue(options.fieldPath, options.sourceField, options.evidenceId));
    return;
  }
  options.assign(datumFromMapping(
    options.map(sourceValue),
    "none",
    options.evidenceId,
    options.asOfDate,
    options.fieldPath,
    options.sourceField,
    issues,
  ));
}

function applyFuelEconomy(
  record: EpaVehicleRecord,
  fuelMapping: ReturnType<typeof mapFuelType>,
  environment: NonNullable<CanonicalVehicleContribution["data"]["environment"]>,
  evidenceId: string,
  asOfDate: string,
  issues: CanonicalContributionIssue[],
) {
  const fuelType = fuelMapping.result.ok ? fuelMapping.result.value : null;
  let sourceField: "combE" | "comb08" = fuelType === "electric" ? "combE" : "comb08";
  let source = readNumber(record, sourceField, "environment.fuelEconomy", evidenceId, issues);
  if (fuelType === "electric" && (source.state !== "value" || source.value === null || source.value <= 0)) {
    const mpge = readNumber(record, "comb08", "environment.fuelEconomy", evidenceId, issues);
    if (mpge.state === "value" && mpge.value !== null && mpge.value > 0) {
      sourceField = "comb08";
      source = mpge;
    }
  }
  if (source.state === "omitted") return;
  const unit = sourceField === "combE" ? "kwh_per_100_miles" : fuelType === "electric" ? "mpge" : "mpg";
  if (source.state !== "value" || source.value === null || source.value <= 0) {
    const reason = source.state === "invalid" || source.value !== null && source.value < 0 ? "invalid" : "not_available";
    environment.fuelEconomy = missingDatum(unit, evidenceId, reason, `EPA ${sourceField} did not provide a positive usable efficiency value.`);
    if (source.state === "value") {
      issues.push(createIssue({
        code: "epa_inappropriate_fuel_economy_value",
        kind: "normalization_warning",
        fieldPath: "environment.fuelEconomy",
        message: `EPA ${sourceField} value ${String(source.value)} is not a usable canonical fuel-economy value.`,
        evidenceIds: [evidenceId],
        sourceField,
      }));
    }
    return;
  }
  environment.fuelEconomy = claimDatum(source.value, unit, evidenceId, asOfDate, 0.97, "sourced", {
    sourceField,
    sourceUnit: unit,
  });
}

function applyEvRange(
  record: EpaVehicleRecord,
  fuelMapping: ReturnType<typeof mapFuelType>,
  environment: NonNullable<CanonicalVehicleContribution["data"]["environment"]>,
  evidenceId: string,
  asOfDate: string,
  issues: CanonicalContributionIssue[],
) {
  const source = readNumber(record, "range", "environment.evRange", evidenceId, issues);
  if (source.state === "omitted") return;
  const fuelType = fuelMapping.result.ok ? fuelMapping.result.value : null;
  const supportsElectricRange = fuelType === "electric" || fuelType === "plug_in_hybrid";
  if (!supportsElectricRange && source.value === 0) {
    environment.evRange = missingDatum("miles", evidenceId, "not_applicable", "EPA range is zero because electric driving range is not applicable to this powertrain.");
    issues.push(createIssue({
      code: "epa_not_applicable_ev_range",
      kind: "normalization_warning",
      fieldPath: "environment.evRange",
      message: "EPA range is zero for a non-plug-in vehicle and is preserved as not applicable, not as a zero-mile EV range.",
      evidenceIds: [evidenceId],
      sourceField: "range",
    }));
    return;
  }
  if (source.state !== "value" || source.value === null || source.value <= 0) {
    environment.evRange = missingDatum(
      "miles",
      evidenceId,
      source.state === "invalid" || source.value !== null && source.value < 0 ? "invalid" : "not_available",
      "EPA exposed electric range but did not provide a positive usable value.",
    );
    return;
  }
  environment.evRange = claimDatum(source.value, "miles", evidenceId, asOfDate, 0.97);
}

function applyEmissions(
  record: EpaVehicleRecord,
  environment: NonNullable<CanonicalVehicleContribution["data"]["environment"]>,
  evidenceId: string,
  asOfDate: string,
  issues: CanonicalContributionIssue[],
) {
  const preferred = readNumber(record, "co2TailpipeGpm", "environment.emissions", evidenceId, issues);
  const fallback = readNumber(record, "co2", "environment.emissions", evidenceId, issues);
  const sourceField = preferred.state === "value" ? "co2TailpipeGpm" : "co2";
  const source = preferred.state === "value" ? preferred : fallback.state !== "omitted" ? fallback : preferred;
  if (source.state === "omitted") return;
  if (source.state !== "value" || source.value === null || source.value < 0) {
    environment.emissions = missingDatum(
      "grams_co2e_per_mile",
      evidenceId,
      source.state === "invalid" || source.value !== null && source.value < 0 ? "invalid" : "not_available",
      "EPA exposed CO2 data but supplied no usable canonical value.",
    );
    return;
  }
  environment.emissions = claimDatum(source.value, "grams_co2e_per_mile", evidenceId, asOfDate, 0.97, "sourced", {
    sourceField,
    sourceUnit: "grams_per_mile",
  });
}

function applyFuelCost(
  record: EpaVehicleRecord,
  financial: NonNullable<CanonicalVehicleContribution["data"]["financial"]>,
  evidenceId: string,
  asOfDate: string,
  issues: CanonicalContributionIssue[],
) {
  const source = readNumber(record, "fuelCost08", "financial.fuelEnergyCost", evidenceId, issues);
  if (source.state === "omitted") return;
  if (source.state !== "value" || source.value === null || source.value < 0) {
    financial.fuelEnergyCost = missingDatum(
      "usd_per_month",
      evidenceId,
      source.state === "invalid" || source.value !== null && source.value < 0 ? "invalid" : "not_available",
      "EPA exposed annual fuel cost but supplied no usable non-negative value.",
    );
    return;
  }
  const monthlyCost = Math.round((source.value / 12) * 100) / 100;
  financial.fuelEnergyCost = claimDatum(
    monthlyCost,
    "usd_per_month",
    evidenceId,
    asOfDate,
    0.9,
    "derived",
    {
      sourceField: "fuelCost08",
      sourceAnnualCostUsd: source.value,
      annualMiles: 15000,
      cityDrivingPercent: 55,
      personalized: false,
    },
    "EPA annual fuel cost divided by 12; source assumptions retained in measurementContext.",
  );
}

function preserveUnsupportedMeasurements(
  record: EpaVehicleRecord,
  issues: CanonicalContributionIssue[],
  directEvidenceId: string,
  derivedEvidenceId: string,
) {
  addUnsupportedDestinationIssue(record, ["city08", "highway08"], "environment.fuelEconomy", directEvidenceId, issues, "city/highway fuel-economy breakdown");
  addUnsupportedDestinationIssue(record, ["cityA08", "highwayA08", "combA08"], "environment.fuelEconomy", directEvidenceId, issues, "alternate-fuel efficiency");
  addUnsupportedDestinationIssue(record, ["cityE", "highwayE"], "environment.fuelEconomy", directEvidenceId, issues, "city/highway electric-consumption breakdown");
  addUnsupportedDestinationIssue(record, ["rangeCity", "rangeHwy"], "environment.evRange", directEvidenceId, issues, "city/highway EV-range breakdown");
  addUnsupportedDestinationIssue(record, ["charge120", "charge240"], "environment.chargingSpeed", directEvidenceId, issues, "charging time, which cannot be converted to charging power without battery-energy data");
  addUnsupportedDestinationIssue(record, ["ghgScore", "ghgScoreA", "feScore", "feScoreA"], "environment.emissions", directEvidenceId, issues, "EPA 0-10 environmental scores");
  addUnsupportedDestinationIssue(record, ["co2TailpipeAGpm"], "environment.emissions", directEvidenceId, issues, "alternate-fuel tailpipe emissions");
  addUnsupportedDestinationIssue(record, ["fuelCostA08"], "financial.fuelEnergyCost", derivedEvidenceId, issues, "alternate-fuel annual cost");
  addUnsupportedDestinationIssue(record, ["cylinders", "displ"], "record", directEvidenceId, issues, "engine cylinder/displacement details");
}

function addUnsupportedDestinationIssue(
  record: EpaVehicleRecord,
  sourceFields: readonly (keyof EpaVehicleRecord)[],
  fieldPath: CanonicalVehicleFieldPath | "record",
  evidenceId: string,
  issues: CanonicalContributionIssue[],
  concept: string,
) {
  const presentFields = sourceFields.filter((field) => {
    if (!Object.hasOwn(record, field)) return false;
    const value = record[field];
    if (typeof value === "number") return value !== 0;
    return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
  });
  if (!presentFields.length) return;
  issues.push(createIssue({
    code: `epa_unsupported_destination_${presentFields.join("_").toLowerCase()}`,
    kind: "normalization_warning",
    fieldPath,
    message: `EPA supplied ${concept}, but the current CVR has no lossless canonical destination; source values remain in evidence.`,
    evidenceIds: [evidenceId],
    sourceField: presentFields.join(","),
  }));
}

function applyMappingIssue(
  mapping: MappingResult<unknown>,
  fieldPath: CanonicalVehicleFieldPath,
  sourceField: string,
  evidenceId: string,
  issues: CanonicalContributionIssue[],
) {
  const issue = mapping.ok ? mapping.issue : {
    kind: mapping.issueKind,
    code: mapping.issueCode,
    message: mapping.issueMessage,
  };
  if (!issue) return;
  issues.push(createIssue({
    code: issue.code,
    kind: issue.kind,
    fieldPath,
    message: issue.message,
    evidenceIds: [evidenceId],
    sourceField,
  }));
}

function datumFromMapping<Value, Unit extends CanonicalUnit>(
  mapping: MappingResult<Value>,
  unit: Unit,
  evidenceId: string,
  asOfDate: string,
  fieldPath: CanonicalVehicleFieldPath,
  sourceField: string,
  issues: CanonicalContributionIssue[],
): CanonicalContributionDatum<Value, Unit> {
  applyMappingIssue(mapping, fieldPath, sourceField, evidenceId, issues);
  if (!mapping.ok) {
    return missingDatum(unit, evidenceId, mapping.missingReason, mapping.issueMessage);
  }
  return claimDatum(mapping.value, unit, evidenceId, asOfDate, mapping.confidenceScore);
}

function mapVehicleClass(value: string) {
  const normalized = normalizeLookup(value);
  const ambiguousBody = mappingFailure(
    "ambiguous_mapping",
    "epa_ambiguous_vehicle_class_body_style",
    `EPA VClass ${JSON.stringify(value)} identifies size/class but not a safe canonical body style.`,
    "insufficient_specificity",
  );
  if (/\b(minicompact|subcompact) cars?\b/.test(normalized)) {
    return { category: mapped<CanonicalVehicleCategory>("subcompact_car", 0.94), bodyStyle: ambiguousBody };
  }
  if (/\bcompact cars?\b/.test(normalized)) {
    return { category: mapped<CanonicalVehicleCategory>("compact_car", 0.94), bodyStyle: ambiguousBody };
  }
  if (/\b(mid size|midsize) cars?\b/.test(normalized)) {
    return { category: mapped<CanonicalVehicleCategory>("midsize_car", 0.94), bodyStyle: ambiguousBody };
  }
  if (/\blarge cars?\b/.test(normalized)) {
    return { category: mapped<CanonicalVehicleCategory>("large_car", 0.94), bodyStyle: ambiguousBody };
  }
  if (/\bsport utility vehicles?\b|\bsuvs?\b/.test(normalized)) {
    return {
      category: mapped<CanonicalVehicleCategory>("suv", 0.88, {
        kind: "reduced_specificity",
        code: "epa_reduced_vehicle_class_suv",
        message: "EPA SUV class maps to canonical SUV without inferring crossover status.",
      }),
      bodyStyle: mapped<CanonicalBodyStyle>("suv", 0.92),
    };
  }
  if (/\bpickup trucks?\b/.test(normalized)) {
    return { category: mapped<CanonicalVehicleCategory>("pickup", 0.94), bodyStyle: mapped<CanonicalBodyStyle>("truck", 0.94) };
  }
  if (/\bminivans?\b/.test(normalized)) {
    return { category: mapped<CanonicalVehicleCategory>("minivan", 0.96), bodyStyle: mapped<CanonicalBodyStyle>("minivan", 0.96) };
  }
  if (/\b(cargo|passenger) vans?\b/.test(normalized)) {
    return {
      category: mapped<CanonicalVehicleCategory>("van", 0.92),
      bodyStyle: mappingFailure("normalization_warning", "epa_unsupported_van_body_style", "Canonical body style has no lossless general-van value.", "unsupported"),
    };
  }
  if (/\bstation wagons?\b/.test(normalized)) {
    return {
      category: mappingFailure("normalization_warning", "epa_unsupported_wagon_category", "Canonical vehicle category has no lossless station-wagon value.", "unsupported"),
      bodyStyle: mapped<CanonicalBodyStyle>("wagon", 0.94),
    };
  }
  const failure = mappingFailure(
    "ambiguous_mapping",
    "epa_ambiguous_vehicle_class",
    `EPA VClass ${JSON.stringify(value)} has no safe canonical category or body-style mapping.`,
    "unsupported",
  );
  return { category: failure, bodyStyle: failure };
}

function mapDrivetrain(value: string): MappingResult<CanonicalDrivetrain> {
  const normalized = normalizeLookup(value);
  if (/^(front wheel drive|fwd)$/.test(normalized)) return mapped("FWD", 0.97);
  if (/^(rear wheel drive|rwd)$/.test(normalized)) return mapped("RWD", 0.97);
  if (/^(all wheel drive|awd)$/.test(normalized)) return mapped("AWD", 0.97);
  if (/^(4 wheel drive|part time 4 wheel drive|4wd)$/.test(normalized)) return mapped("4WD", 0.96);
  if (/^(2 wheel drive|4 wheel or all wheel drive)$/.test(normalized)) {
    return mappingFailure("ambiguous_mapping", "epa_ambiguous_drivetrain", `EPA drive value ${JSON.stringify(value)} does not distinguish a canonical drivetrain.`, "insufficient_specificity");
  }
  return mappingFailure("normalization_warning", "epa_unsupported_drivetrain", `EPA drive value ${JSON.stringify(value)} has no safe canonical drivetrain mapping.`, "unsupported");
}

function mapTransmission(value: string): MappingResult<CanonicalTransmission> {
  const normalized = normalizeLookup(value);
  if (/\b(cvt|continuously variable|variable gear ratios)\b/.test(normalized)) return mapped("cvt", 0.96);
  if (/^manual\b/.test(normalized)) return mapped("manual", 0.97);
  if (/\bautomatic\b/.test(normalized)) return mapped("automatic", 0.96);
  return mappingFailure("normalization_warning", "epa_unsupported_transmission", `EPA trany value ${JSON.stringify(value)} has no safe canonical transmission-family mapping.`, "unsupported");
}

function mapFuelType(record: EpaVehicleRecord) {
  const sourceFields = (["fuelType", "fuelType1", "fuelType2", "atvType"] as const)
    .filter((field) => Object.hasOwn(record, field));
  if (!sourceFields.length) {
    return { present: false, sourceField: "fuelType", result: mappingFailure("explicit_source_missing", "epa_missing_fuel_type", "EPA did not expose a fuel-type field.", "not_collected") as MappingResult<CanonicalFuelType> };
  }
  const values = sourceFields.flatMap((field) => typeof record[field] === "string" && record[field]?.trim() ? [record[field] as string] : []);
  if (!values.length) {
    return { present: true, sourceField: sourceFields.join(","), result: mappingFailure("explicit_source_missing", "epa_missing_fuel_type", "EPA exposed fuel type but supplied no usable value.", "not_available") as MappingResult<CanonicalFuelType> };
  }
  const normalized = normalizeLookup(values.join(" "));
  const model = normalizeLookup(record.model);
  const hasElectricity = /\belectricity\b|\belectric\b|\bbev\b/.test(normalized);
  const hasGasoline = /\b(regular|premium|midgrade|gasoline|gas)\b/.test(normalized) && !/natural gas/.test(normalized);
  const hasDiesel = /\bdiesel\b/.test(normalized);
  const hasHydrogen = /\bhydrogen\b/.test(normalized);
  const hasUnsupportedFuel = /\b(e85|ethanol|cng|natural gas|propane|lpg)\b/.test(normalized);
  const plugInEvidence = /\bplug in hybrid\b|\bphev\b/.test(normalized)
    || hasElectricity && hasGasoline && ((record.range || 0) > 0 || (record.charge240 || 0) > 0 || (record.charge120 || 0) > 0);

  let result: MappingResult<CanonicalFuelType>;
  if (hasUnsupportedFuel || [hasGasoline, hasDiesel, hasHydrogen].filter(Boolean).length > 1) {
    result = mappingFailure("ambiguous_mapping", "epa_ambiguous_fuel_type", `EPA fuel values ${JSON.stringify(values)} describe a combination the canonical fuel taxonomy cannot safely represent.`, "unsupported");
  } else if (plugInEvidence) {
    result = mapped("plug_in_hybrid", 0.94);
  } else if (hasElectricity && !hasGasoline && !hasDiesel && !hasHydrogen) {
    result = mapped("electric", 0.98);
  } else if (hasHydrogen && !hasElectricity) {
    result = mapped("hydrogen", 0.97);
  } else if (hasDiesel && !hasElectricity) {
    result = mapped("diesel", 0.98);
  } else if (hasGasoline && !hasElectricity && (/\bhybrid\b/.test(normalized) || /\bhybrid\b/.test(model))) {
    result = mapped("hybrid", 0.91, {
      kind: "reduced_specificity",
      code: "epa_hybrid_identity_evidence",
      message: "EPA fuel and explicit model identity support a conventional hybrid mapping; plug-in capability was not inferred.",
    });
  } else if (hasGasoline && !hasElectricity) {
    result = mapped("gas", 0.98);
  } else if (hasElectricity && hasGasoline) {
    result = mappingFailure("ambiguous_mapping", "epa_ambiguous_fuel_type", "EPA reports gasoline and electricity without sufficient plug-in or conventional-hybrid evidence.", "insufficient_specificity");
  } else {
    result = mappingFailure("normalization_warning", "epa_unsupported_fuel_type", `EPA fuel values ${JSON.stringify(values)} have no safe canonical fuel mapping.`, "unsupported");
  }
  return { present: true, sourceField: sourceFields.join(","), result };
}

function readNumber(
  record: EpaVehicleRecord,
  sourceField: keyof EpaVehicleRecord,
  fieldPath: CanonicalVehicleFieldPath,
  evidenceId: string,
  issues: CanonicalContributionIssue[],
): NumericSourceValue {
  if (!Object.hasOwn(record, sourceField)) return { state: "omitted", value: null };
  const raw = record[sourceField];
  if (raw === null) {
    issues.push(missingIssue(fieldPath, String(sourceField), evidenceId));
    return { state: "missing", value: null };
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return { state: "value", value: raw };
  issues.push(createIssue({
    code: "epa_malformed_numeric_value",
    kind: "invalid_canonical_value",
    fieldPath,
    message: `EPA field ${sourceField} reached normalization with a malformed numeric value.`,
    evidenceIds: [evidenceId],
    sourceField,
  }));
  return { state: "invalid", value: null };
}

function claimDatum<Value, Unit extends CanonicalUnit>(
  value: Value,
  unit: Unit,
  evidenceId: string,
  asOfDate: string,
  confidenceScore: number,
  status: Exclude<CanonicalValueStatus, "missing" | "estimated"> = "sourced",
  measurementContext: Record<string, string | number | boolean> | null = null,
  estimationMethod: string | null = null,
): CanonicalContributionDatum<Value, Unit> {
  return {
    value,
    unit,
    status,
    confidence: confidence(confidenceScore, ["One caller-selected EPA configuration supports this canonical value."]),
    evidenceIds: [evidenceId],
    attemptEvidenceIds: [],
    estimated: false,
    estimationMethod,
    asOfDate,
    measurementContext,
    missingReason: null,
  };
}

function missingDatum<Value, Unit extends CanonicalUnit>(
  unit: Unit,
  evidenceId: string,
  missingReason: CanonicalMissingReason,
  basis: string,
): CanonicalContributionDatum<Value, Unit> {
  return {
    value: null,
    unit,
    status: "missing",
    confidence: confidence(null, [basis], "not_applicable"),
    evidenceIds: [],
    attemptEvidenceIds: [evidenceId],
    estimated: false,
    estimationMethod: null,
    asOfDate: null,
    measurementContext: null,
    missingReason,
  };
}

function createEvidence(
  record: EpaVehicleRecord,
  context: CanonicalIngestionContext,
  dataUse: CanonicalContributionDataUse,
  evidenceId: string,
  method: CanonicalContributionEvidence["normalizationMethod"],
  sourceFields: readonly (keyof EpaVehicleRecord)[],
): CanonicalContributionEvidence | null {
  const sourceClaims = sourceFields.flatMap((sourceField) => {
    if (!Object.hasOwn(record, sourceField)) return [];
    const value = record[sourceField];
    return value === undefined ? [] : [{ sourceField, originalSourceValue: value }];
  });
  if (!sourceClaims.length) return null;
  const sourceId = record.id.trim();
  return {
    evidenceId,
    sourceType: "epa",
    providerName: epaProviderName,
    sourceRecordId: sourceId,
    sourceUrl: getVehicleUrl(sourceId),
    scope: "configuration",
    observedAt: record.modifiedOn || record.createdOn || null,
    retrievedAt: context.retrievedAt,
    market: context.market,
    methodology: method === "direct"
      ? "Published EPA source values retained with type formatting and explicit canonical units; unsupported breakdowns remain source-only."
      : method === "mapped"
        ? "Deterministic EPA vocabulary mapping into existing canonical identity enums."
        : annualFuelCostMethodology,
    license: epaLicense,
    dataUse,
    sourceClaims,
    normalizationMethod: method,
    normalizationNotes: method === "direct"
      ? ["MPG/MPGe, kWh/100 miles, miles, hours, grams/mile, and EPA 0-10 scores retain their documented source meaning."]
      : method === "mapped"
        ? ["Ambiguous or unsupported categorical values remain explicitly missing and emit typed issues."]
        : ["fuelCost08 USD/year is divided by 12 for canonical USD/month; the result is not personalized."],
  };
}

function calculateSourceConfidence(
  record: EpaVehicleRecord,
  issues: readonly CanonicalContributionIssue[],
  retrievedAt: string,
) {
  const coverageGroups = [
    Object.hasOwn(record, "VClass") || Object.hasOwn(record, "drive") || Object.hasOwn(record, "trany"),
    Object.hasOwn(record, "fuelType") || Object.hasOwn(record, "fuelType1") || Object.hasOwn(record, "fuelType2"),
    Object.hasOwn(record, "comb08") || Object.hasOwn(record, "combE"),
    Object.hasOwn(record, "co2") || Object.hasOwn(record, "co2TailpipeGpm"),
    Object.hasOwn(record, "fuelCost08"),
  ].filter(Boolean).length;
  const coverageBonus = coverageGroups * 0.014;
  const materialIssues = issues.filter((issue) =>
    issue.kind === "ambiguous_mapping"
    || issue.kind === "invalid_canonical_value"
    || issue.code.includes("unsupported_fuel")
    || issue.code.includes("unsupported_drivetrain")
    || issue.code.includes("unsupported_transmission"),
  ).length;
  const reducedSpecificity = issues.filter((issue) => issue.kind === "reduced_specificity").length;
  const sourceDate = record.modifiedOn || record.createdOn;
  let freshnessPenalty = sourceDate ? 0 : 0.03;
  if (sourceDate) {
    const ageYears = Math.max(0, (Date.parse(retrievedAt) - Date.parse(sourceDate)) / 31_557_600_000);
    if (Number.isFinite(ageYears)) freshnessPenalty = ageYears > 15 ? 0.05 : ageYears > 8 ? 0.03 : ageYears > 3 ? 0.01 : 0;
  }
  return clamp(roundConfidence(0.86 + coverageBonus - Math.min(0.24, materialIssues * 0.04) - Math.min(0.06, reducedSpecificity * 0.015) - freshnessPenalty), 0, 1);
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
    code: `epa_missing_${toSnakeCase(sourceField)}`,
    kind: "explicit_source_missing",
    fieldPath,
    message: `EPA exposed ${sourceField} but supplied no usable value.`,
    evidenceIds: [evidenceId],
    sourceField,
  });
}

function invalidIdentityIssue(message: string, sourceField: string | null = null) {
  return createIssue({
    code: "epa_invalid_source_identity",
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

function mapped<Value>(
  value: Value,
  confidenceScore: number,
  issue?: MappingSuccess<Value>["issue"],
): MappingSuccess<Value> {
  return { ok: true, value, confidenceScore, ...(issue ? { issue } : {}) };
}

function mappingFailure(
  issueKind: CanonicalContributionIssueKind,
  issueCode: string,
  issueMessage: string,
  missingReason: CanonicalMissingReason,
): MappingFailure {
  return { ok: false, issueKind, issueCode, issueMessage, missingReason };
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

function normalizeSourceRecordId(record: EpaVehicleRecord) {
  return typeof record?.id === "string" && record.id.trim() ? record.id.trim() : "unknown";
}

function getVehicleUrl(sourceId: string) {
  return `https://www.fueleconomy.gov/ws/rest/vehicle/${encodeURIComponent(sourceId)}`;
}

function toSnakeCase(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
