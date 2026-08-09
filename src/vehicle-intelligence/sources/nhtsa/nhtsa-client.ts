const nhtsaVpicBaseUrl = "https://vpic.nhtsa.dot.gov/api/vehicles";
const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;

export type DecodedVin = {
  make: string | null;
  model: string | null;
  modelYear: number | null;
  bodyClass: string | null;
  driveType: string | null;
  fuelTypePrimary: string | null;
  transmissionStyle: string | null;
  vehicleType: string | null;
};

type NhtsaDecodeVinValue = {
  Make?: unknown;
  Model?: unknown;
  ModelYear?: unknown;
  BodyClass?: unknown;
  DriveType?: unknown;
  FuelTypePrimary?: unknown;
  TransmissionStyle?: unknown;
  VehicleType?: unknown;
  ErrorCode?: unknown;
  ErrorText?: unknown;
};

type NhtsaDecodeVinResponse = {
  Results?: unknown;
};

export async function decodeVin(vin: string): Promise<DecodedVin> {
  const normalizedVin = vin.trim().toUpperCase();
  if (!vinPattern.test(normalizedVin)) {
    throw new Error("Invalid VIN: expected 17 characters using letters and numbers other than I, O, or Q.");
  }

  const url = new URL(`${nhtsaVpicBaseUrl}/DecodeVinValues/${encodeURIComponent(normalizedVin)}`);
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw new Error("NHTSA VIN decode request failed because the network request could not be completed.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new Error(`NHTSA VIN decode request failed with HTTP status ${response.status}.`);
  }

  let payload: NhtsaDecodeVinResponse;
  try {
    payload = await response.json() as NhtsaDecodeVinResponse;
  } catch (error) {
    throw new Error("NHTSA VIN decode response was not valid JSON.", { cause: error });
  }

  if (!Array.isArray(payload.Results) || payload.Results.length === 0) {
    throw new Error("NHTSA VIN decode returned an empty response.");
  }

  const result = payload.Results[0];
  if (!isDecodeVinValue(result)) {
    throw new Error("NHTSA VIN decode returned an unexpected response shape.");
  }

  const errorCodes = asString(result.ErrorCode)
    ?.split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  if (errorCodes?.some((code) => code !== "0")) {
    const errorText = asString(result.ErrorText);
    throw new Error(errorText ? `Invalid VIN: ${errorText}` : "Invalid VIN: NHTSA could not decode this VIN.");
  }

  const decoded = {
    make: asString(result.Make),
    model: asString(result.Model),
    modelYear: asYear(result.ModelYear),
    bodyClass: asString(result.BodyClass),
    driveType: asString(result.DriveType),
    fuelTypePrimary: asString(result.FuelTypePrimary),
    transmissionStyle: asString(result.TransmissionStyle),
    vehicleType: asString(result.VehicleType),
  };

  if (Object.values(decoded).every((value) => value === null)) {
    throw new Error("NHTSA VIN decode returned no vehicle data.");
  }

  return decoded;
}

function isDecodeVinValue(value: unknown): value is NhtsaDecodeVinValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function asYear(value: unknown) {
  const normalized = asString(value);
  if (!normalized) return null;
  const year = Number(normalized);
  return Number.isInteger(year) && year >= 1886 ? year : null;
}
