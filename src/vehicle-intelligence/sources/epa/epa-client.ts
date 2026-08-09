const fuelEconomyBaseUrl = "https://www.fueleconomy.gov/ws/rest";
const requestTimeoutMs = 6_000;

export type EpaMenuItem = {
  text: string;
  value: string;
};

export type EpaVehicleOption = {
  id: string;
  label: string;
  year: number;
  make: string;
  model: string;
};

export type EpaVehicleRecord = {
  id: string;
  year: number;
  make: string;
  model: string;
  VClass?: string | null;
  drive?: string | null;
  trany?: string | null;
  cylinders?: number | null;
  displ?: number | null;
  fuelType?: string | null;
  fuelType1?: string | null;
  fuelType2?: string | null;
  atvType?: string | null;
  city08?: number | null;
  highway08?: number | null;
  comb08?: number | null;
  cityA08?: number | null;
  highwayA08?: number | null;
  combA08?: number | null;
  range?: number | null;
  rangeCity?: number | null;
  rangeHwy?: number | null;
  charge240?: number | null;
  charge120?: number | null;
  cityE?: number | null;
  highwayE?: number | null;
  combE?: number | null;
  fuelCost08?: number | null;
  fuelCostA08?: number | null;
  co2?: number | null;
  co2TailpipeGpm?: number | null;
  co2TailpipeAGpm?: number | null;
  ghgScore?: number | null;
  ghgScoreA?: number | null;
  feScore?: number | null;
  feScoreA?: number | null;
  createdOn?: string | null;
  modifiedOn?: string | null;
};

type EpaJsonObject = Record<string, unknown>;
type OptionalStringField =
  | "VClass"
  | "drive"
  | "trany"
  | "fuelType"
  | "fuelType1"
  | "fuelType2"
  | "atvType"
  | "createdOn"
  | "modifiedOn";
type OptionalNumberField = Exclude<
  keyof EpaVehicleRecord,
  "id" | "year" | "make" | "model" | OptionalStringField
>;

const optionalStringFields = [
  "VClass",
  "drive",
  "trany",
  "fuelType",
  "fuelType1",
  "fuelType2",
  "atvType",
  "createdOn",
  "modifiedOn",
] as const satisfies readonly OptionalStringField[];

const optionalNumberFields = [
  "cylinders",
  "displ",
  "city08",
  "highway08",
  "comb08",
  "cityA08",
  "highwayA08",
  "combA08",
  "range",
  "rangeCity",
  "rangeHwy",
  "charge240",
  "charge120",
  "cityE",
  "highwayE",
  "combE",
  "fuelCost08",
  "fuelCostA08",
  "co2",
  "co2TailpipeGpm",
  "co2TailpipeAGpm",
  "ghgScore",
  "ghgScoreA",
  "feScore",
  "feScoreA",
] as const satisfies readonly OptionalNumberField[];

const unavailableMinusOneFields = new Set<OptionalNumberField>([
  "co2",
  "ghgScore",
  "ghgScoreA",
  "feScore",
  "feScoreA",
]);

export async function getMakesForYear(year: number): Promise<EpaMenuItem[]> {
  validateYear(year);
  return requestMenu("vehicle/menu/make", { year: String(year) }, "make menu");
}

export async function getModelsForYearMake(
  year: number,
  make: string,
): Promise<EpaMenuItem[]> {
  validateYear(year);
  const normalizedMake = requireText(make, "make");
  return requestMenu(
    "vehicle/menu/model",
    { year: String(year), make: normalizedMake },
    "model menu",
  );
}

export async function getVehicleOptions(
  year: number,
  make: string,
  model: string,
): Promise<EpaVehicleOption[]> {
  validateYear(year);
  const normalizedMake = requireText(make, "make");
  const normalizedModel = requireText(model, "model");
  const items = await requestMenu(
    "vehicle/menu/options",
    { year: String(year), make: normalizedMake, model: normalizedModel },
    "vehicle-options menu",
  );

  return items.map((item) => {
    const id = normalizeVehicleId(item.value);
    return {
      id,
      label: item.text,
      year,
      make: normalizedMake,
      model: normalizedModel,
    };
  });
}

