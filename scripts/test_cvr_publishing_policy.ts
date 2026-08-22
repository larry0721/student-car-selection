import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vehicleKnowledgeFixtureProposals } from "../data/vehicleKnowledgeFixtures";
import {
  cvrPublishingPolicy,
  evaluateCVRForPublishing,
} from "../src/vehicle-intelligence/canonical-vehicle-publishing-policy";
import { compileVehicleKnowledge } from "../src/vehicle-intelligence/vehicle-knowledge-compiler";
import { createVehicleKnowledgeRepository } from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import type {
  CanonicalEvidence,
  CanonicalEvidenceSourceValue,
  CanonicalUnit,
  CanonicalVehicleFieldPath,
} from "../types/canonicalVehicle";
import type { VehicleKnowledgeClaim, VehicleKnowledgeSnapshot } from "../types/vehicleKnowledge";
import type { KnowledgeCompilationResult } from "../types/vehicleKnowledgeCompiler";

const asOf = "2026-08-09T00:00:00.000Z";
const catalogPath = join(process.cwd(), "data/processed/vehicleCatalog.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const originalFetch = globalThis.fetch;
let networkCalls = 0;

async function run() {
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("CVR publishing tests must remain offline.");
  };

  // 1. A complete, conflict-free candidate above every threshold publishes.
  const publishableCompilation = buildCompilation(publishableFields);
  const publish = evaluateCVRForPublishing(publishableCompilation);
  assert.equal(publish.action, "PUBLISH");
  assert.equal(publish.publishable, true);
  assert.ok(publish.publishabilityScore >= cvrPublishingPolicy.minimumPublishabilityScore);
  assert.equal(publish.publishedRecord?.record.recordStatus, "validated");
  assert.equal(publish.publishedRecord?.publication.active, true);
  assert.equal(publish.publishedRecord?.publication.auditId, publish.auditRecord.auditId);

  // 2. Required identity must be complete and canonical.
  const missingIdentity = evaluateCVRForPublishing(buildCompilation(publishableFields.filter(([path]) => path !== "identity.model")));
  assert.equal(missingIdentity.action, "HOLD");
  assert.ok(missingIdentity.diagnostics.some((item) => item.code === "missing_required_identity" && item.fieldPath === "identity.model"));
  assert.equal(missingIdentity.publishedRecord, null);

  // 3. A blocking conflict is held rather than resolved by the gate.
  const conflictInput = clone(publishableCompilation);
  conflictInput.summary.conflictedFields = 1;
  conflictInput.unresolvedFields.push({ fieldPath: "financial.purchasePrice", missingReason: "source_conflict", staleClaimIds: [], conflictingClaimIds: ["claim-a", "claim-b"] });
  conflictInput.diagnostics.push({ code: "unresolved_conflict", fieldPath: "financial.purchasePrice", severity: "warning", message: "Controlled conflict.", claimIds: ["claim-a", "claim-b"], evidenceIds: [] });
  const conflict = evaluateCVRForPublishing(conflictInput);
  assert.equal(conflict.action, "HOLD");
  assert.ok(conflict.diagnostics.some((item) => item.code === "blocking_conflict"));

  // 4. Stale dynamic knowledge remains diagnosed but does not block stable publication.
  const staleInput = clone(publishableCompilation);
  const staleFuelCost = staleInput.unresolvedFields.find((field) => field.fieldPath === "financial.fuelEnergyCost")!;
  staleFuelCost.missingReason = "stale";
  staleFuelCost.staleClaimIds = ["stale-claim"];
  staleInput.summary.staleFields = 1;
  staleInput.diagnostics.push({ code: "stale_claim_available", fieldPath: "financial.fuelEnergyCost", severity: "warning", message: "Controlled stale dynamic field.", claimIds: ["stale-claim"], evidenceIds: [] });
  const stale = evaluateCVRForPublishing(staleInput);
  assert.equal(stale.action, "PUBLISH");
  assert.ok(stale.diagnostics.some((item) => item.code === "stale_knowledge_present" && item.fieldPath === "financial.fuelEnergyCost"));
  assert.equal(stale.metrics.staleFields, 1);
  assert.equal(stale.metrics.blockingStaleFields, 0);
  assert.equal(stale.metrics.nonBlockingStaleFields, 1);
  assert.equal(cvrPublishingPolicy.maximumBlockingStaleFields, 0);

  const staleIdentityInput = clone(buildCompilation(publishableFields.filter(([path]) => path !== "identity.make")));
  const staleIdentityField = staleIdentityInput.unresolvedFields.find((field) => field.fieldPath === "identity.make")!;
  staleIdentityField.missingReason = "stale";
  staleIdentityInput.summary.staleFields = 1;
  const staleIdentity = evaluateCVRForPublishing(staleIdentityInput);
  assert.equal(staleIdentity.action, "HOLD");
  assert.equal(staleIdentity.metrics.blockingStaleFields, 1);
  assert.equal(staleIdentity.checks.find((check) => check.check === "blocking_staleness")?.passed, false);

  // 5. Compiler errors reject the candidate rather than entering human approval.
  const compilerErrorInput = clone(publishableCompilation);
  compilerErrorInput.diagnostics.push({ code: "unit_mismatch", fieldPath: "environment.fuelEconomy", severity: "error", message: "Controlled invalid unit.", claimIds: ["bad-unit"], evidenceIds: [] });
  const compilerError = evaluateCVRForPublishing(compilerErrorInput);
  assert.equal(compilerError.action, "REJECT");
  assert.ok(compilerError.diagnostics.some((item) => item.code === "compiler_error_unresolved"));

  // 6. Dangling evidence and missing claim lineage are rejecting provenance defects.
  const danglingEvidenceInput = clone(publishableCompilation);
  danglingEvidenceInput.record.identity.make.evidenceIds = ["missing-evidence"];
  const danglingEvidence = evaluateCVRForPublishing(danglingEvidenceInput);
  assert.equal(danglingEvidence.action, "REJECT");
  assert.ok(danglingEvidence.diagnostics.some((item) => item.code === "evidence_reference_missing"));

  const missingClaimInput = clone(publishableCompilation);
  const firstClaimId = Object.keys(missingClaimInput.claimLineage)[0];
  delete missingClaimInput.claimLineage[firstClaimId];
  const missingClaim = evaluateCVRForPublishing(missingClaimInput);
  assert.equal(missingClaim.action, "REJECT");
  assert.ok(missingClaim.diagnostics.some((item) => item.code === "claim_lineage_missing"));

  // 7. The gate verifies repository trust but never recalculates or upgrades it.
  const untrustedInput = clone(publishableCompilation);
  const untrustedId = Object.keys(untrustedInput.claimLineage)[0];
  untrustedInput.claimLineage[untrustedId] = {
    ...untrustedInput.claimLineage[untrustedId],
    trustAssessment: { ...untrustedInput.claimLineage[untrustedId].trustAssessment, trustState: "REVIEW_REQUIRED" },
  };
  const untrusted = evaluateCVRForPublishing(untrustedInput);
  assert.equal(untrusted.action, "REJECT");
  assert.ok(untrusted.diagnostics.some((item) => item.code === "untrusted_claim_used"));

  // 8. Complete identity with insufficient coverage is reviewable, not publishable.
  const identityOnly = evaluateCVRForPublishing(buildCompilation(publishableFields.slice(0, 4)));
  assert.equal(identityOnly.action, "REVIEW_REQUIRED");
  assert.ok(identityOnly.diagnostics.some((item) => item.code === "insufficient_trusted_claim_coverage"));
  assert.ok(identityOnly.diagnostics.some((item) => item.code === "data_quality_below_threshold"));

  // 9. No trusted knowledge is held honestly.
  const empty = evaluateCVRForPublishing(buildCompilation([]));
  assert.equal(empty.action, "HOLD");
  assert.equal(empty.metrics.trustedClaimsUsed, 0);

  // 10-12. Each quality threshold independently blocks unattended publishing.
  const lowEvidenceInput = clone(publishableCompilation);
  lowEvidenceInput.record.confidence.evidenceQuality.value = cvrPublishingPolicy.minimumEvidenceQuality - 1;
  assert.equal(evaluateCVRForPublishing(lowEvidenceInput).action, "REVIEW_REQUIRED");

  const lowAgreementInput = clone(publishableCompilation);
  lowAgreementInput.record.confidence.sourceAgreement.value = cvrPublishingPolicy.minimumSourceAgreement - 1;
  assert.equal(evaluateCVRForPublishing(lowAgreementInput).action, "REVIEW_REQUIRED");

  const lowTrustInput = clone(publishableCompilation);
  for (const claimId of Object.keys(lowTrustInput.claimLineage)) {
    lowTrustInput.claimLineage[claimId] = {
      ...lowTrustInput.claimLineage[claimId],
      trustAssessment: { ...lowTrustInput.claimLineage[claimId].trustAssessment, trustScore: cvrPublishingPolicy.minimumRepositoryTrust - 1 },
    };
  }
  assert.equal(evaluateCVRForPublishing(lowTrustInput).action, "REVIEW_REQUIRED");

  // 13. Score and checks are bounded, traceable, and internally consistent.
  assert.ok(publish.publishabilityScore >= 0 && publish.publishabilityScore <= 100);
  assert.ok(publish.checks.every((check) => check.passed));
  assert.equal(publish.auditRecord.publishabilityScore, publish.publishabilityScore);
  assert.deepEqual(publish.auditRecord.metrics, publish.metrics);
  assert.deepEqual(publish.auditRecord.thresholds, publish.thresholds);

  // 14-16. Evaluation is deterministic, pure, and stable for identical input.
  const before = JSON.stringify(publishableCompilation);
  const repeated = evaluateCVRForPublishing(publishableCompilation);
  assert.deepEqual(repeated, publish);
  assert.equal(repeated.auditRecord.auditId, publish.auditRecord.auditId);
  assert.equal(JSON.stringify(publishableCompilation), before);
  assert.ok(Object.isFrozen(publish));
  assert.ok(Object.isFrozen(publish.auditRecord));

  // 17. Non-publish actions never leak an active published record.
  for (const decision of [missingIdentity, conflict, compilerError, identityOnly, empty]) {
    assert.equal(decision.publishedRecord, null);
    assert.equal(decision.publishable, false);
  }

  // 18-21. The boundary is isolated from persistence, network, catalog, and recommendations.
  const policySource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/canonical-vehicle-publishing-policy.ts"), "utf8");
  assert.equal(/from\s+["'][^"']*(vehicle-knowledge-repository|vehicleCatalog|recommendation)/.test(policySource), false);
  assert.equal(/\b(addProposal|approveClaim|rejectClaim|supersedeClaim|withdrawClaim|fetch)\s*\(/.test(policySource), false);
  assert.equal(networkCalls, 0);
  assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);

  console.log("CVR publishing policy passed: PUBLISH, REVIEW_REQUIRED, HOLD, and REJECT boundaries are deterministic and auditable.");
  console.log(JSON.stringify({
    publish: summarize(publish),
    identityOnly: summarize(identityOnly),
    missingIdentity: summarize(missingIdentity),
    conflict: summarize(conflict),
    compilerError: summarize(compilerError),
  }, null, 2));
}

const publishableFields: Array<[CanonicalVehicleFieldPath, CanonicalEvidenceSourceValue, CanonicalUnit]> = [
  ["identity.make", "Toyota", "none"],
  ["identity.model", "Prius", "none"],
  ["identity.modelYear", 2021, "year"],
  ["identity.bodyStyle", "hatchback", "none"],
  ["identity.vehicleCategory", "compact_car", "none"],
  ["identity.drivetrain", "FWD", "none"],
  ["identity.transmission", "cvt", "none"],
  ["identity.fuelType", "hybrid", "none"],
  ["environment.fuelEconomy", 52, "mpg"],
  ["financial.maintenanceCost", 75, "usd_per_month"],
];

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});

