import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vehicleKnowledgeFixtureProposals } from "../data/vehicleKnowledgeFixtures";
import { compileVehicleKnowledge } from "../src/vehicle-intelligence/vehicle-knowledge-compiler";
import { createVehicleKnowledgeRepository } from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import {
  canonicalVehicleFieldNames,
  canonicalVehicleFieldPaths,
  canonicalVehicleSectionNames,
  type CanonicalDatum,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
} from "../types/canonicalVehicle";
import type {
  VehicleKnowledgeClaim,
  VehicleKnowledgeProposal,
  VehicleKnowledgeSnapshot,
} from "../types/vehicleKnowledge";
import type { KnowledgeCompilationResult } from "../types/vehicleKnowledgeCompiler";

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
    throw new Error("Knowledge compiler tests must not use the network.");
  };

  const basicRepository = fixtureRepository("compiler-basic");
  approve(basicRepository, clone(vehicleKnowledgeFixtureProposals.epaFuelEconomy));
  approve(basicRepository, clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity));
  const basicSnapshot = basicRepository.getKnowledgeSnapshot("fixture-vehicle-2020", asOf);
  const basic = compileVehicleKnowledge(basicSnapshot);

  // 1-3. Trusted source claims populate the corresponding canonical fields.
  assert.equal(basic.record.environment.fuelEconomy.value, 52);
  assert.equal(basic.record.environment.fuelEconomy.unit, "mpg");
  assert.equal(basic.record.identity.make.value, "Toyota");
  assert.equal(basic.record.identity.make.status, "sourced");

  const electricRepository = fixtureRepository("compiler-electric-efficiency");
  const electricProposal = clone(vehicleKnowledgeFixtureProposals.epaFuelEconomy);
  electricProposal.vehicleId = "fixture-electric-efficiency";
  electricProposal.canonicalValue = 30.0011;
  electricProposal.unit = "kwh_per_100_miles";
  const electricClaim = approve(electricRepository, electricProposal);
  const electric = compileVehicleKnowledge(
    electricRepository.getKnowledgeSnapshot(electricClaim.vehicleId, asOf),
  );
  assert.equal(electric.record.environment.fuelEconomy.value, 30.0011);
  assert.equal(electric.record.environment.fuelEconomy.unit, "kwh_per_100_miles");

  const agreementRepository = fixtureRepository("compiler-agreement");
  const nhtsaDrive = approve(agreementRepository, clone(vehicleKnowledgeFixtureProposals.agreeingNhtsaDrivetrain));
  const oemDrive = approve(agreementRepository, clone(vehicleKnowledgeFixtureProposals.agreeingOemDrivetrain));
  const repositoryAgreementSnapshot = agreementRepository.getKnowledgeSnapshot(nhtsaDrive.vehicleId, asOf);
  const agreementSnapshot = withCompatibleActiveClaims(repositoryAgreementSnapshot, [
    agreementRepository.getClaim(nhtsaDrive.claimId)!,
    agreementRepository.getClaim(oemDrive.claimId)!,
  ]);
  const agreement = compileVehicleKnowledge(agreementSnapshot);
  assert.equal(agreement.record.identity.drivetrain.value, "AWD");

  // 4-5. Stale financial knowledge is diagnostic history, never an active value.
  const staleRepository = fixtureRepository("compiler-stale");
  const stalePrice = approve(
    staleRepository,
    clone(vehicleKnowledgeFixtureProposals.staleListingPrice),
    "2025-01-02T00:00:00.000Z",
  );
  const stale = compileVehicleKnowledge(staleRepository.getKnowledgeSnapshot(stalePrice.vehicleId, asOf));
  assert.equal(stale.record.financial.purchasePrice.value, null);
  assert.equal(stale.record.financial.purchasePrice.missingReason, "stale");
  assert.equal(stale.summary.staleFields, 1);
  assert.ok(stale.diagnostics.some((item) => item.code === "stale_claim_available" && item.fieldPath === "financial.purchasePrice"));

  // 6-8. Rejected, proposed, and superseded claims remain inactive.
  const inactiveRepository = fixtureRepository("compiler-inactive");
  const rejected = inactiveRepository.addProposal(clone(vehicleKnowledgeFixtureProposals.rejectedSafetyClaim));
  assert.equal(rejected.claimStatus, "rejected");
  const proposedInput = clone(vehicleKnowledgeFixtureProposals.reviewedFuelEconomy);
  proposedInput.reviewDecision = null;
  const proposed = inactiveRepository.addProposal(proposedInput);
  assert.equal(proposed.claimStatus, "proposed");
  const oldCost = approve(inactiveRepository, staleFuelCostRevision(), "2024-01-02T00:00:00.000Z");
  const newCost = approve(inactiveRepository, clone(vehicleKnowledgeFixtureProposals.newEpaFuelCost));
  inactiveRepository.supersedeClaim(oldCost.claimId, newCost.claimId, transition("Newer fixture replaces old cost."));
  const inactive = compileVehicleKnowledge(inactiveRepository.getKnowledgeSnapshot(oldCost.vehicleId, asOf));
  assert.equal(inactive.record.safety.crashSafety.value, null);
  assert.equal(inactive.record.environment.fuelEconomy.value, null);
  assert.equal(inactive.record.financial.fuelEnergyCost.value, 202);
  assert.equal(inactive.claimLineage[oldCost.claimId], undefined, "Superseded knowledge must not support the active value.");
  assert.equal(inactive.summary.staleFields, 0);
  assert.equal(inactiveRepository.getKnowledgeSnapshot(oldCost.vehicleId, asOf).historicalStaleClaims.some((claim) => claim.claimId === oldCost.claimId), true);
  assert.equal(inactive.diagnostics.some((item) => item.code === "stale_claim_available" && item.fieldPath === "financial.fuelEnergyCost"), false);
  assert.deepEqual(
    inactive.lineage.find((item) => item.canonicalFieldPath === "financial.fuelEnergyCost")?.activeClaimIds,
    [newCost.claimId],
  );

  // Several unresolved stale claims for one field count as one current stale field.
  const staleOnlySnapshot = staleRepository.getKnowledgeSnapshot(stalePrice.vehicleId, asOf);
  const repeatedStaleClaims = [0, 1, 2].map((index) => ({
    ...clone(staleOnlySnapshot.staleClaims[0]),
    claimId: `${staleOnlySnapshot.staleClaims[0].claimId}:history-${index}`,
  }));
  const repeatedStaleSnapshot: VehicleKnowledgeSnapshot = {
    ...clone(staleOnlySnapshot),
    staleClaims: repeatedStaleClaims,
    inactiveClaims: clone(repeatedStaleClaims),
  };
  const repeatedStale = compileVehicleKnowledge(repeatedStaleSnapshot);
  assert.equal(repeatedStale.summary.staleFields, 1);
  assert.equal(repeatedStale.unresolvedFields.find((field) => field.fieldPath === "financial.purchasePrice")?.staleClaimIds.length, 3);

  // Historical stale knowledge on another field remains visible but cannot poison current compilation.
  const historicalOnlySnapshot: VehicleKnowledgeSnapshot = {
    ...clone(basicSnapshot),
    historicalStaleClaims: clone(staleOnlySnapshot.staleClaims),
    staleClaims: [],
  };
  const historicalOnly = compileVehicleKnowledge(historicalOnlySnapshot);
  assert.equal(historicalOnly.summary.staleFields, 0);
  assert.equal(historicalOnly.diagnostics.some((item) => item.code === "stale_claim_available"), false);

  // 9. A blocking conflict remains unresolved and input ordering cannot elect a winner.
  const conflictRepository = fixtureRepository("compiler-conflict");
  const conflictNhtsa = approve(conflictRepository, clone(vehicleKnowledgeFixtureProposals.conflictingNhtsaDrivetrain));
  approve(conflictRepository, clone(vehicleKnowledgeFixtureProposals.conflictingOemDrivetrain));
  const conflictSnapshot = conflictRepository.getKnowledgeSnapshot(conflictNhtsa.vehicleId, asOf);
  const conflict = compileVehicleKnowledge(conflictSnapshot);
  assert.equal(conflict.record.identity.drivetrain.value, null);
  assert.equal(conflict.record.identity.drivetrain.missingReason, "source_conflict");
  assert.ok(conflict.diagnostics.some((item) => item.code === "unresolved_conflict"));

  // 10. No repository knowledge produces an explicit not_collected datum.
  const sparseRepository = fixtureRepository("compiler-sparse");
  const sparseMake = approve(sparseRepository, clone(vehicleKnowledgeFixtureProposals.nhtsaIdentity));
  const sparseSnapshot = sparseRepository.getKnowledgeSnapshot(sparseMake.vehicleId, asOf);
  const sparse = compileVehicleKnowledge(sparseSnapshot);
  assert.equal(sparse.record.identity.model.value, null);
  assert.equal(sparse.record.identity.model.missingReason, "not_collected");

  // A required identity field with only current stale knowledge remains unresolved and blocking-ready.
  const staleMake = {
    ...clone(sparseSnapshot.activeClaims[0]),
    trustAssessment: { ...clone(sparseSnapshot.activeClaims[0].trustAssessment), trustState: "STALE" as const },
  };
  const staleIdentitySnapshot: VehicleKnowledgeSnapshot = {
    ...clone(sparseSnapshot),
    activeClaims: [],
    inactiveClaims: [staleMake],
    staleClaims: [staleMake],
    historicalStaleClaims: [],
  };
  const staleIdentity = compileVehicleKnowledge(staleIdentitySnapshot);
  assert.equal(staleIdentity.record.identity.make.value, null);
  assert.equal(staleIdentity.record.identity.make.missingReason, "stale");
  assert.equal(staleIdentity.summary.staleFields, 1);

  // 11-13. Compatible claims preserve every supporting claim and evidence reference.
  const agreementLineage = agreement.lineage.find((item) => item.canonicalFieldPath === "identity.drivetrain")!;
  assert.deepEqual(agreementLineage.activeClaimIds, [nhtsaDrive.claimId, oemDrive.claimId].sort());
  assert.equal(agreementLineage.evidenceIds.length, 2);
  assert.equal(agreementLineage.compilationRule, "compatible_active_trusted_claims");
  assert.ok(agreementLineage.evidenceIds.every((id) => agreement.record.evidence.some((evidence) => evidence.evidenceId === id)));
  assert.ok(agreementLineage.activeClaimIds.every((id) => agreement.claimLineage[id]?.trustAssessment.trustState === "TRUSTED"));

  // 14. Missing evidence invalidates the active claim and emits a typed diagnostic.
  const missingEvidenceSnapshot: VehicleKnowledgeSnapshot = {
    ...clone(basicSnapshot),
    evidence: basicSnapshot.evidence.filter(
      (item) => !basicSnapshot.activeClaims[0].evidenceIds.includes(item.evidenceId),
    ),
  };
  const missingEvidence = compileVehicleKnowledge(missingEvidenceSnapshot);
  assert.ok(missingEvidence.diagnostics.some((item) => item.code === "evidence_reference_missing"));
  assert.equal(getDatum(missingEvidence.record, basicSnapshot.activeClaims[0].canonicalFieldPath).value, null);

  // 15. A unit mismatch is rejected safely rather than coerced.
  const unitMismatchSnapshot: VehicleKnowledgeSnapshot = {
    ...clone(basicSnapshot),
    activeClaims: basicSnapshot.activeClaims.map((claim) => claim.canonicalFieldPath === "environment.fuelEconomy"
      ? { ...clone(claim), unit: "usd" }
      : clone(claim)),
  };
  const unitMismatch = compileVehicleKnowledge(unitMismatchSnapshot);
  assert.equal(unitMismatch.record.environment.fuelEconomy.value, null);
  assert.equal(unitMismatch.record.environment.fuelEconomy.missingReason, "invalid");
  assert.ok(unitMismatch.diagnostics.some((item) => item.code === "unit_mismatch"));

  const unsupportedSnapshot: VehicleKnowledgeSnapshot = {
    ...clone(agreementSnapshot),
    activeClaims: agreementSnapshot.activeClaims.map((claim) => ({ ...clone(claim), canonicalValue: "sideways" })),
  };
  const unsupported = compileVehicleKnowledge(unsupportedSnapshot);
  assert.equal(unsupported.record.identity.drivetrain.missingReason, "unsupported");
  assert.ok(unsupported.diagnostics.some((item) => item.code === "unsupported_value"));

  // 16-17. Derived and estimated status are preserved; trust does not upgrade provenance.
  const derivedSnapshot = singleStatusSnapshot(basicSnapshot, "financial.totalOwnershipCost", 410, "usd_per_month", "derived");
  const estimatedSnapshot = singleStatusSnapshot(basicSnapshot, "financial.maintenanceCost", 95, "usd_per_month", "estimated");
  assert.equal(compileVehicleKnowledge(derivedSnapshot).record.financial.totalOwnershipCost.status, "derived");
  assert.equal(compileVehicleKnowledge(estimatedSnapshot).record.financial.maintenanceCost.status, "estimated");

  // 18-19. Coverage and agreement are record-level facts distinct from field trust.
  assert.ok((sparse.record.confidence.dataQuality.value ?? 100) < 10);
  assert.equal(sparse.record.confidence.dataQuality.value, sparse.summary.coverage);
  assert.ok((agreement.record.confidence.sourceAgreement.value ?? 0) > (conflict.record.confidence.sourceAgreement.value ?? 100));

  // 20. Every one of the authoritative 73 canonical fields is materialized.
  assert.equal(canonicalVehicleFieldPaths.length, 73);
  assert.equal(countCanonicalData(basic.record), 73);
  for (const path of canonicalVehicleFieldPaths) assert.ok(getDatum(basic.record, path));

  // 21-24. Identity, output, purity, and claim ordering are deterministic.
  const inputBefore = JSON.stringify(agreementSnapshot);
  const repeated = compileVehicleKnowledge(agreementSnapshot);
  assert.equal(repeated.record.recordId, agreement.record.recordId);
  assert.deepEqual(repeated, agreement);
  assert.equal(JSON.stringify(agreementSnapshot), inputBefore);
  const reversed = clone(agreementSnapshot);
  reversed.activeClaims.reverse();
  reversed.inactiveClaims.reverse();
  reversed.evidence.reverse();
  assert.deepEqual(compileVehicleKnowledge(reversed), agreement);

  // 25-27. Compiler source is isolated from catalog, network, and recommendation execution.
  const compilerSource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/vehicle-knowledge-compiler.ts"), "utf8");
  assert.equal(compilerSource.includes("vehicleCatalog"), false);
  assert.equal(/from\s+["'][^"']*(recommendation|vehicleCatalog)/.test(compilerSource), false);
  assert.equal(/\b(addProposal|approveClaim|rejectClaim|supersedeClaim|withdrawClaim)\s*\(/.test(compilerSource), false);
  assert.equal(networkCalls, 0);
  assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);

  const reports = {
    A_epa_mpg_nhtsa_identity: fixtureReport(basicSnapshot, basic),
    B_agreeing_drivetrain: fixtureReport(agreementSnapshot, agreement),
    C_conflicting_drivetrain: fixtureReport(conflictSnapshot, conflict),
    D_stale_financial_claim: fixtureReport(staleRepository.getKnowledgeSnapshot(stalePrice.vehicleId, asOf), stale),
    E_sparse_identity: fixtureReport(sparseSnapshot, sparse),
  };

  console.log("Vehicle knowledge compiler passed all 27 permanent compiler requirements.");
  console.log(JSON.stringify(reports, null, 2));
}

function fixtureRepository(id: string) {
  return createVehicleKnowledgeRepository({
    repositoryId: id,
    dataUse: "fixture",
    createdAt: "2025-01-01T00:00:00.000Z",
  });
}

function approve(
  repository: ReturnType<typeof fixtureRepository>,
  proposal: VehicleKnowledgeProposal,
  occurredAt = asOf,
) {
  const claim = repository.addProposal(proposal);
  return repository.approveClaim(claim.claimId, transition("Approved compiler fixture.", occurredAt));
}

function transition(reason: string, occurredAt = asOf) {
  return { occurredAt, reason, reviewDecision: null };
}

function withCompatibleActiveClaims(
  snapshot: VehicleKnowledgeSnapshot,
  claims: VehicleKnowledgeClaim[],
): VehicleKnowledgeSnapshot {
  const activeIds = new Set(claims.map((claim) => claim.claimId));
  return {
    ...clone(snapshot),
    activeClaims: clone(claims),
    inactiveClaims: clone(snapshot.inactiveClaims.filter((claim) => !activeIds.has(claim.claimId))),
  };
}

function singleStatusSnapshot(
  source: VehicleKnowledgeSnapshot,
  fieldPath: CanonicalVehicleFieldPath,
  value: number,
  unit: VehicleKnowledgeClaim["unit"],
  valueStatus: "derived" | "estimated",
): VehicleKnowledgeSnapshot {
  const sourceClaim = source.activeClaims[0];
  const claim: VehicleKnowledgeClaim = {
    ...clone(sourceClaim),
    claimId: `fixture-${valueStatus}-claim`,
    canonicalFieldPath: fieldPath,
    canonicalValue: value,
    unit,
    valueStatus,
    estimationMethod: `Controlled ${valueStatus} fixture.`,
    normalizationMethod: valueStatus,
    source: {
      ...clone(sourceClaim.source),
      sourceType: "derived",
      providerName: "Controlled compiler fixture",
      sourceRecordId: `fixture-${valueStatus}`,
    },
    sourceRecordId: `fixture-${valueStatus}`,
    evidenceIds: [`fixture-${valueStatus}-evidence`],
  };
  const evidence = {
    ...clone(source.evidence[0]),
    evidenceId: claim.evidenceIds[0],
    sourceType: "derived" as const,
    providerName: "Controlled compiler fixture",
    sourceRecordId: claim.sourceRecordId,
    normalizationMethod: valueStatus,
    sourceClaims: [{ sourceField: fieldPath, originalSourceValue: value }],
  };
  return {
    ...clone(source),
    activeClaims: [claim],
    inactiveClaims: [],
    conflictedClaims: [],
    unresolvedConflicts: [],
    staleClaims: [],
    historicalStaleClaims: [],
    evidence: [evidence],
  };
}

function staleFuelCostRevision(): VehicleKnowledgeProposal {
  const proposal = clone(vehicleKnowledgeFixtureProposals.oldEpaFuelCost);
  proposal.source = {
    ...proposal.source,
    sourceRecordId: "epa-cost-old-stale",
    observedAt: "2024-01-01T00:00:00.000Z",
    retrievedAt: "2024-01-01T00:00:00.000Z",
  };
  proposal.evidence = proposal.evidence.map((evidence) => ({
    ...evidence,
    evidenceId: "fixture-evidence:epa-cost-old-stale:fuel-cost",
    sourceRecordId: "epa-cost-old-stale",
    observedAt: "2024-01-01T00:00:00.000Z",
    retrievedAt: "2024-01-01T00:00:00.000Z",
  }));
  proposal.createdAt = "2024-01-01T00:00:00.000Z";
  proposal.effectiveFrom = "2024-01-01T00:00:00.000Z";
  return proposal;
}

function getDatum(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath): CanonicalDatum<unknown> {
  const [section, field] = path.split(".");
  return (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field];
}

function countCanonicalData(record: CanonicalVehicleRecord) {
  return canonicalVehicleSectionNames.reduce(
    (count, section) => count + canonicalVehicleFieldNames[section].filter((field) => Boolean((record[section] as Record<string, unknown>)[field])).length,
    0,
  );
}

function fixtureReport(snapshot: VehicleKnowledgeSnapshot, result: KnowledgeCompilationResult) {
  return {
    trustedClaimsAvailable: snapshot.trustSummary.trustedCount,
    activeClaimsUsed: result.summary.trustedClaimsUsed,
    populatedFields: result.summary.populatedFields,
    missingFields: result.summary.missingFields,
    staleFields: result.summary.staleFields,
    conflicts: result.summary.conflictedFields,
    evidenceUsed: result.summary.evidenceRecordsUsed,
    dataQualityConfidence: result.record.confidence.dataQuality.value,
    evidenceQualityConfidence: result.record.confidence.evidenceQuality.value,
    sourceAgreementConfidence: result.record.confidence.sourceAgreement.value,
    diagnostics: result.diagnostics.reduce<Record<string, number>>((counts, diagnostic) => {
      counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
