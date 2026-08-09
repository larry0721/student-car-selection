import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCanonicalVehicleContribution } from "../src/vehicle-intelligence/canonical-vehicle-contribution";
import { mergeCanonicalVehicleContributions } from "../src/vehicle-intelligence/canonical-vehicle-merger";
import {
  epaContributionAdapter,
  normalizeEpaVehicleToContribution,
} from "../src/vehicle-intelligence/sources/epa/epa-contribution-adapter";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import type { CanonicalIngestionContext, CanonicalVehicleRecord } from "../types/canonicalVehicle";

const context: CanonicalIngestionContext = {
  ingestionId: "test-epa",
  retrievedAt: "2026-08-08T12:00:00.000Z",
  market: "US",
  sourceType: "epa",
};
let sequence = 48000;

const gasolineRecord: EpaVehicleRecord = {
  id: "47085",
  year: 2024,
  make: " Toyota ",
  model: " Camry ",
  VClass: "Midsize Cars",
  drive: "Front-Wheel Drive",
  trany: "Automatic (S8)",
  cylinders: 6,
  displ: 3.5,
  fuelType: "Regular",
  fuelType1: "Regular Gasoline",
  fuelType2: null,
  atvType: null,
  city08: 22,
  highway08: 33,
  comb08: 26,
  cityA08: 0,
  highwayA08: 0,
  combA08: 0,
  range: 0,
  rangeCity: 0,
  rangeHwy: 0,
  charge240: 0,
  charge120: 0,
  cityE: 0,
  highwayE: 0,
  combE: 0,
  fuelCost08: 2350,
  fuelCostA08: 0,
  co2: 338,
  co2TailpipeGpm: 338,
  co2TailpipeAGpm: 0,
  ghgScore: 5,
  ghgScoreA: null,
  feScore: 5,
  feScoreA: null,
  createdOn: "2023-09-19T00:00:00-04:00",
  modifiedOn: "2024-01-18T00:00:00-05:00",
};

const originalGasoline = clone(gasolineRecord);
const gasolineResult = normalize(gasolineRecord);
const gasoline = requireContribution(gasolineResult);
assert.deepEqual(gasolineRecord, originalGasoline, "EPA normalizer must not mutate its source record.");
assert.equal(gasoline.data.identity?.make?.value, "Toyota");
assert.equal(gasoline.data.identity?.model?.value, "Camry");
assert.equal(gasoline.data.identity?.modelYear?.value, 2024);
assert.equal(gasoline.data.identity?.vehicleCategory?.value, "midsize_car");
assert.equal(gasoline.data.identity?.bodyStyle?.value, null);
assert.equal(gasoline.data.identity?.bodyStyle?.missingReason, "insufficient_specificity");
assert.equal(gasoline.data.identity?.drivetrain?.value, "FWD");
assert.equal(gasoline.data.identity?.transmission?.value, "automatic");
assert.equal(gasoline.data.identity?.fuelType?.value, "gas");
assert.equal(gasoline.data.environment?.fuelEconomy?.value, 26);
assert.equal(gasoline.data.environment?.fuelEconomy?.unit, "mpg");
assert.equal(gasoline.data.environment?.emissions?.value, 338);
assert.equal(gasoline.data.environment?.emissions?.unit, "grams_co2e_per_mile");
assert.equal(gasoline.data.environment?.evRange?.value, null);
assert.equal(gasoline.data.environment?.evRange?.missingReason, "not_applicable");
assert.equal(gasoline.data.financial?.fuelEnergyCost?.value, 195.83);
assert.equal(gasoline.data.financial?.fuelEnergyCost?.unit, "usd_per_month");
assert.equal(gasoline.data.financial?.fuelEnergyCost?.status, "derived");
assert.equal(gasoline.data.financial?.fuelEnergyCost?.measurementContext?.sourceAnnualCostUsd, 2350);
assert.equal(gasoline.recordScope, "configuration");
assert.equal(gasoline.linkage.vin, null);
assert.equal(gasoline.linkage.configurationId, "fueleconomy:47085");
assert.deepEqual(gasoline.linkage.externalIds, [{ namespace: "fueleconomy_gov_vehicle_id", value: "47085" }]);
assert.equal(gasoline.source.sourceRecordId, "47085");
assert.equal(gasoline.source.sourceType, "epa");
assert.equal(gasoline.source.observedAt, gasolineRecord.modifiedOn);
assert.equal(gasoline.normalizationVersion, "fueleconomy-vehicle-1.0.0");
assert.equal(validateCanonicalVehicleContribution(gasoline).valid, true);
assert.equal("safety" in gasoline.data, false);
assert.equal("reliability" in gasoline.data, false);
assert.equal("comfort" in gasoline.data, false);
assert.equal("technology" in gasoline.data, false);
assert.ok(gasoline.issues.some((issue) => issue.code === "epa_ambiguous_vehicle_class_body_style"));
assert.ok(gasoline.issues.some((issue) => issue.code === "epa_not_applicable_ev_range"));
assert.ok(gasoline.issues.some((issue) => issue.code.includes("unsupported_destination_city08_highway08")));
assert.ok(gasoline.issues.some((issue) => issue.code.includes("unsupported_destination_ghgscore_fescore")));
assert.ok(gasoline.evidence.some((evidence) => evidence.sourceClaims.some((claim) => claim.sourceField === "highway08" && claim.originalSourceValue === 33)));
assert.ok(gasoline.evidence.some((evidence) => evidence.sourceClaims.some((claim) => claim.sourceField === "ghgScore" && claim.originalSourceValue === 5)));
assert.ok(gasoline.evidence.some((evidence) => evidence.sourceClaims.some((claim) => claim.sourceField === "feScore" && claim.originalSourceValue === 5)));
assertEvidenceIntegrity(gasoline);

