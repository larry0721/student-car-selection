import { validateVehicleRecord } from "../../lib/data/vehicleValidation";
import type {
  CatalogDataIssue,
  CatalogEnrichmentBatchResult,
  CatalogEnrichmentContributionDisposition,
  CatalogEnrichmentEvidenceSummary,
  CatalogEnrichmentIssue,
  CatalogEnrichmentResult,
  CatalogEnrichmentSourceMatches,
  CatalogEnrichmentStatus,
  CatalogEnrichmentTraceStep,
  GoldenSetSelection,
} from "../../types/catalogEnrichment";
import {
  canonicalVehicleFieldPaths,
  type CanonicalIngestionContext,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
} from "../../types/canonicalVehicle";
import type {
  CanonicalContributionDataUse,
  CanonicalContributionIssue,
  CanonicalVehicleContribution,
} from "../../types/canonicalVehicleContribution";
import type { Vehicle } from "../../types/vehicle";
import type { EpaVehicleRecord } from "./sources/epa/epa-client";
import { epaContributionAdapter } from "./sources/epa/epa-contribution-adapter";
import { getModelsForMakeYear } from "./sources/nhtsa/nhtsa-client";
import { nhtsaContributionAdapter } from "./sources/nhtsa/nhtsa-contribution-adapter";
import { mergeCanonicalVehicleContributions } from "./canonical-vehicle-merger";
import { decideEnrichment } from "./enrichment-decision-policy";
import {
  discoverAndMatchEpaCandidates,
  matchNhtsaCandidates,
} from "./vehicle-source-matching";
import type {
  CatalogVehicleMatchInput,
  NhtsaCatalogMatchCandidate,
  SourceMatchResult,
  VehicleSourceMatchName,
} from "../../types/vehicleSourceMatch";

export type ControlledEnrichmentSourceProvider = {
  matchNhtsa(vehicle: CatalogVehicleMatchInput): Promise<SourceMatchResult<NhtsaCatalogMatchCandidate>>;
  matchEpa(vehicle: CatalogVehicleMatchInput): Promise<SourceMatchResult<EpaVehicleRecord>>;
};

export type ControlledCatalogEnrichmentOptions = {
  retrievedAt?: string;
  market?: string | null;
  catalogUniverse?: readonly Vehicle[];
  sourceProvider?: ControlledEnrichmentSourceProvider;
  sourceDataUse?: CanonicalContributionDataUse;
};

export const controlledEnrichmentSourceProvider: ControlledEnrichmentSourceProvider = {
  async matchNhtsa(vehicle) {
    const models = await getModelsForMakeYear(vehicle.make, vehicle.year);
    return matchNhtsaCandidates(vehicle, models.map((model) => ({
      sourceRecordId: `nhtsa:model:${model.makeId ?? "unknown"}:${model.modelId ?? "unknown"}:${model.modelYear}`,
      vin: null,
      make: model.makeName,
      model: model.modelName,
      modelYear: model.modelYear,
      bodyClass: null,
      vehicleType: model.vehicleTypeName,
      driveType: null,
      fuelTypePrimary: null,
      transmissionStyle: null,
    })));
  },
  matchEpa(vehicle) {
    return discoverAndMatchEpaCandidates(vehicle);
  },
};

