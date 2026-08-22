const nhtsaSafetyBaseUrl = "https://api.nhtsa.gov/SafetyRatings";
const requestTimeoutMs = 8_000;

export type NhtsaSafetyCandidate = Readonly<{
  vehicleId: number;
  vehicleDescription: string;
  modelYear: number;
  make: string;
  model: string;
  drivetrain: "FWD" | "RWD" | "AWD" | "4WD" | null;
  bodyDescription: "suv" | "hatchback" | "sedan" | "pickup" | null;
  doorCount: number | null;
  powertrainDescription: "electric" | null;
  rawDescription: string;
}>;

export type NhtsaSafetyRatingState = "RATED" | "NOT_RATED";

export type NhtsaSafetyRecord = Readonly<{
  vehicleId: number;
  vehicleDescription: string;
  modelYear: number;
  make: string;
  model: string;
  ratingState: NhtsaSafetyRatingState;
  ratings: {
    overall: number | null;
    overallFrontCrash: number | null;
    frontCrashDriverSide: number | null;
    frontCrashPassengerSide: number | null;
    overallSideCrash: number | null;
    sideCrashDriverSide: number | null;
    sideCrashPassengerSide: number | null;
    sidePoleCrash: number | null;
    combinedSideBarrierAndPoleFront: number | null;
    combinedSideBarrierAndPoleRear: number | null;
    sideBarrierOverall: number | null;
    rollover: number | null;
    rolloverPossibilityRatio: number | null;
  };
  safetyTechnology: {
    electronicStabilityControl: string | null;
    forwardCollisionWarning: string | null;
    laneDepartureWarning: string | null;
  };
  safetyHistory: {
    complaintsCount: number | null;
    recallsCount: number | null;
    investigationCount: number | null;
  };
  media: Record<string, string>;
  rawFields: Record<string, string | number | boolean | null>;
}>;

export type NhtsaSafetyClientErrorCode = "INVALID_REQUEST" | "NETWORK_FAILURE" | "HTTP_FAILURE" | "INVALID_JSON" | "INVALID_RESPONSE";

export class NhtsaSafetyClientError extends Error {
  readonly code: NhtsaSafetyClientErrorCode;
  readonly status: number | null;

  constructor(code: NhtsaSafetyClientErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "NhtsaSafetyClientError";
    this.code = code;
    this.status = options.status ?? null;
  }
}

export async function getSafetyRatingCandidates(
  year: number,
  make: string,
  model: string,
): Promise<NhtsaSafetyCandidate[]> {
  validateYear(year);
  const normalizedMake = requireText(make, "make");
  const normalizedModel = requireText(model, "model");
  const path = `modelyear/${year}/make/${encodeURIComponent(normalizedMake)}/model/${encodeURIComponent(normalizedModel)}`;
  const payload = await requestNhtsaSafety(path, "candidate discovery");
  const results = getResults(payload, "candidate discovery");
  return results.map((item) => parseCandidate(item, year, normalizedMake, normalizedModel));
}

export async function getSafetyRatingByVehicleId(vehicleId: number | string): Promise<NhtsaSafetyRecord> {
  const normalizedId = normalizeVehicleId(vehicleId);
  const payload = await requestNhtsaSafety(`VehicleId/${normalizedId}`, "vehicle rating");
  const results = getResults(payload, "vehicle rating");
  if (results.length === 0) {
    throw new NhtsaSafetyClientError("INVALID_RESPONSE", `NHTSA Safety returned no rating record for VehicleId ${normalizedId}.`);
  }
  if (results.length !== 1) {
    throw new NhtsaSafetyClientError("INVALID_RESPONSE", `NHTSA Safety returned ${results.length} rating records for VehicleId ${normalizedId}.`);
  }
  return parseSafetyRecord(results[0], normalizedId);
}

function parseCandidate(raw: Record<string, unknown>, year: number, make: string, model: string): NhtsaSafetyCandidate {
  const vehicleId = parseInteger(raw.VehicleId);
  const description = parseText(raw.VehicleDescription);
  if (vehicleId === null || vehicleId <= 0 || !description) {
    throw new NhtsaSafetyClientError("INVALID_RESPONSE", "NHTSA Safety candidate contained invalid VehicleId or VehicleDescription.");
  }
  return {
    vehicleId,
    vehicleDescription: description,
    modelYear: year,
    make,
    model,
    drivetrain: parseDrivetrain(description),
    bodyDescription: parseBodyDescription(description),
    doorCount: parseDoorCount(description),
    powertrainDescription: /\bBEV\b|\bELECTRIC\b/i.test(description) ? "electric" : null,
    rawDescription: description,
  };
}

