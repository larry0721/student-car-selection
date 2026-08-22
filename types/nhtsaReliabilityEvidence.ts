import type {
  CanonicalEvidence,
  CanonicalEvidenceDataUse,
  CanonicalEvidenceSourceValue,
} from "./canonicalVehicle";

export const defectEvidenceTypes = [
  "RECALL",
  "COMPLAINT",
  "INVESTIGATION",
  "MANUFACTURER_COMMUNICATION",
] as const;

export type DefectEvidenceType = (typeof defectEvidenceTypes)[number];

export const defectComponentCategories = [
  "engine",
  "transmission",
  "powertrain",
  "electrical",
  "brakes",
  "steering",
  "suspension",
  "airbags",
  "fuel_system",
  "battery_ev_system",
  "climate",
  "structure",
  "unknown_other",
] as const;

export type DefectComponentCategory = (typeof defectComponentCategories)[number];
export type DefectEvidenceScope = "model_year" | "model" | "configuration" | "vin" | "unknown";
export type DefectAcquisitionState = "AVAILABLE" | "NO_RECORDS_FOUND" | "UNSUPPORTED" | "SOURCE_FAILURE";
export type DefectAssertionStatus = "OFFICIAL_CAMPAIGN" | "REPORTED_ALLEGATION";

export type VehicleDefectIdentity = Readonly<{
  vehicleId: string;
  modelYear: number;
  make: string;
  model: string;
}>;

export type NhtsaRecallRecord = Readonly<{
  campaignNumber: string;
  manufacturer: string | null;
  component: string | null;
  summary: string | null;
  consequence: string | null;
  remedy: string | null;
  notes: string | null;
  reportReceivedDate: string | null;
  modelYear: number;
  make: string;
  model: string;
  nhtsaActionNumber: string | null;
  parkIt: boolean | null;
  parkOutside: boolean | null;
  overTheAirUpdate: boolean | null;
  sourceUrl: string;
  rawFields: Record<string, CanonicalEvidenceSourceValue>;
}>;

export type NhtsaComplaintRecord = Readonly<{
  odiNumber: string;
  manufacturer: string | null;
  incidentDate: string | null;
  complaintFiledDate: string | null;
  component: string | null;
  summary: string | null;
  crashReported: boolean;
  fireReported: boolean;
  injuries: number;
  deaths: number;
  mileage: number | null;
  vehicleSpeed: number | null;
  modelYear: number;
  make: string;
  model: string;
  sourceUrl: string;
  rawFields: Record<string, CanonicalEvidenceSourceValue>;
}>;

export type NhtsaRecallLookupResult = Readonly<{
  state: "RECALL_RECORDS_FOUND" | "NO_RECALL_RECORD_FOUND";
  records: readonly NhtsaRecallRecord[];
  sourceUrl: string;
}>;

export type NhtsaComplaintLookupResult = Readonly<{
  state: "COMPLAINT_RECORDS_FOUND" | "NO_COMPLAINT_RECORD_FOUND";
  records: readonly NhtsaComplaintRecord[];
  sourceUrl: string;
}>;

export type DefectSeverityIndicators = Readonly<{
  crashReported: boolean;
  fireReported: boolean;
  injuries: number;
  deaths: number;
  recallConsequence: string | null;
  parkIt: boolean;
  parkOutside: boolean;
  investigationOpened: boolean;
}>;

export type VehicleDefectEvidenceEvent = Readonly<{
  evidenceId: string;
  evidenceType: Extract<DefectEvidenceType, "RECALL" | "COMPLAINT">;
  sourceRecordId: string;
  sourceScope: "model_year";
  assertionStatus: DefectAssertionStatus;
  allegationVerified: boolean;
  originalComponent: string | null;
  normalizedComponents: readonly DefectComponentCategory[];
  severity: DefectSeverityIndicators;
  sourceDate: string | null;
  evidence: CanonicalEvidence;
}>;

export type DeferredDefectSource = Readonly<{
  evidenceType: Extract<DefectEvidenceType, "INVESTIGATION" | "MANUFACTURER_COMMUNICATION">;
  state: "UNSUPPORTED";
  records: readonly [];
  limitation: string;
  officialSourceUrl: string;
}>;

export type VehicleReliabilityEvidenceSnapshot = Readonly<{
  schemaVersion: "1.0.0";
  snapshotId: string;
  vehicle: VehicleDefectIdentity;
  generatedAt: string;
  dataUse: CanonicalEvidenceDataUse;
  recalls: readonly VehicleDefectEvidenceEvent[];
  complaints: readonly VehicleDefectEvidenceEvent[];
  investigations: DeferredDefectSource;
  manufacturerCommunications: DeferredDefectSource;
  componentSummary: readonly Readonly<{
    component: DefectComponentCategory;
    recordCount: number;
    evidenceIds: readonly string[];
  }>[];
  severitySummary: Readonly<{
    complaintCrashRecords: number;
    complaintFireRecords: number;
    complaintInjuryRecords: number;
    complaintDeathRecords: number;
    totalReportedInjuries: number;
    totalReportedDeaths: number;
    parkItRecalls: number;
    parkOutsideRecalls: number;
    seriousSignalRecordCount: number;
  }>;
  dateRange: Readonly<{ earliest: string | null; latest: string | null }>;
  evidenceCoverage: Readonly<{
    recalls: DefectAcquisitionState;
    complaints: DefectAcquisitionState;
    investigations: "UNSUPPORTED";
    manufacturerCommunications: "UNSUPPORTED";
    reliabilityEvidenceAvailable: boolean;
    reliabilityScoreSupported: false;
  }>;
  sourceScopeSummary: Readonly<{
    modelYearRecords: number;
    modelRecords: 0;
    configurationRecords: 0;
    vinRecords: 0;
    unknownScopeRecords: 0;
  }>;
  evidence: readonly CanonicalEvidence[];
  limitations: readonly string[];
  reliabilityScore: null;
  productionRecommendationConnected: false;
}>;
