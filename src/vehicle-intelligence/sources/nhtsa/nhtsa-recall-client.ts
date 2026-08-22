import type { NhtsaRecallLookupResult, NhtsaRecallRecord } from "../../../../types/nhtsaReliabilityEvidence";
import {
  createNhtsaVehicleIssueUrl,
  parseBoolean,
  parseInteger,
  parseText,
  requestNhtsaDefectRecords,
  sourceValueRecord,
} from "./nhtsa-defect-http";

export async function getRecallsByVehicle(year: number, make: string, model: string): Promise<NhtsaRecallLookupResult> {
  const sourceUrl = createNhtsaVehicleIssueUrl("recalls", year, make, model);
  const rawRecords = await requestNhtsaDefectRecords(sourceUrl, "recalls");
  const records = deduplicate(rawRecords.map((raw) => parseRecall(raw, sourceUrl)));
  return {
    state: records.length ? "RECALL_RECORDS_FOUND" : "NO_RECALL_RECORD_FOUND",
    records,
    sourceUrl,
  };
}

function parseRecall(raw: Record<string, unknown>, sourceUrl: string): NhtsaRecallRecord {
  const campaignNumber = parseText(raw.NHTSACampaignNumber);
  const modelYear = parseInteger(raw.ModelYear);
  const make = parseText(raw.Make);
  const model = parseText(raw.Model);
  if (!campaignNumber || modelYear === null || !make || !model) {
    throw new Error("NHTSA recall record was missing campaign or vehicle identity fields.");
  }
  return {
    campaignNumber,
    manufacturer: parseText(raw.Manufacturer),
    component: parseText(raw.Component),
    summary: parseText(raw.Summary),
    consequence: parseText(raw.Consequence),
    remedy: parseText(raw.Remedy),
    notes: parseText(raw.Notes),
    reportReceivedDate: parseText(raw.ReportReceivedDate),
    modelYear,
    make,
    model,
    nhtsaActionNumber: parseText(raw.NHTSAActionNumber),
    parkIt: parseBoolean(raw.parkIt),
    parkOutside: parseBoolean(raw.parkOutSide),
    overTheAirUpdate: parseBoolean(raw.overTheAirUpdate),
    sourceUrl,
    rawFields: sourceValueRecord(raw),
  };
}

function deduplicate(records: readonly NhtsaRecallRecord[]) {
  return [...new Map(records.map((record) => [record.campaignNumber, record])).values()]
    .sort((left, right) => left.campaignNumber.localeCompare(right.campaignNumber));
}
