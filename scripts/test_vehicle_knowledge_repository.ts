import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  vehicleKnowledgeFixtureProposals,
  vehicleKnowledgeReviewDecisionFixture,
} from "../data/vehicleKnowledgeFixtures";
import { normalizeEpaVehicleToContribution } from "../src/vehicle-intelligence/sources/epa/epa-contribution-adapter";
import {
  createVehicleKnowledgeProposalsFromContribution,
  createVehicleKnowledgeRepository,
  loadVehicleKnowledgeRepository,
  serializeVehicleKnowledgeRepository,
} from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import {
  getVehicleKnowledgeSourceAuthority,
  isStaticIdentityKnowledgeField,
  isTimeSensitiveKnowledgeField,
} from "../src/vehicle-intelligence/vehicle-knowledge-trust-policy";
import type { CatalogEnrichmentReviewDecision } from "../types/catalogEnrichmentReview";
import type { VehicleKnowledgeProposal } from "../types/vehicleKnowledge";

const asOf = "2026-08-09T00:00:00.000Z";
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
    throw new Error("Vehicle knowledge tests must not use the network.");
  };

  // 1. Direct EPA fuel-economy evidence is trusted and can become active.
  const basic = fixtureRepository("basic");
  const epaMpg = basic.addProposal(clone(vehicleKnowledgeFixtureProposals.epaFuelEconomy));
  assert.equal(epaMpg.trustAssessment.trustState, "TRUSTED");
  const approvedMpg = basic.approveClaim(epaMpg.claimId, transition("Authoritative direct EPA MPG fixture."));
  assert.equal(approvedMpg.claimStatus, "approved");
  assert.equal(basic.getActiveClaimsForVehicle(epaMpg.vehicleId, asOf)[0]?.canonicalValue, 52);

  // 2. VIN-scoped NHTSA identity is trusted.
  const nhtsaMake = basic.addProposal(clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity));
  assert.equal(nhtsaMake.trustAssessment.trustState, "TRUSTED");
  assert.ok(nhtsaMake.trustAssessment.sourceAuthority >= 95);
  basic.approveClaim(nhtsaMake.claimId, transition("VIN-scoped NHTSA identity fixture."));

  // 3-4. Authority is field-specific; EPA has no borrowed safety authority.
  assert.ok(getVehicleKnowledgeSourceAuthority("environment.fuelEconomy", "epa", "configuration") > 90);
  assert.ok(getVehicleKnowledgeSourceAuthority("safety.crashSafety", "epa", "configuration") < 25);
  assert.ok(getVehicleKnowledgeSourceAuthority("safety.crashSafety", "nhtsa", "vin") > 90);
  const unsupportedSafety = basic.addProposal(clone(vehicleKnowledgeFixtureProposals.rejectedSafetyClaim));
  assert.equal(unsupportedSafety.trustAssessment.trustState, "REJECTED");
  assert.equal(unsupportedSafety.claimStatus, "rejected");

  // 5. Independent agreeing sources improve agreement without creating duplicates in active output.
  const agreement = fixtureRepository("agreement");
  const firstAgreement = agreement.addProposal(clone(vehicleKnowledgeFixtureProposals.agreeingNhtsaDrivetrain));
  const firstAgreementScore = firstAgreement.trustAssessment.sourceAgreement;
  agreement.approveClaim(firstAgreement.claimId, transition("First authoritative drivetrain claim."));
  const secondAgreement = agreement.addProposal(clone(vehicleKnowledgeFixtureProposals.agreeingOemDrivetrain));
  agreement.approveClaim(secondAgreement.claimId, transition("Independent OEM agreement."));
  assert.ok(agreement.getClaim(firstAgreement.claimId)!.trustAssessment.sourceAgreement > firstAgreementScore);
  assert.equal(agreement.getActiveClaimsForVehicle(firstAgreement.vehicleId, asOf).filter((claim) => claim.canonicalFieldPath === "identity.drivetrain").length, 1);

  // 6. Comparable strong sources that disagree create a blocking conflict.
  const conflict = fixtureRepository("conflict");
  const conflictNhtsa = conflict.addProposal(clone(vehicleKnowledgeFixtureProposals.conflictingNhtsaDrivetrain));
  conflict.approveClaim(conflictNhtsa.claimId, transition("First drivetrain fixture."));
  const conflictOem = conflict.addProposal(clone(vehicleKnowledgeFixtureProposals.conflictingOemDrivetrain));
  conflict.approveClaim(conflictOem.claimId, transition("Conflicting OEM drivetrain fixture."));
  assert.equal(conflict.getConflictsForVehicle(conflictNhtsa.vehicleId).length, 1);
  assert.equal(conflict.getActiveClaimsForVehicle(conflictNhtsa.vehicleId, asOf).length, 0);

  // 7. A weak reviewed source cannot silently override a stronger source.
  const authority = fixtureRepository("authority");
  const strongSafety = authority.addProposal(safetyProposal("nhtsa", "88", "nhtsa-safety", 88));
  authority.approveClaim(strongSafety.claimId, transition("Strong NHTSA safety evidence."));
  const weakSafetyProposal = safetyProposal("epa", "42", "epa-safety", 42);
  weakSafetyProposal.reviewDecision = reviewDecision("epa-safety", "fixture-authority:epa");
  const weakSafety = authority.addProposal(weakSafetyProposal);
  authority.approveClaim(weakSafety.claimId, transition("Reviewer retained the weak contradictory claim.", weakSafetyProposal.reviewDecision));
  assert.equal(authority.getClaim(weakSafety.claimId)?.claimStatus, "conflicted");
  assert.equal(authority.getActiveClaimsForVehicle(strongSafety.vehicleId, asOf)[0]?.claimId, strongSafety.claimId);

  // 8, 11, 12. A fresher trusted time-sensitive source revision supersedes, but never deletes, the old claim.
  const revisions = fixtureRepository("revisions");
  const oldCost = revisions.addProposal(costRevision("fixture-vehicle-2020", "epa-cost-old-stale", 195, "2024-01-01T00:00:00.000Z"));
  revisions.approveClaim(oldCost.claimId, transition("Initial EPA fuel-cost publication.", null, "2024-01-02T00:00:00.000Z"));
  const newCost = revisions.addProposal(clone(vehicleKnowledgeFixtureProposals.newEpaFuelCost));
  revisions.approveClaim(newCost.claimId, transition("Updated EPA fuel-cost publication.", null, "2026-07-16T00:00:00.000Z"));
  assert.equal(revisions.getClaim(oldCost.claimId)?.claimStatus, "superseded");
  assert.equal(revisions.getClaim(oldCost.claimId)?.supersededByClaimId, newCost.claimId);
  assert.equal(revisions.getClaim(newCost.claimId)?.supersedesClaimId, oldCost.claimId);
  assert.equal(revisions.getActiveClaimsForVehicle(oldCost.vehicleId, asOf).find((claim) => claim.canonicalFieldPath === "financial.fuelEnergyCost")?.canonicalValue, 202);
  assert.ok(revisions.getKnowledgeHistory(oldCost.vehicleId).some((event) => event.eventType === "claim_superseded"));
  const revisionsSnapshot = revisions.getKnowledgeSnapshot(oldCost.vehicleId, asOf);
  assert.equal(revisionsSnapshot.staleClaims.length, 0, "Resolved stale history must not remain current.");
  assert.equal(revisionsSnapshot.historicalStaleClaims.length, 1);
  assert.equal(revisionsSnapshot.historicalStaleClaims[0].claimId, oldCost.claimId);
  assert.equal(revisionsSnapshot.trustSummary.unresolvedStaleFieldCount, 0);
  assert.equal(revisionsSnapshot.trustSummary.historicalStaleCount, 1);

  // Multiple stale superseded versions remain auditable but count as zero current stale fields.
  const multipleRevisions = fixtureRepository("multiple-stale-revisions");
  const revisionInputs = [
    costRevision("fixture-multiple-stale", "cost-v1", 180, "2024-01-01T00:00:00.000Z"),
    costRevision("fixture-multiple-stale", "cost-v2", 185, "2024-06-01T00:00:00.000Z"),
    costRevision("fixture-multiple-stale", "cost-v3", 190, "2025-01-01T00:00:00.000Z"),
    costRevision("fixture-multiple-stale", "cost-v4", 205, "2026-08-01T00:00:00.000Z"),
  ];
  for (const proposal of revisionInputs) {
    const claim = multipleRevisions.addProposal(proposal);
    multipleRevisions.approveClaim(claim.claimId, transition(`Approve ${claim.sourceRecordId}.`, null, proposal.createdAt));
  }
  const eventsBeforeSnapshot = multipleRevisions.exportState().events.length;
  const multipleSnapshot = multipleRevisions.getKnowledgeSnapshot("fixture-multiple-stale", asOf);
  assert.equal(multipleSnapshot.staleClaims.length, 0);
  assert.equal(multipleSnapshot.historicalStaleClaims.length, 3);
  assert.equal(multipleSnapshot.trustSummary.unresolvedStaleFieldCount, 0);
  assert.equal(multipleSnapshot.supersededHistoryCount, 3);
  assert.equal(multipleRevisions.getClaimsForVehicle("fixture-multiple-stale").length, 4);
  assert.equal(multipleRevisions.exportState().events.length, eventsBeforeSnapshot, "Read-only snapshots must preserve append-only history.");

  // 9. Freshness cannot silently replace static identity.
  assert.equal(isStaticIdentityKnowledgeField("identity.make"), true);
  assert.equal(isTimeSensitiveKnowledgeField("identity.make"), false);
  const identityConflict = fixtureRepository("identity-conflict");
  const oldIdentity = identityConflict.addProposal(clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity));
  identityConflict.approveClaim(oldIdentity.claimId, transition("VIN identity."));
  const newerDifferentIdentity = clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity);
  newerDifferentIdentity.canonicalValue = "Honda";
  newerDifferentIdentity.source = { ...newerDifferentIdentity.source, sourceRecordId: "NEWER-VIN", retrievedAt: "2026-08-01T00:00:00.000Z", observedAt: "2026-08-01T00:00:00.000Z" };
  newerDifferentIdentity.evidence = newerDifferentIdentity.evidence.map((item) => ({ ...item, evidenceId: `${item.evidenceId}:newer`, sourceRecordId: "NEWER-VIN", retrievedAt: "2026-08-01T00:00:00.000Z", observedAt: "2026-08-01T00:00:00.000Z" }));
  newerDifferentIdentity.createdAt = "2026-08-01T00:00:00.000Z";
  const newerIdentityClaim = identityConflict.addProposal(newerDifferentIdentity);
  identityConflict.approveClaim(newerIdentityClaim.claimId, transition("Newer but contradictory identity evidence."));
  assert.equal(identityConflict.getActiveClaimsForVehicle(oldIdentity.vehicleId, asOf).length, 0);

  // 10. Rejected claims never become active.
  assert.equal(basic.getActiveClaimsForVehicle(unsupportedSafety.vehicleId, asOf).some((claim) => claim.claimId === unsupportedSafety.claimId), false);
  assert.throws(() => basic.approveClaim(unsupportedSafety.claimId, transition("Should fail.")), /Only proposed or conflicted/);

  // 13. Unresolved conflicts return no active value for the field.
  assert.equal(conflict.getKnowledgeSnapshot(conflictNhtsa.vehicleId, asOf).coverageSummary.activeFieldCount, 0);
  assert.equal(conflict.getKnowledgeSnapshot(conflictNhtsa.vehicleId, asOf).unresolvedConflicts[0]?.blocking, true);

  // 14. APPROVE_SOURCE review identity, reviewer, reason, and evidence survive contribution projection.
  const reviewedContribution = normalizeEpaVehicleToContribution({
    id: "12345",
    year: 2020,
    make: "Toyota",
    model: "Prius",
    VClass: "Midsize Cars",
    drive: "Front-Wheel Drive",
    trany: "Automatic (variable gear ratios)",
    fuelType: "Regular Gasoline",
    fuelType1: "Regular Gasoline",
    city08: 50,
    highway08: 48,
    comb08: 49,
    fuelCost08: 900,
    createdOn: "2026-01-01",
    modifiedOn: "2026-07-01",
  }, {
    ingestionId: "fixture-reviewed-contribution",
    retrievedAt: "2026-07-01T00:00:00.000Z",
    market: "US",
    sourceType: "epa",
  }, { dataUse: "fixture" });
  assert.ok(reviewedContribution.contribution);
  const contributionReview = reviewDecision("12345", "fixture-reviewed:epa");
  const projected = createVehicleKnowledgeProposalsFromContribution("fixture-reviewed", reviewedContribution.contribution!, {
    createdAt: "2026-07-01T00:00:00.000Z",
    reviewDecision: contributionReview,
    dataClassification: "fixture",
  });
  assert.ok(projected.length > 0);
  const reviewedRepository = fixtureRepository("reviewed");
  const reviewedClaim = reviewedRepository.addProposal(projected.find((proposal) => proposal.canonicalFieldPath === "environment.fuelEconomy")!);
  const reviewedApproved = reviewedRepository.approveClaim(reviewedClaim.claimId, transition("Approved source contribution.", contributionReview));
  assert.equal(reviewedApproved.reviewDecisionId, contributionReview.decisionId);
  assert.equal(reviewedApproved.reviewContext?.reviewer.reviewerId, "fixture_reviewer");
  assert.equal(reviewedApproved.reviewContext?.reason, contributionReview.reason);

  const electricContribution = normalizeEpaVehicleToContribution({
    id: "39860",
    year: 2018,
    make: "Nissan",
    model: "Leaf",
    VClass: "Midsize Cars",
    drive: "Front-Wheel Drive",
    trany: "Automatic (A1)",
    fuelType: "Electricity",
    fuelType1: "Electricity",
    atvType: "EV",
    comb08: 112,
    combE: 30.0011,
    range: 151,
    fuelCost08: 700,
  }, {
    ingestionId: "fixture-electric-efficiency",
    retrievedAt: "2026-07-01T00:00:00.000Z",
    market: "US",
    sourceType: "epa",
  }, { dataUse: "fixture" });
  assert.ok(electricContribution.contribution);
  const electricReview = reviewDecision("39860", "fixture-electric:epa");
  const electricProposal = createVehicleKnowledgeProposalsFromContribution(
    "fixture-electric",
    electricContribution.contribution!,
    { createdAt: "2026-07-01T00:00:00.000Z", reviewDecision: electricReview, dataClassification: "fixture" },
  ).find((proposal) => proposal.canonicalFieldPath === "environment.fuelEconomy")!;
  assert.equal(electricProposal.unit, "kwh_per_100_miles");
  const electricRepository = fixtureRepository("electric-efficiency");
  const electricClaim = electricRepository.addProposal(electricProposal);
  const approvedElectricClaim = electricRepository.approveClaim(
    electricClaim.claimId,
    transition("Approved authoritative electric-efficiency unit.", electricReview),
  );
  assert.equal(approvedElectricClaim.unit, "kwh_per_100_miles");

  // 15. Fixture knowledge cannot enter a production repository.
  const production = createVehicleKnowledgeRepository({ repositoryId: "production", dataUse: "production", createdAt: asOf });
  assert.throws(() => production.addProposal(clone(vehicleKnowledgeFixtureProposals.epaFuelEconomy)), /Fixture\/test knowledge cannot enter/);

  // 16. The immutable catalog is never imported or mutated by repository behavior.
  assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);

  // 17-19. Ordering, IDs, serialization, and event history are deterministic and survive reload.
  const first = buildDeterministicRepository("deterministic");
  const second = buildDeterministicRepository("deterministic");
  assert.equal(serializeVehicleKnowledgeRepository(first), serializeVehicleKnowledgeRepository(second));
  assert.deepEqual(first.exportState().claims.map((claim) => claim.claimId), second.exportState().claims.map((claim) => claim.claimId));
  const reloaded = loadVehicleKnowledgeRepository(serializeVehicleKnowledgeRepository(first));
  assert.equal(serializeVehicleKnowledgeRepository(reloaded), serializeVehicleKnowledgeRepository(first));
  assert.ok(reloaded.getKnowledgeHistory("fixture-vehicle-2020").length >= 4);

  // Snapshot exposes claims, stale history, evidence, trust, and coverage without creating a CVR.
  const stale = fixtureRepository("stale");
  const stalePrice = stale.addProposal(clone(vehicleKnowledgeFixtureProposals.staleListingPrice));
  stale.approveClaim(stalePrice.claimId, transition("Retain historical listing price.", null, "2025-01-02T00:00:00.000Z"));
  const staleSnapshot = stale.getKnowledgeSnapshot(stalePrice.vehicleId, asOf);
  assert.equal(staleSnapshot.staleClaims.length, 1);
  assert.equal(staleSnapshot.historicalStaleClaims.length, 0);
  assert.equal(staleSnapshot.trustSummary.unresolvedStaleFieldCount, 1);
  assert.equal(staleSnapshot.activeClaims.length, 0);
  assert.equal("identity" in staleSnapshot, false, "Knowledge snapshots must not masquerade as CanonicalVehicleRecord objects.");

  // 20-21. No recommendation code and no network dependency.
  const repositorySource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/vehicle-knowledge-repository.ts"), "utf8");
  const trustSource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/vehicle-knowledge-trust-policy.ts"), "utf8");
  assert.equal(/from\s+["'][^"']*recommendations/.test(`${repositorySource}\n${trustSource}`), false);
  assert.equal(repositorySource.includes("vehicleCatalogData"), false);
  assert.equal(repositorySource.includes("mergeCanonicalVehicleContributions"), false, "Knowledge Compiler behavior is not part of this repository.");
  assert.equal(networkCalls, 0);

  console.log("Vehicle knowledge repository passed: claims, field-aware trust, agreement, conflicts, supersession, staleness, review linkage, persistence, snapshots, and isolation verified.");
  console.log(JSON.stringify({
    trustedEpaMpg: approvedMpg.trustAssessment,
    trustedNhtsaIdentity: basic.getClaim(nhtsaMake.claimId)?.trustAssessment,
    conflictCount: conflict.getConflictsForVehicle(conflictNhtsa.vehicleId).length,
    supersededHistory: revisionsSnapshot.supersededHistoryCount,
    resolvedHistoricalStale: revisionsSnapshot.historicalStaleClaims.length,
    multipleResolvedHistoricalStale: multipleSnapshot.historicalStaleClaims.length,
    staleHistory: staleSnapshot.staleClaims.length,
    projectedContributionClaims: projected.length,
  }, null, 2));
}

function fixtureRepository(id: string) {
  return createVehicleKnowledgeRepository({ repositoryId: id, dataUse: "fixture", createdAt: "2025-01-01T00:00:00.000Z" });
}

function buildDeterministicRepository(id: string) {
  const repository = fixtureRepository(id);
  const mpg = repository.addProposal(clone(vehicleKnowledgeFixtureProposals.epaFuelEconomy));
  repository.approveClaim(mpg.claimId, transition("Deterministic MPG approval."));
  const identity = repository.addProposal(clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity));
  repository.approveClaim(identity.claimId, transition("Deterministic identity approval."));
  return repository;
}

