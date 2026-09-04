import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  goldenSetV1RepositoryId,
  prepareGoldenSetV1,
  publishGoldenSetV1,
  serializeGoldenSetV1Manifest,
} from "../src/vehicle-intelligence/golden-set-v1-publication";
import {
  createPublishedCVRRepository,
  loadPublishedCVRRepository,
  serializePublishedCVRRepository,
} from "../src/vehicle-intelligence/published-cvr-repository";
import {
  createPublishedVehicleAuthorityArtifact,
  serializePublishedVehicleAuthorityArtifact,
} from "../src/vehicle-intelligence/published-vehicle-authority-artifact";

const root = process.cwd();
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const knowledgePath = join(root, "data/vehicle-knowledge/repositories/phase-3.2e-reviewed-golden.json");
const reviewPath = join(root, "data/enrichment-review/manifests/phase-3.2e-golden-owner-decisions.json");
const repositoryPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const manifestPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.manifest.json");
const runtimeArtifactPath = join(root, "data/published-vehicle-intelligence/golden-set-v1.runtime.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const knowledgeBefore = readFileSync(knowledgePath, "utf8");
const reviewManifest = readFileSync(reviewPath, "utf8");
const publishedAt = new Date().toISOString();

const repository = existsSync(repositoryPath)
  ? loadPublishedCVRRepository(readFileSync(repositoryPath, "utf8"))
  : createPublishedCVRRepository({ repositoryId: goldenSetV1RepositoryId, dataUse: "production", createdAt: publishedAt });
const prepared = prepareGoldenSetV1({
  reviewManifestSerialized: reviewManifest,
  knowledgeRepositorySerialized: knowledgeBefore,
  publishedAt,
});
const result = publishGoldenSetV1(repository, prepared);

writeFileSync(repositoryPath, serializePublishedCVRRepository(repository), { encoding: "utf8", mode: 0o600 });
writeFileSync(manifestPath, serializeGoldenSetV1Manifest(result.manifest), { encoding: "utf8", mode: 0o600 });
writeFileSync(
  runtimeArtifactPath,
  serializePublishedVehicleAuthorityArtifact(createPublishedVehicleAuthorityArtifact(repository.exportState())),
  { encoding: "utf8", mode: 0o644 },
);

const reloaded = loadPublishedCVRRepository(readFileSync(repositoryPath, "utf8"));
if (reloaded.listPublishedVehicles().length !== 5) throw new Error("Persisted Golden Set v1 repository did not reload with exactly five active vehicles.");
if (readFileSync(catalogPath, "utf8") !== catalogBefore) throw new Error("Original catalog changed during Golden Set v1 publication.");
if (readFileSync(knowledgePath, "utf8") !== knowledgeBefore) throw new Error("Vehicle Knowledge Repository changed during Golden Set v1 publication.");

console.log(JSON.stringify({
  repositoryPath,
  manifestPath,
  runtimeArtifactPath,
  publicationsAttempted: result.publicationsAttempted,
  publicationsSucceeded: result.publicationsSucceeded,
  publicationsBlocked: result.publicationsBlocked,
  repositoryState: {
    activeVehicleCount: reloaded.listPublishedVehicles().length,
    originalCatalogMutated: reloaded.exportState().originalCatalogMutated,
    knowledgeRepositoryMutated: reloaded.exportState().knowledgeRepositoryMutated,
    recommendationRuntimeConnected: reloaded.exportState().recommendationRuntimeConnected,
  },
  vehicles: result.vehicles.map((item) => ({
    vehicle: item.prepared.spec.displayName,
    vehicleId: item.publication.vehicleId,
    epaSourceId: item.prepared.spec.epaSourceId,
    trustedClaims: item.prepared.compilation.summary.trustedClaimsUsed,
    populatedFields: item.prepared.compilation.summary.populatedFields,
    missingFields: item.prepared.compilation.summary.missingFields,
    staleFields: item.prepared.compilation.unresolvedFields.filter((field) => field.missingReason === "stale").map((field) => field.fieldPath),
    dataQuality: item.prepared.compilation.record.confidence.dataQuality.value,
    evidenceQuality: item.prepared.compilation.record.confidence.evidenceQuality.value,
    sourceAgreement: item.prepared.compilation.record.confidence.sourceAgreement.value,
    publishScore: item.prepared.publishingDecision.publishabilityScore,
    publicationId: item.publication.publicationId,
    recordVersion: item.publication.recordVersion,
    fingerprint: item.publication.fingerprint,
    status: item.publication.publicationStatus,
    historyCount: reloaded.getPublicationHistory(item.publication.vehicleId).length,
    idempotentReplay: item.replayRecognized,
  })),
}, null, 2));
