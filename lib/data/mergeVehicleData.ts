import catalogMetadata from "@/data/processed/vehicleCatalog.metadata.json";
import { getVehicleFamilyKey, getVehicleKey } from "@/lib/data/vehicleIdentity";
import type { EnrichedVehicle, VehicleDataOverlay } from "@/types/data";
import type { Vehicle } from "@/types/vehicle";

const catalogGeneratedAt = String((catalogMetadata as { generatedAt?: string }).generatedAt || "2026-07-08");

export function mergeVehicleData(vehicles: Vehicle[], overlays: VehicleDataOverlay[]): EnrichedVehicle[] {
  const overlaysByExactKey = new Map<string, VehicleDataOverlay[]>();
  const overlaysByFamilyKey = new Map<string, VehicleDataOverlay[]>();

  overlays.forEach((overlay) => {
    const exactKey = getVehicleKey(overlay);
    const familyKey = getVehicleFamilyKey(overlay);

    if (exactKey) overlaysByExactKey.set(exactKey, [...(overlaysByExactKey.get(exactKey) || []), overlay]);
    if (familyKey) overlaysByFamilyKey.set(familyKey, [...(overlaysByFamilyKey.get(familyKey) || []), overlay]);
  });

  return vehicles.map((vehicle) => {
    const exactMatches = overlaysByExactKey.get(getVehicleKey(vehicle)) || [];
    const familyMatches = overlaysByFamilyKey.get(getVehicleFamilyKey(vehicle)) || [];
    const matches = [...familyMatches, ...exactMatches];

    return matches.reduce<EnrichedVehicle>(
      (mergedVehicle, overlay) => applyOverlay(mergedVehicle, overlay),
      { ...vehicle, dataSources: ["seed"], dataUpdatedAt: catalogGeneratedAt },
    );
  });
}

function applyOverlay(vehicle: EnrichedVehicle, overlay: VehicleDataOverlay): EnrichedVehicle {
  return {
    ...vehicle,
    dataSources: Array.from(new Set([...vehicle.dataSources, overlay.source])),
    dataUpdatedAt: getLatestDate(vehicle.dataUpdatedAt, overlay.fetchedAt),
    reliabilityScore: overlay.reliabilityScore ?? vehicle.reliabilityScore,
    safetyScore: overlay.safetyScore ?? vehicle.safetyScore,
    insurance: overlay.insuranceMonthly ?? vehicle.insurance,
    maintenanceEstimate: overlay.maintenanceMonthly ?? vehicle.maintenanceEstimate,
    depreciationEstimate: overlay.depreciationAnnual ?? vehicle.depreciationEstimate,
    mpg: overlay.mpg ?? vehicle.mpg,
    fuelType: overlay.fuelType ?? vehicle.fuelType,
    bodyType: overlay.bodyType ?? vehicle.bodyType,
    drivetrain: overlay.drivetrain ?? vehicle.drivetrain,
    transmission: overlay.transmission ?? vehicle.transmission,
    seats: overlay.seats ?? vehicle.seats,
    price: overlay.price ?? vehicle.price,
    mileage: overlay.mileage ?? vehicle.mileage,
    commonIssues: mergeList(vehicle.commonIssues, overlay.commonIssues),
    pros: mergeList(vehicle.pros, overlay.pros),
    watchouts: mergeList(vehicle.watchouts, overlay.cons),
    imageUrl: overlay.imageUrl ?? vehicle.imageUrl,
    imageSource: overlay.imageUrl ? overlay.imageSource || overlay.source : vehicle.imageSource,
    imageVerified: overlay.imageUrl ? overlay.imageVerified ?? overlay.source === "listing-api" : vehicle.imageVerified,
    listingUrl: overlay.listingUrl ?? vehicle.listingUrl,
  };
}

function mergeList(base: string[], incoming?: string[]) {
  if (!incoming?.length) return base;
  return Array.from(new Set([...base, ...incoming.map((item) => item.trim()).filter(Boolean)])).slice(0, 6);
}

function getLatestDate(baseDate: string, incomingDate?: string) {
  if (!incomingDate) return baseDate;
  const baseTime = Date.parse(baseDate);
  const incomingTime = Date.parse(incomingDate);
  if (!Number.isFinite(incomingTime)) return baseDate;
  if (!Number.isFinite(baseTime)) return incomingDate;
  return incomingTime > baseTime ? incomingDate : baseDate;
}