const goldenSetCriteria = [
  criterion("gasoline_sedan", "Common gasoline sedan with a configuration likely to expose multiple EPA engine options.", 2015,
    (vehicle) => matches(vehicle, "Toyota", "Camry", "sedan", "gas", "FWD", "automatic")),
  criterion("hybrid", "Common hybrid hatchback with authoritative EPA powertrain and efficiency coverage.", 2016,
    (vehicle) => matches(vehicle, "Toyota", "Prius", "hatchback", "hybrid", "FWD", "automatic")),
  criterion("battery_electric", "Common battery-electric hatchback with EPA range and efficiency coverage.", 2018,
    (vehicle) => matches(vehicle, "Nissan", "Leaf", "hatchback", "electric", "FWD", "automatic")),
  criterion("awd_crossover", "Common AWD crossover used to verify configuration discrimination.", 2016,
    (vehicle) => matches(vehicle, "Honda", "CR-V", "suv", "gas", "AWD", "automatic")),
  criterion("pickup_truck", "Common 4WD pickup likely to expose multiple engine configurations.", 2019,
    (vehicle) => matches(vehicle, "Ford", "F-150", "truck", "gas", "4WD", "automatic")),
  criterion("compact_economy", "Common subcompact economy car with simple gasoline configuration.", 2017,
    (vehicle) => matches(vehicle, "Toyota", "Yaris", undefined, "gas", "FWD", "automatic")),
  criterion("compact_sedan", "Common compact sedan distinct from the larger gasoline-sedan case.", 2015,
    (vehicle) => matches(vehicle, "Toyota", "Corolla", "sedan", "gas", "FWD", "automatic")),
  criterion("family_suv", "Common family SUV with front-wheel-drive configuration.", 2016,
    (vehicle) => matches(vehicle, "Toyota", "RAV4", "suv", "gas", "FWD", "automatic")),
  criterion("hybrid_crossover", "Hybrid crossover broadens body-style and powertrain coverage.", 2017,
    (vehicle) => matches(vehicle, "Kia", "Niro", "suv", "hybrid", "FWD", "automatic")),
  criterion("powertrain_anomaly", "Catalog labels this plug-in model as electric, intentionally testing contradiction handling.", 2017,
    (vehicle) => vehicle.make === "Chevrolet" && vehicle.model === "Volt" && vehicle.fuelType === "electric"),
  criterion("drivetrain_anomaly", "Front-wheel-drive pickup claim intentionally tests catalog validation and source rejection.", 2017,
    (vehicle) => vehicle.make === "Toyota" && vehicle.model === "Tacoma" && vehicle.drivetrain === "FWD"),
  criterion("identity_anomaly", "Truncated model identity intentionally tests not-found behavior without silent repair.", 2017,
    (vehicle) => vehicle.make === "Toyota" && vehicle.model === "Yari"),
] as const;

export function selectControlledEnrichmentGoldenSet(
  catalog: readonly Vehicle[],
): GoldenSetSelection[] {
  const usedIds = new Set<string>();
  return goldenSetCriteria.flatMap((selectionCriterion) => {
    const candidates = catalog
      .filter((vehicle) => !usedIds.has(vehicle.id) && selectionCriterion.predicate(vehicle))
      .sort((left, right) => {
        const yearDistance = Math.abs(left.year - selectionCriterion.targetYear)
          - Math.abs(right.year - selectionCriterion.targetYear);
        return yearDistance || left.id.localeCompare(right.id);
      });
    const vehicle = candidates[0];
    if (!vehicle) return [];
    usedIds.add(vehicle.id);
    return [{
      criterion: selectionCriterion.key,
      rationale: selectionCriterion.rationale,
      vehicle: clone(vehicle),
    }];
  });
}

