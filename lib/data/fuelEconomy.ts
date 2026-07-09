import { fetchWithTimeout } from "@/lib/data/fetchWithTimeout";
import type { FuelEconomyVehicle, VehicleDataOverlay, VehicleIdentity } from "@/types/data";

const fuelEconomyBaseUrl = "https://www.fueleconomy.gov/ws/rest";

export async function fetchFuelEconomyVehicles(identity: VehicleIdentity): Promise<FuelEconomyVehicle[]> {
  if (!identity.make || !identity.model || !identity.year) return [];

  let vehicles = await fetchMenuOptions("vehicle/menu/options", {
    year: String(identity.year),
    make: identity.make,
    model: identity.model,
  });

  if (!vehicles.length) {
    vehicles = await fetchMenuOptions("vehicle/menu/options", {
      year: String(identity.year),
      make: identity.make,
      model: getModelFamily(identity.model),
    });
  }

  const detailedVehicles = await Promise.all(
    vehicles.slice(0, 3).map(async (vehicle) => fetchFuelEconomyVehicle(vehicle.value, identity)),
  );

  return detailedVehicles.filter(Boolean) as FuelEconomyVehicle[];
}

export async function fetchFuelEconomyOverlay(identity: VehicleIdentity): Promise<VehicleDataOverlay[]> {
  const vehicles = await fetchFuelEconomyVehicles(identity);

  return vehicles.map((vehicle) => ({
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    source: "fueleconomy.gov",
    sourceId: vehicle.sourceId,
    mpg: vehicle.mpg,
    fuelType: vehicle.fuelType,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain,
    seats: vehicle.seats,
    fetchedAt: new Date().toISOString(),
  }));
}

async function fetchFuelEconomyVehicle(id: string, fallback: VehicleIdentity): Promise<FuelEconomyVehicle | null> {
  const url = new URL(`${fuelEconomyBaseUrl}/vehicle/${encodeURIComponent(id)}`);
  const data = await fetchJsonOrXml(url);
  const sourceId = getField(data, "id") || id;
  const mpg = Number(getField(data, "comb08") || getField(data, "combE"));

  return {
    sourceId,
    make: getField(data, "make") || fallback.make,
    model: getField(data, "model") || fallback.model,
    year: Number(getField(data, "year")) || fallback.year || new Date().getFullYear(),
    mpg: Number.isFinite(mpg) ? mpg : undefined,
    fuelType: getField(data, "fuelType") || getField(data, "fuelType1"),
    transmission: normalizeTransmission(getField(data, "trany")),
    drivetrain: normalizeDrive(getField(data, "drive")),
    seats: Number(getField(data, "seats")) || undefined,
  };
}

async function fetchMenuOptions(path: string, params: Record<string, string>) {
  const url = new URL(`${fuelEconomyBaseUrl}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const data = await fetchJsonOrXml(url);
  if (!data || typeof data !== "object") return [];
  const rawItems = Array.isArray(data.menuItem) ? data.menuItem : data.menuItem ? [data.menuItem] : [];

  return rawItems
    .map((item) => ({
      text: getField(item, "text"),
      value: getField(item, "value"),
    }))
    .filter((item) => item.value);
}

async function fetchJsonOrXml(url: URL): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 4500);
  if (!response.ok) throw new Error(`FuelEconomy.gov request failed with status ${response.status}`);

  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return parseSimpleXml(text);
  }
}

function getModelFamily(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean)[0] || value;
}

function parseSimpleXml(xml: string): Record<string, unknown> {
  const menuItems = Array.from(xml.matchAll(/<menuItem>\s*<text>([\s\S]*?)<\/text>\s*<value>([\s\S]*?)<\/value>\s*<\/menuItem>/g)).map(
    ([, text, value]) => ({ text: decodeXml(text), value: decodeXml(value) }),
  );
  if (menuItems.length) return { menuItem: menuItems };

  return Object.fromEntries(
    Array.from(xml.matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)).map(([, key, value]) => [key, decodeXml(value)]),
  );
}

function getField(data: unknown, key: string) {
  if (!data || typeof data !== "object" || !(key in data)) return "";
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function normalizeTransmission(value: string) {
  const text = value.toLowerCase();
  if (text.includes("manual")) return "manual";
  if (text.includes("variable")) return "CVT";
  if (text) return "automatic";
  return undefined;
}

function normalizeDrive(value: string) {
  const text = value.toLowerCase();
  if (text.includes("4-wheel") || text.includes("4wd")) return "4WD";
  if (text.includes("all-wheel") || text.includes("awd")) return "AWD";
  if (text.includes("rear")) return "RWD";
  if (text.includes("front")) return "FWD";
  return undefined;
}
