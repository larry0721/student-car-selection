import { canonicalVehicleFieldPaths, type CanonicalDatum, type CanonicalVehicleFieldPath } from "../../types/canonicalVehicle";
import type { CatalogEnrichmentReviewManifest } from "../../types/catalogEnrichmentReview";
import type { EpaVehicleRecord } from "./sources/epa/epa-client";
import type {
  GoldenSetV1Manifest,
  GoldenSetV1PublicationResult,
  GoldenVehiclePublicationSpec,
  PreparedGoldenVehiclePublication,
} from "../../types/goldenVehiclePublication";
import type { PublishCanonicalVehicleInput, PublishedCVRRepository } from "../../types/publishedVehicleIntelligence";
import type { VehicleKnowledgeRepositoryState } from "../../types/vehicleKnowledge";
import { evaluateCVRForPublishing, cvrPublishingPolicyVersion } from "./canonical-vehicle-publishing-policy";
import { compileVehicleKnowledge, vehicleKnowledgeCompilerVersion } from "./vehicle-knowledge-compiler";
import { loadVehicleKnowledgeRepository } from "./vehicle-knowledge-repository";
import { vehicleKnowledgeTrustPolicyVersion } from "./vehicle-knowledge-trust-policy";
import { normalizeEpaVehicleToContribution } from "./sources/epa/epa-contribution-adapter";
import { fingerprintPublishedCVR } from "./published-cvr-repository";

export const goldenSetV1RepositoryId = "phase-3.2e-golden-set-v1-shadow" as const;
export const goldenSetV1ManifestId = "phase-3.2e-golden-set-v1" as const;

export const goldenSetV1Vehicles: readonly GoldenVehiclePublicationSpec[] = Object.freeze([
  { vehicleId: "hyundai-accent-2017-craigslist-carstrucks-data", displayName: "2017 Hyundai Accent", epaSourceId: "37479" },
  { vehicleId: "toyota-prius-2016-usedcarscatalog", displayName: "2016 Toyota Prius", epaSourceId: "37163" },
  { vehicleId: "toyota-rav4-2016-craigslist-carstrucks-data", displayName: "2016 Toyota RAV4", epaSourceId: "37086" },
  { vehicleId: "honda-cr-v-2016-craigslist-carstrucks-data", displayName: "2016 Honda CR-V", epaSourceId: "37024" },
  { vehicleId: "nissan-leaf-2018-craigslist-carstrucks-data", displayName: "2018 Nissan Leaf", epaSourceId: "39860" },
]);

type PrepareInput = {
  reviewManifestSerialized: string;
  knowledgeRepositorySerialized: string;
  publishedAt: string;
  requestedVehicleIds?: readonly string[];
};

