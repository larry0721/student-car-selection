import assert from "node:assert/strict";
import { validateCanonicalVehicleContribution } from "../src/vehicle-intelligence/canonical-vehicle-contribution";
import {
  nhtsaContributionAdapter,
  normalizeDecodedVinToContribution,
  type NhtsaSourceRecord,
} from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-contribution-adapter";
import type { DecodedVin } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-client";
import type { CanonicalIngestionContext, CanonicalVehicleRecord } from "../types/canonicalVehicle";

const vin = "1HGCM82633A004352";
const context: CanonicalIngestionContext = {
  ingestionId: "test-nhtsa",
  retrievedAt: "2026-08-07T12:00:00.000Z",
  market: "US",
  sourceType: "nhtsa",
};
const accordDecoded: DecodedVin = {
  make: "HONDA",
  model: " Accord ",
  modelYear: 2003,
  bodyClass: "Coupe",
  driveType: "FWD/Front-Wheel Drive",
  fuelTypePrimary: "Gasoline",
  transmissionStyle: "Automatic",
  vehicleType: "PASSENGER CAR",
};

const originalInput = clone(accordDecoded);
const accordResult = normalize(accordDecoded);
const accord = requireContribution(accordResult);
assert.deepEqual(accordDecoded, originalInput, "Normalizer must not mutate DecodedVin input.");
assert.equal(accord.data.identity?.make?.value, "Honda");
assert.equal(accord.data.identity?.model?.value, "Accord");
assert.equal(accord.data.identity?.modelYear?.value, 2003);
assert.equal(accord.data.identity?.bodyStyle?.value, "coupe");
assert.equal(accord.data.identity?.drivetrain?.value, "FWD");
assert.equal(accord.data.identity?.fuelType?.value, "gas");
assert.equal(accord.data.identity?.transmission?.value, "automatic");
assert.equal(accord.data.identity?.vehicleCategory?.status, "missing");
assert.ok(accord.issues.some((issue) => issue.code === "nhtsa_vehicle_type_too_broad"));
assert.equal(accord.linkage.vin, vin);
assert.equal(accord.source.providerName, "NHTSA vPIC");
assert.equal(accord.source.sourceRecordId, vin);
assert.equal(accord.source.retrievedAt, context.retrievedAt);
assert.equal(accord.sourceMetadata.dataset, "vPIC");
assert.deepEqual(Object.keys(accord.data), ["identity"]);
assert.equal("financial" in accord.data, false);
assert.equal("safety" in accord.data, false);
assert.equal("reliability" in accord.data, false);
assert.equal(validateCanonicalVehicleContribution(accord).valid, true);

assertMapping({ driveType: "AWD/All-Wheel Drive" }, "drivetrain", "AWD");
assertMapping({ driveType: "4WD/4-Wheel Drive/4x4" }, "drivetrain", "4WD");
assertMapping({ fuelTypePrimary: "Battery Electric Vehicle (BEV)" }, "fuelType", "electric");
assertMapping({ transmissionStyle: "Manual" }, "transmission", "manual");
assertMapping({ transmissionStyle: "Continuously Variable Transmission (CVT)" }, "transmission", "cvt");
assertMapping({ bodyClass: "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)" }, "bodyStyle", "suv");
assertMapping({ bodyClass: "Pickup" }, "bodyStyle", "truck");

const fordMake = requireContribution(normalize({ ...accordDecoded, make: "FORD" }));
assert.equal(fordMake.data.identity?.make?.value, "Ford");
const acronymMake = requireContribution(normalize({ ...accordDecoded, make: "BMW" }));
assert.equal(acronymMake.data.identity?.make?.value, "BMW");

const unsupportedNaturalGas = requireContribution(normalize({ ...accordDecoded, fuelTypePrimary: "Compressed Natural Gas (CNG)" }));
assert.equal(unsupportedNaturalGas.data.identity?.fuelType?.value, null);
assert.ok(unsupportedNaturalGas.issues.some((issue) => issue.code === "nhtsa_unsupported_fuel_type_primary"));

const emptyDrive = requireContribution(normalize({ ...accordDecoded, driveType: null }));
assert.equal(emptyDrive.data.identity?.drivetrain?.status, "missing");
assert.equal(emptyDrive.data.identity?.drivetrain?.missingReason, "not_available");
assert.deepEqual(emptyDrive.data.identity?.drivetrain?.evidenceIds, []);
assert.deepEqual(emptyDrive.data.identity?.drivetrain?.attemptEvidenceIds, ["test-nhtsa:nhtsa-vpic:1HGCM82633A004352:mapped"]);
assert.ok(emptyDrive.issues.some((issue) => issue.code === "nhtsa_missing_drive_type"));

const unknownDrive = requireContribution(normalize({ ...accordDecoded, driveType: "Quantum Drive" }));
assert.equal(unknownDrive.data.identity?.drivetrain?.value, null);
assert.equal(unknownDrive.data.identity?.drivetrain?.missingReason, "unsupported");
assert.ok(unknownDrive.issues.some((issue) => issue.code === "nhtsa_unsupported_drive_type"));

