import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCanonicalVehicleContribution } from "../src/vehicle-intelligence/canonical-vehicle-contribution";
import { mergeCanonicalVehicleContributions } from "../src/vehicle-intelligence/canonical-vehicle-merger";
import { normalizeEpaVehicleToContribution } from "../src/vehicle-intelligence/sources/epa/epa-contribution-adapter";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import {
  normalizeDecodedVinToContribution,
  type NhtsaSourceRecord,
} from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-contribution-adapter";
import type { DecodedVin } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-client";
import {
  canonicalVehicleFieldNames,
  canonicalVehicleFieldPaths,
  canonicalVehicleSectionNames,
  type CanonicalDatum,
  type CanonicalIngestionContext,
  type CanonicalVehicleRecord,
} from "../types/canonicalVehicle";
import type { CanonicalVehicleContribution } from "../types/canonicalVehicleContribution";

const retrievedAt = "2026-08-08T12:00:00.000Z";

type VehicleFixture = {
  name: string;
  rationale: string;
  nhtsa: NhtsaSourceRecord;
  epa: EpaVehicleRecord;
  expected: {
    bodyStyle: string;
    vehicleCategory: string;
    drivetrain: string;
    transmission: string;
    fuelType: string;
    fuelEconomyUnit: "mpg" | "mpge" | "kwh_per_100_miles";
  };
};

const fixtures: VehicleFixture[] = [
  vehicleFixture({
    name: "2024 Toyota Camry",
    rationale: "The VIN-scoped identity and caller-selected EPA gasoline/FWD configuration share exact make, model, and model year.",
    vin: "4T1C11AK0RU000001",
    epaId: "47085",
    make: "Toyota",
    model: "Camry",
    bodyClass: "Sedan/Saloon",
    vehicleType: "PASSENGER CAR",
    vClass: "Midsize Cars",
    nhtsaDrive: "FWD/Front-Wheel Drive",
    epaDrive: "Front-Wheel Drive",
    nhtsaTransmission: "Automatic",
    epaTransmission: "Automatic (S8)",
    nhtsaFuel: "Gasoline",
    epaFuel: "Regular",
    epaFuel1: "Regular Gasoline",
    comb08: 26,
    fuelCost08: 2350,
    emissions: 338,
    expectedBody: "sedan",
    expectedCategory: "midsize_car",
    expectedDrive: "FWD",
    expectedTransmission: "automatic",
    expectedFuel: "gas",
    fuelEconomyUnit: "mpg",
  }),
  vehicleFixture({
    name: "2024 Toyota Prius",
    rationale: "Both records identify the same Prius hybrid/FWD/CVT configuration; the EPA size class adds category detail.",
    vin: "JTDACAAU0R3000001",
    epaId: "47110",
    make: "Toyota",
    model: "Prius",
    bodyClass: "Hatchback/Liftback/Notchback",
    vehicleType: "PASSENGER CAR",
    vClass: "Midsize Cars",
    nhtsaDrive: "FWD/Front-Wheel Drive",
    epaDrive: "Front-Wheel Drive",
    nhtsaTransmission: "Continuously Variable Transmission (CVT)",
    epaTransmission: "Automatic (variable gear ratios)",
    nhtsaFuel: "Hybrid Electric Vehicle (HEV)",
    epaFuel: "Regular Gasoline Hybrid",
    epaFuel1: "Regular Gasoline",
    comb08: 57,
    fuelCost08: 1100,
    emissions: 155,
    expectedBody: "hatchback",
    expectedCategory: "midsize_car",
    expectedDrive: "FWD",
    expectedTransmission: "cvt",
    expectedFuel: "hybrid",
    fuelEconomyUnit: "mpg",
  }),
  vehicleFixture({
    name: "2024 Nissan Leaf",
    rationale: "Both records identify the same battery-electric Leaf/FWD configuration and agree on zero tailpipe emissions.",
    vin: "1N4AZ1BV0RC000001",
    epaId: "46956",
    make: "Nissan",
    model: "Leaf",
    bodyClass: "Hatchback/Liftback/Notchback",
    vehicleType: "PASSENGER CAR",
    vClass: "Midsize Cars",
    nhtsaDrive: "FWD/Front-Wheel Drive",
    epaDrive: "Front-Wheel Drive",
    nhtsaTransmission: "Automatic",
    epaTransmission: "Automatic (A1)",
    nhtsaFuel: "Battery Electric Vehicle (BEV)",
    epaFuel: "Electricity",
    epaFuel1: "Electricity",
    comb08: 111,
    combE: 30.4,
    range: 212,
    fuelCost08: 650,
    emissions: 0,
    expectedBody: "hatchback",
    expectedCategory: "midsize_car",
    expectedDrive: "FWD",
    expectedTransmission: "automatic",
    expectedFuel: "electric",
    fuelEconomyUnit: "kwh_per_100_miles",
  }),
  vehicleFixture({
    name: "2024 Honda CR-V",
    rationale: "The exact model-year identity and matching AWD/gas/CVT claims tie the VIN decode to the selected EPA SUV configuration.",
    vin: "2HKRS4H50RH000001",
    epaId: "47125",
    make: "Honda",
    model: "CR-V",
    bodyClass: "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)",
    vehicleType: "MULTIPURPOSE PASSENGER VEHICLE (MPV)",
    vClass: "Small Sport Utility Vehicle 4WD",
    nhtsaDrive: "AWD/All-Wheel Drive",
    epaDrive: "All-Wheel Drive",
    nhtsaTransmission: "Continuously Variable Transmission (CVT)",
    epaTransmission: "Automatic (variable gear ratios)",
    nhtsaFuel: "Gasoline",
    epaFuel: "Regular",
    epaFuel1: "Regular Gasoline",
    comb08: 29,
    fuelCost08: 2100,
    emissions: 306,
    expectedBody: "suv",
    expectedCategory: "suv",
    expectedDrive: "AWD",
    expectedTransmission: "cvt",
    expectedFuel: "gas",
    fuelEconomyUnit: "mpg",
  }),
  vehicleFixture({
    name: "2024 Ford Maverick",
    rationale: "The exact model-year identity and matching FWD/gas/automatic claims identify one caller-selected compact pickup configuration.",
    vin: "3FTTW8H30RRA00001",
    epaId: "47508",
    make: "Ford",
    model: "Maverick",
    bodyClass: "Pickup",
    vehicleType: "TRUCK",
    vClass: "Small Pickup Trucks 2WD",
    nhtsaDrive: "FWD/Front-Wheel Drive",
    epaDrive: "Front-Wheel Drive",
    nhtsaTransmission: "Automatic",
    epaTransmission: "Automatic (S8)",
    nhtsaFuel: "Gasoline",
    epaFuel: "Regular",
    epaFuel1: "Regular Gasoline",
    comb08: 26,
    fuelCost08: 2350,
    emissions: 340,
    expectedBody: "truck",
    expectedCategory: "pickup",
    expectedDrive: "FWD",
    expectedTransmission: "automatic",
    expectedFuel: "gas",
    fuelEconomyUnit: "mpg",
  }),
];