function buildCompilation(fields: Array<[CanonicalVehicleFieldPath, CanonicalEvidenceSourceValue, CanonicalUnit]>): KnowledgeCompilationResult {
  const repository = createVehicleKnowledgeRepository({ repositoryId: "publishing-fixture", dataUse: "fixture", createdAt: "2025-01-01T00:00:00.000Z" });
  const proposal = clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity);
  const base = repository.addProposal(proposal);
  repository.approveClaim(base.claimId, { occurredAt: asOf, reason: "Publishing fixture seed.", reviewDecision: null });
  const seedSnapshot = repository.getKnowledgeSnapshot(base.vehicleId, asOf);
  const seedClaim = seedSnapshot.activeClaims[0];
  const seedEvidence = seedSnapshot.evidence[0];
  const claims: VehicleKnowledgeClaim[] = fields.map(([path, value, unit], index) => ({
    ...clone(seedClaim),
    claimId: `publishing-claim-${index}:${path}`,
    canonicalFieldPath: path,
    canonicalValue: value,
    unit,
    recordScope: "configuration",
    sourceRecordId: `publishing-source-${index}`,
    evidenceIds: [`publishing-evidence-${index}:${path}`],
    source: {
      ...clone(seedClaim.source),
      sourceRecordId: `publishing-source-${index}`,
      providerName: index % 2 === 0 ? "Controlled NHTSA fixture" : "Controlled OEM fixture",
      sourceType: index % 2 === 0 ? "nhtsa" : "oem",
    },
  }));
  const evidence: CanonicalEvidence[] = claims.map((claim, index) => ({
    ...clone(seedEvidence),
    evidenceId: claim.evidenceIds[0],
    sourceType: claim.source.sourceType,
    providerName: claim.source.providerName,
    sourceRecordId: claim.sourceRecordId,
    scope: "configuration",
    sourceClaims: [{ sourceField: claim.canonicalFieldPath, originalSourceValue: claim.canonicalValue }],
  }));
  const snapshot: VehicleKnowledgeSnapshot = {
    ...clone(seedSnapshot),
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
      averageTrustScore: claims.length ? seedClaim.trustAssessment.trustScore : null,
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

function summarize(decision: ReturnType<typeof evaluateCVRForPublishing>) {
  return {
    action: decision.action,
    score: decision.publishabilityScore,
    trustedClaims: decision.metrics.trustedClaimsUsed,
    coverage: decision.metrics.dataQualityCoverage,
    evidenceQuality: decision.metrics.evidenceQuality,
    sourceAgreement: decision.metrics.sourceAgreement,
    repositoryTrust: decision.metrics.repositoryTrust,
    diagnostics: decision.diagnostics.map((item) => item.code),
  };
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
