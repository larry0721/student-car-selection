import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublishedVehicleAuthorityArtifact,
  loadPublishedVehicleAuthorityArtifact,
  serializePublishedVehicleAuthorityArtifact,
} from "../src/vehicle-intelligence/published-vehicle-authority-artifact";
import { loadPublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";
import { parseVehicleEnergyAuthority, toLegacyVehicleMpg } from "../src/vehicle-intelligence/vehicle-energy-field-contract";

const root = process.cwd();
const repositoryPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const artifactPath = join(root, "data/published-vehicle-intelligence/golden-set-v1.runtime.json");
assert.equal(existsSync(artifactPath), true, "The committed runtime artifact must exist in a fresh checkout.");

const repository = loadPublishedCVRRepository(readFileSync(repositoryPath, "utf8"));
const first = createPublishedVehicleAuthorityArtifact(repository.exportState());
const second = createPublishedVehicleAuthorityArtifact(repository.exportState());
assert.equal(serializePublishedVehicleAuthorityArtifact(first), serializePublishedVehicleAuthorityArtifact(second));
assert.equal(readFileSync(artifactPath, "utf8"), serializePublishedVehicleAuthorityArtifact(first), "Committed runtime artifact is stale.");

const loaded = loadPublishedVehicleAuthorityArtifact(readFileSync(artifactPath, "utf8"));
assert.equal(loaded.publishedVehicleCount, 5);
assert.equal(loaded.canonicalIdentityContractVersion, "1.0.0");
assert.ok(loaded.publicationPolicyVersions.length > 0);
assert.equal(new Set(loaded.publications.map((item) => item.vehicleId)).size, 5);
assert.deepEqual(loaded.explicitlyNonScoreableFields, ["safetyScore", "reliabilityScore"]);

const crv = loaded.publications.find((item) => item.vehicleId === "honda-cr-v-2016-craigslist-carstrucks-data");
assert.ok(crv);
assert.ok(crv.canonicalRecord.evidence.some((item) => item.sourceType === "epa" && item.sourceRecordId === "37024"));
assert.ok(crv.canonicalRecord.evidence.some((item) => item.sourceType === "nhtsa" && item.sourceRecordId === "10170"));

const leaf = loaded.publications.find((item) => item.vehicleId === "nissan-leaf-2018-craigslist-carstrucks-data");
assert.ok(leaf);
assert.equal(leaf.canonicalRecord.environment.fuelEconomy.unit, "kwh_per_100_miles");
assert.equal(leaf.canonicalRecord.environment.evRange.unit, "miles");
assert.equal(leaf.canonicalRecord.environment.evRange.value, 151);
assert.equal(toLegacyVehicleMpg(parseVehicleEnergyAuthority({ fuelType: "gas", value: 30, unit: "mpg", field: "efficiency" })), 30);
assert.equal(toLegacyVehicleMpg(parseVehicleEnergyAuthority({ fuelType: "hybrid", value: 52, unit: "mpg", field: "efficiency" })), 52);
assert.equal(toLegacyVehicleMpg(parseVehicleEnergyAuthority({ fuelType: "electric", value: 112, unit: "mpge", field: "efficiency" })), null);
assert.equal(toLegacyVehicleMpg(parseVehicleEnergyAuthority({ fuelType: "electric", value: 30.0011, unit: "kwh_per_100_miles", field: "efficiency" })), null);
assert.deepEqual(parseVehicleEnergyAuthority({ fuelType: "electric", value: 151, unit: "miles", field: "range" }), {
  kind: "electric_range", value: 151, unit: "miles", legacyMpgCompatible: false,
});

assert.throws(() => loadPublishedVehicleAuthorityArtifact("{"), /malformed JSON/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({ ...loaded, schemaVersion: "2.0.0" })), /incompatible/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({ ...loaded, artifactVersion: "golden-set-v2.0.0" })), /incompatible/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({ ...loaded, resolverContractVersion: "2.0.0" })), /incompatible/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({ ...loaded, canonicalIdentityContractVersion: "2.0.0" })), /incompatible/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({ ...loaded, recommendationRuntimeEligible: false })), /incompatible/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({ ...loaded, generationFingerprint: "stale" })), /stale/);
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify({
  ...loaded,
  publishedVehicleCount: loaded.publishedVehicleCount + 1,
  publications: [...loaded.publications, loaded.publications[0]],
})), /duplicate|incompatible/);

const malformed = clone(loaded);
malformed.publications[0].canonicalRecord.environment.fuelEconomy.value = Number.POSITIVE_INFINITY;
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify(malformed)), /non-finite|malformed|stale/);

const missingIdentity = clone(loaded);
missingIdentity.publications[0].canonicalRecord.identity.make.value = null;
missingIdentity.publications[0].canonicalRecord.identity.make.status = "missing";
assert.throws(() => loadPublishedVehicleAuthorityArtifact(JSON.stringify(missingIdentity)), /required exact identity/);

console.log("Published vehicle authority artifact passed: deterministic generation, fresh-build equality, schema, duplicate, malformed, stale, identity, EPA/NHTSA lineage, and EV-unit validation.");

function clone<Value>(value: Value): Value { return JSON.parse(JSON.stringify(value)) as Value; }