const summaries = fixtures.map(runFixture);
runConflictTests(fixtures[0]);
runMissingValueTests(fixtures[0]);
assertRuntimeIsolation();

console.log("NHTSA + EPA multi-source validation passed for five caller-selected vehicle pairs.");
for (const summary of summaries) {
  console.log(
    `${summary.vehicle}: NHTSA ${summary.nhtsaKnown} known/${summary.nhtsaMissing} missing; `
    + `EPA ${summary.epaKnown} known/${summary.epaMissing} missing; `
    + `source confidence ${summary.nhtsaConfidence}/${summary.epaConfidence}; `
    + `merged ${summary.populated}/73 populated, `
    + `${summary.missing} missing, ${summary.conflicts} conflicts, ${summary.evidence} evidence; `
    + `confidence DQ ${summary.dataQuality}, EQ ${summary.evidenceQuality}, SA ${summary.sourceAgreement}.`,
  );
}

function runFixture(fixture: VehicleFixture) {
  const nhtsa = requireNhtsaContribution(fixture);
  const epa = requireEpaContribution(fixture);
  const original = clone([nhtsa, epa]);
  const merged = mergeCanonicalVehicleContributions([nhtsa, epa], { targetDataUse: "test" });
  const reversed = mergeCanonicalVehicleContributions([epa, nhtsa], { targetDataUse: "test" });

  assert.deepEqual(merged, reversed, `${fixture.name} merge must be order independent.`);
  assert.deepEqual([nhtsa, epa], original, `${fixture.name} merge must not mutate source contributions.`);
  assert.equal(merged.records.length, 1, merged.issues.map((issue) => issue.message).join("; "));
  const record = merged.records[0];
  assertCompleteRecord(record);
  assertEvidenceIntegrity(record, merged.issues);
  assert.equal(record.recordScope, "vin");
  assert.equal(record.recordId, `cvr:vin:${fixture.nhtsa.vin}`);
  assert.equal(record.identity.make.value, fixture.epa.make);
  assert.equal(record.identity.model.value, fixture.epa.model);
  assert.equal(record.identity.modelYear.value, fixture.epa.year);
  assert.equal(record.identity.bodyStyle.value, fixture.expected.bodyStyle);
  assert.equal(record.identity.vehicleCategory.value, fixture.expected.vehicleCategory);
  assert.equal(record.identity.drivetrain.value, fixture.expected.drivetrain);
  assert.equal(record.identity.transmission.value, fixture.expected.transmission);
  assert.equal(record.identity.fuelType.value, fixture.expected.fuelType);
  assert.equal(record.environment.fuelEconomy.unit, fixture.expected.fuelEconomyUnit);
  assert.equal(record.financial.fuelEnergyCost.status, "derived");
  assert.equal(record.identity.make.confidence.sourceAgreement, "agrees");
  assert.equal(record.identity.drivetrain.confidence.sourceAgreement, "agrees");
  assert.ok(record.identity.make.evidenceIds.length >= 2);
  assert.ok(record.identity.drivetrain.evidenceIds.length >= 2);
  assert.ok(record.evidence.some((item) => item.sourceType === "nhtsa" && item.sourceRecordId === fixture.nhtsa.vin));
  assert.ok(record.evidence.some((item) => item.sourceType === "epa" && item.sourceRecordId === fixture.epa.id));
  assert.ok(record.evidence.some((item) => item.sourceType === "epa" && item.observedAt === fixture.epa.modifiedOn));
  assert.ok(record.evidence.some((item) => item.sourceType === "nhtsa" && item.retrievedAt === retrievedAt));
  assert.ok(record.evidence.some((item) => item.sourceType === "nhtsa" && item.sourceClaims?.some((claim) => {
    return claim.sourceField === "Make" && claim.originalSourceValue === fixture.nhtsa.decoded.make;
  })));
  assert.ok(record.evidence.some((item) => item.sourceType === "epa" && item.sourceClaims?.some((claim) => {
    return claim.sourceField === "comb08" && claim.originalSourceValue === fixture.epa.comb08;
  })));
  assert.ok(record.evidence.every((item) => item.normalizationMethod));
  assert.ok(record.evidence.every((item) => item.dataUse === "test"));
  assert.equal(new Set(record.evidence.map((item) => item.evidenceId)).size, record.evidence.length);

  const productionAttempt = mergeCanonicalVehicleContributions([nhtsa, epa]);
  assert.equal(productionAttempt.records.length, 0, "Test evidence must not enter a production CVR.");
  assert.equal(productionAttempt.rejectedSourceRecordIds.length, 2);

  return summarize(fixture, nhtsa, epa, record);
}