export function prepareGoldenSetV1(input: PrepareInput): PreparedGoldenVehiclePublication[] {
  const publishedAt = requireDate(input.publishedAt, "publishedAt");
  const requested = validateRequestedScope(input.requestedVehicleIds ?? goldenSetV1Vehicles.map((item) => item.vehicleId));
  const reviewManifest = parseReviewManifest(input.reviewManifestSerialized);
  const knowledgeState = parseKnowledgeState(input.knowledgeRepositorySerialized);
  const knowledgeRepository = loadVehicleKnowledgeRepository(input.knowledgeRepositorySerialized);

  return requested.map((vehicleId) => {
    const spec = requireGoldenSpec(vehicleId);
    const ownerDecision = reviewManifest.decisions.find((decision) => decision.catalogVehicleId === spec.vehicleId);
    const selectedSnapshot = ownerDecision?.selectedCandidateSnapshot as EpaVehicleRecord | null | undefined;
    if (!ownerDecision
      || ownerDecision.action !== "APPROVE_SOURCE"
      || ownerDecision.source !== "epa"
      || ownerDecision.dataUse !== "production"
      || ownerDecision.selectedSourceRecordId !== spec.epaSourceId
      || selectedSnapshot?.id !== spec.epaSourceId) {
      throw new Error(`${spec.vehicleId} lacks the exact approved production EPA ${spec.epaSourceId} owner decision.`);
    }

    const normalized = normalizeEpaVehicleToContribution(selectedSnapshot, {
      ingestionId: `golden-publication:${ownerDecision.decisionId}`,
      retrievedAt: knowledgeState.updatedAt,
      market: "US",
      sourceType: "epa",
    }, { dataUse: "production" });
    if (!normalized.contribution || normalized.contribution.source.sourceRecordId !== spec.epaSourceId) {
      throw new Error(`${spec.vehicleId} could not reproduce its approved EPA contribution.`);
    }

    const claims = knowledgeRepository.getClaimsForVehicle(spec.vehicleId);
    validateProductionClaims(spec, ownerDecision.decisionId, claims, knowledgeState);
    validateContributionLineage(spec, normalized.contribution, claims);
    const knowledgeSnapshot = knowledgeRepository.getKnowledgeSnapshot(spec.vehicleId, knowledgeState.updatedAt);
    const compilation = compileVehicleKnowledge(knowledgeSnapshot);
    const publishingDecision = evaluateCVRForPublishing(compilation);
    if (publishingDecision.action !== "PUBLISH") {
      throw new Error(`${spec.vehicleId} was blocked by the CVR Publishing Gate: ${publishingDecision.action} - ${publishingDecision.reason}`);
    }
    if (publishingDecision.diagnostics.some((item) => item.severity === "error" || item.code === "blocking_conflict")) {
      throw new Error(`${spec.vehicleId} has blocking publication diagnostics.`);
    }
    assertCanonicalCoverage(compilation.record);
    if (spec.epaSourceId === "39860") validateLeafIntegrity(compilation.record);

    const knowledgeSnapshotId = `vehicle-knowledge-snapshot:${stableHash(`${knowledgeState.repositoryId}:${spec.vehicleId}`)}`;
    const knowledgeSnapshotVersion = `${knowledgeState.updatedAt}:${stableHash(stableValue(knowledgeSnapshot))}`;
    const publishInput: PublishCanonicalVehicleInput = {
      vehicleId: spec.vehicleId,
      canonicalRecord: compilation.record,
      publishingDecision,
      sourceKnowledgeSnapshotId: knowledgeSnapshotId,
      sourceKnowledgeSnapshotVersion: knowledgeSnapshotVersion,
      compilerVersion: vehicleKnowledgeCompilerVersion,
      trustPolicyVersion: vehicleKnowledgeTrustPolicyVersion,
      publishingPolicyVersion: cvrPublishingPolicyVersion,
      publishedAt,
      dataClassification: "production",
    };
    return deepFreeze({
      spec,
      ownerDecision,
      knowledgeSnapshot,
      knowledgeSnapshotId,
      knowledgeSnapshotVersion,
      compilation,
      publishingDecision,
      publishInput,
    });
  });
}

export function publishGoldenSetV1(
  repository: PublishedCVRRepository,
  prepared: readonly PreparedGoldenVehiclePublication[],
): GoldenSetV1PublicationResult {
  validatePreparedScope(prepared);
  const existing = repository.listPublishedVehicles();
  if (existing.some((item) => !goldenSetV1Vehicles.some((spec) => spec.vehicleId === item.vehicleId))) {
    throw new Error("The Golden Set v1 repository contains a vehicle outside the approved five-vehicle scope.");
  }

  const vehicles = prepared.map((item) => {
    const historyBefore = repository.getPublicationHistory(item.spec.vehicleId);
    if (historyBefore.length > 1) throw new Error(`${item.spec.vehicleId} already has more than one publication and cannot enter Golden Set v1.`);
    if (historyBefore[0] && historyBefore[0].fingerprint !== fingerprintPublishedCVR(item.publishInput)) {
      throw new Error(`${item.spec.vehicleId} has a different existing publication; Golden Set v1 will not create v2.`);
    }
    const publication = repository.publish(item.publishInput);
    const replay = repository.publish({ ...item.publishInput, publishedAt: shiftTimestamp(item.publishInput.publishedAt, 60_000) });
    if (publication.publicationId !== replay.publicationId || replay.recordVersion !== 1) {
      throw new Error(`${item.spec.vehicleId} idempotent replay attempted to create a new publication version.`);
    }
    const history = repository.getPublicationHistory(item.spec.vehicleId);
    if (history.length !== 1 || history[0].publicationStatus !== "active") {
      throw new Error(`${item.spec.vehicleId} must retain exactly one active Golden Set v1 publication.`);
    }
    return deepFreeze({
      prepared: item,
      publication,
      replayPublicationId: replay.publicationId,
      replayRecognized: true,
    });
  });

  const active = repository.listPublishedVehicles();
  const expectedIds = goldenSetV1Vehicles.map((item) => item.vehicleId).sort();
  if (stableValue(active.map((item) => item.vehicleId).sort()) !== stableValue(expectedIds)) {
    throw new Error("Golden Set v1 active scope is not exactly the five approved vehicles.");
  }
  const manifest = createGoldenSetV1Manifest(repository, vehicles);
  return deepFreeze({
    publicationsAttempted: prepared.length,
    publicationsSucceeded: vehicles.length,
    publicationsBlocked: [],
    vehicles,
    manifest,
    repositoryPublicationCount: active.length,
  });
}

