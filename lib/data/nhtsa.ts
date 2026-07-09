import { fetchWithTimeout } from "@/lib/data/fetchWithTimeout";
import type { NhtsaModel, VehicleDataOverlay, VehicleIdentity } from "@/types/data";

const nhtsaBaseUrl = "https://vpic.nhtsa.dot.gov/api/vehicles";

export async function fetchNhtsaModelsForMakeYear(identity: VehicleIdentity): Promise<NhtsaModel[]> {
  if (!identity.make || !identity.year) return [];

  const url = new URL(`${nhtsaBaseUrl}/GetModelsForMakeYear/make/${encodeURIComponent(identity.make)}/modelyear/${identity.year}`);
  url.searchParams.set("format", "json");

  const response = await fetchWithTimeout(url, {}, 4500);
  if (!response.ok) throw new Error(`NHTSA request failed with status ${response.status}`);

  const data = (await response.json()) as {
    Results?: Array<{
      Make_Name?: string;
      Model_Name?: string;
      ModelYear?: string;
      VehicleTypeName?: string;
    }>;
  };

  return (data.Results || [])
    .filter((item) => item.Make_Name && item.Model_Name)
    .map((item) => ({
      make: item.Make_Name || identity.make,
      model: item.Model_Name || identity.model,
      year: Number(item.ModelYear) || identity.year,
      vehicleType: item.VehicleTypeName,
    }));
}

export async function fetchNhtsaOverlay(identity: VehicleIdentity): Promise<VehicleDataOverlay[]> {
  const models = await fetchNhtsaModelsForMakeYear(identity);
  const likelyMatches = models.filter((model) =>
    model.model.toLowerCase().includes(identity.model.toLowerCase().split(" ")[0] || identity.model.toLowerCase()),
  );

  return likelyMatches.slice(0, 3).map((model) => ({
    make: model.make,
    model: model.model,
    year: model.year,
    source: "nhtsa",
    bodyType: normalizeNhtsaBodyType(model.vehicleType),
    fetchedAt: new Date().toISOString(),
  }));
}

function normalizeNhtsaBodyType(vehicleType?: string) {
  const value = String(vehicleType || "").toLowerCase();
  if (value.includes("truck")) return "truck";
  if (value.includes("multipurpose") || value.includes("utility")) return "suv";
  if (value.includes("passenger car")) return "sedan";
  return undefined;
}
