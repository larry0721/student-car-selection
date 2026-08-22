import type { CanonicalEvidenceSourceValue, CanonicalUnit, CanonicalVehicleFieldPath } from "../types/canonicalVehicle";

export type PublishedCVRFixtureField = readonly [CanonicalVehicleFieldPath, CanonicalEvidenceSourceValue, CanonicalUnit];

const requiredIdentity = (make: string, model: string, year: number, bodyStyle: string): PublishedCVRFixtureField[] => [
  ["identity.make", make, "none"],
  ["identity.model", model, "none"],
  ["identity.modelYear", year, "year"],
  ["identity.bodyStyle", bodyStyle, "none"],
];

export const publishedCVRFixtureProfiles = {
  strongGasoline: {
    vehicleId: "fixture-published-gasoline",
    dataClassification: "fixture" as const,
    fields: [
      ...requiredIdentity("Honda", "Civic", 2020, "sedan"),
      ["identity.vehicleCategory", "compact_car", "none"],
      ["identity.drivetrain", "FWD", "none"],
      ["identity.transmission", "automatic", "none"],
      ["identity.fuelType", "gas", "none"],
      ["environment.fuelEconomy", 34, "mpg"],
      ["safety.crashSafety", 88, "score_0_100"],
    ] as PublishedCVRFixtureField[],
  },
  hybrid: {
    vehicleId: "fixture-published-hybrid",
    dataClassification: "fixture" as const,
    fields: [
      ...requiredIdentity("Toyota", "Prius", 2021, "hatchback"),
      ["identity.drivetrain", "FWD", "none"],
      ["identity.transmission", "cvt", "none"],
      ["identity.fuelType", "hybrid", "none"],
      ["environment.fuelEconomy", 52, "mpg"],
      ["financial.maintenanceCost", 75, "usd_per_month"],
    ] as PublishedCVRFixtureField[],
  },
  hybridSupersedingVersion: {
    vehicleId: "fixture-published-hybrid",
    dataClassification: "fixture" as const,
    fields: [
      ...requiredIdentity("Toyota", "Prius", 2021, "hatchback"),
      ["identity.drivetrain", "FWD", "none"],
      ["identity.transmission", "cvt", "none"],
      ["identity.fuelType", "hybrid", "none"],
      ["environment.fuelEconomy", 54, "mpg"],
      ["financial.maintenanceCost", 72, "usd_per_month"],
    ] as PublishedCVRFixtureField[],
  },
  electric: {
    vehicleId: "fixture-published-ev",
    dataClassification: "fixture" as const,
    fields: [
      ...requiredIdentity("Nissan", "Leaf", 2022, "hatchback"),
      ["identity.drivetrain", "FWD", "none"],
      ["identity.transmission", "automatic", "none"],
      ["identity.fuelType", "electric", "none"],
      ["environment.evRange", 149, "miles"],
      ["environment.chargingSpeed", 50, "kilowatts"],
    ] as PublishedCVRFixtureField[],
  },
  sparsePublishable: {
    vehicleId: "fixture-published-sparse",
    dataClassification: "fixture" as const,
    fields: [
      ...requiredIdentity("Toyota", "Camry", 2020, "sedan"),
      ["identity.drivetrain", "FWD", "none"],
      ["identity.transmission", "automatic", "none"],
      ["identity.fuelType", "gas", "none"],
      ["environment.fuelEconomy", 32, "mpg"],
    ] as PublishedCVRFixtureField[],
  },
  rejectedAttempt: {
    vehicleId: "fixture-published-rejected",
    dataClassification: "fixture" as const,
    fields: [
      ["identity.make", "Toyota", "none"],
      ["identity.modelYear", 2020, "year"],
    ] as PublishedCVRFixtureField[],
  },
} as const;
