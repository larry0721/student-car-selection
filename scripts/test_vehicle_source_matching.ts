import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  discoverAndMatchEpaCandidates,
  matchCatalogVehicleSources,
  matchEpaCandidates,
  matchNhtsaCandidates,
  sourceMatchingPolicy,
} from "../src/vehicle-intelligence/vehicle-source-matching";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import type {
  CatalogVehicleMatchInput,
  EpaCatalogSourceClient,
  NhtsaCatalogMatchCandidate,
} from "../types/vehicleSourceMatch";

const exactCases = [
  {
    name: "gasoline passenger car",
    catalog: catalog({ id: "camry", make: "Toyota", model: "Camry", bodyType: "sedan", fuelType: "gas", drivetrain: "FWD", transmission: "automatic" }),
    nhtsa: nhtsa({ id: "camry-vin", make: "TOYOTA MOTOR CORPORATION", model: "Camry", bodyClass: "Sedan/Saloon", fuel: "Gasoline", drive: "Front-Wheel Drive", transmission: "Automatic" }),
    epa: epa({ id: "1001", make: "Toyota", model: "Camry", vClass: "Midsize Cars", fuel: "Regular Gasoline", drive: "Front-Wheel Drive", transmission: "Automatic (S8)" }),
  },
  {
    name: "hybrid",
    catalog: catalog({ id: "prius", make: "Toyota", model: "Prius", bodyType: "hatchback", fuelType: "hybrid", drivetrain: "FWD", transmission: "CVT" }),
    nhtsa: nhtsa({ id: "prius-vin", make: "Toyota", model: "Prius", bodyClass: "Hatchback/Liftback", fuel: "Hybrid Electric Vehicle (HEV)", drive: "FWD", transmission: "Continuously Variable Transmission (CVT)" }),
    epa: epa({ id: "1002", make: "Toyota", model: "Prius", vClass: "Midsize Cars", fuel: "Regular Gasoline", atvType: "Hybrid", drive: "Front-Wheel Drive", transmission: "Automatic (variable gear ratios)" }),
  },
  {
    name: "battery electric",
    catalog: catalog({ id: "leaf", make: "Nissan", model: "Leaf", bodyType: "hatchback", fuelType: "electric", drivetrain: "FWD", transmission: "automatic" }),
    nhtsa: nhtsa({ id: "leaf-vin", make: "Nissan", model: "Leaf", bodyClass: "Hatchback", fuel: "Battery Electric Vehicle (BEV)", drive: "FWD", transmission: "Automatic" }),
    epa: epa({ id: "1003", make: "Nissan", model: "Leaf", vClass: "Midsize Cars", fuel: "Electricity", atvType: "EV", drive: "Front-Wheel Drive", transmission: "Automatic (A1)" }),
  },
  {
    name: "AWD SUV",
    catalog: catalog({ id: "crv", make: "Honda", model: "CR-V", bodyType: "suv", fuelType: "gas", drivetrain: "AWD", transmission: "CVT" }),
    nhtsa: nhtsa({ id: "crv-vin", make: "Honda Motor Co., Ltd.", model: "CR-V", bodyClass: "Sport Utility Vehicle (SUV)", fuel: "Gasoline", drive: "All-Wheel Drive", transmission: "CVT" }),
    epa: epa({ id: "1004", make: "Honda", model: "CR-V AWD", vClass: "Small Sport Utility Vehicle 4WD", fuel: "Regular Gasoline", drive: "All-Wheel Drive", transmission: "Automatic (variable gear ratios)" }),
  },
  {
    name: "pickup",
    catalog: catalog({ id: "maverick", make: "Ford", model: "Maverick", bodyType: "truck", fuelType: "gas", drivetrain: "FWD", transmission: "automatic" }),
    nhtsa: nhtsa({ id: "maverick-vin", make: "Ford Motor Company", model: "Maverick", bodyClass: "Pickup", fuel: "Gasoline", drive: "Front-Wheel Drive", transmission: "Automatic" }),
    epa: epa({ id: "1005", make: "Ford", model: "Maverick Pickup 2WD", vClass: "Small Pickup Trucks 2WD", fuel: "Regular Gasoline", drive: "Front-Wheel Drive", transmission: "Automatic (S8)" }),
  },
] as const;

for (const testCase of exactCases) {
  const result = matchCatalogVehicleSources(testCase.catalog, {
    nhtsa: [testCase.nhtsa],
    epa: [testCase.epa],
  });
  assert.equal(result.nhtsa.status, "exact", `${testCase.name} should exactly match NHTSA fixture identity.`);
  assert.equal(result.epa.status, "exact", `${testCase.name} should exactly match EPA fixture configuration.`);
  assert.ok(result.nhtsa.confidence >= 0.9);
  assert.ok(result.epa.confidence >= 0.9);
}

