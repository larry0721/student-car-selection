import type { CanonicalEvidenceSourceValue } from "../../../../types/canonicalVehicle";

const requestTimeoutMs = 12_000;

export type NhtsaDefectClientErrorCode =
  | "INVALID_REQUEST"
  | "NETWORK_FAILURE"
  | "HTTP_FAILURE"
  | "INVALID_JSON"
  | "INVALID_RESPONSE";

export class NhtsaDefectClientError extends Error {
  readonly code: NhtsaDefectClientErrorCode;
  readonly status: number | null;

  constructor(code: NhtsaDefectClientErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "NhtsaDefectClientError";
    this.code = code;
    this.status = options.status ?? null;
  }
}

export function createNhtsaVehicleIssueUrl(
  issueType: "recalls" | "complaints",
  year: number,
  make: string,
  model: string,
) {
  validateIdentity(year, make, model);
  const operation = issueType === "recalls" ? "recallsByVehicle" : "complaintsByVehicle";
  const url = new URL(`https://api.nhtsa.gov/${issueType}/${operation}`);
  url.searchParams.set("make", make.trim());
  url.searchParams.set("model", model.trim());
  url.searchParams.set("modelYear", String(year));
  return url.toString();
}

export async function requestNhtsaDefectRecords(url: string, operation: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "student-car-selection/1.0" },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    throw new NhtsaDefectClientError(
      "NETWORK_FAILURE",
      timedOut
        ? `NHTSA ${operation} request timed out after ${requestTimeoutMs}ms.`
        : `NHTSA ${operation} network request failed.`,
      { cause: error },
    );
  }

  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch (error) {
    clearTimeout(timeout);
    throw new NhtsaDefectClientError("INVALID_JSON", `NHTSA ${operation} response was not valid JSON.`, { status: response.status, cause: error });
  }
  clearTimeout(timeout);

  const parsed = parseEnvelope(payload, operation);
  const acceptedEmptyResponse = !response.ok
    && response.status === 400
    && parsed.records.length === 0
    && /success/i.test(parsed.message);
  if (!response.ok && !acceptedEmptyResponse) {
    throw new NhtsaDefectClientError("HTTP_FAILURE", `NHTSA ${operation} request failed with HTTP status ${response.status}.`, { status: response.status });
  }
  return parsed.records;
}

export function sourceValueRecord(raw: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
    const normalized = toSourceValue(value);
    return normalized === undefined ? [] : [[key, normalized]];
  })) as Record<string, CanonicalEvidenceSourceValue>;
}

export function parseText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

export function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === "true";
  return null;
}

function validateIdentity(year: number, make: string, model: string) {
  const currentYear = new Date().getUTCFullYear() + 2;
  if (!Number.isInteger(year) || year < 1886 || year > currentYear) {
    throw new NhtsaDefectClientError("INVALID_REQUEST", `model year must be an integer between 1886 and ${currentYear}.`);
  }
  if (!make.trim()) throw new NhtsaDefectClientError("INVALID_REQUEST", "make is required.");
  if (!model.trim()) throw new NhtsaDefectClientError("INVALID_REQUEST", "model is required.");
}

function parseEnvelope(payload: unknown, operation: string) {
  if (!isObject(payload)) throw new NhtsaDefectClientError("INVALID_RESPONSE", `NHTSA ${operation} response had an unexpected shape.`);
  const records = payload.results ?? payload.Results;
  const message = payload.message ?? payload.Message;
  if (!Array.isArray(records) || !records.every(isObject)) {
    throw new NhtsaDefectClientError("INVALID_RESPONSE", `NHTSA ${operation} response did not contain a valid results array.`);
  }
  return { records, message: typeof message === "string" ? message : "" };
}

function toSourceValue(value: unknown): CanonicalEvidenceSourceValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const items = value.map(toSourceValue).filter((item): item is CanonicalEvidenceSourceValue => item !== undefined);
    return items;
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const normalized = toSourceValue(item);
      return normalized === undefined ? [] : [[key, normalized]];
    }));
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