function runConflictTests(base: VehicleFixture) {
  const nhtsa = requireNhtsaContribution(base);
  const conflictCases: Array<{ code: string; record: EpaVehicleRecord }> = [
    { code: "canonical_linkage_make_conflict", record: { ...base.epa, make: "Honda" } },
    { code: "canonical_linkage_model_conflict", record: { ...base.epa, model: "Corolla" } },
    { code: "canonical_linkage_model_year_conflict", record: { ...base.epa, year: 2023 } },
    { code: "canonical_linkage_drivetrain_conflict", record: { ...base.epa, drive: "All-Wheel Drive" } },
    { code: "canonical_linkage_fuel_type_conflict", record: { ...base.epa, fuelType: "Diesel", fuelType1: "Diesel" } },
    { code: "canonical_linkage_transmission_conflict", record: { ...base.epa, trany: "Manual 6-spd" } },
  ];

  for (const testCase of conflictCases) {
    const epa = requireEpaContribution({ ...base, epa: testCase.record });
    const result = mergeCanonicalVehicleContributions([nhtsa, epa], { targetDataUse: "test" });
    assert.equal(result.records.length, 0, `${testCase.code} must block an unsafe merge.`);
    assert.ok(result.issues.some((issue) => issue.code === testCase.code));
  }

  const nhtsaBodyConflict = requireNhtsaContribution({
    ...base,
    nhtsa: {
      ...base.nhtsa,
      decoded: {
        ...base.nhtsa.decoded,
        bodyClass: "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)",
        vehicleType: "Sport Utility Vehicle (SUV)",
      },
    },
  });
  const epaBodyConflict = requireEpaContribution({
    ...base,
    epa: { ...base.epa, VClass: "Small Pickup Trucks 2WD" },
  });
  const unresolved = mergeCanonicalVehicleContributions(
    [nhtsaBodyConflict, epaBodyConflict],
    { targetDataUse: "test", authorityMargin: 100 },
  );
  assert.equal(unresolved.records.length, 1);
  assert.equal(unresolved.records[0].identity.bodyStyle.value, null);
  assert.equal(unresolved.records[0].identity.bodyStyle.missingReason, "source_conflict");
  assert.equal(unresolved.records[0].identity.vehicleCategory.value, null);
  assert.equal(unresolved.records[0].identity.vehicleCategory.missingReason, "source_conflict");
  assert.ok(unresolved.issues.filter((issue) => issue.code === "canonical_field_conflict").length >= 2);
  assertEvidenceIntegrity(unresolved.records[0], unresolved.issues);
}

