export type VehicleExposureScope = "model_year" | "model" | "configuration" | "vin";
export type VehicleExposureAvailability = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "SOURCE_FAILURE";
export type VehicleExposureConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type VehicleExposureQuery = Readonly<{
  vehicleId: string;
  modelYear: number;
  make: string;
  model: string;
  geography: string;
  asOfDate: string;
}>;

export type VehicleExposureRecord = Readonly<{
  scope: VehicleExposureScope;
  registeredVehicleCount: number | null;
  estimatedVehiclesInOperation: number | null;
  annualMiles: Readonly<{ mean: number | null; median: number | null; unit: "miles_per_year" }>;
  lifetimeMileageDistribution: Readonly<{
    p25: number | null;
    median: number | null;
    p75: number | null;
    unit: "miles";
  }>;
  salesVolume: number | null;
  geography: string;
  observedAt: string | null;
  source: Readonly<{
    providerName: string;
    sourceRecordId: string | null;
    sourceUrl: string | null;
    retrievedAt: string;
  }>;
  confidence: Readonly<{
    level: VehicleExposureConfidenceLevel;
    basis: readonly string[];
  }>;
}>;

export type VehicleExposureResult = Readonly<{
  availability: VehicleExposureAvailability;
  query: VehicleExposureQuery;
  record: VehicleExposureRecord | null;
  limitations: readonly string[];
  error: string | null;
  dataUse: "production" | "test";
}>;

export interface VehicleExposureProvider {
  readonly providerId: string;
  readonly providerKind: "unsupported" | "fixture" | "external";
  readonly dataUse: "production" | "test";
  getExposure(query: VehicleExposureQuery): Promise<VehicleExposureResult>;
}

export type ExposureNormalizedReliabilityEvidence = Readonly<{
  availability: "AVAILABLE" | "UNAVAILABLE";
  sourceInterpretationId: string;
  exposureProviderId: string;
  rawComplaintRecords: number;
  denominatorType: "estimated_vehicles_in_operation" | "registered_vehicle_count" | null;
  denominatorValue: number | null;
  complaintRecordsPerThousandVehicles: number | null;
  geography: string | null;
  observedAt: string | null;
  comparativeReliabilitySupported: false;
  reliabilityScore: null;
  limitations: readonly string[];
}>;
