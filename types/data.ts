import type { Vehicle } from "@/types/vehicle";

export type DataSourceName =
  | "seed"
  | "nhtsa"
  | "fueleconomy.gov"
  | "listing-api"
  | "csv-import";

export type VehicleIdentity = {
  make: string;
  model: string;
  year?: number;
};

export type VehicleDataOverlay = VehicleIdentity & {
  source: DataSourceName;
  sourceId?: string;
  reliabilityScore?: number;
  safetyScore?: number;
  insuranceMonthly?: number;
  maintenanceMonthly?: number;
  depreciationAnnual?: number;
  mpg?: number;
  fuelType?: string;
  bodyType?: string;
  drivetrain?: string;
  transmission?: string;
  seats?: number;
  price?: number;
  mileage?: number;
  commonIssues?: string[];
  pros?: string[];
  cons?: string[];
  imageUrl?: string;
  imageSource?: string;
  imageVerified?: boolean;
  listingUrl?: string;
  fetchedAt?: string;
};

export type VehicleDataImportResult = {
  overlays: VehicleDataOverlay[];
  warnings: string[];
};

export type NhtsaModel = {
  make: string;
  model: string;
  year?: number;
  vehicleType?: string;
};

export type FuelEconomyVehicle = {
  sourceId: string;
  make: string;
  model: string;
  year: number;
  mpg?: number;
  fuelType?: string;
  transmission?: string;
  drivetrain?: string;
  seats?: number;
};

export type UsedCarListing = {
  sourceId: string;
  make: string;
  model: string;
  year: number;
  price?: number;
  mileage?: number;
  listingUrl?: string;
  imageUrl?: string;
  imageVerified?: boolean;
  source: string;
};

export type EnrichedVehicle = Vehicle & {
  dataSources: DataSourceName[];
};

export type DataProviderStatus = {
  source: DataSourceName;
  configured: boolean;
  message: string;
};