export async function runControlledCatalogEnrichment(
  catalogVehicle: Vehicle,
  options: ControlledCatalogEnrichmentOptions = {},
): Promise<CatalogEnrichmentResult> {
  const inputSnapshot = clone(catalogVehicle);
  const catalogSnapshot = clone(catalogVehicle);
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const sourceProvider = options.sourceProvider ?? controlledEnrichmentSourceProvider;
  const dataUse = options.sourceDataUse ?? "production";
  const issues: CatalogEnrichmentIssue[] = [];
  const sourceMatches: CatalogEnrichmentSourceMatches = { nhtsa: null, epa: null };
  const failedSources: VehicleSourceMatchName[] = [];
  const trace: CatalogEnrichmentTraceStep[] = [];
  addTrace(trace, "catalog_snapshot", null, "captured");

  try {
    sourceMatches.nhtsa = await sourceProvider.matchNhtsa(toMatchInput(catalogSnapshot));
    addTrace(trace, "source_match", "nhtsa", sourceMatches.nhtsa.status);
  } catch (error) {
    failedSources.push("nhtsa");
    issues.push(sourceFailure("nhtsa", error));
    addTrace(trace, "source_match", "nhtsa", "failed");
  }

  try {
    sourceMatches.epa = await sourceProvider.matchEpa(toMatchInput(catalogSnapshot));
    addTrace(trace, "source_match", "epa", sourceMatches.epa.status);
  } catch (error) {
    failedSources.push("epa");
    issues.push(sourceFailure("epa", error));
    addTrace(trace, "source_match", "epa", "failed");
  }

  const enrichmentDecisions = {
    nhtsa: sourceMatches.nhtsa ? decideEnrichment(sourceMatches.nhtsa) : null,
    epa: sourceMatches.epa ? decideEnrichment(sourceMatches.epa) : null,
  };
  if (enrichmentDecisions.nhtsa) addTrace(trace, "enrichment_policy", "nhtsa", enrichmentDecisions.nhtsa.action);
  if (enrichmentDecisions.epa) addTrace(trace, "enrichment_policy", "epa", enrichmentDecisions.epa.action);

  const adaptedContributions: CanonicalVehicleContribution[] = [];
  const dispositions: CatalogEnrichmentContributionDisposition[] = [];

  await processNhtsaContribution({
    match: sourceMatches.nhtsa,
    decision: enrichmentDecisions.nhtsa,
    dataUse,
    context: ingestionContext(catalogVehicle.id, "nhtsa", retrievedAt, options.market),
    contributions: adaptedContributions,
    dispositions,
    issues,
    trace,
  });
  await processEpaContribution({
    match: sourceMatches.epa,
    decision: enrichmentDecisions.epa,
    dataUse,
    context: ingestionContext(catalogVehicle.id, "epa", retrievedAt, options.market),
    contributions: adaptedContributions,
    dispositions,
    issues,
    trace,
  });

  const mergeResult = adaptedContributions.length
    ? mergeCanonicalVehicleContributions(adaptedContributions, { targetDataUse: "production" })
    : { records: [], rejectedSourceRecordIds: [], issues: [] };
  addTrace(trace, "canonical_merger", null, adaptedContributions.length ? `${mergeResult.records.length}_records` : "not_run");
  issues.push(...mergeResult.issues.map((issue) => ({
    code: issue.code,
    stage: "merge" as const,
    source: null,
    severity: issue.severity,
    message: issue.message,
  })));

  const rejectedIds = new Set(mergeResult.rejectedSourceRecordIds);
  const acceptedContributions = adaptedContributions.filter((contribution) => !rejectedIds.has(contribution.source.sourceRecordId));
  for (const disposition of dispositions) {
    if (disposition.sourceRecordId && rejectedIds.has(disposition.sourceRecordId)) {
      disposition.disposition = "rejected";
      disposition.reason = "The canonical merger rejected this contribution.";
    }
  }
  if (adaptedContributions.length && !mergeResult.records.length) {
    issues.push({
      code: "controlled_enrichment_merge_rejected",
      stage: "merge",
      source: null,
      severity: "error",
      message: "Approved source contributions did not produce a staged canonical record.",
    });
  }

  const canonicalRecord = mergeResult.records[0] ?? null;
  const evidenceSummary = summarizeEvidence(canonicalRecord);
  const acceptedSources = uniqueSources(acceptedContributions.map((item) => item.source.sourceType));
  const integrity = {
    allCanonicalFieldsPresent: canonicalRecord ? evidenceSummary.canonicalFieldCount === canonicalVehicleFieldPaths.length : true,
    everyPopulatedFieldHasEvidence: evidenceSummary.populatedFieldsWithoutEvidence.length === 0,
    fixtureEvidenceRejected: evidenceSummary.fixtureEvidenceIds.length === 0,
    onlyAutoEnrichSourcesMerged: acceptedSources.every((source) => enrichmentDecisions[source]?.action === "AUTO_ENRICH"),
    catalogSnapshotUnchanged: JSON.stringify(catalogVehicle) === JSON.stringify(inputSnapshot),
    sourceMetadataPreserved: canonicalRecord
      ? canonicalRecord.evidence.every((evidence) => Boolean(evidence.sourceRecordId && evidence.retrievedAt))
      : true,
  };
  addIntegrityIssues(integrity, issues);
  addTrace(trace, "integrity_check", null, Object.values(integrity).every(Boolean) ? "passed" : "failed");

  const reviewRequiredSources = decisionSources(enrichmentDecisions, "REVIEW_REQUIRED");
  const deferredSources = decisionSources(enrichmentDecisions, "DEFER");
  const skippedSources = decisionSources(enrichmentDecisions, "SKIP");
  const enrichmentSummary = {
    acceptedSources,
    reviewRequiredSources,
    deferredSources,
    skippedSources,
    failedSources: [...failedSources].sort(),
    partial: Boolean(canonicalRecord) && (reviewRequiredSources.length + deferredSources.length + skippedSources.length + failedSources.length > 0),
    productionCatalogMutated: false as const,
    stagingBoundary: "runtime_only" as const,
  };

  return {
    catalogVehicleId: catalogVehicle.id,
    catalogSnapshot,
    sourceMatches,
    enrichmentDecisions,
    contributions: { accepted: acceptedContributions, dispositions },
    canonicalRecord,
    status: resolveStatus({
      hasRecord: Boolean(canonicalRecord),
      failedSources,
      reviewRequiredSources,
      deferredSources,
      issues,
    }),
    issues,
    mergerIssues: mergeResult.issues,
    catalogDataIssues: analyzeCatalogDataIssues(catalogSnapshot, options.catalogUniverse ?? [catalogSnapshot]),
    evidenceSummary,
    enrichmentSummary,
    integrity,
    orchestrationTrace: trace,
  };
}