export function createGoldenSetV1Manifest(
  repository: PublishedCVRRepository,
  results: GoldenSetV1PublicationResult["vehicles"],
): GoldenSetV1Manifest {
  const state = repository.exportState();
  if (state.repositoryId !== goldenSetV1RepositoryId || state.dataUse !== "production") {
    throw new Error("Golden Set v1 manifest requires the approved production shadow repository.");
  }
  const vehicles = results.map(({ prepared, publication }) => ({
    vehicleId: publication.vehicleId,
    displayName: prepared.spec.displayName,
    epaSourceId: prepared.spec.epaSourceId,
    publicationId: publication.publicationId,
    recordVersion: publication.recordVersion,
    fingerprint: publication.fingerprint,
    publicationDecision: "PUBLISH" as const,
    publicationTimestamp: publication.publishedAt,
    compilerVersion: publication.compilerVersion,
    trustPolicyVersion: publication.trustPolicyVersion,
    publishingPolicyVersion: publication.publishingPolicyVersion,
    sourceKnowledgeSnapshotId: publication.sourceKnowledgeSnapshotId!,
    sourceKnowledgeSnapshotVersion: publication.sourceKnowledgeSnapshotVersion!,
  })).sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  return deepFreeze({
    schemaVersion: "1.0.0",
    goldenDatasetVersion: "1.0.0",
    manifestId: goldenSetV1ManifestId,
    repositoryId: state.repositoryId,
    storageBoundary: "shadow_metadata_only",
    recommendationRuntimeConnected: false,
    publicationTimestamp: vehicles.map((item) => item.publicationTimestamp).sort().at(-1)!,
    vehicles,
  });
}

