import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { auditVehicleCatalog, isRecommendableVehicle, validateVehicleRecord } from "../lib/data/vehicleValidation.ts";

const require = createRequire(import.meta.url);
const vehicleCatalog = require("../data/processed/vehicleCatalog.json");

const audit = auditVehicleCatalog(vehicleCatalog);
const invalidRecords = audit.filter((result) => !result.recommendable);
const recommendableRecords = audit.filter((result) => result.recommendable);

assert.equal(audit.length, vehicleCatalog.length, "every vehicle record should be audited");
assert.ok(recommendableRecords.length >= 220, "validator should keep a useful recommendation pool");
assert.ok(invalidRecords.length >= 1, "validator should identify suspicious source records");

[
  "ford-ecosport-2018-craigslist-carstrucks-data",
  "toyota-tacoma-2017-craigslist-carstrucks-data",
  "nissan-murano-2014-craigslist-carstrucks-data",
  "subaru-brz-2015-craigslist-carstrucks-data",
  "ford-explorer-2022-craigslist-carstrucks-data",
].forEach((vehicleId) => {
  const record = findVehicle(vehicleId);
  assert.ok(record, `${vehicleId} fixture should exist in the catalog`);
  assert.ok(!isRecommendableVehicle(record), `${vehicleId} should be excluded from recommendations`);
  assert.ok(validateVehicleRecord(record).length > 0, `${vehicleId} should include validation issues`);
});

[
  "toyota-corolla-2014-craigslist-carstrucks-data",
  "toyota-rav4-2023-2023-car-model-dataset",
  "nissan-leaf-2015-craigslist-carstrucks-data",
  "toyota-tacoma-2023-2023-car-model-dataset",
].forEach((vehicleId) => {
  const record = findVehicle(vehicleId);
  assert.ok(record, `${vehicleId} fixture should exist in the catalog`);
  assert.deepEqual(validateVehicleRecord(record), [], `${vehicleId} should pass validation`);
});

invalidRecords.forEach(({ vehicle, issues }) => {
  assert.ok(vehicle.id, "invalid vehicles should still retain source ids for auditability");
  assert.ok(issues.every((issue) => issue.field && issue.message), `${vehicle.id} issues should be explainable`);
});

console.log(
  `Vehicle data validation passed: ${recommendableRecords.length} recommendable, ${invalidRecords.length} excluded, ${audit.length} audited.`,
);

function findVehicle(vehicleId) {
  return vehicleCatalog.find((vehicle) => vehicle.id === vehicleId);
}
