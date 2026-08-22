import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  publishedCVRFixtureProfiles,
  type PublishedCVRFixtureField,
} from "../data/publishedVehicleIntelligenceFixtures";
import { vehicleKnowledgeFixtureProposals } from "../data/vehicleKnowledgeFixtures";
import {
  cvrPublishingPolicyVersion,
  evaluateCVRForPublishing,
} from "../src/vehicle-intelligence/canonical-vehicle-publishing-policy";
import {
  createPublishedCVRRepository,
  comparePublishedCVRs,
  fingerprintCanonicalVehicleRecord,
  fingerprintPublishedCVR,
  loadPublishedCVRRepository,
  serializePublishedCVRRepository,
} from "../src/vehicle-intelligence/published-cvr-repository";
import { vehicleKnowledgeCompilerVersion, compileVehicleKnowledge } from "../src/vehicle-intelligence/vehicle-knowledge-compiler";
import { createVehicleKnowledgeRepository } from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import { vehicleKnowledgeTrustPolicyVersion } from "../src/vehicle-intelligence/vehicle-knowledge-trust-policy";
import type { CanonicalEvidence } from "../types/canonicalVehicle";
import type { CVRPublishingDecision } from "../types/cvrPublishing";
import type {
  PublishCanonicalVehicleInput,
  PublishedCVRRepository,
  PublishedVehicleIntelligenceRecord,
} from "../types/publishedVehicleIntelligence";
import type { VehicleKnowledgeClaim, VehicleKnowledgeSnapshot } from "../types/vehicleKnowledge";
import type { KnowledgeCompilationResult } from "../types/vehicleKnowledgeCompiler";

const asOf = "2026-08-11T00:00:00.000Z";
const catalogPath = join(process.cwd(), "data/processed/vehicleCatalog.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const originalFetch = globalThis.fetch;
let networkCalls = 0;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});