export async function getVehicleById(vehicleId: string | number): Promise<EpaVehicleRecord> {
  const normalizedId = normalizeVehicleId(vehicleId);
  const payload = await requestJson(
    `vehicle/${encodeURIComponent(normalizedId)}`,
    {},
    "vehicle-record",
  );

  if (!isObject(payload)) {
    throw new Error("FuelEconomy.gov vehicle-record response had an unexpected shape.");
  }
  if (Object.keys(payload).length === 0) {
    throw new Error(`FuelEconomy.gov returned no vehicle record for EPA vehicle ID ${normalizedId}.`);
  }

  return parseVehicleRecord(payload, normalizedId);
}

async function requestMenu(
  path: string,
  parameters: Record<string, string>,
  operation: string,
) {
  const payload = await requestJson(path, parameters, operation);
  if (!isObject(payload) || !("menuItem" in payload)) {
    throw new Error(`FuelEconomy.gov ${operation} response had an unexpected shape.`);
  }

  const rawItems = payload.menuItem;
  if (rawItems === null || (Array.isArray(rawItems) && rawItems.length === 0)) return [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (!items.every(isObject)) {
    throw new Error(`FuelEconomy.gov ${operation} response had an unexpected menu-item shape.`);
  }

  return items.map((item) => {
    const text = parseRequiredString(item.text);
    const value = parseRequiredString(item.value);
    if (!text || !value) {
      throw new Error(`FuelEconomy.gov ${operation} response contained an invalid menu item.`);
    }
    return { text, value };
  });
}

async function requestJson(
  path: string,
  parameters: Record<string, string>,
  operation: string,
): Promise<unknown> {
  const url = new URL(`${fuelEconomyBaseUrl}/${path}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new Error(`FuelEconomy.gov ${operation} request timed out after ${requestTimeoutMs}ms.`, {
        cause: error,
      });
    }
    throw new Error(`FuelEconomy.gov ${operation} request failed because the network request could not be completed.`, {
      cause: error,
    });
  }

  if (!response.ok) {
    clearTimeout(timeout);
    throw new Error(`FuelEconomy.gov ${operation} request failed with HTTP status ${response.status}.`);
  }

  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new Error(`FuelEconomy.gov ${operation} response was not valid JSON.`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function parseVehicleRecord(payload: EpaJsonObject, requestedId: string): EpaVehicleRecord {
  const id = parseRequiredString(payload.id);
  const year = parseNumber(payload.year);
  const make = parseRequiredString(payload.make);
  const model = parseRequiredString(payload.model);
  if (!id || year === null || !Number.isInteger(year) || !make || !model) {
    throw new Error(`FuelEconomy.gov vehicle-record response for EPA vehicle ID ${requestedId} was missing required identity fields.`);
  }

  const record: Record<string, unknown> = { id, year, make, model };
  for (const field of optionalStringFields) {
    if (Object.hasOwn(payload, field)) record[field] = parseString(payload[field]);
  }
  for (const field of optionalNumberFields) {
    if (!Object.hasOwn(payload, field)) continue;
    const parsed = parseNumber(payload[field]);
    record[field] = parsed === -1 && unavailableMinusOneFields.has(field) ? null : parsed;
  }
  return record as EpaVehicleRecord;
}

function validateYear(year: number) {
  const maximumYear = new Date().getUTCFullYear() + 2;
  if (!Number.isInteger(year) || year < 1984 || year > maximumYear) {
    throw new Error(`Invalid EPA model year: expected an integer from 1984 through ${maximumYear}.`);
  }
}

function requireText(value: string, field: "make" | "model") {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid EPA ${field}: expected a non-blank string.`);
  }
  return value.trim();
}

function normalizeVehicleId(value: string | number) {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0 || !Number.isSafeInteger(Number(normalized))) {
    throw new Error("Invalid EPA vehicle ID: expected a positive integer or numeric string.");
  }
  return normalized;
}

function parseRequiredString(value: unknown) {
  const parsed = parseString(value);
  return parsed === null ? null : parsed;
}

function parseString(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isObject(value: unknown): value is EpaJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
