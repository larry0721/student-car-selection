import type { VehicleIdentity } from "@/types/data";

export function getVehicleKey(vehicle: VehicleIdentity) {
  return [
    normalizeIdentityPart(vehicle.year ? String(vehicle.year) : ""),
    normalizeIdentityPart(vehicle.make),
    normalizeIdentityPart(vehicle.model),
  ]
    .filter(Boolean)
    .join(":");
}

export function getVehicleFamilyKey(vehicle: VehicleIdentity) {
  return [normalizeIdentityPart(vehicle.make), normalizeIdentityPart(vehicle.model)].filter(Boolean).join(":");
}

export function normalizeIdentityPart(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}
