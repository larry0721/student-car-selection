import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluateCVRForPublishing, cvrPublishingPolicyVersion } from "../src/vehicle-intelligence/canonical-vehicle-publishing-policy";
import { loadPublishedCVRRepository, serializePublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";
import { evaluateShadowRecommendationReadiness } from "../src/vehicle-intelligence/shadow-recommendation-readiness";
import { normalizeNhtsaSafetyToContribution } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-contribution-adapter";
import { getNhtsaSafetyIdentity, getNhtsaSafetyIntelligence } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-intelligence";
import { compileVehicleKnowledge, vehicleKnowledgeCompilerVersion } from "../src/vehicle-intelligence/vehicle-knowledge-compiler";
import { createVehicleKnowledgeProposalsFromContribution, loadVehicleKnowledgeRepository, serializeVehicleKnowledgeRepository } from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import { vehicleKnowledgeTrustPolicyVersion } from "../src/vehicle-intelligence/vehicle-knowledge-trust-policy";
import type { BuyerProfile } from "../types/buyer";
import type { CanonicalVehicleFieldPath } from "../types/canonicalVehicle";
import type { PublishCanonicalVehicleInput } from "../types/publishedVehicleIntelligence";
import type { NhtsaSafetyRecord } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-client";
import type { Vehicle } from "../types/vehicle";

const root = process.cwd();
const catalogPath = join(root, "data/processed/vehicleCatalog.json");
const knowledgePath = join(root, "data/vehicle-knowledge/repositories/phase-3.2e-reviewed-golden.json");
const publishedPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const reportPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.nhtsa-safety-report.json");
const catalogSerialized = readFileSync(catalogPath, "utf8");
const knowledgeSerialized = readFileSync(knowledgePath, "utf8");
const publishedSerialized = readFileSync(publishedPath, "utf8");
const catalog = JSON.parse(catalogSerialized) as Vehicle[];
const knowledge = loadVehicleKnowledgeRepository(knowledgeSerialized);
const publications = loadPublishedCVRRepository(publishedSerialized);
const originalEpaClaims = stable(knowledge.exportState().claims.filter((claim) => claim.source.sourceType === "epa"));
const runAt = new Date().toISOString();

const expected = [
  { vehicleId: "hyundai-accent-2017-craigslist-carstrucks-data", label: "2017 Hyundai Accent", nhtsaVehicleId: 11111, baseline: { overall: 4, front: 4, side: 4, rollover: 4, rolloverRatio: 0.124 } },
  { vehicleId: "toyota-prius-2016-usedcarscatalog", label: "2016 Toyota Prius", nhtsaVehicleId: 10111, baseline: { overall: 5, front: 4, side: 5, rollover: 4, rolloverRatio: 0.107 } },
  { vehicleId: "toyota-rav4-2016-craigslist-carstrucks-data", label: "2016 Toyota RAV4", nhtsaVehicleId: 10114, baseline: { overall: 5, front: 4, side: 5, rollover: 4, rolloverRatio: 0.174 } },
  { vehicleId: "honda-cr-v-2016-craigslist-carstrucks-data", label: "2016 Honda CR-V", nhtsaVehicleId: 10170, baseline: { overall: 5, front: 5, side: 5, rollover: 4, rolloverRatio: 0.174 } },
  { vehicleId: "nissan-leaf-2018-craigslist-carstrucks-data", label: "2018 Nissan Leaf", nhtsaVehicleId: 12789, baseline: null },
] as const;

async function main() {
  const initialPublications = publications.listPublishedVehicles();
  assert.equal(initialPublications.length, 5);
  const before = evaluateShadowRecommendationReadiness({ buyerProfileId: "profile-a-safety-reliability-before", buyerProfile: profileA(), catalog, publications: initialPublications });
  const sourceResults = [];

  for (const spec of expected) {
    const active = publications.getActivePublicationForVehicle(spec.vehicleId);
    assert.ok(active, `Missing active publication for ${spec.vehicleId}`);
    const identity = getNhtsaSafetyIdentity(active.canonicalRecord);
    const result = await getNhtsaSafetyIntelligence(identity);
    assert.notEqual(result.state, "SOURCE_FAILURE", `${spec.label}: ${result.error}`);
    assert.notEqual(result.state, "NO_MATCH", `${spec.label}: no NHTSA Safety match`);
    assert.notEqual(result.state, "AMBIGUOUS_MATCH", `${spec.label}: ambiguous NHTSA Safety match`);
    assert.equal(result.match?.selectedCandidate?.vehicleId, spec.nhtsaVehicleId, `${spec.label}: live matched VehicleId differs from manual baseline`);
    assert.ok(result.record);
    const baselineDifferences = compareBaseline(result.record, spec.baseline);
    const normalized = normalizeNhtsaSafetyToContribution({ record: result.record, dataUse: "production" }, {
      ingestionId: `phase-3.3a:${spec.vehicleId}`,
      retrievedAt: runAt,
      market: "US",
      sourceType: "nhtsa",
    });
    assert.ok(normalized.contribution);
    const proposals = createVehicleKnowledgeProposalsFromContribution(spec.vehicleId, normalized.contribution, {
      createdAt: runAt,
      dataClassification: "verified_source",
    });
    const claims = [];
    for (const proposal of proposals) {
      const existing = knowledge.getClaimsForVehicle(spec.vehicleId).find((claim) =>
        claim.canonicalFieldPath === proposal.canonicalFieldPath
        && claim.source.providerName === proposal.source.providerName
        && claim.sourceRecordId === proposal.source.sourceRecordId
        && stable(claim.canonicalValue) === stable(proposal.canonicalValue));
      let claim = existing ?? knowledge.addProposal(proposal);
      if (claim.claimStatus === "proposed" || claim.claimStatus === "conflicted") {
        claim = knowledge.approveClaim(claim.claimId, {
          occurredAt: runAt,
          reason: "Deterministic exact NHTSA Safety configuration match with direct official NCAP evidence and trusted field authority.",
        });
      }
      assert.equal(claim.trustAssessment.trustState, "TRUSTED");
      assert.equal(claim.claimStatus, "approved");
      claims.push({ claimId: claim.claimId, field: claim.canonicalFieldPath, value: claim.canonicalValue, trustScore: claim.trustAssessment.trustScore, evidenceIds: claim.evidenceIds });
    }
    if (result.state === "NOT_RATED") assert.equal(claims.length, 0, "NOT_RATED must not create a numeric safety claim.");
    sourceResults.push({
      vehicleId: spec.vehicleId,
      label: spec.label,
      expectedVehicleId: spec.nhtsaVehicleId,
      sourceState: result.state,
      match: result.match,
      record: result.record,
      baselineDifferences,
      contribution: normalized.contribution,
      claims,
    });
  }

  assert.equal(stable(knowledge.exportState().claims.filter((claim) => claim.source.sourceType === "epa")), originalEpaClaims, "EPA claims changed during NHTSA ingestion.");
  const knowledgeState = knowledge.exportState();
  const publicationsBeforeRevision = new Map(publications.listPublishedVehicles().map((item) => [item.vehicleId, item]));
  const sourceResultByVehicle = new Map(sourceResults.map((item) => [item.vehicleId, item]));
  const revisionResults = [];

  for (const spec of expected) {
    const snapshot = knowledge.getKnowledgeSnapshot(spec.vehicleId, knowledgeState.updatedAt);
    const compilation = compileVehicleKnowledge(snapshot);
    const decision = evaluateCVRForPublishing(compilation);
    const activeBefore = publicationsBeforeRevision.get(spec.vehicleId)!;
    const publishInput: PublishCanonicalVehicleInput = {
      vehicleId: spec.vehicleId,
      canonicalRecord: compilation.record,
      publishingDecision: decision,
      sourceKnowledgeSnapshotId: activeBefore.sourceKnowledgeSnapshotId ?? `vehicle-knowledge-snapshot:${stableHash(spec.vehicleId)}`,
      sourceKnowledgeSnapshotVersion: `${knowledgeState.updatedAt}:${stableHash(stable(snapshot))}`,
      compilerVersion: vehicleKnowledgeCompilerVersion,
      trustPolicyVersion: vehicleKnowledgeTrustPolicyVersion,
      publishingPolicyVersion: cvrPublishingPolicyVersion,
      publishedAt: runAt,
      dataClassification: "production",
    };
    let publication = activeBefore;
    const hasNewCanonicalSafetyClaim = Boolean(sourceResultByVehicle.get(spec.vehicleId)?.claims.length);
    if (decision.action === "PUBLISH" && hasNewCanonicalSafetyClaim) publication = publications.publish(publishInput);
    const history = publications.getPublicationHistory(spec.vehicleId);
    revisionResults.push({
      vehicleId: spec.vehicleId,
      label: spec.label,
      publishingDecision: decision.action,
      publishScore: decision.publishabilityScore,
      publicationSkippedReason: hasNewCanonicalSafetyClaim ? null : "No numeric NHTSA safety claim changed canonical content.",
      previousPublicationId: activeBefore.publicationId,
      activePublicationId: publication.publicationId,
      activeVersion: publication.recordVersion,
      meaningfulChange: publication.publicationId !== activeBefore.publicationId,
      history: history.map((item) => ({ publicationId: item.publicationId, version: item.recordVersion, status: item.publicationStatus, fingerprint: item.fingerprint })),
    });
  }

  const activeAfter = publications.listPublishedVehicles();
  const after = evaluateShadowRecommendationReadiness({ buyerProfileId: "profile-a-safety-reliability-after", buyerProfile: profileA(), catalog, publications: activeAfter });
  const profileAComparison = expected.map((spec) => {
    const beforeVehicle = before.vehicleComparisons.find((item) => item.vehicleId === spec.vehicleId)!;
    const afterVehicle = after.vehicleComparisons.find((item) => item.vehicleId === spec.vehicleId)!;
    return {
      vehicleId: spec.vehicleId,
      label: spec.label,
      safetyCoverageBefore: dimensionCoverage(beforeVehicle, "safety"),
      safetyCoverageAfter: dimensionCoverage(afterVehicle, "safety"),
      reliabilityCoverageBefore: dimensionCoverage(beforeVehicle, "reliability"),
      reliabilityCoverageAfter: dimensionCoverage(afterVehicle, "reliability"),
      combinedCoverageBefore: beforeVehicle.decisionCoverage,
      combinedCoverageAfter: afterVehicle.decisionCoverage,
      readinessBefore: beforeVehicle.readiness,
      readinessAfter: afterVehicle.readiness,
    };
  });

  assert.equal(readFileSync(catalogPath, "utf8"), catalogSerialized);
  const report = {
    schemaVersion: "1.0.0",
    runAt,
    source: "NHTSA Safety Ratings / NCAP",
    productionRecommendationConnected: false,
    originalCatalogMutated: false,
    sourceResults,
    revisionResults,
    profileAComparison,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(knowledgePath, serializeVehicleKnowledgeRepository(knowledge), { mode: 0o600 });
  writeFileSync(publishedPath, serializePublishedCVRRepository(publications), { mode: 0o600 });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

function profileA(): BuyerProfile {
  return {
    maxPurchaseBudget: 0, monthlyBudget: 0, downPayment: 0, loanTermMonths: 60, apr: 7,
    paymentMethod: "not-sure", purchaseCondition: "any", expectedAnnualMileage: 12000, fuelPrice: 3.5,
    insuranceBudget: 0, minYear: 0, maxMileage: 0, minMpg: 0, fuelEconomyImportance: 0,
    reliabilityImportance: 5, performanceImportance: 0, cargoNeed: "not-sure", familySize: 0,
    drivetrainPreference: "any", transmissionPreference: "any", bodyStyle: "any", climate: "not-sure",
    resaleValueImportance: 0, modificationPlans: "not-sure", advancedFeaturesImportance: 0,
    safetyPriority: "maximum", scoreWeights: { affordability: 0, reliability: 50, safety: 50, fuelEnergyCost: 0, insuranceCost: 0, maintenanceRisk: 0, practicality: 0, resaleValue: 0, drivingPreferenceFit: 0 },
    decisionPolicies: {
      reliability: decisionPolicy("reliability"),
      safety: decisionPolicy("safety"),
      affordability: { ...decisionPolicy("affordability"), participation: "deprioritized", importance: 0 },
    },
  };
}

function decisionPolicy(dimension: "reliability" | "safety" | "affordability") {
  return { dimension, participation: "active" as const, importance: 1, source: "user_confirmed" as const, confidence: 1, confirmation: "confirmed" as const, sourceText: `Profile A ${dimension}`, messageRef: `phase-3.3a:${dimension}`, explanation: "Controlled safety readiness profile." };
}

function compareBaseline(record: NhtsaSafetyRecord, baseline: typeof expected[number]["baseline"]) {
  if (!baseline) return record.ratingState === "NOT_RATED" ? [] : ["Expected NOT_RATED but live source returned rated data."];
  const checks = [
    ["overall", record.ratings.overall, baseline.overall],
    ["overallFrontCrash", record.ratings.overallFrontCrash, baseline.front],
    ["overallSideCrash", record.ratings.overallSideCrash, baseline.side],
    ["rollover", record.ratings.rollover, baseline.rollover],
    ["rolloverPossibilityRatio", record.ratings.rolloverPossibilityRatio, baseline.rolloverRatio],
  ] as const;
  return checks.filter(([, actual, expectedValue]) => actual !== expectedValue).map(([field, actual, expectedValue]) => `${field}: live=${actual}, baseline=${expectedValue}`);
}

function dimensionCoverage(comparison: ReturnType<typeof evaluateShadowRecommendationReadiness>["vehicleComparisons"][number], dimension: "safety" | "reliability") {
  return Math.round(100 * (comparison.decisionReadiness.relevantDimensions.find((item) => item.dimension === dimension)?.supportRatio ?? 0));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
