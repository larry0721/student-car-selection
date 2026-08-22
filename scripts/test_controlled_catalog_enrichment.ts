import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vehicleCatalogData from "../data/processed/vehicleCatalog.json";
import {
  runControlledCatalogEnrichment,
  runControlledCatalogEnrichmentBatch,
  selectControlledEnrichmentGoldenSet,
  type ControlledEnrichmentSourceProvider,
} from "../src/vehicle-intelligence/controlled-catalog-enrichment";
import { getModelsForMakeYear } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-client";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import type { Vehicle } from "../types/vehicle";
import type {
  NhtsaCatalogMatchCandidate,
  SourceMatchCandidateAssessment,
  SourceMatchResult,
} from "../types/vehicleSourceMatch";

const retrievedAt = "2026-08-08T20:00:00.000Z";
const catalog = vehicleCatalogData as Vehicle[];
const goldenSet = selectControlledEnrichmentGoldenSet(catalog);
assert.equal(goldenSet.length, 12);
assert.deepEqual(goldenSet.map((item) => item.criterion), [
  "gasoline_sedan",
  "hybrid",
  "battery_electric",
  "awd_crossover",
  "pickup_truck",
  "compact_economy",
  "compact_sedan",
  "family_suv",
  "hybrid_crossover",
  "powertrain_anomaly",
  "drivetrain_anomaly",
  "identity_anomaly",
]);
assert.deepEqual(goldenSet.map((item) => item.vehicle.id), [
  "toyota-camry-2015-craigslist-carstrucks-data",
  "toyota-prius-2016-craigslist-carstrucks-data",
  "nissan-leaf-2018-craigslist-carstrucks-data",
  "honda-cr-v-2016-craigslist-carstrucks-data",
  "ford-f-150-2019-craigslist-carstrucks-data",
  "toyota-yaris-2017-craigslist-carstrucks-data",
  "toyota-corolla-2015-craigslist-carstrucks-data",
  "toyota-rav4-2016-craigslist-carstrucks-data",
  "kia-niro-2017-craigslist-carstrucks-data",
  "chevrolet-volt-2017-craigslist-carstrucks-data",
  "toyota-tacoma-2017-craigslist-carstrucks-data",
  "toyota-yari-2017-craigslist-carstrucks-data",
]);

const camry = goldenSet[0].vehicle;
const corolla = goldenSet[6].vehicle;
const originalFetch = globalThis.fetch;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});

