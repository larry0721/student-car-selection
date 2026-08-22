import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDecisionReport, runCandidatePipeline } from "../lib/recommendations";
import { loadPublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";
import { evaluateShadowRecommendationReadiness } from "../src/vehicle-intelligence/shadow-recommendation-readiness";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { CanonicalDatum, CanonicalVehicleFieldPath } from "../types/canonicalVehicle";
import type { DecisionParticipation, DecisionParticipationPolicy, DecisionPolicyDimension } from "../types/decisionPolicy";
import type { PublishedVehicleIntelligenceRecord } from "../types/publishedVehicleIntelligence";
import type { ShadowRecommendationReadinessComparison } from "../types/shadowRecommendationReadiness";
import type { Vehicle } from "../types/vehicle";

const catalog = JSON.parse(readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8")) as Vehicle[];
const repositorySerialized = readFileSync(join(process.cwd(), "data/published-vehicle-intelligence/repositories/golden-set-v1.json"), "utf8");
const publications = loadPublishedCVRRepository(repositorySerialized).listPublishedVehicles();
const publicationHistory = (JSON.parse(repositorySerialized) as { publications: Array<{ vehicleId: string; recordVersion: number; fingerprint: string }> }).publications;
const catalogBefore = stableValue(catalog);
const zeroWeights: ScoreWeights = { affordability: 0, reliability: 0, safety: 0, fuelEnergyCost: 0, insuranceCost: 0, maintenanceRisk: 0, practicality: 0, resaleValue: 0, drivingPreferenceFit: 0 };

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 0, monthlyBudget: 0, downPayment: 0, loanTermMonths: 60, apr: 7,
  paymentMethod: "not-sure", purchaseCondition: "any", expectedAnnualMileage: 12_000,
  fuelPrice: 3.5, insuranceBudget: 0, minYear: 0, maxMileage: 0, minMpg: 0,
  fuelEconomyImportance: 0, reliabilityImportance: 0, performanceImportance: 0,
  cargoNeed: "not-sure", familySize: 0, drivetrainPreference: "any",
  transmissionPreference: "any", bodyStyle: "any", climate: "not-sure",
  resaleValueImportance: 0, modificationPlans: "not-sure", advancedFeaturesImportance: 0,
  safetyPriority: "not-sure", scoreWeights: zeroWeights, decisionPolicies: {},
};

export const shadowReadinessProfiles: Record<string, BuyerProfile> = {
  A_safety_reliability: profile({
    weights: { reliability: 50, safety: 50 },
    policies: { reliability: policy("reliability", "active", 1), safety: policy("safety", "active", 1), affordability: policy("affordability", "deprioritized", 0) },
  }),
  B_ownership_cost: profile({
    weights: { affordability: 25, fuelEnergyCost: 25, insuranceCost: 25, maintenanceRisk: 25 },
    policies: {
      affordability: policy("affordability", "active", 1), fuelEnergyCost: policy("fuelEnergyCost", "active", 1),
      insuranceCost: policy("insuranceCost", "active", 1), maintenanceRisk: policy("maintenanceRisk", "active", 1),
    },
  }),
  C_performance: profile({
    weights: { drivingPreferenceFit: 100 },
    policies: { performance: policy("performance", "active", 1), fuelEnergyCost: policy("fuelEnergyCost", "disabled", 0) },
    updates: { performanceImportance: 5, fuelEconomyImportance: 0 },
  }),
  D_ev_buyer: profile({
    weights: { practicality: 100 },
    policies: { fuelType: policy("fuelType", "enforced", 1) },
    updates: { requiredFuelTypes: ["electric"], cargoNeed: "high" },
  }),
  E_suv_requirement: profile({
    weights: { affordability: 1 },
    policies: { bodyStyle: policy("bodyStyle", "enforced", 1), affordability: policy("affordability", "disabled", 0) },
    updates: { requiredBodyStyles: ["suv"], bodyStyle: "suv" },
  }),
  F_budget_disabled: profile({
    weights: { affordability: 1 },
    policies: { purchaseBudget: policy("purchaseBudget", "disabled", 0), affordability: policy("affordability", "disabled", 0), modelYear: policy("modelYear", "enforced", 1) },
    updates: { maxPurchaseBudget: 0, monthlyBudget: 0, minYear: 2010 },
  }),
};

assert.equal(publications.length, 5, "Golden Set v1 must contain exactly five active publications.");
const expectedFingerprints = new Map([
  ["honda-cr-v-2016-craigslist-carstrucks-data", "130uj4s"],
  ["hyundai-accent-2017-craigslist-carstrucks-data", "17cb0qz"],
  ["nissan-leaf-2018-craigslist-carstrucks-data", "4iksm1"],
  ["toyota-prius-2016-usedcarscatalog", "gw6fjs"],
  ["toyota-rav4-2016-craigslist-carstrucks-data", "1rqusio"],
]);
for (const [vehicleId, fingerprint] of expectedFingerprints) {
  assert.ok(publicationHistory.some((item) => item.vehicleId === vehicleId && item.recordVersion === 1 && item.fingerprint === fingerprint), `${vehicleId} must retain its original Golden Set v1 fingerprint.`);
}
assert.ok(publications.every((publication) => publication.recordVersion === 1 || publication.recordVersion === 2));

const profileBefore = stableValue(shadowReadinessProfiles);
const publicationsBefore = stableValue(publications);
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error("Shadow readiness tests must not use the network.");
};

