import type { VehicleDataImportResult, VehicleDataOverlay } from "@/types/data";

const supportedColumns = new Set([
  "make",
  "model",
  "year",
  "reliability",
  "reliabilityscore",
  "safety",
  "safetyscore",
  "insurance",
  "insurancemonthly",
  "maintenance",
  "maintenancemonthly",
  "mpg",
  "commonissues",
  "imageurl",
  "listingurl",
]);

export function parseVehicleScoreCsv(csvText: string): VehicleDataImportResult {
  const rows = parseCsv(csvText);
  const warnings: string[] = [];
  if (rows.length < 2) return { overlays: [], warnings: ["CSV file did not include any data rows."] };

  const headers = rows[0].map(normalizeHeader);
  const unknownHeaders = headers.filter((header) => header && !supportedColumns.has(header));
  if (unknownHeaders.length) warnings.push(`Ignored unsupported columns: ${unknownHeaders.join(", ")}.`);

  const overlays = rows.slice(1).flatMap((row, index) => {
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, row[cellIndex] || ""]));
    const make = record.make?.trim();
    const model = record.model?.trim();

    if (!make || !model) {
      warnings.push(`Row ${index + 2} skipped because make or model is missing.`);
      return [];
    }

    return [
      {
        make,
        model,
        year: toNumber(record.year),
        source: "csv-import",
        reliabilityScore: toNumber(record.reliability || record.reliabilityscore),
        safetyScore: toNumber(record.safety || record.safetyscore),
        insuranceMonthly: toNumber(record.insurance || record.insurancemonthly),
        maintenanceMonthly: toNumber(record.maintenance || record.maintenancemonthly),
        mpg: toNumber(record.mpg),
        commonIssues: splitList(record.commonissues),
        imageUrl: record.imageurl?.trim() || undefined,
        imageSource: record.imageurl?.trim() ? "csv-import" : undefined,
        imageVerified: Boolean(record.imageurl?.trim()),
        listingUrl: record.listingurl?.trim() || undefined,
        fetchedAt: new Date().toISOString(),
      } satisfies VehicleDataOverlay,
    ];
  });

  return { overlays, warnings };
}

function parseCsv(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === "\"" && nextChar === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function toNumber(value?: string) {
  if (!value) return undefined;
  const numberValue = Number(value.replace(/[$,%]/g, ""));
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function splitList(value?: string) {
  return value
    ? value
        .split(/[;|]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}