function runMissingValueTests(base: VehicleFixture) {
  const nhtsaMissingDrive = requireNhtsaContribution({
    ...base,
    nhtsa: { ...base.nhtsa, decoded: { ...base.nhtsa.decoded, driveType: null } },
  });
  const epa = requireEpaContribution(base);
  const driveResult = mergeCanonicalVehicleContributions([nhtsaMissingDrive, epa], { targetDataUse: "test" });
  assert.equal(driveResult.records[0].identity.drivetrain.value, "FWD");

  const nhtsaMissingCategory = requireNhtsaContribution(base);
  const categoryResult = mergeCanonicalVehicleContributions([nhtsaMissingCategory, epa], { targetDataUse: "test" });
  assert.equal(categoryResult.records[0].identity.vehicleCategory.value, "midsize_car");

  const epaMissingEmissions = requireEpaContribution({
    ...base,
    epa: { ...base.epa, co2TailpipeGpm: null },
  });
  const emissionsResult = mergeCanonicalVehicleContributions([nhtsaMissingCategory, epaMissingEmissions], { targetDataUse: "test" });
  assert.equal(emissionsResult.records[0].environment.emissions.value, null);
  assert.equal(emissionsResult.records[0].environment.emissions.missingReason, "not_available");
  assert.ok(emissionsResult.issues.some((issue) => issue.code === "canonical_field_explicitly_missing"));
}

function requireNhtsaContribution(fixture: VehicleFixture) {
  const result = normalizeDecodedVinToContribution(fixture.nhtsa, context("nhtsa", fixture.name));
  assert.ok(result.contribution, result.issues.map((issue) => issue.message).join("; "));
  assert.equal(validateCanonicalVehicleContribution(result.contribution).valid, true);
  return result.contribution;
}

function requireEpaContribution(fixture: VehicleFixture) {
  const result = normalizeEpaVehicleToContribution(fixture.epa, context("epa", fixture.name), { dataUse: "test" });
  assert.ok(result.contribution, result.issues.map((issue) => issue.message).join("; "));
  assert.equal(validateCanonicalVehicleContribution(result.contribution).valid, true);
  return result.contribution;
}

function vehicleFixture(options: {
  name: string;
  rationale: string;
  vin: string;
  epaId: string;
  make: string;
  model: string;
  bodyClass: string;
  vehicleType: string;
  vClass: string;
  nhtsaDrive: string;
  epaDrive: string;
  nhtsaTransmission: string;
  epaTransmission: string;
  nhtsaFuel: string;
  epaFuel: string;
  epaFuel1: string;
  comb08: number;
  combE?: number;
  range?: number;
  fuelCost08: number;
  emissions: number;
  expectedBody: string;
  expectedCategory: string;
  expectedDrive: string;
  expectedTransmission: string;
  expectedFuel: string;
  fuelEconomyUnit: "mpg" | "mpge" | "kwh_per_100_miles";
}): VehicleFixture {
  assert.match(options.vin, /^[A-HJ-NPR-Z0-9]{17}$/);
  const decoded: DecodedVin = {
    make: options.make.toUpperCase(),
    model: options.model,
    modelYear: 2024,
    bodyClass: options.bodyClass,
    driveType: options.nhtsaDrive,
    fuelTypePrimary: options.nhtsaFuel,
    transmissionStyle: options.nhtsaTransmission,
    vehicleType: options.vehicleType,
  };
  const epa: EpaVehicleRecord = {
    id: options.epaId,
    year: 2024,
    make: options.make,
    model: options.model,
    VClass: options.vClass,
    drive: options.epaDrive,
    trany: options.epaTransmission,
    fuelType: options.epaFuel,
    fuelType1: options.epaFuel1,
    fuelType2: null,
    comb08: options.comb08,
    ...(options.combE !== undefined ? { combE: options.combE } : {}),
    ...(options.range !== undefined ? { range: options.range } : {}),
    fuelCost08: options.fuelCost08,
    co2TailpipeGpm: options.emissions,
    createdOn: "2023-09-01T00:00:00-04:00",
    modifiedOn: "2024-01-15T00:00:00-05:00",
  };
  return {
    name: options.name,
    rationale: options.rationale,
    nhtsa: { vin: options.vin, decoded, dataUse: "test", observedAt: null },
    epa,
    expected: {
      bodyStyle: options.expectedBody,
      vehicleCategory: options.expectedCategory,
      drivetrain: options.expectedDrive,
      transmission: options.expectedTransmission,
      fuelType: options.expectedFuel,
      fuelEconomyUnit: options.fuelEconomyUnit,
    },
  };
}