export async function runControlledCatalogEnrichmentBatch(
  selectedVehicles: readonly Vehicle[],
  options: ControlledCatalogEnrichmentOptions = {},
): Promise<CatalogEnrichmentBatchResult> {
  const sortedVehicles = [...selectedVehicles].sort((left, right) => left.id.localeCompare(right.id));
  const results = [];
  for (const vehicle of sortedVehicles) {
    results.push(await runControlledCatalogEnrichment(vehicle, options));
  }
  return {
    selectedCatalogVehicleIds: sortedVehicles.map((vehicle) => vehicle.id),
    results,
    stagingBoundary: "runtime_only",
    productionCatalogMutated: false,
  };
}

export function analyzeCatalogDataIssues(
  vehicle: Vehicle,
  catalogUniverse: readonly Vehicle[],
): CatalogDataIssue[] {
  const validationIssues = validateVehicleRecord(vehicle).map((issue, index): CatalogDataIssue => ({
    issueId: `${vehicle.id}:validation:${issue.field}:${index}`,
    catalogVehicleId: vehicle.id,
    kind: "validation",
    field: issue.field,
    severity: ["year", "make", "model", "bodyType", "drivetrain", "fuelType", "transmission"].includes(issue.field)
      ? "error"
      : "warning",
    message: issue.message,
    relatedCatalogVehicleIds: [],
  }));
  const identityKey = `${vehicle.year}:${normalize(vehicle.make)}:${normalize(vehicle.model)}`;
  const duplicateIds = catalogUniverse
    .filter((candidate) => candidate.id !== vehicle.id
      && `${candidate.year}:${normalize(candidate.make)}:${normalize(candidate.model)}` === identityKey)
    .map((candidate) => candidate.id)
    .sort();
  const issues = [...validationIssues];
  if (duplicateIds.length) {
    issues.push({
      issueId: `${vehicle.id}:duplicate_identity`,
      catalogVehicleId: vehicle.id,
      kind: "duplicate_identity",
      field: "identity",
      severity: "warning",
      message: "The catalog contains another record with the same year, make, and model but does not include trim or configuration linkage.",
      relatedCatalogVehicleIds: duplicateIds,
    });
  }
  issues.push({
    issueId: `${vehicle.id}:missing_configuration`,
    catalogVehicleId: vehicle.id,
    kind: "missing_configuration",
    field: "trim_engine_vin",
    severity: "warning",
    message: "The catalog does not provide trim, engine, cylinders, VIN, or external source identifiers for configuration matching.",
    relatedCatalogVehicleIds: [],
  });
  return issues;
}