let results: Record<string, ShadowRecommendationReadinessComparison>;
try {
  results = Object.fromEntries(Object.entries(shadowReadinessProfiles).map(([id, buyerProfile]) => [
    id,
    evaluateShadowRecommendationReadiness({ buyerProfileId: id, buyerProfile, catalog, publications }),
  ]));
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(networkAttempts, 0, "Shadow evaluation must have no network dependency.");
assert.equal(stableValue(shadowReadinessProfiles), profileBefore, "BuyerProfiles must remain immutable.");
assert.equal(stableValue(publications), publicationsBefore, "Published CVRs must remain immutable.");
assert.equal(stableValue(catalog), catalogBefore, "The legacy catalog must remain immutable.");

const profileA = results.A_safety_reliability;
assert.ok(profileA.vehicleComparisons.every((item) => !item.relevantDimensions.includes("fuelEnergyCost")));
assert.ok(profileA.vehicleComparisons.every((item) => !item.disclosureRequirements.some((disclosure) => disclosure.dimension === "fuelEnergyCost")));

const profileB = results.B_ownership_cost;
assert.ok(profileB.vehicleComparisons.every((item) => item.staleRelevantDimensions.includes("fuelEnergyCost")));
assert.ok(profileB.vehicleComparisons.every((item) => item.disclosureRequirements.some((disclosure) => disclosure.dimension === "fuelEnergyCost")));

const profileC = results.C_performance;
assert.ok(profileC.vehicleComparisons.every((item) => !item.relevantDimensions.includes("fuelEconomy") && !item.relevantDimensions.includes("fuelEnergyCost")));
assert.ok(profileC.vehicleComparisons.every((item) => item.unsupportedDimensions.includes("performance")));

const profileD = results.D_ev_buyer;
const leaf = vehicle(profileD, "nissan-leaf-2018-craigslist-carstrucks-data");
assert.ok(leaf.supportedDimensions.includes("evRange"));
assert.equal(fieldValue(publication("nissan-leaf-2018-craigslist-carstrucks-data"), "environment.evRange"), 151);
assert.equal(leaf.requirementEvaluations.find((item) => item.dimension === "fuelType")?.status, "PASSED");
const priusEV = vehicle(profileD, "toyota-prius-2016-usedcarscatalog");
assert.equal(priusEV.requirementEvaluations.find((item) => item.dimension === "fuelType")?.status, "FAILED");
assert.ok(priusEV.failedRequiredDimensions.includes("fuelType"));

const profileE = results.E_suv_requirement;
for (const id of ["toyota-rav4-2016-craigslist-carstrucks-data", "honda-cr-v-2016-craigslist-carstrucks-data"]) {
  const comparison = vehicle(profileE, id);
  assert.equal(comparison.requirementEvaluations.find((item) => item.dimension === "bodyStyle")?.status, "PASSED");
  assert.equal(comparison.readiness, "READY");
}
const priusSUV = vehicle(profileE, "toyota-prius-2016-usedcarscatalog");
assert.equal(priusSUV.requirementEvaluations.find((item) => item.dimension === "bodyStyle")?.status, "EVIDENCE_UNAVAILABLE");
assert.ok(priusSUV.unsupportedRequiredDimensions.includes("bodyStyle"));
assert.equal(priusSUV.failedRequiredDimensions.includes("bodyStyle"), false);

const profileF = results.F_budget_disabled;
assert.ok(profileF.vehicleComparisons.every((item) => !item.relevantDimensions.includes("purchaseBudget") && !item.relevantDimensions.includes("affordability")));
assert.ok(profileF.vehicleComparisons.every((item) => item.decisionCoverage === 100));

assert.ok(profileA.vehicleComparisons.every((item) => item.unsupportedDimensions.includes("reliability")));
assert.ok(profileA.vehicleComparisons.every((item) => item.decisionReadiness.scoringIneligibleDimensions.includes("reliability")));
assert.equal(profileA.vehicleComparisons.filter((item) => item.supportedDimensions.includes("safety")).length, 4);
assert.ok(vehicle(profileA, "nissan-leaf-2018-craigslist-carstrucks-data").unsupportedDimensions.includes("safety"));

const staleCost = profileB.vehicleComparisons[0].decisionReadiness.relevantDimensions.find((item) => item.dimension === "fuelEnergyCost")!;
assert.equal(staleCost.scoreEligible, false);
assert.ok(staleCost.fieldEvaluations.some((field) => field.availability === "STALE"));

const conflicted = clone(publications);
setUnavailable(conflicted[0], "safety.crashSafety", "source_conflict");
const conflictProfile = profile({ weights: { safety: 100 }, policies: { safety: policy("safety", "active", 1) } });
const conflictResult = evaluateShadowRecommendationReadiness({ buyerProfileId: "conflicted-safety", buyerProfile: conflictProfile, catalog, publications: conflicted });
assert.ok(vehicle(conflictResult, conflicted[0].vehicleId).conflictedRelevantDimensions.includes("safety"));
assert.ok(vehicle(conflictResult, conflicted[0].vehicleId).decisionReadiness.scoringIneligibleDimensions.includes("safety"));

assert.ok(vehicle(profileD, "nissan-leaf-2018-craigslist-carstrucks-data").decisionReadiness.scoringEligibleDimensions.includes("fuelType"));

for (const [id, buyerProfile] of Object.entries(shadowReadinessProfiles)) {
  const before = runCandidatePipeline(clone(buyerProfile), catalog, { includeCompromises: true, includeExcluded: true });
  const beforeObjects = stableValue(before.decisionSet);
  const beforeReport = stableValue(buildDecisionReport(before.decisionSet));
  evaluateShadowRecommendationReadiness({ buyerProfileId: `${id}:isolation`, buyerProfile, catalog, publications });
  const after = runCandidatePipeline(clone(buyerProfile), catalog, { includeCompromises: true, includeExcluded: true });
  assert.equal(stableValue(after.decisionSet), beforeObjects, `${id}: production RecommendationObject/decision set changed`);
  assert.equal(stableValue(buildDecisionReport(after.decisionSet)), beforeReport, `${id}: DecisionReport changed`);
}

console.log("Shadow recommendation readiness passed: 20 isolation, evidence, requirement, coverage, and publication invariants.");
console.log(JSON.stringify({
  matrix: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, result.vehicleComparisons.map((item) => ({
    vehicle: item.vehicleLabel,
    readiness: item.readiness,
    coverage: item.decisionCoverage,
    unsupportedRequired: item.unsupportedRequiredDimensions,
    failedRequired: item.failedRequiredDimensions,
    materialMissing: item.disclosureRequirements.filter((entry) => entry.level === "REQUIRED").map((entry) => entry.dimension),
    disclosure: item.disclosureRequirements.length > 0,
  }))])),
  averageByProfile: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, result.summary.averageDecisionCoverage])),
  averageByVehicle: averageByVehicle(results),
  legacy: Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {
    qualified: result.legacyResult.qualifiedCount,
    winner: result.legacyResult.winner?.vehicleId ?? null,
    runnerUp: result.legacyResult.runnerUp?.vehicleId ?? null,
    winnerScore: result.legacyResult.winner?.overallMatchScore ?? null,
  }])),
}, null, 2));