function context(sourceType: "nhtsa" | "epa", name: string): CanonicalIngestionContext {
  return {
    ingestionId: `multi-source-${slug(name)}-${sourceType}`,
    retrievedAt,
    market: "US",
    sourceType,
  };
}

function summarize(
  fixture: VehicleFixture,
  nhtsa: CanonicalVehicleContribution,
  epa: CanonicalVehicleContribution,
  record: CanonicalVehicleRecord,
) {
  const recordDatums = getRecordDatums(record);
  return {
    vehicle: fixture.name,
    rationale: fixture.rationale,
    nhtsaKnown: countContribution(nhtsa, true),
    nhtsaMissing: countContribution(nhtsa, false),
    nhtsaConfidence: nhtsa.sourceConfidence.score,
    epaKnown: countContribution(epa, true),
    epaMissing: countContribution(epa, false),
    epaConfidence: epa.sourceConfidence.score,
    populated: recordDatums.filter(([, datum]) => datum.value !== null).length,
    missing: recordDatums.filter(([, datum]) => datum.value === null).length,
    conflicts: recordDatums.filter(([, datum]) => datum.missingReason === "source_conflict").length,
    explicitSourceMissing: recordDatums.filter(([, datum]) => datum.value === null && datum.missingReason !== "not_collected").length,
    evidence: record.evidence.length,
    dataQuality: record.confidence.dataQuality.value,
    evidenceQuality: record.confidence.evidenceQuality.value,
    sourceAgreement: record.confidence.sourceAgreement.value,
  };
}

function countContribution(contribution: CanonicalVehicleContribution, known: boolean) {
  return Object.values(contribution.data)
    .flatMap((section) => Object.values(section || {}))
    .filter((datum) => known ? datum.value !== null : datum.value === null)
    .length;
}

function getRecordDatums(record: CanonicalVehicleRecord) {
  return canonicalVehicleFieldPaths.map((fieldPath) => {
    const [sectionName, fieldName] = fieldPath.split(".") as [keyof CanonicalVehicleRecord, string];
    const section = record[sectionName] as unknown as Record<string, CanonicalDatum<unknown>>;
    return [fieldPath, section[fieldName]] as const;
  });
}

function assertCompleteRecord(record: CanonicalVehicleRecord) {
  assert.equal(canonicalVehicleFieldPaths.length, 73);
  for (const sectionName of canonicalVehicleSectionNames) {
    const section = record[sectionName] as unknown as Record<string, CanonicalDatum<unknown>>;
    assert.deepEqual(Object.keys(section).sort(), [...canonicalVehicleFieldNames[sectionName]].sort());
  }
}

function assertEvidenceIntegrity(record: CanonicalVehicleRecord, issues: { evidenceIds: string[] }[]) {
  const evidenceIds = new Set(record.evidence.map((item) => item.evidenceId));
  assert.equal(evidenceIds.size, record.evidence.length);
  for (const [, datum] of getRecordDatums(record)) {
    assert.ok(datum.evidenceIds.every((id) => evidenceIds.has(id)), "Canonical datum contains a dangling evidence reference.");
    if (datum.value !== null && !String(datum.estimationMethod || "").includes("Canonical merger confidence policy")) {
      assert.ok(datum.evidenceIds.length > 0, "Every populated source field must retain evidence.");
    }
  }
  assert.ok(issues.flatMap((issue) => issue.evidenceIds).every((id) => evidenceIds.has(id)));
  for (const evidence of record.evidence) {
    assert.ok(evidence.sourceRecordId);
    assert.ok(evidence.sourceUrl);
    assert.ok(evidence.sourceClaims && evidence.sourceClaims.length > 0);
  }
}

function assertRuntimeIsolation() {
  const runtimeFiles = [
    "data/vehicleCatalog.ts",
    "lib/recommendations.ts",
    "types/vehicle.ts",
    "components/VisibleIntelligenceResults.tsx",
  ];
  for (const file of runtimeFiles) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.equal(source.includes("mergeCanonicalVehicleContributions"), false, `${file} must not consume the canonical merger.`);
    assert.equal(source.includes("test_multi_source_vehicle"), false, `${file} must not import the test harness.`);
  }
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