type ContributionProcessingInput<Candidate> = {
  match: SourceMatchResult<Candidate> | null;
  decision: ReturnType<typeof decideEnrichment<Candidate>> | null;
  dataUse: CanonicalContributionDataUse;
  context: CanonicalIngestionContext;
  contributions: CanonicalVehicleContribution[];
  dispositions: CatalogEnrichmentContributionDisposition[];
  issues: CatalogEnrichmentIssue[];
  trace: CatalogEnrichmentTraceStep[];
};

async function processNhtsaContribution(input: ContributionProcessingInput<NhtsaCatalogMatchCandidate>) {
  const source = "nhtsa" as const;
  if (!canAdapt(input, source)) return;
  const candidate = input.match?.selectedCandidate?.candidate;
  const vin = candidate?.vin?.trim().toUpperCase() ?? "";
  if (!candidate || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    rejectAdapterInput(input, source, "An AUTO_ENRICH NHTSA match requires a valid VIN before the VIN contribution adapter can run.");
    return;
  }
  const normalized = await nhtsaContributionAdapter.normalize([{
    vin,
    decoded: {
      make: candidate.make,
      model: candidate.model,
      modelYear: candidate.modelYear,
      bodyClass: candidate.bodyClass ?? null,
      driveType: candidate.driveType ?? null,
      fuelTypePrimary: candidate.fuelTypePrimary ?? null,
      transmissionStyle: candidate.transmissionStyle ?? null,
      vehicleType: candidate.vehicleType ?? null,
    },
    dataUse: input.dataUse,
    observedAt: null,
  }], input.context);
  acceptAdapterResult(input, source, normalized.contributions, normalized.issues);
}

async function processEpaContribution(input: ContributionProcessingInput<EpaVehicleRecord>) {
  const source = "epa" as const;
  if (!canAdapt(input, source)) return;
  const candidate = input.match?.selectedCandidate?.candidate;
  if (!candidate) {
    rejectAdapterInput(input, source, "An AUTO_ENRICH EPA match did not contain a selected source record.");
    return;
  }
  const normalized = await epaContributionAdapter.normalize([candidate], input.context);
  acceptAdapterResult(input, source, normalized.contributions, normalized.issues);
}

function canAdapt<Candidate>(input: ContributionProcessingInput<Candidate>, source: VehicleSourceMatchName) {
  if (!input.match || !input.decision) {
    input.dispositions.push({ source, sourceRecordId: null, decisionAction: null, disposition: "unavailable", reason: "Source matching failed." });
    return false;
  }
  const sourceRecordId = input.match.selectedCandidate?.sourceRecordId ?? null;
  if (input.decision.action !== "AUTO_ENRICH") {
    input.dispositions.push({
      source,
      sourceRecordId,
      decisionAction: input.decision.action,
      disposition: "withheld",
      reason: input.decision.reason,
    });
    return false;
  }
  return true;
}

