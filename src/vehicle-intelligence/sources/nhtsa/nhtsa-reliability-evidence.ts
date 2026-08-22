import type {
  CanonicalEvidence,
  CanonicalEvidenceDataUse,
  CanonicalEvidenceSourceClaim,
} from "../../../../types/canonicalVehicle";
import type {
  DefectAcquisitionState,
  DefectComponentCategory,
  DeferredDefectSource,
  NhtsaComplaintLookupResult,
  NhtsaComplaintRecord,
  NhtsaRecallLookupResult,
  NhtsaRecallRecord,
  VehicleDefectEvidenceEvent,
  VehicleDefectIdentity,
  VehicleReliabilityEvidenceSnapshot,
} from "../../../../types/nhtsaReliabilityEvidence";
import { getComplaintsByVehicle } from "./nhtsa-complaint-client";
import { NhtsaDefectClientError } from "./nhtsa-defect-http";
import { getRecallsByVehicle } from "./nhtsa-recall-client";

export const nhtsaReliabilityEvidenceSchemaVersion = "1.0.0" as const;
export const nhtsaReliabilityEvidenceNormalizationVersion = "nhtsa-defect-events-1.0.0" as const;

type SnapshotInput = Readonly<{
  vehicle: VehicleDefectIdentity;
  recalls: NhtsaRecallLookupResult | Readonly<{ state: "SOURCE_FAILURE"; records: readonly []; sourceUrl: string; error: string }>;
  complaints: NhtsaComplaintLookupResult | Readonly<{ state: "SOURCE_FAILURE"; records: readonly []; sourceUrl: string; error: string }>;
  generatedAt: string;
  dataUse?: CanonicalEvidenceDataUse;
}>;

export type NhtsaReliabilityEvidenceResult = Readonly<{
  snapshot: VehicleReliabilityEvidenceSnapshot;
  sourceErrors: readonly Readonly<{ source: "recalls" | "complaints"; error: string }>[];
}>;

export async function getNhtsaReliabilityEvidence(
  vehicle: VehicleDefectIdentity,
  options: { generatedAt?: string; dataUse?: CanonicalEvidenceDataUse } = {},
): Promise<NhtsaReliabilityEvidenceResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const [recallResult, complaintResult] = await Promise.allSettled([
    getRecallsByVehicle(vehicle.modelYear, vehicle.make, vehicle.model),
    getComplaintsByVehicle(vehicle.modelYear, vehicle.make, vehicle.model),
  ]);
  const sourceErrors: Array<{ source: "recalls" | "complaints"; error: string }> = [];
  const recalls = recallResult.status === "fulfilled"
    ? recallResult.value
    : sourceFailure("recalls", vehicle, recallResult.reason, sourceErrors);
  const complaints = complaintResult.status === "fulfilled"
    ? complaintResult.value
    : sourceFailure("complaints", vehicle, complaintResult.reason, sourceErrors);
  return {
    snapshot: buildVehicleReliabilityEvidenceSnapshot({
      vehicle,
      recalls,
      complaints,
      generatedAt,
      dataUse: options.dataUse ?? "production",
    }),
    sourceErrors,
  };
}