const compact = requireContribution(normalize({ ...gasolineRecord, id: "compact", VClass: "Compact Cars" }, "test", true));
assert.equal(compact.data.identity?.vehicleCategory?.value, "compact_car");

const ambiguousClass = requireContribution(normalize({ ...gasolineRecord, id: "47086", VClass: "Two Seaters" }));
assert.equal(ambiguousClass.data.identity?.vehicleCategory?.value, null);
assert.equal(ambiguousClass.data.identity?.bodyStyle?.value, null);
assert.ok(ambiguousClass.issues.some((issue) => issue.code === "epa_ambiguous_vehicle_class"));

assertDrivetrain("Front-Wheel Drive", "FWD");
assertDrivetrain("Rear-Wheel Drive", "RWD");
assertDrivetrain("All-Wheel Drive", "AWD");
assertDrivetrain("Part-time 4-Wheel Drive", "4WD");
const ambiguousDrive = requireContribution(normalize({ ...gasolineRecord, id: "47087", drive: "4-Wheel or All-Wheel Drive" }));
assert.equal(ambiguousDrive.data.identity?.drivetrain?.value, null);
assert.ok(ambiguousDrive.issues.some((issue) => issue.code === "epa_ambiguous_drivetrain"));

assertTransmission("Automatic (S8)", "automatic");
assertTransmission("Manual 6-spd", "manual");
assertTransmission("Automatic (variable gear ratios)", "cvt");

const hybrid = requireContribution(normalize({
  ...gasolineRecord,
  id: "47100",
  model: "Camry Hybrid LE",
  cylinders: 4,
  displ: 2.5,
  fuelType: "Regular",
  fuelType1: "Regular Gasoline",
  fuelType2: null,
  atvType: "Hybrid",
  city08: 51,
  highway08: 53,
  comb08: 52,
  range: 0,
}));
assert.equal(hybrid.data.identity?.fuelType?.value, "hybrid");
assert.equal(hybrid.data.environment?.fuelEconomy?.value, 52);
assertEvidenceIntegrity(hybrid);

const plugInHybrid = requireContribution(normalize({
  ...gasolineRecord,
  id: "47101",
  model: "Prius Prime",
  fuelType: "Regular Gas and Electricity",
  fuelType1: "Regular Gasoline",
  fuelType2: "Electricity",
  comb08: 48,
  combE: 29,
  range: 44,
  charge240: 2.5,
}));
assert.equal(plugInHybrid.data.identity?.fuelType?.value, "plug_in_hybrid");
assert.equal(plugInHybrid.data.environment?.fuelEconomy?.value, 48);
assert.equal(plugInHybrid.data.environment?.fuelEconomy?.unit, "mpg");
assert.equal(plugInHybrid.data.environment?.evRange?.value, 44);
assert.equal("chargingSpeed" in (plugInHybrid.data.environment || {}), false);
assert.ok(plugInHybrid.issues.some((issue) => issue.code.includes("unsupported_destination_charge240")));
assert.ok(plugInHybrid.evidence.some((evidence) => evidence.sourceClaims.some((claim) => claim.sourceField === "charge240" && claim.originalSourceValue === 2.5)));
assertEvidenceIntegrity(plugInHybrid);