export function serializeGoldenSetV1Manifest(manifest: GoldenSetV1Manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function validateProductionClaims(
  spec: GoldenVehiclePublicationSpec,
  decisionId: string,
  claims: ReturnType<ReturnType<typeof loadVehicleKnowledgeRepository>["getClaimsForVehicle"]>,
  state: VehicleKnowledgeRepositoryState,
) {
  if (!claims.length) throw new Error(`${spec.vehicleId} has no retained knowledge claims.`);
  const evidenceById = new Map(state.evidence.map((item) => [item.evidenceId, item]));
  for (const claim of claims) {
    const isApprovedEpaClaim = claim.dataClassification === "reviewed_source"
      && claim.source.sourceType === "epa"
      && claim.sourceRecordId === spec.epaSourceId
      && claim.reviewDecisionId === decisionId
      && claim.reviewContext?.reviewDecisionId === decisionId;
    const isVerifiedNhtsaCrashClaim = claim.canonicalFieldPath === "safety.crashSafety"
      && claim.dataClassification === "verified_source"
      && claim.source.sourceType === "nhtsa"
      && claim.source.providerName === "NHTSA Safety Ratings / NCAP"
      && claim.source.sourceUrl?.startsWith("https://api.nhtsa.gov/SafetyRatings/VehicleId/") === true
      && claim.reviewDecisionId === null
      && claim.reviewContext === null;
    if (!isApprovedEpaClaim && !isVerifiedNhtsaCrashClaim) {
      throw new Error(`${spec.vehicleId} contains a claim outside its approved EPA or verified NHTSA crash lineage.`);
    }
    if (!claim.evidenceIds.length || claim.evidenceIds.some((id) => {
      const evidence = evidenceById.get(id);
      return !evidence
        || evidence.dataUse !== "production"
        || evidence.sourceType !== claim.source.sourceType
        || evidence.sourceRecordId !== claim.sourceRecordId;
    })) throw new Error(`${spec.vehicleId} contains missing, fixture, or mismatched source evidence.`);
  }
}

function validateContributionLineage(
  spec: GoldenVehiclePublicationSpec,
  contribution: NonNullable<ReturnType<typeof normalizeEpaVehicleToContribution>["contribution"]>,
  claims: ReturnType<ReturnType<typeof loadVehicleKnowledgeRepository>["getClaimsForVehicle"]>,
) {
  if (contribution.dataUse !== "production" || contribution.evidence.some((item) => item.dataUse !== "production")) {
    throw new Error(`${spec.vehicleId} reproduced a non-production EPA contribution.`);
  }
  for (const [section, fields] of Object.entries(contribution.data)) {
    if (!fields) continue;
    for (const [fieldName, datum] of Object.entries(fields)) {
      if (!datum || datum.value === null || datum.status === "missing") continue;
      const fieldPath = `${section}.${fieldName}` as CanonicalVehicleFieldPath;
      const retained = claims.find((claim) => claim.canonicalFieldPath === fieldPath);
      if (!retained || retained.unit !== datum.unit || stableValue(retained.canonicalValue) !== stableValue(datum.value)) {
        throw new Error(`${spec.vehicleId} retained claim ${fieldPath} does not match the reproduced approved EPA contribution.`);
      }
    }
  }
}

function validateLeafIntegrity(record: PreparedGoldenVehiclePublication["compilation"]["record"]) {
  if (record.identity.fuelType.value !== "electric"
    || record.identity.drivetrain.value !== "FWD"
    || record.environment.evRange.value !== 151
    || record.environment.evRange.unit !== "miles"
    || record.environment.emissions.value !== 0
    || record.environment.fuelEconomy.value !== 30.0011
    || record.environment.fuelEconomy.unit !== "kwh_per_100_miles") {
    throw new Error("EPA 39860 failed electric powertrain, range, emissions, or kWh/100-mile integrity checks.");
  }
  const preservesMpge = record.evidence.some((evidence) => evidence.sourceRecordId === "39860"
    && evidence.sourceClaims?.some((claim) => claim.sourceField === "comb08" && claim.originalSourceValue === 112));
  if (!preservesMpge) throw new Error("EPA 39860 no longer preserves source MPGe 112 in evidence lineage.");
}

function assertCanonicalCoverage(record: PreparedGoldenVehiclePublication["compilation"]["record"]) {
  for (const path of canonicalVehicleFieldPaths) {
    const [section, field] = path.split(".");
    const datum = (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section]?.[field];
    if (!datum) throw new Error(`${record.recordId} does not contain all 73 canonical fields.`);
  }
}

function validateRequestedScope(requested: readonly string[]) {
  const expected = goldenSetV1Vehicles.map((item) => item.vehicleId).sort();
  const actual = [...requested].sort();
  if (new Set(actual).size !== actual.length || stableValue(actual) !== stableValue(expected)) {
    throw new Error("Golden Set v1 scope must contain exactly the five owner-approved vehicle IDs.");
  }
  return actual;
}

function validatePreparedScope(prepared: readonly PreparedGoldenVehiclePublication[]) {
  validateRequestedScope(prepared.map((item) => item.spec.vehicleId));
  if (prepared.some((item) => item.publishingDecision.action !== "PUBLISH" || item.publishInput.dataClassification !== "production")) {
    throw new Error("Every Golden Set v1 input must retain a production PUBLISH decision.");
  }
}

function requireGoldenSpec(vehicleId: string) {
  const spec = goldenSetV1Vehicles.find((item) => item.vehicleId === vehicleId);
  if (!spec) throw new Error(`${vehicleId} is outside Golden Set v1 scope.`);
  return spec;
}

function parseReviewManifest(serialized: string): CatalogEnrichmentReviewManifest {
  const parsed = JSON.parse(serialized) as CatalogEnrichmentReviewManifest;
  if (parsed.schemaVersion !== "1.0.0" || parsed.dataUse !== "production" || parsed.storageBoundary !== "local_staging_only" || parsed.productionCatalogMutated !== false || !Array.isArray(parsed.decisions)) {
    throw new Error("Golden Set v1 owner-review manifest is invalid.");
  }
  return parsed;
}

function parseKnowledgeState(serialized: string): VehicleKnowledgeRepositoryState {
  const parsed = JSON.parse(serialized) as VehicleKnowledgeRepositoryState;
  if (parsed.dataUse !== "production" || parsed.originalCatalogMutated !== false || parsed.storageBoundary !== "vehicle_knowledge_only") {
    throw new Error("Golden Set v1 requires the approved production Vehicle Knowledge Repository.");
  }
  return parsed;
}

function shiftTimestamp(timestamp: string, milliseconds: number) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function requireDate(value: string, field: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be a valid timestamp.`);
  return value;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