export function buildVehicleReliabilityEvidenceSnapshot(input: SnapshotInput): VehicleReliabilityEvidenceSnapshot {
  requireDate(input.generatedAt);
  const dataUse = input.dataUse ?? "production";
  const recalls = input.recalls.state === "SOURCE_FAILURE"
    ? []
    : deduplicate(input.recalls.records.map((record) => normalizeRecall(record, input.vehicle, input.generatedAt, dataUse)));
  const complaints = input.complaints.state === "SOURCE_FAILURE"
    ? []
    : deduplicate(input.complaints.records.map((record) => normalizeComplaint(record, input.vehicle, input.generatedAt, dataUse)));
  const events = [...recalls, ...complaints];
  const evidence = events.map((event) => event.evidence).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const componentSummary = summarizeComponents(events);
  const dateRange = summarizeDates(events, input.vehicle.modelYear, input.generatedAt);
  const recallCoverage = acquisitionState(input.recalls.state);
  const complaintCoverage = acquisitionState(input.complaints.state);
  const limitations = [
    "Recall and complaint counts are exposure-unadjusted and must not be compared as reliability rankings.",
    "Complaint frequency varies with sales volume, vehicle age, mileage, and owner reporting behavior.",
    "A complaint is an allegation received by NHTSA, not a verified mechanical diagnosis.",
    "Year/make/model lookups provide model-year evidence and do not establish trim or configuration applicability.",
    "Implausible source dates before the model year minus one are retained in raw evidence but excluded from the summary date range.",
    investigationsDeferred.limitation,
    communicationsDeferred.limitation,
    ...(input.recalls.state === "SOURCE_FAILURE" ? [`Recall acquisition failed: ${input.recalls.error}`] : []),
    ...(input.complaints.state === "SOURCE_FAILURE" ? [`Complaint acquisition failed: ${input.complaints.error}`] : []),
  ];

  return deepFreeze({
    schemaVersion: nhtsaReliabilityEvidenceSchemaVersion,
    snapshotId: `nhtsa-reliability:${stableHash(input.vehicle.vehicleId)}:${stableHash(input.generatedAt)}`,
    vehicle: { ...input.vehicle },
    generatedAt: input.generatedAt,
    dataUse,
    recalls,
    complaints,
    investigations: investigationsDeferred,
    manufacturerCommunications: communicationsDeferred,
    componentSummary,
    severitySummary: summarizeSeverity(recalls, complaints),
    dateRange,
    evidenceCoverage: {
      recalls: recallCoverage,
      complaints: complaintCoverage,
      investigations: "UNSUPPORTED",
      manufacturerCommunications: "UNSUPPORTED",
      reliabilityEvidenceAvailable: events.length > 0,
      reliabilityScoreSupported: false,
    },
    sourceScopeSummary: {
      modelYearRecords: events.length,
      modelRecords: 0,
      configurationRecords: 0,
      vinRecords: 0,
      unknownScopeRecords: 0,
    },
    evidence,
    limitations,
    reliabilityScore: null,
    productionRecommendationConnected: false,
  });
}

export function normalizeNhtsaDefectComponent(component: string | null): readonly DefectComponentCategory[] {
  if (!component?.trim()) return ["unknown_other"];
  const value = component.toUpperCase();
  const categories = new Set<DefectComponentCategory>();
  if (/TRACTION BATTERY|HYBRID PROPULSION|ELECTRIC PROPULSION|BATTERY\/CABLES/.test(value)) categories.add("battery_ev_system");
  if (/AUTOMATIC TRANSMISSION|MANUAL TRANSMISSION|TRANSMISSION/.test(value)) categories.add("transmission");
  if (/POWER TRAIN/.test(value)) categories.add("powertrain");
  if (/ENGINE/.test(value)) categories.add("engine");
  if (/ELECTRICAL SYSTEM/.test(value)) categories.add("electrical");
  if (/SERVICE BRAKES|PARKING BRAKE/.test(value)) categories.add("brakes");
  if (/STEERING/.test(value)) categories.add("steering");
  if (/SUSPENSION/.test(value)) categories.add("suspension");
  if (/AIR BAGS?/.test(value)) categories.add("airbags");
  if (/FUEL SYSTEM|FUEL\/PROPULSION/.test(value)) categories.add("fuel_system");
  if (/AIR CONDITIONER|CLIMATE CONTROL|HEATER/.test(value)) categories.add("climate");
  if (/STRUCTURE/.test(value)) categories.add("structure");
  return categories.size ? [...categories].sort() : ["unknown_other"];
}

const investigationsDeferred: DeferredDefectSource = deepFreeze({
  evidenceType: "INVESTIGATION",
  state: "UNSUPPORTED",
  records: [],
  limitation: "NHTSA publishes investigation bulk files and search interfaces, but no stable documented year/make/model JSON API is available to this client; acquisition is deferred without scraping.",
  officialSourceUrl: "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
});

const communicationsDeferred: DeferredDefectSource = deepFreeze({
  evidenceType: "MANUFACTURER_COMMUNICATION",
  state: "UNSUPPORTED",
  records: [],
  limitation: "NHTSA publishes manufacturer-communication and TSB bulk files, but no stable documented year/make/model JSON API is available to this client; acquisition is deferred without brittle scraping.",
  officialSourceUrl: "https://www.nhtsa.gov/nhtsa-datasets-and-apis",
});