async function run() {
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("Published CVR repository tests must remain offline.");
  };

  const gasoline = fixturePublicationInput(publishedCVRFixtureProfiles.strongGasoline, "gas-v1");
  const hybridV1 = fixturePublicationInput(publishedCVRFixtureProfiles.hybrid, "hybrid-v1");
  const hybridV2 = fixturePublicationInput(publishedCVRFixtureProfiles.hybridSupersedingVersion, "hybrid-v2", -1);
  const electric = fixturePublicationInput(publishedCVRFixtureProfiles.electric, "ev-v1");
  const sparse = fixturePublicationInput(publishedCVRFixtureProfiles.sparsePublishable, "sparse-v1");
  const holdAttempt = fixturePublicationInput(publishedCVRFixtureProfiles.rejectedAttempt, "hold-v1");

  // Fixture set: gasoline, hybrid, EV, and sparse records pass; incomplete attempt is not publishable.
  assert.equal(gasoline.publishingDecision.action, "PUBLISH");
  assert.equal(hybridV1.publishingDecision.action, "PUBLISH");
  assert.equal(electric.publishingDecision.action, "PUBLISH");
  assert.equal(sparse.publishingDecision.action, "PUBLISH");
  assert.equal(holdAttempt.publishingDecision.action, "HOLD");

  const repository = fixtureRepository("published-cvr-main");

  // 1, 8. A valid PUBLISH decision creates version 1 as active.
  const first = repository.publish(hybridV1);
  assert.equal(first.recordVersion, 1);
  assert.equal(first.publicationStatus, "active");
  assert.equal(repository.getActivePublicationForVehicle(first.vehicleId)?.publicationId, first.publicationId);
  assert.equal(first.publishingDecisionId, hybridV1.publishingDecision.auditRecord.auditId);

  // 2-4. Every non-PUBLISH outcome is rejected at the repository boundary.
  const reviewAttempt = fixturePublicationInput({
    ...publishedCVRFixtureProfiles.sparsePublishable,
    vehicleId: "fixture-review-attempt",
    fields: publishedCVRFixtureProfiles.sparsePublishable.fields.slice(0, 4),
  }, "review-v1");
  assert.equal(reviewAttempt.publishingDecision.action, "REVIEW_REQUIRED");
  assert.throws(() => repository.publish(reviewAttempt), /Only a PUBLISH decision/);
  assert.throws(() => repository.publish(holdAttempt), /Only a PUBLISH decision/);
  const rejectAttempt = withCompilerError(gasoline, "unit_mismatch");
  assert.equal(rejectAttempt.publishingDecision.action, "REJECT");
  assert.throws(() => repository.publish(rejectAttempt), /Only a PUBLISH decision/);

  // 5. A malformed CVR is rejected even if its runtime decision is made to match the altered fingerprint.
  const malformed = clone(gasoline);
  delete (malformed.canonicalRecord.identity as unknown as Record<string, unknown>).model;
  const malformedFingerprint = fingerprintCanonicalVehicleRecord(malformed.canonicalRecord);
  malformed.publishingDecision = {
    ...malformed.publishingDecision,
    auditRecord: { ...malformed.publishingDecision.auditRecord, candidateFingerprint: malformedFingerprint },
  };
  assert.throws(() => repository.publish(malformed), /section identity does not match/);

  // 6. An audit record is mandatory even for a nominal PUBLISH decision.
  const missingAudit = clone(gasoline);
  (missingAudit as { publishingDecision: unknown }).publishingDecision = { ...missingAudit.publishingDecision, auditRecord: null };
  assert.throws(() => repository.publish(missingAudit as PublishCanonicalVehicleInput), /publishing audit record is required/);

  // 7. Fixture/test intelligence cannot enter a production publication repository.
  const production = createPublishedCVRRepository({ repositoryId: "production-shadow", dataUse: "production", createdAt: asOf });
  assert.throws(() => production.publish(gasoline), /Fixture\/test records cannot enter/);
  assert.equal(production.exportState().publications.length, 0);
  assert.throws(() => repository.publish({ ...gasoline, vehicleId: "wrong-vehicle-link" }), /vehicleId does not match/);

  // 9-11. A second version supersedes, preserves history, and becomes the sole active version.
  const second = repository.publish(hybridV2);
  const superseded = repository.getPublication(first.publicationId)!;
  assert.equal(second.recordVersion, 2);
  assert.equal(second.publicationStatus, "active");
  assert.equal(second.supersedesPublicationId, first.publicationId);
  assert.equal(superseded.publicationStatus, "superseded");
  assert.equal(superseded.supersededByPublicationId, second.publicationId);
  assert.equal(repository.getPublicationHistory(first.vehicleId).length, 2);
  assert.equal(repository.getActivePublicationForVehicle(first.vehicleId)?.publicationId, second.publicationId);

  // 12. A withdrawn publication is no longer active.
  const gasolinePublication = repository.publish(gasoline);
  repository.withdrawPublication(gasolinePublication.publicationId, { occurredAt: "2026-08-11T01:00:00.000Z", reason: "Controlled withdrawal test." });
  assert.equal(repository.getActivePublicationForVehicle(gasolinePublication.vehicleId), null);
  assert.equal(repository.getPublication(gasolinePublication.publicationId)?.publicationStatus, "withdrawn");

  // 13-14. Fingerprints are deterministic and exclude processing timestamps.
  assert.equal(first.fingerprint, fingerprintPublishedCVR(hybridV1));
  const laterHybridInput: PublishCanonicalVehicleInput = { ...hybridV1, publishedAt: "2030-01-01T00:00:00.000Z" };
  assert.equal(fingerprintPublishedCVR(hybridV1), fingerprintPublishedCVR(laterHybridInput));
  const idempotentRepository = fixtureRepository("idempotent");
  const idempotentFirst = idempotentRepository.publish(hybridV1);
  const idempotentSecond = idempotentRepository.publish({ ...hybridV1, publishedAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(idempotentSecond.publicationId, idempotentFirst.publicationId);
  assert.equal(idempotentRepository.getPublicationHistory(hybridV1.vehicleId).length, 1);

  // 15-17. Diff reports value, confidence, and evidence changes.
  const versionDiff = repository.comparePublications(first.publicationId, second.publicationId);
  assert.ok(versionDiff.valuesChanged.some((item) => item.fieldPath === "environment.fuelEconomy"));
  assert.ok(versionDiff.confidenceChanged.length > 0);
  assert.ok(versionDiff.evidenceChanged.some((item) => item.fieldPath === "environment.fuelEconomy"));
  assert.ok(versionDiff.recordEvidenceAdded.length > 0);
  assert.ok(versionDiff.recordEvidenceRemoved.length > 0);
  assert.equal(versionDiff.hasMeaningfulChanges, true);

  const staleStateTo = {
    ...clone(first),
    publicationId: `${first.publicationId}:stale-state`,
    canonicalRecord: {
      ...clone(first.canonicalRecord),
      reliability: {
        ...clone(first.canonicalRecord.reliability),
        longTermReliability: {
          ...clone(first.canonicalRecord.reliability.longTermReliability),
          missingReason: "stale" as const,
        },
      },
    },
  } as PublishedVehicleIntelligenceRecord;
  const staleStateDiff = comparePublishedCVRs(first, staleStateTo);
  assert.ok(staleStateDiff.staleConflictStateChanged.some((item) => item.fieldPath === "reliability.longTermReliability"));

  // 18. The previous retained version is rollback-eligible and can be marked without promotion.
  const rollbackBefore = repository.getRollbackPlan(first.vehicleId);
  assert.equal(rollbackBefore.eligible, true);
  assert.equal(rollbackBefore.rollbackCandidatePublicationId, first.publicationId);
  repository.markRollbackCandidate(first.publicationId, { occurredAt: "2026-08-11T02:00:00.000Z", reason: "Prepare a reviewed rollback option." });
  assert.equal(repository.getPublication(first.publicationId)?.publicationStatus, "rollback_candidate");
  assert.equal(repository.getActivePublicationForVehicle(first.vehicleId)?.publicationId, second.publicationId, "Rollback planning must not promote a prior record.");

  // Publish remaining fixture examples without touching production records.
  const evPublication = repository.publish(electric);
  const sparsePublication = repository.publish(sparse);
  assert.equal(evPublication.dataClassification, "fixture");
  assert.equal(sparsePublication.dataClassification, "fixture");
  assert.equal(repository.listPublishedVehicles().some((item) => item.vehicleId === electric.vehicleId), true);

  // 19-22. Catalog, knowledge state, recommendation runtime, and network remain isolated.
  const untouchedKnowledge = createVehicleKnowledgeRepository({ repositoryId: "untouched-knowledge", dataUse: "fixture", createdAt: asOf });
  const knowledgeBefore = JSON.stringify(untouchedKnowledge.exportState());
  repository.getPublicationHistory(hybridV1.vehicleId);
  assert.equal(JSON.stringify(untouchedKnowledge.exportState()), knowledgeBefore);
  assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);
  const repositorySource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/published-cvr-repository.ts"), "utf8");
  assert.equal(/from\s+["'][^"']*(recommendation|vehicleCatalog|vehicle-knowledge-repository|vehicle-knowledge-compiler)/.test(repositorySource), false);
  assert.equal(/\bfetch\s*\(/.test(repositorySource), false);
  assert.equal(networkCalls, 0);

  // 23. Serialization and reload are deterministic and preserve append-only history.
  const serialized = serializePublishedCVRRepository(repository);
  const reloaded = loadPublishedCVRRepository(serialized);
  assert.equal(serializePublishedCVRRepository(reloaded), serialized);
  assert.deepEqual(reloaded.getPublicationHistory(hybridV1.vehicleId), repository.getPublicationHistory(hybridV1.vehicleId));
  assert.equal(reloaded.exportState().events.some((event) => event.eventType === "publication_superseded"), true);
  assert.equal(reloaded.exportState().originalCatalogMutated, false);
  assert.equal(reloaded.exportState().knowledgeRepositoryMutated, false);
  assert.equal(reloaded.exportState().recommendationRuntimeConnected, false);

  console.log("Published CVR repository passed all 23 shadow publication, versioning, diff, rollback, persistence, and isolation requirements.");
  console.log(JSON.stringify({
    fixturePublications: {
      gasoline: gasoline.publishingDecision.action,
      hybrid: hybridV1.publishingDecision.action,
      electric: electric.publishingDecision.action,
      sparse: sparse.publishingDecision.action,
      rejectedAttempt: holdAttempt.publishingDecision.action,
    },
    hybridHistory: repository.getPublicationHistory(hybridV1.vehicleId).map((item) => ({ version: item.recordVersion, status: item.publicationStatus, fingerprint: item.fingerprint })),
    rollbackPlan: {
      currentPublicationId: repository.getRollbackPlan(hybridV1.vehicleId).currentPublicationId,
      candidatePublicationId: repository.getRollbackPlan(hybridV1.vehicleId).rollbackCandidatePublicationId,
      eligible: repository.getRollbackPlan(hybridV1.vehicleId).eligible,
      changedValues: repository.getRollbackPlan(hybridV1.vehicleId).diff?.valuesChanged.length ?? 0,
      changedConfidence: repository.getRollbackPlan(hybridV1.vehicleId).diff?.confidenceChanged.length ?? 0,
      changedEvidence: repository.getRollbackPlan(hybridV1.vehicleId).diff?.evidenceChanged.length ?? 0,
    },
    activeVehicleCount: repository.listPublishedVehicles().length,
    eventCount: repository.exportState().events.length,
  }, null, 2));
}

function fixturePublicationInput(
  profile: { vehicleId: string; dataClassification: "fixture"; fields: readonly PublishedCVRFixtureField[] },
  evidenceVersion: string,
  trustAdjustment = 0,
): PublishCanonicalVehicleInput {
  const compilation = buildCompilation(profile.vehicleId, profile.fields, evidenceVersion, trustAdjustment);
  const publishingDecision = evaluateCVRForPublishing(compilation);
  return {
    vehicleId: profile.vehicleId,
    canonicalRecord: compilation.record,
    publishingDecision,
    sourceKnowledgeSnapshotId: `snapshot:${profile.vehicleId}:${evidenceVersion}`,
    sourceKnowledgeSnapshotVersion: evidenceVersion,
    compilerVersion: vehicleKnowledgeCompilerVersion,
    trustPolicyVersion: vehicleKnowledgeTrustPolicyVersion,
    publishingPolicyVersion: cvrPublishingPolicyVersion,
    publishedAt: asOf,
    dataClassification: profile.dataClassification,
  };
}

function buildCompilation(
  vehicleId: string,
  fields: readonly PublishedCVRFixtureField[],
  evidenceVersion: string,
  trustAdjustment: number,
): KnowledgeCompilationResult {
  const knowledge = createVehicleKnowledgeRepository({ repositoryId: `fixture:${vehicleId}`, dataUse: "fixture", createdAt: "2025-01-01T00:00:00.000Z" });
  const seedProposal = clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity);
  seedProposal.vehicleId = vehicleId;
  const proposal = knowledge.addProposal(seedProposal);
  knowledge.approveClaim(proposal.claimId, { occurredAt: asOf, reason: "Published-CVR fixture seed.", reviewDecision: null });
  const seed = knowledge.getKnowledgeSnapshot(vehicleId, asOf);
  const seedClaim = seed.activeClaims[0];
  const seedEvidence = seed.evidence[0];
  const claims: VehicleKnowledgeClaim[] = fields.map(([fieldPath, value, unit], index) => ({
    ...clone(seedClaim),
    claimId: `published-fixture:${vehicleId}:${evidenceVersion}:${index}`,
    canonicalFieldPath: fieldPath,
    canonicalValue: value,
    unit,
    recordScope: "configuration",
    sourceRecordId: `${vehicleId}:${evidenceVersion}:${index}`,
    evidenceIds: [`published-evidence:${vehicleId}:${evidenceVersion}:${index}`],
    source: {
      ...clone(seedClaim.source),
      sourceType: index % 2 ? "oem" : "nhtsa",
      providerName: index % 2 ? "Controlled OEM fixture" : "Controlled NHTSA fixture",
      sourceRecordId: `${vehicleId}:${evidenceVersion}:${index}`,
    },
    trustAssessment: {
      ...clone(seedClaim.trustAssessment),
      trustScore: seedClaim.trustAssessment.trustScore + trustAdjustment,
      evidenceQuality: seedClaim.trustAssessment.evidenceQuality + trustAdjustment,
    },
  }));
  const evidence: CanonicalEvidence[] = claims.map((claim) => ({
    ...clone(seedEvidence),
    evidenceId: claim.evidenceIds[0],
    sourceType: claim.source.sourceType,
    providerName: claim.source.providerName,
    sourceRecordId: claim.sourceRecordId,
    scope: "configuration",
    sourceClaims: [{ sourceField: claim.canonicalFieldPath, originalSourceValue: claim.canonicalValue }],
  }));
  const snapshot: VehicleKnowledgeSnapshot = {
    ...clone(seed),
    activeClaims: claims,
    inactiveClaims: [],
    conflictedClaims: [],
    unresolvedConflicts: [],
    staleClaims: [],
    historicalStaleClaims: [],
    evidence,
    trustSummary: {
      trustedCount: claims.length,
      reviewRequiredCount: 0,
      conflictedCount: 0,
      staleCount: 0,
      historicalStaleCount: 0,
      unresolvedStaleFieldCount: 0,
      averageTrustScore: claims.length ? claims[0].trustAssessment.trustScore : null,
    },
    coverageSummary: {
      activeFieldCount: claims.length,
      proposedFieldCount: 0,
      conflictedFieldCount: 0,
      canonicalFieldPaths: claims.map((claim) => claim.canonicalFieldPath).sort(),
    },
  };
  return compileVehicleKnowledge(snapshot);
}

function withCompilerError(input: PublishCanonicalVehicleInput, code: "unit_mismatch"): PublishCanonicalVehicleInput {
  const compilation = buildCompilation(input.vehicleId, publishedCVRFixtureProfiles.strongGasoline.fields, "reject-error", 0);
  compilation.diagnostics.push({ code, fieldPath: "environment.fuelEconomy", severity: "error", message: "Controlled compiler error.", claimIds: [], evidenceIds: [] });
  const publishingDecision = evaluateCVRForPublishing(compilation);
  return { ...input, canonicalRecord: compilation.record, publishingDecision };
}

function fixtureRepository(id: string): PublishedCVRRepository {
  return createPublishedCVRRepository({ repositoryId: id, dataUse: "fixture", createdAt: "2026-08-11T00:00:00.000Z" });
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