function acceptAdapterResult<Candidate>(
  input: ContributionProcessingInput<Candidate>,
  source: VehicleSourceMatchName,
  contributions: CanonicalVehicleContribution[],
  adapterIssues: CanonicalContributionIssue[],
) {
  input.issues.push(...adapterIssues.map((issue) => ({
    code: issue.code,
    stage: "contribution" as const,
    source,
    severity: issue.severity,
    message: issue.message,
  })));
  input.contributions.push(...contributions);
  const sourceRecordId = input.match?.selectedCandidate?.sourceRecordId ?? null;
  input.dispositions.push({
    source,
    sourceRecordId,
    decisionAction: "AUTO_ENRICH",
    disposition: contributions.length ? "accepted" : "rejected",
    reason: contributions.length
      ? "The selected candidate passed policy and the existing contribution adapter."
      : "The contribution adapter rejected the selected candidate.",
  });
  addTrace(input.trace, "contribution_adapter", source, contributions.length ? "accepted" : "rejected");
}

function rejectAdapterInput<Candidate>(
  input: ContributionProcessingInput<Candidate>,
  source: VehicleSourceMatchName,
  message: string,
) {
  input.issues.push({ code: `${source}_controlled_enrichment_adapter_input`, stage: "contribution", source, severity: "error", message });
  input.dispositions.push({
    source,
    sourceRecordId: input.match?.selectedCandidate?.sourceRecordId ?? null,
    decisionAction: input.decision?.action ?? null,
    disposition: "rejected",
    reason: message,
  });
  addTrace(input.trace, "contribution_adapter", source, "rejected");
}

function summarizeEvidence(record: CanonicalVehicleRecord | null): CatalogEnrichmentEvidenceSummary {
  if (!record) {
    return {
      canonicalFieldCount: 0,
      populatedFieldCount: 0,
      missingFieldCount: 0,
      evidenceCount: 0,
      populatedFieldsWithoutEvidence: [],
      fixtureEvidenceIds: [],
      sourceTypes: [],
      sourceRecordIds: [],
    };
  }
  let populatedFieldCount = 0;
  let canonicalFieldCount = 0;
  const populatedFieldsWithoutEvidence: CanonicalVehicleFieldPath[] = [];
  const evidenceIds = new Set(record.evidence.map((evidence) => evidence.evidenceId));
  for (const path of canonicalVehicleFieldPaths) {
    const [section, field] = path.split(".") as [keyof CanonicalVehicleRecord, string];
    const sectionValue = record[section];
    const datum = sectionValue && typeof sectionValue === "object"
      ? (sectionValue as unknown as Record<string, { value: unknown; evidenceIds: string[] }>)[field]
      : undefined;
    if (!datum || !("value" in datum) || !Array.isArray(datum.evidenceIds)) continue;
    canonicalFieldCount += 1;
    if (datum.value === null) continue;
    populatedFieldCount += 1;
    if (!datum.evidenceIds.length || datum.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))) {
      populatedFieldsWithoutEvidence.push(path);
    }
  }
  return {
    canonicalFieldCount,
    populatedFieldCount,
    missingFieldCount: canonicalVehicleFieldPaths.length - populatedFieldCount,
    evidenceCount: record.evidence.length,
    populatedFieldsWithoutEvidence,
    fixtureEvidenceIds: record.evidence
      .filter((evidence) => evidence.dataUse !== "production" || evidence.sourceType === "example_fixture")
      .map((evidence) => evidence.evidenceId)
      .sort(),
    sourceTypes: [...new Set(record.evidence.map((evidence) => evidence.sourceType))].sort(),
    sourceRecordIds: [...new Set(record.evidence.flatMap((evidence) => evidence.sourceRecordId ? [evidence.sourceRecordId] : []))].sort(),
  };
}