function profile(input: {
  weights?: Partial<ScoreWeights>;
  policies?: Partial<Record<DecisionPolicyDimension, DecisionParticipationPolicy>>;
  updates?: Partial<BuyerProfile>;
}) {
  return { ...baseProfile, ...input.updates, scoreWeights: { ...zeroWeights, ...input.weights }, decisionPolicies: input.policies ?? {} };
}

function policy(dimension: DecisionPolicyDimension, participation: DecisionParticipation, importance?: number): DecisionParticipationPolicy {
  return { dimension, participation, importance, source: "user_confirmed", confidence: 1, confirmation: "confirmed", sourceText: `Shadow fixture ${dimension}`, messageRef: `shadow:${dimension}`, explanation: "Controlled shadow readiness fixture." };
}

function vehicle(result: ShadowRecommendationReadinessComparison, id: string) {
  const comparison = result.vehicleComparisons.find((item) => item.vehicleId === id);
  assert.ok(comparison, `Missing comparison for ${id}`);
  return comparison;
}

function publication(id: string) {
  const match = publications.find((item) => item.vehicleId === id);
  assert.ok(match, `Missing publication for ${id}`);
  return match;
}

function fieldValue(record: PublishedVehicleIntelligenceRecord, path: CanonicalVehicleFieldPath) {
  const [section, field] = path.split(".");
  return (record.canonicalRecord as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field].value;
}

function setUnavailable(record: PublishedVehicleIntelligenceRecord, path: CanonicalVehicleFieldPath, missingReason: "source_conflict" | "stale") {
  const [section, field] = path.split(".");
  const datum = (record.canonicalRecord as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field];
  datum.value = null;
  datum.status = "missing";
  datum.evidenceIds = [];
  datum.missingReason = missingReason;
  datum.confidence = { score: null, level: "unknown", sourceAgreement: missingReason === "source_conflict" ? "conflicts" : "not_applicable", basis: ["Controlled shadow fixture."] };
}

function averageByVehicle(results: Record<string, ShadowRecommendationReadinessComparison>) {
  const totals = new Map<string, { label: string; values: number[] }>();
  for (const result of Object.values(results)) for (const item of result.vehicleComparisons) {
    const current = totals.get(item.vehicleId) ?? { label: item.vehicleLabel, values: [] };
    current.values.push(item.decisionCoverage);
    totals.set(item.vehicleId, current);
  }
  return Object.fromEntries([...totals.values()].sort((a, b) => a.label.localeCompare(b.label)).map((item) => [item.label, Math.round(item.values.reduce((sum, value) => sum + value, 0) / item.values.length)]));
}

function stableValue(value: unknown) {
  return JSON.stringify(value);
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
