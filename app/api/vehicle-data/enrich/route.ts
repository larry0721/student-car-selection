import { NextResponse } from "next/server";
import { fetchFuelEconomyOverlay } from "@/lib/data/fuelEconomy";
import { fetchNhtsaOverlay } from "@/lib/data/nhtsa";
import { fetchListingOverlay, getUsedCarListingProviderStatus } from "@/lib/data/usedCarListings";
import type { DataProviderStatus, VehicleDataOverlay, VehicleIdentity } from "@/types/data";

type EnrichmentSource = "nhtsa" | "fueleconomy.gov" | "listing-api";

type EnrichmentRequest = {
  vehicles: VehicleIdentity[];
  sources?: EnrichmentSource[];
};

export async function POST(request: Request) {
  const payload = (await request.json()) as EnrichmentRequest;
  const vehicles = Array.isArray(payload.vehicles) ? payload.vehicles.slice(0, 10) : [];
  const sources: EnrichmentSource[] = payload.sources?.length ? payload.sources : ["nhtsa", "fueleconomy.gov", "listing-api"];
  const allProviderStatus: DataProviderStatus[] = [
    { source: "nhtsa", configured: true, message: "NHTSA vPIC public API configured." },
    { source: "fueleconomy.gov", configured: true, message: "FuelEconomy.gov public API configured." },
    getUsedCarListingProviderStatus(),
  ];
  const providerStatus = allProviderStatus.filter((status) => sources.includes(status.source as EnrichmentSource));

  if (!vehicles.length) {
    return NextResponse.json({ overlays: [], warnings: ["No vehicles were provided for enrichment."], providerStatus });
  }

  const warnings: string[] = [];
  const overlays: VehicleDataOverlay[] = [];
  const listingStatus = providerStatus.find((status) => status.source === "listing-api");
  if (sources.includes("listing-api") && listingStatus && !listingStatus.configured) warnings.push(listingStatus.message);

  const vehicleResults = await Promise.all(vehicles.map((vehicle) => enrichVehicle(vehicle, sources, Boolean(listingStatus?.configured))));
  vehicleResults.forEach((result) => {
    overlays.push(...result.overlays);
    warnings.push(...result.warnings);
  });

  return NextResponse.json({ overlays, warnings: Array.from(new Set(warnings)), providerStatus });
}

async function enrichVehicle(
  vehicle: VehicleIdentity,
  sources: EnrichmentSource[],
  listingConfigured: boolean,
) {
  const warnings: string[] = [];
  const overlays: VehicleDataOverlay[] = [];
  const results = await Promise.allSettled([
    sources.includes("nhtsa") ? fetchNhtsaOverlay(vehicle) : Promise.resolve([]),
    sources.includes("fueleconomy.gov") ? fetchFuelEconomyOverlay(vehicle) : Promise.resolve([]),
    sources.includes("listing-api") && listingConfigured ? fetchListingOverlay(vehicle) : Promise.resolve([]),
  ]);

  results.forEach((result) => {
    if (result.status === "fulfilled") {
      overlays.push(...result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : "data fetch failed";
      warnings.push(`${vehicle.year || ""} ${vehicle.make} ${vehicle.model}: ${reason}`);
    }
  });

  return { overlays, warnings };
}