function addIntegrityIssues(
  integrity: CatalogEnrichmentResult["integrity"],
  issues: CatalogEnrichmentIssue[],
) {
  const checks: Array<[keyof typeof integrity, string]> = [
    ["allCanonicalFieldsPresent", "The staged CVR does not expose all canonical fields."],
    ["everyPopulatedFieldHasEvidence", "At least one populated canonical field lacks evidence."],
    ["fixtureEvidenceRejected", "Fixture, test, or example evidence entered a staged production record."],
    ["onlyAutoEnrichSourcesMerged", "A non-AUTO_ENRICH source entered the staged record."],
    ["catalogSnapshotUnchanged", "The input catalog vehicle was mutated during enrichment."],
    ["sourceMetadataPreserved", "Source IDs or retrieval metadata did not survive into canonical evidence."],
  ];
  for (const [key, message] of checks) {
    if (!integrity[key]) issues.push({ code: `controlled_enrichment_integrity_${key}`, stage: "integrity", source: null, severity: "error", message });
  }
}

function resolveStatus(input: {
  hasRecord: boolean;
  failedSources: VehicleSourceMatchName[];
  reviewRequiredSources: VehicleSourceMatchName[];
  deferredSources: VehicleSourceMatchName[];
  issues: CatalogEnrichmentIssue[];
}): CatalogEnrichmentStatus {
  if (input.failedSources.length || input.issues.some((issue) => issue.severity === "error")) return "failed";
  if (input.deferredSources.length) return "deferred";
  if (input.reviewRequiredSources.length) return "review_required";
  if (input.hasRecord) return "enriched";
  return "skipped";
}

function decisionSources(
  decisions: CatalogEnrichmentResult["enrichmentDecisions"],
  action: "REVIEW_REQUIRED" | "DEFER" | "SKIP",
) {
  return (["nhtsa", "epa"] as const).filter((source) => decisions[source]?.action === action);
}

function toMatchInput(vehicle: Vehicle): CatalogVehicleMatchInput {
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    drivetrain: vehicle.drivetrain,
    transmission: vehicle.transmission,
  };
}

function ingestionContext(
  catalogVehicleId: string,
  sourceType: "nhtsa" | "epa",
  retrievedAt: string,
  market: string | null | undefined,
): CanonicalIngestionContext {
  return {
    ingestionId: `controlled-enrichment:${catalogVehicleId}:${sourceType}:${retrievedAt}`,
    retrievedAt,
    market: market ?? "US",
    sourceType,
  };
}

function sourceFailure(source: VehicleSourceMatchName, error: unknown): CatalogEnrichmentIssue {
  return {
    code: `${source}_controlled_enrichment_source_failure`,
    stage: "matching",
    source,
    severity: "error",
    message: error instanceof Error ? error.message : `${source.toUpperCase()} source matching failed.`,
  };
}

function addTrace(
  trace: CatalogEnrichmentTraceStep[],
  stage: CatalogEnrichmentTraceStep["stage"],
  source: VehicleSourceMatchName | null,
  outcome: string,
) {
  trace.push({ sequence: trace.length + 1, stage, source, outcome });
}

function uniqueSources(values: string[]): VehicleSourceMatchName[] {
  return [...new Set(values.filter((value): value is VehicleSourceMatchName => value === "nhtsa" || value === "epa"))].sort();
}

function criterion(
  key: string,
  rationale: string,
  targetYear: number,
  predicate: (vehicle: Vehicle) => boolean,
) {
  return { key, rationale, targetYear, predicate };
}

function matches(
  vehicle: Vehicle,
  make: string,
  model: string,
  bodyType?: string,
  fuelType?: string,
  drivetrain?: string,
  transmission?: string,
) {
  return vehicle.make === make
    && vehicle.model === model
    && (!bodyType || vehicle.bodyType === bodyType)
    && (!fuelType || vehicle.fuelType === fuelType)
    && (!drivetrain || vehicle.drivetrain === drivetrain)
    && (!transmission || vehicle.transmission === transmission);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