function transition(
  reason: string,
  reviewDecision: CatalogEnrichmentReviewDecision | null = null,
  occurredAt = asOf,
) {
  return { occurredAt, reason, reviewDecision };
}

function reviewDecision(sourceRecordId: string, reviewId: string): CatalogEnrichmentReviewDecision {
  return {
    ...clone(vehicleKnowledgeReviewDecisionFixture),
    decisionId: `${reviewId}:v1`,
    reviewId,
    catalogVehicleId: reviewId.split(":")[0],
    selectedSourceRecordId: sourceRecordId,
    reviewedCandidateIds: [sourceRecordId],
    evidence: [{ kind: "source_record", reference: sourceRecordId, note: "Controlled fixture review." }],
  };
}

function safetyProposal(
  sourceType: "nhtsa" | "epa",
  value: string,
  sourceRecordId: string,
  numericValue: number,
): VehicleKnowledgeProposal {
  const base = clone(vehicleKnowledgeFixtureProposals.rejectedSafetyClaim);
  base.vehicleId = "fixture-authority";
  base.canonicalValue = numericValue;
  base.source = {
    ...base.source,
    sourceType,
    providerName: sourceType === "nhtsa" ? "NHTSA" : "EPA",
    sourceRecordId,
  };
  base.evidence = base.evidence.map((item) => ({
    ...item,
    evidenceId: `fixture-evidence:${sourceRecordId}:safety`,
    sourceType,
    providerName: sourceType === "nhtsa" ? "NHTSA" : "EPA",
    sourceRecordId,
    sourceClaims: [{ sourceField: "safety", originalSourceValue: value }],
  }));
  base.confidence = { score: 92, level: "high", sourceAgreement: "single_source", basis: ["Controlled safety fixture."] };
  base.reviewDecision = null;
  return base;
}

function costRevision(
  vehicleId: string,
  sourceRecordId: string,
  value: number,
  retrievedAt: string,
): VehicleKnowledgeProposal {
  const proposal = clone(vehicleKnowledgeFixtureProposals.oldEpaFuelCost);
  proposal.vehicleId = vehicleId;
  proposal.canonicalValue = value;
  proposal.createdAt = retrievedAt;
  proposal.effectiveFrom = retrievedAt;
  proposal.source = {
    ...proposal.source,
    sourceRecordId,
    observedAt: retrievedAt,
    retrievedAt,
  };
  proposal.evidence = proposal.evidence.map((evidence) => ({
    ...evidence,
    evidenceId: `fixture-evidence:${sourceRecordId}:fuel-cost`,
    sourceRecordId,
    observedAt: retrievedAt,
    retrievedAt,
    sourceClaims: [{ sourceField: "fuelCost08", originalSourceValue: value * 12 }],
  }));
  return proposal;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
