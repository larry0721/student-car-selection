import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeEpaVehicleToContribution } from "../src/vehicle-intelligence/sources/epa/epa-contribution-adapter";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import {
  cvrPublishingPolicy,
  evaluateCVRForPublishing,
} from "../src/vehicle-intelligence/canonical-vehicle-publishing-policy";
import { compileVehicleKnowledge } from "../src/vehicle-intelligence/vehicle-knowledge-compiler";
import {
  createVehicleKnowledgeProposalsFromContribution,
  createVehicleKnowledgeRepository,
} from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import type { CatalogEnrichmentReviewDecision } from "../types/catalogEnrichmentReview";

const asOf = "2026-08-12T04:03:06.693Z";
const catalogPath = join(process.cwd(), "data/processed/vehicleCatalog.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const originalFetch = globalThis.fetch;

const goldenSources = [
  {
    vehicleId: "toyota-rav4-2016-craigslist-carstrucks-data",
    expectedVehicle: "2016 Toyota RAV4",
    source: {
      id: "37086",
      year: 2016,
      make: "Toyota",
      model: "RAV4",
      VClass: "Small Sport Utility Vehicle 2WD",
      drive: "Front-Wheel Drive",
      trany: "Automatic (S6)",
      fuelType: "Regular",
      fuelType1: "Regular Gasoline",
      fuelType2: null,
      atvType: null,
      createdOn: "2015-10-28T00:00:00-04:00",
      modifiedOn: "2016-09-26T00:00:00-04:00",
      cylinders: 4,
      displ: 2.5,
      city08: 23,
      highway08: 29,
      comb08: 25,
      cityA08: 0,
      highwayA08: 0,
      combA08: 0,
      range: 0,
      rangeCity: 0,
      rangeHwy: 0,
      charge240: 0,
      charge120: 0,
      cityE: 0,
      highwayE: 0,
      combE: 0,
      fuelCost08: 2450,
      fuelCostA08: 0,
      co2: 349,
      co2TailpipeGpm: 349,
      co2TailpipeAGpm: 0,
      ghgScore: 6,
      ghgScoreA: null,
      feScore: 6,
    } satisfies EpaVehicleRecord,
  },
  {
    vehicleId: "honda-cr-v-2016-craigslist-carstrucks-data",
    expectedVehicle: "2016 Honda CR-V 4WD",
    source: {
      id: "37024",
      year: 2016,
      make: "Honda",
      model: "CR-V 4WD",
      VClass: "Small Sport Utility Vehicle 4WD",
      drive: "All-Wheel Drive",
      trany: "Automatic (variable gear ratios)",
      fuelType: "Regular",
      fuelType1: "Regular Gasoline",
      fuelType2: null,
      atvType: null,
      createdOn: "2015-10-12T00:00:00-04:00",
      modifiedOn: "2016-09-26T00:00:00-04:00",
      cylinders: 4,
      displ: 2.4,
      city08: 25,
      highway08: 31,
      comb08: 27,
      cityA08: 0,
      highwayA08: 0,
      combA08: 0,
      range: 0,
      rangeCity: 0,
      rangeHwy: 0,
      charge240: 0,
      charge120: 0,
      cityE: 0,
      highwayE: 0,
      combE: 0,
      fuelCost08: 2300,
      fuelCostA08: 0,
      co2: 326,
      co2TailpipeGpm: 326,
      co2TailpipeAGpm: 0,
      ghgScore: 6,
      ghgScoreA: null,
      feScore: 6,
    } satisfies EpaVehicleRecord,
  },
] as const;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});