function parseSafetyRecord(raw: Record<string, unknown>, requestedId: number): NhtsaSafetyRecord {
  const vehicleId = parseInteger(raw.VehicleId);
  const vehicleDescription = parseText(raw.VehicleDescription);
  const modelYear = parseInteger(raw.ModelYear);
  const make = parseText(raw.Make);
  const model = parseText(raw.Model);
  if (vehicleId !== requestedId || !vehicleDescription || modelYear === null || !make || !model) {
    throw new NhtsaSafetyClientError("INVALID_RESPONSE", `NHTSA Safety record for VehicleId ${requestedId} was missing required identity fields.`);
  }
  const ratings = {
    overall: parseStarRating(raw.OverallRating),
    overallFrontCrash: parseStarRating(raw.OverallFrontCrashRating),
    frontCrashDriverSide: parseStarRating(raw.FrontCrashDriversideRating),
    frontCrashPassengerSide: parseStarRating(raw.FrontCrashPassengersideRating),
    overallSideCrash: parseStarRating(raw.OverallSideCrashRating),
    sideCrashDriverSide: parseStarRating(raw.SideCrashDriversideRating),
    sideCrashPassengerSide: parseStarRating(raw.SideCrashPassengersideRating),
    sidePoleCrash: parseStarRating(raw.SidePoleCrashRating),
    combinedSideBarrierAndPoleFront: parseStarRating(raw["combinedSideBarrierAndPoleRating-Front"] ?? raw.combinedSideBarrierAndPoleRatingFront),
    combinedSideBarrierAndPoleRear: parseStarRating(raw["combinedSideBarrierAndPoleRating-Rear"] ?? raw.combinedSideBarrierAndPoleRatingRear),
    sideBarrierOverall: parseStarRating(raw["sideBarrierRating-Overall"] ?? raw.sideBarrierRatingOverall),
    rollover: parseStarRating(raw.RolloverRating),
    rolloverPossibilityRatio: parseRatio(raw.RolloverPossibility),
  };
  const ratingValues = Object.entries(ratings).filter(([key]) => key !== "rolloverPossibilityRatio").map(([, value]) => value);
  const explicitlyNotRated = Object.values(raw).some((value) => typeof value === "string" && value.trim().toLowerCase() === "not rated");
  const ratingState: NhtsaSafetyRatingState = ratingValues.some((value) => value !== null) ? "RATED" : "NOT_RATED";
  if (ratingState === "NOT_RATED" && !explicitlyNotRated) {
    throw new NhtsaSafetyClientError("INVALID_RESPONSE", `NHTSA Safety record for VehicleId ${requestedId} contained no usable ratings and no explicit Not Rated state.`);
  }
  return {
    vehicleId,
    vehicleDescription,
    modelYear,
    make,
    model,
    ratingState,
    ratings,
    safetyTechnology: {
      electronicStabilityControl: parseText(raw.NHTSAElectronicStabilityControl),
      forwardCollisionWarning: parseText(raw.NHTSAForwardCollisionWarning),
      laneDepartureWarning: parseText(raw.NHTSALaneDepartureWarning),
    },
    safetyHistory: {
      complaintsCount: parseInteger(raw.ComplaintsCount),
      recallsCount: parseInteger(raw.RecallsCount),
      investigationCount: parseInteger(raw.InvestigationCount),
    },
    media: parseMedia(raw),
    rawFields: Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string | number | boolean | null] => isSourcePrimitive(entry[1]))),
  };
}

async function requestNhtsaSafety(path: string, operation: string): Promise<unknown> {
  const url = new URL(`${nhtsaSafetyBaseUrl}/${path}`);
  url.searchParams.set("format", "json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    throw new NhtsaSafetyClientError("NETWORK_FAILURE", timedOut
      ? `NHTSA Safety ${operation} request timed out after ${requestTimeoutMs}ms.`
      : `NHTSA Safety ${operation} network request failed.`, { cause: error });
  }
  if (!response.ok) {
    clearTimeout(timeout);
    throw new NhtsaSafetyClientError("HTTP_FAILURE", `NHTSA Safety ${operation} request failed with HTTP status ${response.status}.`, { status: response.status });
  }
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new NhtsaSafetyClientError("INVALID_JSON", `NHTSA Safety ${operation} response was not valid JSON.`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function getResults(payload: unknown, operation: string) {
  if (!isObject(payload) || !Array.isArray(payload.Results) || !payload.Results.every(isObject)) {
    throw new NhtsaSafetyClientError("INVALID_RESPONSE", `NHTSA Safety ${operation} response had an unexpected shape.`);
  }
  return payload.Results;
}

function parseDrivetrain(description: string): NhtsaSafetyCandidate["drivetrain"] {
  if (/\bFWD\b/i.test(description)) return "FWD";
  if (/\bRWD\b/i.test(description)) return "RWD";
  if (/\bAWD\b/i.test(description)) return "AWD";
  if (/\b4WD\b|\b4X4\b/i.test(description)) return "4WD";
  return null;
}

function parseBodyDescription(description: string): NhtsaSafetyCandidate["bodyDescription"] {
  if (/\bSUV\b/i.test(description)) return "suv";
  if (/\bHB\b|\bHATCHBACK\b/i.test(description)) return "hatchback";
  if (/\bPICKUP\b|\bTRUCK\b/i.test(description)) return "pickup";
  if (/\bSEDAN\b/i.test(description)) return "sedan";
  return null;
}

function parseDoorCount(description: string) {
  const match = description.match(/\b([2-5])\s*(?:DR|DOOR)\b/i);
  return match ? Number(match[1]) : null;
}

function parseStarRating(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 5) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.toLowerCase() === "not rated") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5 ? parsed : null;
}

function parseRatio(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function parseMedia(raw: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(raw)
    .filter(([key, value]) => /Picture|Video/i.test(key) && typeof value === "string" && /^https?:\/\//i.test(value.trim()))
    .map(([key, value]) => [key, String(value).trim()]));
}

function normalizeVehicleId(value: string | number) {
  const id = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(id) || id <= 0) throw new NhtsaSafetyClientError("INVALID_REQUEST", "NHTSA Safety VehicleId must be a positive integer.");
  return id;
}

function validateYear(year: number) {
  if (!Number.isInteger(year) || year < 1980 || year > new Date().getUTCFullYear() + 1) {
    throw new NhtsaSafetyClientError("INVALID_REQUEST", "NHTSA Safety model year must be a plausible integer.");
  }
}

function requireText(value: string, field: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new NhtsaSafetyClientError("INVALID_REQUEST", `NHTSA Safety ${field} is required.`);
  return normalized;
}

function parseText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isSourcePrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