const electric = requireContribution(normalize({
  ...gasolineRecord,
  id: "47000",
  make: "Tesla",
  model: "Model 3 Long Range AWD",
  VClass: "Midsize Cars",
  drive: "All-Wheel Drive",
  fuelType: "Electricity",
  fuelType1: "Electricity",
  fuelType2: null,
  city08: 132,
  highway08: 120,
  comb08: 127,
  cityE: 25.5,
  highwayE: 28.1,
  combE: 26.6,
  range: 341,
  rangeCity: 354.2,
  rangeHwy: 326.1,
  charge240: 11.5,
  charge120: 0,
  fuelCost08: 700,
  co2: 0,
  co2TailpipeGpm: 0,
}));
assert.equal(electric.data.identity?.fuelType?.value, "electric");
assert.equal(electric.data.environment?.fuelEconomy?.value, 26.6);
assert.equal(electric.data.environment?.fuelEconomy?.unit, "kwh_per_100_miles");
assert.equal(electric.data.environment?.evRange?.value, 341);
assert.equal(electric.data.environment?.emissions?.value, 0, "A legitimate zero-emissions value must remain zero.");
assert.equal(electric.data.financial?.fuelEnergyCost?.value, 58.33);
assertEvidenceIntegrity(electric);

const electricMpgeFallback = requireContribution(normalize({
  ...electricSource(),
  id: "47001",
  combE: null,
  comb08: 120,
}));
assert.equal(electricMpgeFallback.data.environment?.fuelEconomy?.value, 120);
assert.equal(electricMpgeFallback.data.environment?.fuelEconomy?.unit, "mpge");

const diesel = requireContribution(normalize({
  ...gasolineRecord,
  id: "47200",
  make: "Volkswagen",
  model: "Golf Diesel",
  fuelType: "Diesel",
  fuelType1: "Diesel",
  fuelType2: null,
}));
assert.equal(diesel.data.identity?.fuelType?.value, "diesel");
assertEvidenceIntegrity(diesel);

const ambiguousFuel = requireContribution(normalize({
  ...gasolineRecord,
  id: "47201",
  model: "Dual Fuel",
  fuelType: "Regular Gas or E85",
  fuelType1: "Regular Gasoline",
  fuelType2: "E85",
}));
assert.equal(ambiguousFuel.data.identity?.fuelType?.value, null);
assert.ok(ambiguousFuel.issues.some((issue) => issue.code === "epa_ambiguous_fuel_type"));

const omittedRangeRecord = clone(electricSource());
delete omittedRangeRecord.range;
const omittedRange = requireContribution(normalize(omittedRangeRecord));
assert.equal("evRange" in (omittedRange.data.environment || {}), false, "An omitted EPA source field must stay omitted.");

const unavailableRange = requireContribution(normalize({ ...electricSource(), id: "47003", range: null }));
assert.equal(unavailableRange.data.environment?.evRange?.value, null);
assert.equal(unavailableRange.data.environment?.evRange?.missingReason, "not_available");
assert.ok(unavailableRange.issues.some((issue) => issue.code === "epa_missing_range"));

const unavailableScores = requireContribution(normalize({
  ...gasolineRecord,
  id: "47004",
  ghgScore: null,
  ghgScoreA: null,
  feScore: null,
  feScoreA: null,
}));
assert.equal("ghgScore" in (unavailableScores.data.environment || {}), false);
assert.equal("feScore" in (unavailableScores.data.environment || {}), false);
assert.ok(unavailableScores.evidence.some((evidence) => evidence.sourceClaims.some((claim) => claim.sourceField === "ghgScore" && claim.originalSourceValue === null)));

const malformedNumeric = normalize({ ...gasolineRecord, id: "47005", comb08: "bad" } as unknown as EpaVehicleRecord);
const malformedContribution = requireContribution(malformedNumeric);
assert.equal(malformedContribution.data.environment?.fuelEconomy?.value, null);
assert.equal(malformedContribution.data.environment?.fuelEconomy?.missingReason, "invalid");
assert.ok(malformedContribution.issues.some((issue) => issue.code === "epa_malformed_numeric_value"));

const fixture = requireContribution(normalize(gasolineRecord, "fixture"));
assert.equal(fixture.dataUse, "fixture");
assert.ok(fixture.evidence.every((evidence) => evidence.dataUse === "fixture"));
const fixtureMerge = mergeCanonicalVehicleContributions([fixture]);
assert.equal(fixtureMerge.records.length, 0, "Fixture EPA evidence must not enter a production CVR.");

const invalidIdentity = normalize({ ...gasolineRecord, id: "" });
assert.equal(invalidIdentity.contribution, null);
assert.ok(invalidIdentity.issues.some((issue) => issue.code === "epa_invalid_source_identity"));
const invalidYear = normalize({ ...gasolineRecord, year: 1900 });
assert.equal(invalidYear.contribution, null);
assert.ok(invalidYear.issues.some((issue) => issue.code === "epa_invalid_model_year"));
const invalidContextResult = normalizeEpaVehicleToContribution(gasolineRecord, { ...context, sourceType: "nhtsa" });
assert.equal(invalidContextResult.contribution, null);
assert.ok(invalidContextResult.issues.some((issue) => issue.code === "epa_invalid_ingestion_context"));

let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Network access is forbidden in EPA normalizer tests.");
};
try {
  requireContribution(normalize(gasolineRecord));
  assert.equal(networkCalls, 0, "Pure EPA normalization must not call any network service.");
} finally {
  globalThis.fetch = originalFetch;
}

