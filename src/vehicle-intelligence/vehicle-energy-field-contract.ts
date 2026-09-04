import type { VehicleEnergyAuthority } from "../../types/vehicleEnergyAuthority";

export const vehicleEnergyFieldContractVersion = "1.0.0" as const;

export function parseVehicleEnergyAuthority(input: {
  fuelType: "gas" | "hybrid" | "electric";
  value: unknown;
  unit: string;
  field: "efficiency" | "range";
}): VehicleEnergyAuthority | null {
  if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value <= 0) return null;
  if (input.field === "range") {
    return input.fuelType === "electric" && input.unit === "miles"
      ? { kind: "electric_range", value: input.value, unit: "miles", legacyMpgCompatible: false }
      : null;
  }
  if ((input.fuelType === "gas" || input.fuelType === "hybrid") && input.unit === "mpg") {
    return { kind: "conventional_mpg", fuelType: input.fuelType, value: input.value, unit: "mpg", legacyMpgCompatible: true };
  }
  if (input.fuelType === "electric" && input.unit === "mpge") {
    return { kind: "electric_mpge", value: input.value, unit: "mpge", legacyMpgCompatible: false };
  }
  if (input.fuelType === "electric" && input.unit === "kwh_per_100_miles") {
    return { kind: "electric_consumption", value: input.value, unit: "kwh_per_100_miles", legacyMpgCompatible: false };
  }
  return null;
}

export function toLegacyVehicleMpg(authority: VehicleEnergyAuthority | null) {
  return authority?.legacyMpgCompatible ? authority.value : null;
}