const ambiguousDrive = requireContribution(normalize({ ...accordDecoded, driveType: "4x2" }));
assert.equal(ambiguousDrive.data.identity?.drivetrain?.value, null);
assert.ok(ambiguousDrive.issues.some((issue) => issue.kind === "ambiguous_mapping"));

const ambiguousFuel = requireContribution(normalize({ ...accordDecoded, fuelTypePrimary: "Electric and Gasoline" }));
assert.equal(ambiguousFuel.data.identity?.fuelType?.value, null);
assert.ok(ambiguousFuel.issues.some((issue) => issue.code === "nhtsa_ambiguous_fuel_type_primary"));

const unknownBody = requireContribution(normalize({ ...accordDecoded, bodyClass: "Three Wheel Vehicle" }));
assert.equal(unknownBody.data.identity?.bodyStyle?.value, null);
assert.ok(unknownBody.issues.some((issue) => issue.code === "nhtsa_unsupported_body_class"));

const invalidYear = requireContribution(normalize({ ...accordDecoded, modelYear: 9999 }));
assert.equal(invalidYear.data.identity?.modelYear?.value, null);
assert.equal(invalidYear.data.identity?.modelYear?.missingReason, "invalid");
assert.ok(invalidYear.issues.some((issue) => issue.code === "nhtsa_invalid_model_year"));

const directEvidence = accord.evidence.find((evidence) => evidence.normalizationMethod === "direct");
const mappedEvidence = accord.evidence.find((evidence) => evidence.normalizationMethod === "mapped");
assert.ok(directEvidence);
assert.ok(mappedEvidence);
assert.ok(directEvidence.sourceClaims.some((claim) => claim.sourceField === "Make" && claim.originalSourceValue === "HONDA"));
assert.ok(mappedEvidence.sourceClaims.some((claim) => claim.sourceField === "DriveType" && claim.originalSourceValue === "FWD/Front-Wheel Drive"));

const evidenceIds = new Set(accord.evidence.map((evidence) => evidence.evidenceId));
for (const datum of Object.values(accord.data.identity || {})) {
  const references = datum.value === null ? datum.attemptEvidenceIds : datum.evidenceIds;
  assert.ok(references.length > 0);
  assert.ok(references.every((evidenceId) => evidenceIds.has(evidenceId)));
}

const testEvidence = requireContribution(normalize(accordDecoded, "test"));
assert.equal(testEvidence.dataUse, "test");
assert.ok(testEvidence.evidence.every((evidence) => evidence.dataUse === "test"));
assert.ok(testEvidence.evidence.every((evidence) => evidence.dataUse !== "production"));

const invalidStructure = normalizeDecodedVinToContribution(
  { vin, decoded: { make: "Honda" } as DecodedVin, dataUse: "test" },
  context,
);
assert.equal(invalidStructure.contribution, null);
assert.ok(invalidStructure.issues.some((issue) => issue.code === "nhtsa_invalid_decoded_vin_structure"));

let networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("Network access is forbidden in NHTSA unit tests.");
};
try {
  requireContribution(normalize(accordDecoded));
  assert.equal(networkCalls, 0, "Pure normalization must not call NHTSA or any other network service.");
} finally {
  globalThis.fetch = originalFetch;
}

// @ts-expect-error An NHTSA contribution is intentionally not a complete CVR.
const completeRecord: CanonicalVehicleRecord = accord;
void completeRecord;

runAdapterContractTests()
  .then(() => {
    console.log("NHTSA contribution adapter passed: deterministic mappings, explicit missingness, provenance, linkage, and network isolation verified.");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

function normalize(
  decoded: DecodedVin,
  dataUse: NhtsaSourceRecord["dataUse"] = "test",
) {
  return normalizeDecodedVinToContribution({ vin, decoded, dataUse }, context);
}

function requireContribution(result: ReturnType<typeof normalizeDecodedVinToContribution>) {
  assert.ok(result.contribution, result.issues.map((issue) => issue.message).join("; "));
  return result.contribution;
}

function assertMapping(
  override: Partial<DecodedVin>,
  field: "drivetrain" | "fuelType" | "transmission" | "bodyStyle",
  expected: string,
) {
  const contribution = requireContribution(normalize({ ...accordDecoded, ...override }));
  assert.equal(contribution.data.identity?.[field]?.value, expected);
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

async function runAdapterContractTests() {
  const adapterResult = await nhtsaContributionAdapter.normalize(
    [{ vin, decoded: accordDecoded, dataUse: "test" }],
    context,
  );
  assert.equal(adapterResult.contributions.length, 1);
  assert.deepEqual(adapterResult.rejectedSourceRecordIds, []);

  const rejectedResult = await nhtsaContributionAdapter.normalize(
    [{ vin, decoded: { make: "Honda" } as DecodedVin, dataUse: "test" }],
    context,
  );
  assert.equal(rejectedResult.contributions.length, 0);
  assert.deepEqual(rejectedResult.rejectedSourceRecordIds, [vin]);
}
