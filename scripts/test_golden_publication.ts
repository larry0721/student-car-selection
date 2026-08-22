import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  goldenSetV1RepositoryId,
  goldenSetV1Vehicles,
  prepareGoldenSetV1,
  publishGoldenSetV1,
  serializeGoldenSetV1Manifest,
} from "../src/vehicle-intelligence/golden-set-v1-publication";
import { createPublishedCVRRepository, serializePublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";
import type { PublishCanonicalVehicleInput } from "../types/publishedVehicleIntelligence";

const root = process.cwd();
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const knowledgePath = join(root, "data/vehicle-knowledge/repositories/phase-3.2e-reviewed-golden.json");
const reviewPath = join(root, "data/enrichment-review/manifests/phase-3.2e-golden-owner-decisions.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const knowledgeBefore = readFileSync(knowledgePath, "utf8");
const reviewManifest = readFileSync(reviewPath, "utf8");
const publishedAt = "2026-08-13T00:00:00.000Z";

const prepared = prepareGoldenSetV1({
  reviewManifestSerialized: reviewManifest,
  knowledgeRepositorySerialized: knowledgeBefore,
  publishedAt,
});
assert.equal(prepared.length, 5);
assert.deepEqual(prepared.map((item) => item.spec.vehicleId).sort(), goldenSetV1Vehicles.map((item) => item.vehicleId).sort());
assert.ok(prepared.every((item) => item.publishingDecision.action === "PUBLISH" && item.publishingDecision.publishabilityScore === 90));
assert.ok(prepared.every((item) => item.publishInput.dataClassification === "production"));
assert.ok(prepared.every((item) => item.compilation.record.evidence.every((evidence) => evidence.dataUse === "production")));

const repository = createPublishedCVRRepository({ repositoryId: goldenSetV1RepositoryId, dataUse: "production", createdAt: publishedAt });
const result = publishGoldenSetV1(repository, prepared);
assert.equal(result.publicationsAttempted, 5);
assert.equal(result.publicationsSucceeded, 5);
assert.equal(result.publicationsBlocked.length, 0);
assert.equal(result.repositoryPublicationCount, 5);
assert.ok(result.vehicles.every((item) => item.publication.recordVersion === 1 && item.publication.publicationStatus === "active"));
assert.ok(result.vehicles.every((item) => item.replayRecognized && item.replayPublicationId === item.publication.publicationId));
assert.ok(result.vehicles.every((item) => repository.getActivePublicationForVehicle(item.publication.vehicleId)?.publicationId === item.publication.publicationId));
assert.ok(result.vehicles.every((item) => repository.getPublicationHistory(item.publication.vehicleId).length === 1));
assert.equal(repository.listPublishedVehicles().length, 5);

// Re-running the complete meaningful publication keeps every vehicle at v1.
const firstSerialized = serializePublishedCVRRepository(repository);
const replay = publishGoldenSetV1(repository, prepared);
assert.equal(serializePublishedCVRRepository(repository), firstSerialized);
assert.ok(replay.vehicles.every((item) => item.publication.recordVersion === 1));

// Non-PUBLISH decisions and fixture classifications cannot cross the production boundary.
const blockedInput = clone(prepared[0].publishInput);
blockedInput.publishingDecision = {
  ...blockedInput.publishingDecision,
  action: "REVIEW_REQUIRED",
  publishable: false,
  publishedRecord: null,
};
const rejectionRepository = createPublishedCVRRepository({ repositoryId: "golden-rejection-test", dataUse: "production", createdAt: publishedAt });
assert.throws(() => rejectionRepository.publish(blockedInput), /Only a PUBLISH decision/);
assert.throws(() => rejectionRepository.publish({ ...prepared[0].publishInput, dataClassification: "fixture" }), /Fixture\/test records cannot enter/);

// Scope cannot be expanded to deferred or ambiguous vehicles.
for (const blockedVehicleId of [
  "kia-niro-2017-craigslist-carstrucks-data",
  "toyota-camry-2015-usedcarscatalog",
  "ford-f-150-2019-craigslist-carstrucks-data",
]) {
  assert.throws(() => prepareGoldenSetV1({
    reviewManifestSerialized: reviewManifest,
    knowledgeRepositorySerialized: knowledgeBefore,
    publishedAt,
    requestedVehicleIds: [...goldenSetV1Vehicles.slice(1).map((item) => item.vehicleId), blockedVehicleId],
  }), /exactly the five owner-approved vehicle IDs/);
}

// Evidence, audits, source snapshots, and fingerprints remain complete.
for (const item of result.vehicles) {
  const publication = item.publication;
  const evidenceIds = new Set(publication.canonicalRecord.evidence.map((evidence) => evidence.evidenceId));
  assert.ok(publication.publishingAuditRecord.trustedClaimIds.length > 0);
  assert.ok(publication.sourceKnowledgeSnapshotId);
  assert.ok(publication.sourceKnowledgeSnapshotVersion);
  assert.ok(publication.canonicalRecord.evidence.every((evidence) => evidence.dataUse === "production"));
  for (const lineage of item.prepared.compilation.lineage) {
    assert.ok(lineage.evidenceIds.every((id) => evidenceIds.has(id)));
  }
}

const leaf = result.vehicles.find((item) => item.prepared.spec.epaSourceId === "39860")!.publication.canonicalRecord;
assert.equal(leaf.identity.fuelType.value, "electric");
assert.equal(leaf.identity.drivetrain.value, "FWD");
assert.equal(leaf.environment.evRange.value, 151);
assert.equal(leaf.environment.emissions.value, 0);
assert.equal(leaf.environment.fuelEconomy.value, 30.0011);
assert.equal(leaf.environment.fuelEconomy.unit, "kwh_per_100_miles");
assert.ok(leaf.evidence.some((evidence) => evidence.sourceRecordId === "39860" && evidence.sourceClaims?.some((claim) => claim.sourceField === "comb08" && claim.originalSourceValue === 112)));

const manifestText = serializeGoldenSetV1Manifest(result.manifest);
assert.equal(manifestText.includes("canonicalRecord"), false);
assert.equal(result.manifest.vehicles.length, 5);
assert.equal(repository.exportState().originalCatalogMutated, false);
assert.equal(repository.exportState().knowledgeRepositoryMutated, false);
assert.equal(repository.exportState().recommendationRuntimeConnected, false);
assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);
assert.equal(readFileSync(knowledgePath, "utf8"), knowledgeBefore);

const recommendationRuntime = [
  readFileSync(join(root, "lib/recommendations.ts"), "utf8"),
  readFileSync(join(root, "app/api/recommendations/route.ts"), "utf8"),
].join("\n");
assert.equal(/published-cvr-repository|golden-set-v1-publication|PublishedCVRRepository/.test(recommendationRuntime), false);

console.log("Golden Set v1 publication passed: exact production scope, owner lineage, v1 activation, idempotency, Leaf units, and recommendation isolation verified.");
console.log(JSON.stringify(result.vehicles.map((item) => ({
  vehicle: item.prepared.spec.displayName,
  vehicleId: item.publication.vehicleId,
  epaSourceId: item.prepared.spec.epaSourceId,
  publicationId: item.publication.publicationId,
  version: item.publication.recordVersion,
  fingerprint: item.publication.fingerprint,
  populatedFields: item.prepared.compilation.summary.populatedFields,
  missingFields: item.prepared.compilation.summary.missingFields,
  dataQuality: item.prepared.compilation.record.confidence.dataQuality.value,
  evidenceQuality: item.prepared.compilation.record.confidence.evidenceQuality.value,
  sourceAgreement: item.prepared.compilation.record.confidence.sourceAgreement.value,
  publishScore: item.prepared.publishingDecision.publishabilityScore,
})), null, 2));

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