async function run() {
  await testNhtsaModelClientWithMockedNetwork();
  let unexpectedNetworkCalls = 0;
  globalThis.fetch = async () => {
    unexpectedNetworkCalls += 1;
    throw new Error("Controlled enrichment unit tests must not use live network access.");
  };

  const exactBoth = await enrich(camry, provider("exact", "exact"));
  assert.equal(exactBoth.status, "enriched");
  assert.ok(exactBoth.canonicalRecord);
  assert.deepEqual(exactBoth.enrichmentSummary.acceptedSources, ["epa", "nhtsa"]);
  assert.equal(exactBoth.evidenceSummary.canonicalFieldCount, 73);
  assert.equal(exactBoth.evidenceSummary.populatedFieldCount + exactBoth.evidenceSummary.missingFieldCount, 73);
  assert.ok(exactBoth.evidenceSummary.evidenceCount >= 4);
  assert.equal(exactBoth.integrity.allCanonicalFieldsPresent, true);
  assert.equal(exactBoth.integrity.everyPopulatedFieldHasEvidence, true);
  assert.equal(exactBoth.integrity.fixtureEvidenceRejected, true);
  assert.equal(exactBoth.integrity.onlyAutoEnrichSourcesMerged, true);
  assert.equal(exactBoth.integrity.sourceMetadataPreserved, true);

  const exactEpaProbableNhtsa = await enrich(camry, provider("probable", "exact"));
  assert.equal(exactEpaProbableNhtsa.status, "review_required");
  assert.ok(exactEpaProbableNhtsa.canonicalRecord);
  assert.deepEqual(exactEpaProbableNhtsa.enrichmentSummary.acceptedSources, ["epa"]);
  assert.deepEqual(exactEpaProbableNhtsa.enrichmentSummary.reviewRequiredSources, ["nhtsa"]);
  assert.equal(exactEpaProbableNhtsa.enrichmentSummary.partial, true);
  assert.equal(exactEpaProbableNhtsa.contributions.accepted.length, 1);
  assert.equal(exactEpaProbableNhtsa.contributions.accepted[0].source.sourceType, "epa");

  const exactNhtsaAmbiguousEpa = await enrich(camry, provider("exact", "ambiguous"));
  assert.equal(exactNhtsaAmbiguousEpa.status, "deferred");
  assert.ok(exactNhtsaAmbiguousEpa.canonicalRecord);
  assert.deepEqual(exactNhtsaAmbiguousEpa.enrichmentSummary.acceptedSources, ["nhtsa"]);
  assert.deepEqual(exactNhtsaAmbiguousEpa.enrichmentSummary.deferredSources, ["epa"]);
  assert.equal(exactNhtsaAmbiguousEpa.sourceMatches.epa?.selectedCandidate, null);
  assert.equal(exactNhtsaAmbiguousEpa.contributions.dispositions.find((item) => item.source === "epa")?.disposition, "withheld");

  const probable = await enrich(camry, provider("probable", "not_found"));
  assert.equal(probable.status, "review_required");
  assert.equal(probable.canonicalRecord, null);
  assert.equal(probable.enrichmentDecisions.nhtsa?.action, "REVIEW_REQUIRED");

  const ambiguous = await enrich(camry, provider("not_found", "ambiguous"));
  assert.equal(ambiguous.status, "deferred");
  assert.equal(ambiguous.canonicalRecord, null);
  assert.equal(ambiguous.sourceMatches.epa?.selectedCandidate, null);
  assert.equal(ambiguous.contributions.accepted.length, 0);

  const skipped = await enrich(camry, provider("not_found", "not_found"));
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.canonicalRecord, null);
  assert.deepEqual(skipped.enrichmentSummary.skippedSources, ["nhtsa", "epa"]);

  const input = clone(camry);
  const inputSnapshot = clone(input);
  await enrich(input, provider("exact", "exact"));
  assert.deepEqual(input, inputSnapshot, "Orchestration must not mutate catalog input.");

  const fixtureRejected = await runControlledCatalogEnrichment(camry, {
    sourceProvider: provider("exact", "not_found"),
    retrievedAt,
    catalogUniverse: catalog,
    sourceDataUse: "fixture",
  });
  assert.equal(fixtureRejected.status, "failed");
  assert.equal(fixtureRejected.canonicalRecord, null);
  assert.equal(fixtureRejected.contributions.accepted.length, 0);
  assert.equal(fixtureRejected.contributions.dispositions.find((item) => item.source === "nhtsa")?.disposition, "rejected");
  assert.ok(fixtureRejected.mergerIssues.some((issue) => issue.code === "canonical_merge_data_use_rejected"));

  assert.deepEqual(exactBoth.orchestrationTrace.map((step) => `${step.stage}:${step.source ?? "all"}`), [
    "catalog_snapshot:all",
    "source_match:nhtsa",
    "source_match:epa",
    "enrichment_policy:nhtsa",
    "enrichment_policy:epa",
    "contribution_adapter:nhtsa",
    "contribution_adapter:epa",
    "canonical_merger:all",
    "integrity_check:all",
  ]);
  assert.deepEqual(exactBoth, await enrich(camry, provider("exact", "exact")), "Fixed inputs and time must be deterministic.");

  const batchForward = await runControlledCatalogEnrichmentBatch([camry, corolla], {
    sourceProvider: dynamicExactProvider(),
    retrievedAt,
    catalogUniverse: catalog,
  });
  const batchReverse = await runControlledCatalogEnrichmentBatch([corolla, camry], {
    sourceProvider: dynamicExactProvider(),
    retrievedAt,
    catalogUniverse: catalog,
  });
  assert.deepEqual(batchForward, batchReverse, "Input order must not change meaningful batch output.");
  assert.equal(batchForward.productionCatalogMutated, false);
  assert.equal(batchForward.stagingBoundary, "runtime_only");

  const duplicateIdentityVehicle = goldenSet.find((item) => item.criterion === "hybrid")?.vehicle;
  assert.ok(duplicateIdentityVehicle);
  const duplicateIdentityResult = await enrich(duplicateIdentityVehicle, provider("not_found", "not_found"));
  assert.ok(duplicateIdentityResult.catalogDataIssues.some((issue) => issue.kind === "duplicate_identity"));
  const drivetrainAnomaly = goldenSet.find((item) => item.criterion === "drivetrain_anomaly")?.vehicle;
  assert.ok(drivetrainAnomaly);
  const anomalyResult = await enrich(drivetrainAnomaly, provider("not_found", "not_found"));
  assert.ok(anomalyResult.catalogDataIssues.some((issue) => issue.field === "drivetrain"));

  const source = readFileSync(join(process.cwd(), "src/vehicle-intelligence/controlled-catalog-enrichment.ts"), "utf8");
  for (const requiredCall of [
    "matchNhtsaCandidates",
    "discoverAndMatchEpaCandidates",
    "decideEnrichment",
    "nhtsaContributionAdapter.normalize",
    "epaContributionAdapter.normalize",
    "mergeCanonicalVehicleContributions",
  ]) {
    assert.ok(source.includes(requiredCall), `Orchestrator must use ${requiredCall}.`);
  }
  assert.equal(/from\s+["'][^"']*recommendations/.test(source), false, "Orchestrator must not import recommendation code.");
  assert.equal(source.includes("vehicleCatalogData"), false, "Orchestrator must not import or overwrite the production catalog.");
  assert.equal(unexpectedNetworkCalls, 0);

  console.log("Controlled catalog enrichment passed: staged CVRs, policy gates, partial enrichment, evidence integrity, fixture rejection, anomaly reporting, order, and isolation verified.");
  console.log(`Golden set: ${goldenSet.map((item) => `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`).join("; ")}.`);
}

async function testNhtsaModelClientWithMockedNetwork() {
  globalThis.fetch = async () => new Response(JSON.stringify({
    Results: [{
      Make_ID: 448,
      Make_Name: "Toyota",
      Model_ID: 2469,
      Model_Name: "Camry",
      ModelYear: "2015",
      VehicleTypeName: "PASSENGER CAR",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  const models = await getModelsForMakeYear("Toyota", 2015);
  assert.deepEqual(models, [{
    makeId: 448,
    makeName: "Toyota",
    modelId: 2469,
    modelName: "Camry",
    modelYear: 2015,
    vehicleTypeName: "PASSENGER CAR",
  }]);
}

async function enrich(
  vehicle: Vehicle,
  sourceProvider: ControlledEnrichmentSourceProvider,
) {
  return runControlledCatalogEnrichment(vehicle, {
    sourceProvider,
    retrievedAt,
    catalogUniverse: catalog,
  });
}

function provider(
  nhtsaStatus: SourceMatchResult<unknown>["status"],
  epaStatus: SourceMatchResult<unknown>["status"],
): ControlledEnrichmentSourceProvider {
  return {
    async matchNhtsa(vehicle) {
      return nhtsaResult(vehicle, nhtsaStatus);
    },
    async matchEpa(vehicle) {
      return epaResult(vehicle, epaStatus);
    },
  };
}

function dynamicExactProvider(): ControlledEnrichmentSourceProvider {
  return provider("exact", "exact");
}

function nhtsaResult(
  vehicle: { year: number; make: string; model: string; bodyType: string; fuelType: string; drivetrain: string; transmission: string },
  status: SourceMatchResult<unknown>["status"],
): SourceMatchResult<NhtsaCatalogMatchCandidate> {
  const candidate: NhtsaCatalogMatchCandidate = {
    sourceRecordId: "1HGCM82633A004352",
    vin: "1HGCM82633A004352",
    make: vehicle.make,
    model: vehicle.model,
    modelYear: vehicle.year,
    bodyClass: bodyClass(vehicle.bodyType),
    vehicleType: vehicle.bodyType === "truck" ? "TRUCK" : "PASSENGER CAR",
    driveType: drive(vehicle.drivetrain),
    fuelTypePrimary: fuel(vehicle.fuelType),
    transmissionStyle: transmission(vehicle.transmission),
  };
  return matchResult("nhtsa", status, candidate, "nhtsa-second");
}

function epaResult(
  vehicle: { year: number; make: string; model: string; bodyType: string; fuelType: string; drivetrain: string; transmission: string },
  status: SourceMatchResult<unknown>["status"],
): SourceMatchResult<EpaVehicleRecord> {
  const candidate: EpaVehicleRecord = {
    id: vehicle.model === "Corolla" ? "2002" : "2001",
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    VClass: vehicle.bodyType === "suv" ? "Small Sport Utility Vehicle 2WD" : "Midsize Cars",
    drive: drive(vehicle.drivetrain),
    trany: transmission(vehicle.transmission),
    fuelType: fuel(vehicle.fuelType),
    fuelType1: fuel(vehicle.fuelType),
    atvType: vehicle.fuelType === "hybrid" ? "Hybrid" : vehicle.fuelType === "electric" ? "EV" : null,
    cylinders: vehicle.fuelType === "electric" ? null : 4,
    displ: vehicle.fuelType === "electric" ? null : 2.5,
    city08: vehicle.fuelType === "electric" ? 110 : 25,
    highway08: vehicle.fuelType === "electric" ? 95 : 35,
    comb08: vehicle.fuelType === "electric" ? 103 : 29,
    fuelCost08: 1200,
    co2TailpipeGpm: vehicle.fuelType === "electric" ? 0 : 310,
    createdOn: "2026-01-01",
    modifiedOn: "2026-02-01",
  };
  return matchResult("epa", status, candidate, "2009");
}

function matchResult<Candidate>(
  source: "nhtsa" | "epa",
  status: SourceMatchResult<unknown>["status"],
  candidate: Candidate,
  secondId: string,
): SourceMatchResult<Candidate> {
  if (status === "not_found") {
    return {
      status,
      source,
      selectedCandidate: null,
      candidates: [],
      confidence: 0,
      matchedOn: [],
      conflicts: [],
      missingComparisonFields: [],
      rationale: ["No compatible source record."],
    };
  }
  const primary = assessment(sourceRecordId(candidate), candidate, status === "probable" ? 0.82 : 0.96);
  const candidates = status === "ambiguous"
    ? [primary, assessment(secondId, clone(candidate), 0.94)]
    : [primary];
  return {
    status,
    source,
    selectedCandidate: status === "ambiguous" ? null : primary,
    candidates,
    confidence: status === "exact" ? 0.96 : status === "probable" ? 0.82 : 0.69,
    matchedOn: ["modelYear", "make", "model", "fuelType", "drivetrain", "transmission"],
    conflicts: [],
    missingComparisonFields: status === "probable" ? ["bodyStyle"] : status === "ambiguous" ? ["trim", "engineDisplacement"] : [],
    rationale: status === "ambiguous" ? ["Two configurations remain plausible."] : ["Deterministic test match."],
  };
}

function assessment<Candidate>(
  sourceRecordId: string,
  candidate: Candidate,
  confidence: number,
): SourceMatchCandidateAssessment<Candidate> {
  return {
    sourceRecordId,
    candidate,
    eligible: true,
    confidence,
    matchedOn: ["modelYear", "make", "model", "fuelType", "drivetrain", "transmission"],
    conflicts: [],
    missingComparisonFields: [],
    rationale: [],
  };
}

function sourceRecordId(candidate: unknown) {
  if (candidate && typeof candidate === "object") {
    if ("sourceRecordId" in candidate && typeof candidate.sourceRecordId === "string") return candidate.sourceRecordId;
    if ("id" in candidate && typeof candidate.id === "string") return candidate.id;
  }
  return "unknown";
}

function bodyClass(bodyType: string) {
  if (bodyType === "suv") return "Sport Utility Vehicle (SUV)";
  if (bodyType === "truck") return "Pickup";
  if (bodyType === "hatchback") return "Hatchback/Liftback";
  return "Sedan/Saloon";
}

function drive(value: string) {
  return ({ FWD: "Front-Wheel Drive", AWD: "All-Wheel Drive", RWD: "Rear-Wheel Drive", "4WD": "Four-Wheel Drive" } as Record<string, string>)[value] ?? value;
}

function fuel(value: string) {
  if (value === "hybrid") return "Hybrid Electric Vehicle (HEV)";
  if (value === "electric") return "Electricity";
  if (value === "diesel") return "Diesel";
  return "Regular Gasoline";
}

function transmission(value: string) {
  return value === "manual" ? "Manual" : value === "CVT" ? "Continuously Variable Transmission (CVT)" : "Automatic (S8)";
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
