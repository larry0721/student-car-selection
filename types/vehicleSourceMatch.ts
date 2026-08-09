import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";

export const sourceMatchStatuses = ["exact", "probable", "ambiguous", "not_found"] as const;
export type SourceMatchStatus = (typeof sourceMatchStatuses)[number];
export type VehicleSourceMatchName = "nhtsa" | "epa";

export type SourceMatchDimension =
  | "vin"
  | "externalId"
  | "modelYear"
  | "make"
  | "model"
  | "trim"
  | "fuelType"
  | "drivetrain"
  | "transmission"
  | "bodyStyle"
  | "vehicleCategory"
  | "engineDisplacement"
  | "cylinders";

export type CatalogVehicleMatchInput = {
  id: string;
  year: number;
  make: string;
  model: string;
  bodyType: string;
  fuelType: string;
  drivetrain: string;
  transmission: string;
  trim?: string | null;
  vehicleCategory?: string | null;
  engineDisplacementLiters?: number | null;
  cylinders?: number | null;
  vin?: string | null;
  externalIds?: Array<{ namespace: string; value: string }>;
};

export type NhtsaCatalogMatchCandidate = {
  sourceRecordId: string;
  vin?: string | null;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  bodyClass?: string | null;
  vehicleType?: string | null;
  driveType?: string | null;
  fuelTypePrimary?: string | null;
  transmissionStyle?: string | null;
  trim?: string | null;
  engineDisplacementLiters?: number | null;
  cylinders?: number | null;
  externalIds?: Array<{ namespace: string; value: string }>;
};

export type SourceMatchCandidateAssessment<Candidate> = {
  sourceRecordId: string;
  candidate: Candidate;
  eligible: boolean;
  confidence: number;
  matchedOn: SourceMatchDimension[];
  conflicts: string[];
  missingComparisonFields: SourceMatchDimension[];
  rationale: string[];
};

export type SourceMatchResult<Candidate> = {
  status: SourceMatchStatus;
  source: VehicleSourceMatchName;
  selectedCandidate: SourceMatchCandidateAssessment<Candidate> | null;
  candidates: SourceMatchCandidateAssessment<Candidate>[];
  confidence: number;
  matchedOn: SourceMatchDimension[];
  conflicts: string[];
  missingComparisonFields: SourceMatchDimension[];
  rationale: string[];
};

export type CatalogVehicleSourceMatches = {
  catalogVehicleId: string;
  nhtsa: SourceMatchResult<NhtsaCatalogMatchCandidate>;
  epa: SourceMatchResult<EpaVehicleRecord>;
};

export type EpaCatalogSourceClient = {
  getMakesForYear(year: number): Promise<Array<{ text: string; value: string }>>;
  getModelsForYearMake(year: number, make: string): Promise<Array<{ text: string; value: string }>>;
  getVehicleOptions(year: number, make: string, model: string): Promise<Array<{
    id: string;
    label: string;
    year: number;
    make: string;
    model: string;
  }>>;
  getVehicleById(vehicleId: string | number): Promise<EpaVehicleRecord>;
};