const camry = exactCases[0];
assertNotFound(
  matchEpaCandidates(camry.catalog, [{ ...camry.epa, id: "wrong-drive", drive: "All-Wheel Drive" }]),
  "drivetrain",
);
assertNotFound(
  matchEpaCandidates(exactCases[1].catalog, [{ ...exactCases[1].epa, id: "wrong-hybrid", atvType: null, fuelType: "Regular Gasoline" }]),
  "fuelType",
);
assertNotFound(
  matchEpaCandidates(exactCases[2].catalog, [{ ...exactCases[2].epa, id: "wrong-ev", atvType: null, fuelType: "Regular Gasoline", fuelType1: "Regular Gasoline" }]),
  "fuelType",
);
assertNotFound(
  matchNhtsaCandidates(camry.catalog, [{ ...camry.nhtsa, sourceRecordId: "wrong-transmission", transmissionStyle: "Manual" }]),
  "transmission",
);
assertNotFound(
  matchNhtsaCandidates(camry.catalog, [{ ...camry.nhtsa, sourceRecordId: "wrong-year", modelYear: 2023 }]),
  "modelYear",
);
assertNotFound(
  matchNhtsaCandidates(camry.catalog, [{ ...camry.nhtsa, sourceRecordId: "wrong-make", make: "Honda" }]),
  "make",
);
assertNotFound(
  matchNhtsaCandidates(catalog({ id: "corolla", make: "Toyota", model: "Corolla" }), [
    { ...camry.nhtsa, sourceRecordId: "corolla-cross", model: "Corolla Cross" },
  ]),
  "model",
);

const ambiguousTrims = matchEpaCandidates(camry.catalog, [
  { ...camry.epa, id: "camry-le", cylinders: 4, displ: 2.5 },
  { ...camry.epa, id: "camry-xse", cylinders: 6, displ: 3.5 },
]);
assert.equal(ambiguousTrims.status, "ambiguous");
assert.equal(ambiguousTrims.selectedCandidate, null);
assert.equal(ambiguousTrims.candidates.length, 2);
assert.ok(ambiguousTrims.rationale.some((item) => item.includes("trim, engine")));

const missingDrive = { ...camry.nhtsa, sourceRecordId: "camry-missing-drive", driveType: null };
const probableMissingDrive = matchNhtsaCandidates(camry.catalog, [missingDrive]);
assert.equal(probableMissingDrive.status, "probable");
assert.ok(probableMissingDrive.missingComparisonFields.includes("drivetrain"));
assert.ok(probableMissingDrive.confidence <= sourceMatchingPolicy.unresolvedImportantFieldConfidenceCap);

const probableCatalog = catalog({ ...camry.catalog, id: "probable-camry", trim: "LE" });
const probable = matchNhtsaCandidates(probableCatalog, [
  { ...missingDrive, sourceRecordId: "strong-probable", trim: "LE" },
  {
    ...missingDrive,
    sourceRecordId: "weak-probable",
    model: "Camry AWD",
    trim: null,
    bodyClass: null,
    fuelTypePrimary: null,
    transmissionStyle: null,
  },
]);
assert.equal(probable.status, "probable");
assert.equal(probable.selectedCandidate?.sourceRecordId, "strong-probable");
assert.ok((probable.candidates[0].confidence - probable.candidates[1].confidence) >= sourceMatchingPolicy.ambiguityMargin);

const closeRunnerUp = matchEpaCandidates(camry.catalog, [
  camry.epa,
  { ...camry.epa, id: "close-runner", trany: "Automatic (variable gear ratios)" },
]);
assert.equal(closeRunnerUp.status, "ambiguous");
assert.ok((closeRunnerUp.candidates[0].confidence - closeRunnerUp.candidates[1].confidence) < sourceMatchingPolicy.ambiguityMargin);

const crvMenuSuffix = matchEpaCandidates(exactCases[3].catalog, [
  { ...exactCases[3].epa, id: "crv-4wd-label", model: "CR-V 4WD" },
]);
assert.equal(crvMenuSuffix.status, "exact", "A drivetrain suffix must not break a hyphenated model identity.");

assert.equal(matchEpaCandidates(camry.catalog, []).status, "not_found");

const duplicateSourceRecord = matchNhtsaCandidates(camry.catalog, [camry.nhtsa, clone(camry.nhtsa)]);
assert.equal(duplicateSourceRecord.status, "exact");
assert.equal(duplicateSourceRecord.candidates.length, 1, "Identical normalized source records must not create false ambiguity.");