function normalizeRecall(
  record: NhtsaRecallRecord,
  vehicle: VehicleDefectIdentity,
  retrievedAt: string,
  dataUse: CanonicalEvidenceDataUse,
): VehicleDefectEvidenceEvent {
  const evidenceId = `nhtsa:defect:recall:${record.campaignNumber}`;
  return {
    evidenceId,
    evidenceType: "RECALL",
    sourceRecordId: record.campaignNumber,
    sourceScope: "model_year",
    assertionStatus: "OFFICIAL_CAMPAIGN",
    allegationVerified: true,
    originalComponent: record.component,
    normalizedComponents: normalizeNhtsaDefectComponent(record.component),
    severity: {
      crashReported: false,
      fireReported: false,
      injuries: 0,
      deaths: 0,
      recallConsequence: record.consequence,
      parkIt: record.parkIt === true,
      parkOutside: record.parkOutside === true,
      investigationOpened: false,
    },
    sourceDate: record.reportReceivedDate,
    evidence: canonicalEvidence({
      evidenceId,
      providerName: "NHTSA Recalls",
      sourceRecordId: record.campaignNumber,
      sourceUrl: record.sourceUrl,
      retrievedAt,
      dataUse,
      sourceClaims: claims(record.rawFields),
      methodology: `Official NHTSA recall campaign returned for ${vehicle.modelYear} ${vehicle.make} ${vehicle.model}; applicability remains model-year scoped.`,
      notes: ["The campaign existence and NHTSA fields are official records; no aggregate reliability conclusion is derived."],
    }),
  };
}

function normalizeComplaint(
  record: NhtsaComplaintRecord,
  vehicle: VehicleDefectIdentity,
  retrievedAt: string,
  dataUse: CanonicalEvidenceDataUse,
): VehicleDefectEvidenceEvent {
  const evidenceId = `nhtsa:defect:complaint:${record.odiNumber}`;
  return {
    evidenceId,
    evidenceType: "COMPLAINT",
    sourceRecordId: record.odiNumber,
    sourceScope: "model_year",
    assertionStatus: "REPORTED_ALLEGATION",
    allegationVerified: false,
    originalComponent: record.component,
    normalizedComponents: normalizeNhtsaDefectComponent(record.component),
    severity: {
      crashReported: record.crashReported,
      fireReported: record.fireReported,
      injuries: record.injuries,
      deaths: record.deaths,
      recallConsequence: null,
      parkIt: false,
      parkOutside: false,
      investigationOpened: false,
    },
    sourceDate: record.incidentDate ?? record.complaintFiledDate,
    evidence: canonicalEvidence({
      evidenceId,
      providerName: "NHTSA Consumer Complaints",
      sourceRecordId: record.odiNumber,
      sourceUrl: record.sourceUrl,
      retrievedAt,
      dataUse,
      sourceClaims: claims(record.rawFields),
      methodology: `Consumer complaint received by NHTSA for ${vehicle.modelYear} ${vehicle.make} ${vehicle.model}; applicability remains model-year scoped.`,
      notes: ["NHTSA authority verifies that the report exists; the underlying allegation is not marked as proven mechanical fact."],
    }),
  };
}

function canonicalEvidence(input: {
  evidenceId: string;
  providerName: string;
  sourceRecordId: string;
  sourceUrl: string;
  retrievedAt: string;
  dataUse: CanonicalEvidenceDataUse;
  sourceClaims: CanonicalEvidenceSourceClaim[];
  methodology: string;
  notes: string[];
}): CanonicalEvidence {
  return {
    evidenceId: input.evidenceId,
    sourceType: "nhtsa",
    providerName: input.providerName,
    sourceRecordId: input.sourceRecordId,
    sourceUrl: input.sourceUrl,
    scope: "model_year",
    observedAt: null,
    retrievedAt: input.retrievedAt,
    market: "US",
    methodology: input.methodology,
    license: "United States government public data; verify applicable NHTSA terms.",
    dataUse: input.dataUse,
    sourceClaims: input.sourceClaims,
    normalizationMethod: "mapped",
    normalizationNotes: input.notes,
  };
}

function claims(raw: Record<string, import("../../../../types/canonicalVehicle").CanonicalEvidenceSourceValue>) {
  return Object.entries(raw).sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceField, originalSourceValue]) => ({ sourceField, originalSourceValue }));
}

