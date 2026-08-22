import type { NhtsaComplaintLookupResult, NhtsaComplaintRecord } from "../../../../types/nhtsaReliabilityEvidence";
import {
  createNhtsaVehicleIssueUrl,
  parseBoolean,
  parseInteger,
  parseText,
  requestNhtsaDefectRecords,
  sourceValueRecord,
} from "./nhtsa-defect-http";

export async function getComplaintsByVehicle(year: number, make: string, model: string): Promise<NhtsaComplaintLookupResult> {
  const sourceUrl = createNhtsaVehicleIssueUrl("complaints", year, make, model);
  const rawRecords = await requestNhtsaDefectRecords(sourceUrl, "complaints");
  const records = deduplicate(rawRecords.map((raw) => parseComplaint(raw, sourceUrl, year, make, model)));
  return {
    state: records.length ? "COMPLAINT_RECORDS_FOUND" : "NO_COMPLAINT_RECORD_FOUND",
    records,
    sourceUrl,
  };
}

function parseComplaint(
  raw: Record<string, unknown>,
  sourceUrl: string,
  requestedYear: number,
  requestedMake: string,
  requestedModel: string,
): NhtsaComplaintRecord {
  const odi = parseInteger(raw.odiNumber) ?? parseInteger(raw.ODINumber);
  if (odi === null || odi <= 0) throw new Error("NHTSA complaint record was missing a valid ODI number.");
  const product = getVehicleProduct(raw.products);
  return {
    odiNumber: String(odi),
    manufacturer: parseText(raw.manufacturer),
    incidentDate: parseText(raw.dateOfIncident),
    complaintFiledDate: parseText(raw.dateComplaintFiled),
    component: parseText(raw.components),
    summary: parseText(raw.summary),
    crashReported: parseBoolean(raw.crash) ?? false,
    fireReported: parseBoolean(raw.fire) ?? false,
    injuries: nonNegativeInteger(raw.numberOfInjuries),
    deaths: nonNegativeInteger(raw.numberOfDeaths),
    mileage: nullableNonNegativeInteger(raw.mileage),
    vehicleSpeed: nullableNonNegativeInteger(raw.vehicleSpeed),
    modelYear: parseInteger(product?.productYear) ?? requestedYear,
    make: parseText(product?.productMake) ?? requestedMake,
    model: parseText(product?.productModel) ?? requestedModel,
    sourceUrl,
    rawFields: sourceValueRecord(raw),
  };
}

function getVehicleProduct(value: unknown) {
  if (!Array.isArray(value)) return null;
  const record = value.find((item) => isObject(item) && String(item.type).toLowerCase() === "vehicle");
  return isObject(record) ? record : null;
}

function nonNegativeInteger(value: unknown) {
  return nullableNonNegativeInteger(value) ?? 0;
}

function nullableNonNegativeInteger(value: unknown) {
  const parsed = parseInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function deduplicate(records: readonly NhtsaComplaintRecord[]) {
  return [...new Map(records.map((record) => [record.odiNumber, record])).values()]
    .sort((left, right) => left.odiNumber.localeCompare(right.odiNumber));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