const adapterResultPromise = epaContributionAdapter.normalize([gasolineRecord, electricSource()], context);
const invalidAdapterPromise = epaContributionAdapter.normalize([gasolineRecord], { ...context, sourceType: "nhtsa" });

// @ts-expect-error An EPA contribution is intentionally not a complete CVR.
const completeRecord: CanonicalVehicleRecord = gasoline;
void completeRecord;

const adapterSource = readFileSync(
  join(process.cwd(), "src/vehicle-intelligence/sources/epa/epa-contribution-adapter.ts"),
  "utf8",
);
assert.equal(/from\s+["'][^"']*recommendations/.test(adapterSource), false);
assert.equal(/getMakesForYear|getModelsForYearMake|getVehicleOptions|getVehicleById/.test(adapterSource), false, "Pure EPA adapter must not call the source client or select configurations.");

Promise.all([adapterResultPromise, invalidAdapterPromise])
  .then(([adapterResult, invalidAdapter]) => {
    assert.equal(adapterResult.contributions.length, 2);
    assert.deepEqual(adapterResult.rejectedSourceRecordIds, []);
    assert.equal(invalidAdapter.contributions.length, 0);
    assert.deepEqual(invalidAdapter.rejectedSourceRecordIds, ["47085"]);
    assert.ok(invalidAdapter.issues.some((issue) => issue.code === "epa_invalid_ingestion_context"));
    console.log("EPA contribution adapter passed: identity, powertrain, efficiency, cost, emissions, evidence, missingness, and isolation verified.");
    console.log(`Camry fixture: ${countPopulated(gasoline)} canonical values, ${gasoline.issues.length} typed issues, ${gasoline.evidence.length} evidence records, source confidence ${gasoline.sourceConfidence.score}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

function normalize(
  record: EpaVehicleRecord,
  dataUse: "production" | "fixture" | "test" = "test",
  allowInvalidId = false,
) {
  const adjusted = allowInvalidId && !/^\d+$/.test(record.id) ? { ...record, id: "47099" } : record;
  return normalizeEpaVehicleToContribution(adjusted, context, { dataUse });
}

function requireContribution(result: ReturnType<typeof normalizeEpaVehicleToContribution>) {
  assert.ok(result.contribution, result.issues.map((issue) => issue.message).join("; "));
  assert.equal(validateCanonicalVehicleContribution(result.contribution).valid, true);
  return result.contribution;
}

function assertDrivetrain(source: string, expected: string) {
  const contribution = requireContribution(normalize({ ...gasolineRecord, id: nextId(), drive: source }));
  assert.equal(contribution.data.identity?.drivetrain?.value, expected);
}

function assertTransmission(source: string, expected: string) {
  const contribution = requireContribution(normalize({ ...gasolineRecord, id: nextId(), trany: source }));
  assert.equal(contribution.data.identity?.transmission?.value, expected);
}

function assertEvidenceIntegrity(contribution: NonNullable<ReturnType<typeof normalize>["contribution"]>) {
  const ids = new Set(contribution.evidence.map((evidence) => evidence.evidenceId));
  for (const section of Object.values(contribution.data)) {
    for (const datum of Object.values(section || {})) {
      const references = datum.value === null ? datum.attemptEvidenceIds : datum.evidenceIds;
      assert.ok(references.length > 0);
      assert.ok(references.every((id: string) => ids.has(id)));
      if (datum.value !== null) assert.notEqual(datum.unit, undefined);
    }
  }
  for (const issue of contribution.issues) {
    assert.ok(issue.evidenceIds.every((id) => ids.has(id)));
  }
  assert.ok(contribution.evidence.some((evidence) => evidence.sourceClaims.some((claim) => claim.sourceField === "city08")));
  assert.ok(contribution.evidence.some((evidence) => evidence.normalizationMethod === "mapped" && evidence.sourceClaims.some((claim) => claim.sourceField === "trany")));
}

function electricSource(): EpaVehicleRecord {
  return {
    ...gasolineRecord,
    id: "47002",
    make: "Tesla",
    model: "Model 3 Long Range AWD",
    drive: "All-Wheel Drive",
    fuelType: "Electricity",
    fuelType1: "Electricity",
    fuelType2: null,
    comb08: 127,
    combE: 26.6,
    range: 341,
    charge240: 11.5,
    fuelCost08: 700,
    co2: 0,
    co2TailpipeGpm: 0,
  };
}

function nextId() {
  sequence += 1;
  return String(sequence);
}

function countPopulated(contribution: NonNullable<ReturnType<typeof normalize>["contribution"]>) {
  return Object.values(contribution.data)
    .flatMap((section) => Object.values(section || {}))
    .filter((datum) => datum.value !== null)
    .length;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