const originalCatalog = clone(camry.catalog);
const originalCandidates = clone([camry.epa, { ...camry.epa, id: "camry-second" }]);
const originalCandidatesSnapshot = clone(originalCandidates);
const ordered = matchEpaCandidates(camry.catalog, originalCandidates);
const reversed = matchEpaCandidates(camry.catalog, [...originalCandidates].reverse());
assert.deepEqual(ordered, reversed, "Candidate order must not change the result or diagnostic order.");
assert.deepEqual(camry.catalog, originalCatalog, "Matching must not mutate the catalog record.");
assert.deepEqual(originalCandidates, originalCandidatesSnapshot, "Matching must not mutate source candidates.");

const source = readFileSync(join(process.cwd(), "src/vehicle-intelligence/vehicle-source-matching.ts"), "utf8");
assert.equal(source.includes("mergeCanonicalVehicleContributions"), false, "Matching must not invoke the canonical merger.");
assert.equal(/from\s+["'][^"']*recommendations/.test(source), false, "Matching must not import recommendation code.");

runInjectedEpaWorkflow()
  .then(() => {
    console.log("Vehicle source matching passed: exact, probable, ambiguous, not-found, hard conflicts, margins, order independence, and isolation verified.");
    console.log(`Exact fixtures: ${exactCases.map((item) => item.name).join(", ")}.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

async function runInjectedEpaWorkflow() {
  const requestedIds: string[] = [];
  const fakeClient: EpaCatalogSourceClient = {
    async getMakesForYear(year) {
      assert.equal(year, camry.catalog.year);
      return [{ text: "Toyota Motor Corporation", value: "Toyota" }];
    },
    async getModelsForYearMake(year, make) {
      assert.equal(year, camry.catalog.year);
      assert.equal(make, "Toyota");
      return [
        { text: "Camry", value: "Camry" },
        { text: "Corolla Cross", value: "Corolla Cross" },
      ];
    },
    async getVehicleOptions(year, make, model) {
      assert.equal(year, camry.catalog.year);
      assert.equal(make, "Toyota");
      assert.equal(model, "Camry");
      return [
        { id: "option-fwd", label: "FWD", year, make, model },
        { id: "option-awd", label: "AWD", year, make, model },
      ];
    },
    async getVehicleById(id) {
      requestedIds.push(String(id));
      return String(id) === "option-fwd"
        ? { ...camry.epa, id: String(id) }
        : { ...camry.epa, id: String(id), drive: "All-Wheel Drive" };
    },
  };

  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("Permanent source-matching tests must not use the network.");
  };
  try {
    const result = await discoverAndMatchEpaCandidates(camry.catalog, fakeClient);
    assert.equal(result.status, "exact");
    assert.equal(result.selectedCandidate?.sourceRecordId, "option-fwd");
    assert.deepEqual(requestedIds.sort(), ["option-awd", "option-fwd"]);
    assert.equal(result.candidates.length, 2, "Every EPA option must be evaluated rather than selecting the first one.");
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function catalog(overrides: Partial<CatalogVehicleMatchInput>): CatalogVehicleMatchInput {
  return {
    id: "catalog-vehicle",
    year: 2024,
    make: "Toyota",
    model: "Camry",
    bodyType: "sedan",
    fuelType: "gas",
    drivetrain: "FWD",
    transmission: "automatic",
    ...overrides,
  };
}

function nhtsa(options: {
  id: string;
  make: string;
  model: string;
  bodyClass: string;
  fuel: string;
  drive: string;
  transmission: string;
}): NhtsaCatalogMatchCandidate {
  return {
    sourceRecordId: options.id,
    vin: options.id,
    make: options.make,
    model: options.model,
    modelYear: 2024,
    bodyClass: options.bodyClass,
    vehicleType: options.bodyClass,
    driveType: options.drive,
    fuelTypePrimary: options.fuel,
    transmissionStyle: options.transmission,
  };
}

function epa(options: {
  id: string;
  make: string;
  model: string;
  vClass: string;
  fuel: string;
  atvType?: string;
  drive: string;
  transmission: string;
}): EpaVehicleRecord {
  return {
    id: options.id,
    year: 2024,
    make: options.make,
    model: options.model,
    VClass: options.vClass,
    fuelType: options.fuel,
    fuelType1: options.fuel,
    atvType: options.atvType,
    drive: options.drive,
    trany: options.transmission,
  };
}

function assertNotFound(
  result: ReturnType<typeof matchEpaCandidates> | ReturnType<typeof matchNhtsaCandidates>,
  conflict: string,
) {
  assert.equal(result.status, "not_found");
  assert.equal(result.selectedCandidate, null);
  assert.ok(result.conflicts.some((item) => item.startsWith(`${conflict}:`)));
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