function summarizeComponents(events: readonly VehicleDefectEvidenceEvent[]) {
  const summary = new Map<DefectComponentCategory, Set<string>>();
  for (const event of events) {
    for (const component of event.normalizedComponents) {
      const ids = summary.get(component) ?? new Set<string>();
      ids.add(event.evidenceId);
      summary.set(component, ids);
    }
  }
  return [...summary.entries()].map(([component, ids]) => ({
    component,
    recordCount: ids.size,
    evidenceIds: [...ids].sort(),
  })).sort((left, right) => right.recordCount - left.recordCount || left.component.localeCompare(right.component));
}

function summarizeSeverity(
  recalls: readonly VehicleDefectEvidenceEvent[],
  complaints: readonly VehicleDefectEvidenceEvent[],
) {
  const seriousIds = new Set<string>();
  for (const event of complaints) {
    if (event.severity.crashReported || event.severity.fireReported || event.severity.injuries > 0 || event.severity.deaths > 0) seriousIds.add(event.evidenceId);
  }
  for (const event of recalls) {
    if (event.severity.parkIt || event.severity.parkOutside) seriousIds.add(event.evidenceId);
  }
  return {
    complaintCrashRecords: complaints.filter((item) => item.severity.crashReported).length,
    complaintFireRecords: complaints.filter((item) => item.severity.fireReported).length,
    complaintInjuryRecords: complaints.filter((item) => item.severity.injuries > 0).length,
    complaintDeathRecords: complaints.filter((item) => item.severity.deaths > 0).length,
    totalReportedInjuries: complaints.reduce((total, item) => total + item.severity.injuries, 0),
    totalReportedDeaths: complaints.reduce((total, item) => total + item.severity.deaths, 0),
    parkItRecalls: recalls.filter((item) => item.severity.parkIt).length,
    parkOutsideRecalls: recalls.filter((item) => item.severity.parkOutside).length,
    seriousSignalRecordCount: seriousIds.size,
  };
}

function summarizeDates(events: readonly VehicleDefectEvidenceEvent[], modelYear: number, generatedAt: string) {
  const earliestAllowed = Date.UTC(modelYear - 1, 0, 1);
  const latestAllowed = Date.parse(generatedAt);
  const values = events.map((event) => event.sourceDate).filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: parseSourceDate(value) }))
    .filter((item) => item.timestamp !== null && item.timestamp >= earliestAllowed && item.timestamp <= latestAllowed)
    .sort((left, right) => left.timestamp! - right.timestamp!);
  return { earliest: values[0]?.value ?? null, latest: values.at(-1)?.value ?? null };
}

function parseSourceDate(value: string) {
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const normalized = us ? `${us[3]}-${us[1]}-${us[2]}T00:00:00.000Z` : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function acquisitionState(state: string): DefectAcquisitionState {
  if (state === "SOURCE_FAILURE") return "SOURCE_FAILURE";
  if (state.startsWith("NO_")) return "NO_RECORDS_FOUND";
  return "AVAILABLE";
}

function sourceFailure(
  source: "recalls" | "complaints",
  vehicle: VehicleDefectIdentity,
  error: unknown,
  errors: Array<{ source: "recalls" | "complaints"; error: string }>,
) {
  const message = error instanceof Error ? error.message : "Unknown NHTSA source failure.";
  errors.push({ source, error: message });
  const issueType = source === "recalls" ? "recalls" : "complaints";
  const operation = source === "recalls" ? "recallsByVehicle" : "complaintsByVehicle";
  const url = new URL(`https://api.nhtsa.gov/${issueType}/${operation}`);
  url.searchParams.set("make", vehicle.make);
  url.searchParams.set("model", vehicle.model);
  url.searchParams.set("modelYear", String(vehicle.modelYear));
  return { state: "SOURCE_FAILURE" as const, records: [] as const, sourceUrl: url.toString(), error: message };
}

function deduplicate(events: readonly VehicleDefectEvidenceEvent[]) {
  return [...new Map(events.map((event) => [event.evidenceId, event])).values()]
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

function requireDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new NhtsaDefectClientError("INVALID_REQUEST", "generatedAt must be a valid timestamp.");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
