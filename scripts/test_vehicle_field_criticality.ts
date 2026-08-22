import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalVehicleFieldPaths } from "../types/canonicalVehicle";
import {
  assertCompleteCanonicalVehicleFieldPolicy,
  canonicalVehicleFieldPolicy,
  requiredPublicationIdentityFields,
} from "../src/vehicle-intelligence/vehicle-field-criticality-policy";

const catalogPath = join(process.cwd(), "data/processed/vehicleCatalog.json");
const repositoryPath = join(process.cwd(), "data/vehicle-knowledge/repositories/phase-3.2e-reviewed-golden.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const repositoryBefore = existsSync(repositoryPath) ? readFileSync(repositoryPath, "utf8") : null;

assertCompleteCanonicalVehicleFieldPolicy();
assert.equal(canonicalVehicleFieldPaths.length, 73);
assert.equal(Object.keys(canonicalVehicleFieldPolicy).length, 73);
assert.deepEqual([...requiredPublicationIdentityFields].sort(), [
  "identity.make",
  "identity.model",
  "identity.modelYear",
]);

for (const path of canonicalVehicleFieldPaths) {
  const policy = canonicalVehicleFieldPolicy[path];
  assert.equal(policy.fieldPath, path);
  assert.ok(policy.ontologyConcept.length > 0);
  assert.ok(policy.recommendationRoles.length > 0);
}

assert.equal(canonicalVehicleFieldPolicy["identity.bodyStyle"].publicationCriticality, "CORE_VEHICLE");
assert.equal(canonicalVehicleFieldPolicy["identity.bodyStyle"].missingBehavior, "ALLOW_WITH_DIAGNOSTIC");
assert.equal(canonicalVehicleFieldPolicy["identity.make"].staleBehavior, "BLOCK_PUBLICATION");
assert.equal(canonicalVehicleFieldPolicy["financial.fuelEnergyCost"].freshnessClass, "DYNAMIC");
assert.equal(canonicalVehicleFieldPolicy["financial.fuelEnergyCost"].staleBehavior, "DIAGNOSE_AND_EXCLUDE_FROM_DECISION");
assert.equal(canonicalVehicleFieldPolicy["financial.purchasePrice"].freshnessClass, "HIGHLY_DYNAMIC");
assert.equal(canonicalVehicleFieldPolicy["technology.infotainment"].publicationCriticality, "OPTIONAL_ENRICHMENT");
assert.deepEqual(canonicalVehicleFieldPolicy["confidence.dataQuality"].scoringCategories, []);
assert.ok(canonicalVehicleFieldPolicy["confidence.dataQuality"].recommendationRoles.includes("CONFIDENCE"));

assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);
if (repositoryBefore !== null) assert.equal(readFileSync(repositoryPath, "utf8"), repositoryBefore);

console.log("Vehicle field criticality passed: all 73 CVR fields have one exact typed policy and publication/freshness remain orthogonal.");