async function run() {
  globalThis.fetch = async () => {
    throw new Error("Golden stale-semantics tests must remain offline.");
  };
  assert.equal(cvrPublishingPolicy.maximumBlockingStaleFields, 0);

  const results = goldenSources.map((fixture) => {
    const decision = reviewDecision(fixture.vehicleId, fixture.source);
    const normalized = normalizeEpaVehicleToContribution(fixture.source, {
      ingestionId: `golden-stale-test:${fixture.vehicleId}`,
      retrievedAt: asOf,
      market: "US",
      sourceType: "epa",
    }, { dataUse: "fixture" });
    assert.ok(normalized.contribution);

    const repository = createVehicleKnowledgeRepository({
      repositoryId: `golden-stale-test:${fixture.vehicleId}`,
      dataUse: "fixture",
      createdAt: asOf,
    });
    const proposals = createVehicleKnowledgeProposalsFromContribution(
      fixture.vehicleId,
      normalized.contribution!,
      { createdAt: asOf, reviewDecision: decision, dataClassification: "fixture" },
    );
    for (const proposal of proposals) {
      const claim = repository.addProposal(proposal);
      if (claim.claimStatus === "proposed" || claim.claimStatus === "conflicted") {
        repository.approveClaim(claim.claimId, {
          occurredAt: asOf,
          reason: `Controlled replay of owner-approved EPA ${fixture.source.id}.`,
          reviewDecision: decision,
        });
      }
    }

    const snapshot = repository.getKnowledgeSnapshot(fixture.vehicleId, asOf);
    const compilation = compileVehicleKnowledge(snapshot);
    const publishing = evaluateCVRForPublishing(compilation);

    assert.equal(snapshot.activeClaims.length, 10);
    assert.equal(snapshot.staleClaims.length, 1);
    assert.equal(snapshot.historicalStaleClaims.length, 0);
    assert.equal(snapshot.trustSummary.unresolvedStaleFieldCount, 1);
    assert.equal(snapshot.staleClaims[0].canonicalFieldPath, "financial.fuelEnergyCost");
    assert.equal(compilation.record.financial.fuelEnergyCost.value, null);
    assert.equal(compilation.record.financial.fuelEnergyCost.missingReason, "stale");
    assert.equal(compilation.summary.staleFields, 1);
    assert.equal(compilation.summary.trustedClaimsUsed, 10);
    assert.equal(publishing.metrics.staleFields, 1);
    assert.equal(publishing.metrics.blockingStaleFields, 0);
    assert.equal(publishing.metrics.nonBlockingStaleFields, 1);
    assert.equal(publishing.action, "PUBLISH");
    assert.ok(publishing.publishedRecord);

    return {
      vehicle: fixture.expectedVehicle,
      sourceId: fixture.source.id,
      activeTrustedClaims: snapshot.activeClaims.length,
      historicalStaleClaims: snapshot.historicalStaleClaims.length,
      unresolvedStaleFields: compilation.summary.staleFields,
      fuelEconomy: compilation.record.environment.fuelEconomy.value,
      fuelEconomyUnit: compilation.record.environment.fuelEconomy.unit,
      fuelEnergyCost: compilation.record.financial.fuelEnergyCost.value,
      fuelEnergyCostMissingReason: compilation.record.financial.fuelEnergyCost.missingReason,
      publishabilityScore: publishing.publishabilityScore,
      decision: publishing.action,
    };
  });

  assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);
  console.log("Golden stale semantics passed: RAV4 and CR-V retain genuinely unresolved stale fuel cost without blocking stable CVR publication.");
  console.log(JSON.stringify({ maximumBlockingStaleFields: cvrPublishingPolicy.maximumBlockingStaleFields, results }, null, 2));
}

function reviewDecision(
  vehicleId: string,
  source: EpaVehicleRecord,
): CatalogEnrichmentReviewDecision {
  return {
    decisionId: `${vehicleId}:epa:v1`,
    reviewId: `${vehicleId}:epa`,
    catalogVehicleId: vehicleId,
    source: "epa",
    action: "APPROVE_SOURCE",
    selectedSourceRecordId: source.id,
    selectedCandidateSnapshot: JSON.parse(JSON.stringify(source)) as EpaVehicleRecord,
    reason: `Project owner approved EPA ${source.id} for controlled golden evaluation.`,
    evidence: [{ kind: "source_record", reference: source.id, note: "Controlled golden regression fixture." }],
    catalogCorrections: [],
    resolvedConflicts: [],
    unresolvedFields: [],
    reviewedCandidateIds: [source.id],
    reviewer: { reviewerId: "project_owner", displayName: "Project Owner" },
    decidedAt: asOf,
    reviewVersion: 1,
    supersedesDecisionId: null,
    dataUse: "fixture",
  };
}
