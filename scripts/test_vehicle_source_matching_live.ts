import vehicleCatalogData from "../data/processed/vehicleCatalog.json";
import {
  discoverAndMatchEpaCandidates,
  matchNhtsaCandidates,
} from "../src/vehicle-intelligence/vehicle-source-matching";
import type {
  CatalogVehicleMatchInput,
  NhtsaCatalogMatchCandidate,
  SourceMatchResult,
} from "../types/vehicleSourceMatch";

const targetIds = [
  "toyota-camry-2015-craigslist-carstrucks-data",
  "toyota-prius-2016-usedcarscatalog",
  "nissan-leaf-2018-craigslist-carstrucks-data",
  "honda-cr-v-2016-craigslist-carstrucks-data",
  "ford-f-150-2019-craigslist-carstrucks-data",
] as const;

const catalog = vehicleCatalogData as CatalogVehicleMatchInput[];

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const results = [];
  for (const id of targetIds) {
    const vehicle = catalog.find((item) => item.id === id);
    if (!vehicle) throw new Error(`Live matching catalog fixture ${id} was not found.`);
    const nhtsaCandidates = await getNhtsaModelCandidates(vehicle);
    const nhtsa = matchNhtsaCandidates(vehicle, nhtsaCandidates);
    const epa = await discoverAndMatchEpaCandidates(vehicle);
    results.push({
      catalog: pickCatalogIdentity(vehicle),
      nhtsaCandidateCount: nhtsa.candidates.length,
      nhtsa: summarize(nhtsa),
      epaCandidateCount: epa.candidates.length,
      epa: summarize(epa),
    });
  }
  console.log(JSON.stringify(results, null, 2));
}

async function getNhtsaModelCandidates(
  vehicle: CatalogVehicleMatchInput,
): Promise<NhtsaCatalogMatchCandidate[]> {
  const url = new URL(
    `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(vehicle.make)}/modelyear/${vehicle.year}`,
  );
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`NHTSA model request failed with HTTP status ${response.status}.`);
  const payload = await response.json() as {
    Results?: Array<{
      Make_ID?: number;
      Make_Name?: string;
      Model_ID?: number;
      Model_Name?: string;
      ModelYear?: string;
      VehicleTypeName?: string;
    }>;
  };
  return (payload.Results || []).map((item) => ({
    sourceRecordId: `nhtsa:model:${item.Make_ID || "unknown"}:${item.Model_ID || "unknown"}:${vehicle.year}`,
    vin: null,
    make: item.Make_Name || null,
    model: item.Model_Name || null,
    modelYear: Number(item.ModelYear) || vehicle.year,
    bodyClass: null,
    vehicleType: item.VehicleTypeName || null,
    driveType: null,
    fuelTypePrimary: null,
    transmissionStyle: null,
  }));
}

function summarize<Candidate>(result: SourceMatchResult<Candidate>) {
  return {
    status: result.status,
    confidence: result.confidence,
    selectedSourceRecordId: result.selectedCandidate?.sourceRecordId || null,
    plausibleCandidates: result.candidates.filter((item) => item.eligible).map((item) => ({
      sourceRecordId: item.sourceRecordId,
      confidence: item.confidence,
      matchedOn: item.matchedOn,
      conflicts: item.conflicts,
      missingComparisonFields: item.missingComparisonFields,
    })),
    matchedOn: result.matchedOn,
    conflicts: result.conflicts,
    missingComparisonFields: result.missingComparisonFields,
    rationale: result.rationale,
  };
}

function pickCatalogIdentity(vehicle: CatalogVehicleMatchInput) {
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    drivetrain: vehicle.drivetrain,
    transmission: vehicle.transmission,
  };
}
