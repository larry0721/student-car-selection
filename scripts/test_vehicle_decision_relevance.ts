import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fullyPopulatedPriusRecord } from "../data/canonicalVehicleExamples";
import { evaluateVehicleDecisionReadiness } from "../src/vehicle-intelligence/vehicle-decision-relevance";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { CanonicalDatum, CanonicalMissingReason, CanonicalVehicleFieldPath, CanonicalVehicleRecord } from "../types/canonicalVehicle";
import type { DecisionParticipation, DecisionParticipationPolicy, DecisionPolicyDimension } from "../types/decisionPolicy";

const catalogPath = join(process.cwd(), "data/processed/vehicleCatalog.json");
const repositoryPath = join(process.cwd(), "data/vehicle-knowledge/repositories/phase-3.2e-reviewed-golden.json");
const catalogBefore = readFileSync(catalogPath, "utf8");
const repositoryBefore = existsSync(repositoryPath) ? readFileSync(repositoryPath, "utf8") : null;
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

const full = clone(fullyPopulatedPriusRecord) as CanonicalVehicleRecord;

// 1. Safety/reliability remain fully covered when irrelevant fuel cost is missing.
const safetyReliability = profileWithPolicies({ safety: policy("safety", "active", 1), reliability: policy("reliability", "active", 1) });
const missingFuelCost = withMissing(full, "financial.fuelEnergyCost", "stale");
const safetyReliabilityResult = evaluateVehicleDecisionReadiness(safetyReliability, missingFuelCost);
assert.equal(safetyReliabilityResult.decisionCoverage, 100);
assert.equal(safetyReliabilityResult.staleRelevantDimensions.includes("fuelEnergyCost"), false);
assert.equal(safetyReliabilityResult.disclosureRequirements.length, 0);

// 2. Monthly ownership priorities lose coverage when fuel cost is unavailable.
const ownership = profileWithPolicies({
  affordability: policy("affordability", "active", 0.8),
  insuranceCost: policy("insuranceCost", "active", 0.8),
  maintenanceRisk: policy("maintenanceRisk", "active", 0.8),
  fuelEnergyCost: policy("fuelEnergyCost", "active", 1),
});
const ownershipResult = evaluateVehicleDecisionReadiness(ownership, missingFuelCost);
assert.ok(ownershipResult.decisionCoverage < 100);
assert.ok(ownershipResult.unsupportedDimensions.includes("fuelEnergyCost"));
assert.ok(ownershipResult.disclosureRequirements.some((item) => item.dimension === "fuelEnergyCost" && item.level === "REQUIRED"));

// 3. Performance remains covered when explicitly irrelevant fuel economy is missing.
const performance = profileWithPolicies({ performance: policy("performance", "active", 1), fuelEnergyCost: policy("fuelEnergyCost", "disabled") });
const noFuelEconomy = withMissing(full, "environment.fuelEconomy", "not_available");
const performanceResult = evaluateVehicleDecisionReadiness(performance, noFuelEconomy);
assert.equal(performanceResult.decisionCoverage, 100);
assert.equal(performanceResult.relevantDimensions.some((item) => item.dimension === "fuelEconomy"), false);

// 4. An electric preference activates EV-range readiness and exposes a missing range.
const evBuyer: BuyerProfile = { ...baseProfile, requiredFuelTypes: ["electric"] };
const noRange = withMissing(full, "environment.evRange", "not_available");
const evResult = evaluateVehicleDecisionReadiness(evBuyer, noRange);
assert.ok(evResult.unsupportedDimensions.includes("evRange"));
assert.ok(evResult.disclosureRequirements.some((item) => item.dimension === "evRange" && item.level === "REQUIRED"));

// 5. Disabled budget makes stale purchase price irrelevant.
const noBudget = profileWithPolicies({ purchaseBudget: policy("purchaseBudget", "disabled"), affordability: policy("affordability", "disabled") });
const stalePrice = withMissing(full, "financial.purchasePrice", "stale");
const noBudgetResult = evaluateVehicleDecisionReadiness(noBudget, stalePrice);
assert.equal(noBudgetResult.relevantDimensions.some((item) => item.dimension === "purchaseBudget" || item.dimension === "affordability"), false);
assert.equal(noBudgetResult.disclosureRequirements.length, 0);

// 6. Reliability importance cannot score missing reliability.
const reliability = profileWithPolicies({ reliability: policy("reliability", "active", 1) });
const noReliability = withMissing(full, "reliability.longTermReliability", "not_available");
const reliabilityResult = evaluateVehicleDecisionReadiness(reliability, noReliability);
assert.ok(reliabilityResult.scoringIneligibleDimensions.includes("reliability"));
assert.equal(reliabilityResult.decisionCoverage, 0);

// 7. A body-style hard requirement is materially unsupported when body style is missing.
const bodyStyleProfile: BuyerProfile = { ...baseProfile, requiredBodyStyles: ["suv"] };
const noBodyStyle = withMissing(full, "identity.bodyStyle", "not_available");
const bodyResult = evaluateVehicleDecisionReadiness(bodyStyleProfile, noBodyStyle);
assert.ok(bodyResult.unsupportedDimensions.includes("bodyStyle"));
assert.ok(bodyResult.disclosureRequirements.some((item) => item.dimension === "bodyStyle" && item.level === "REQUIRED"));

// 8-9. The same absent field changes coverage only when the buyer cares about it.
assert.equal(safetyReliabilityResult.decisionCoverage, 100);
assert.ok(ownershipResult.decisionCoverage < safetyReliabilityResult.decisionCoverage);

// 10. Conflicted relevant evidence is ineligible.
const conflictedSafety = withMissing(full, "safety.crashSafety", "source_conflict");
for (const path of ["safety.activeSafety", "safety.passiveSafety", "safety.driverAssistanceSafety"] as CanonicalVehicleFieldPath[]) setMissing(conflictedSafety, path, "not_available");
const conflictResult = evaluateVehicleDecisionReadiness(profileWithPolicies({ safety: policy("safety", "active", 1) }), conflictedSafety);
assert.ok(conflictResult.conflictedRelevantDimensions.includes("safety"));
assert.ok(conflictResult.scoringIneligibleDimensions.includes("safety"));

// 11. Stale relevant evidence is ineligible and cannot receive a default score.
const staleCostResult = evaluateVehicleDecisionReadiness(profileWithPolicies({ fuelEnergyCost: policy("fuelEnergyCost", "active", 1) }), missingFuelCost);
const staleCost = staleCostResult.relevantDimensions.find((item) => item.dimension === "fuelEnergyCost")!;
assert.equal(staleCost.scoreEligible, false);
assert.equal(staleCost.supportedFieldPaths.length, 0);
assert.equal(staleCost.fieldEvaluations[0].availability, "STALE");

// 12. Trusted relevant evidence participates, while estimates remain a separate caution.
const trustedSafety = evaluateVehicleDecisionReadiness(profileWithPolicies({ safety: policy("safety", "active", 1) }), full);
assert.ok(trustedSafety.scoringEligibleDimensions.includes("safety"));
assert.equal(trustedSafety.decisionCoverage, 100);

assert.equal(readFileSync(catalogPath, "utf8"), catalogBefore);
if (repositoryBefore !== null) assert.equal(readFileSync(repositoryPath, "utf8"), repositoryBefore);
console.log("Vehicle decision relevance passed: 12 buyer/CVR fixtures preserve relevance, no-data, disclosure, and scoring-participation invariants.");
console.log(JSON.stringify({
  safetyReliability: summarize(safetyReliabilityResult),
  ownershipCost: summarize(ownershipResult),
  performance: summarize(performanceResult),
  evRange: summarize(evResult),
  noBudget: summarize(noBudgetResult),
}, null, 2));

function profileWithPolicies(policies: Partial<Record<DecisionPolicyDimension, DecisionParticipationPolicy>>): BuyerProfile {
  return { ...baseProfile, decisionPolicies: policies };
}

function policy(dimension: DecisionPolicyDimension, participation: DecisionParticipation, importance?: number): DecisionParticipationPolicy {
  return { dimension, participation, importance, source: "user_confirmed", confidence: 1, confirmation: "confirmed", sourceText: `Fixture ${dimension}`, messageRef: `fixture:${dimension}`, explanation: "Controlled decision-relevance fixture." };
}

function withMissing(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath, reason: CanonicalMissingReason) {
  const copy = clone(record);
  setMissing(copy, path, reason);
  return copy;
}

function setMissing(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath, reason: CanonicalMissingReason) {
  const [section, field] = path.split(".");
  const datum = (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field];
  datum.value = null;
  datum.status = "missing";
  datum.evidenceIds = [];
  datum.estimated = false;
  datum.estimationMethod = null;
  datum.missingReason = reason;
  datum.confidence = { score: null, level: "unknown", sourceAgreement: reason === "source_conflict" ? "conflicts" : "not_applicable", basis: ["Controlled unavailable fixture."] };
}

function summarize(result: ReturnType<typeof evaluateVehicleDecisionReadiness>) {
  return { coverage: result.decisionCoverage, supported: result.supportedDimensions, unsupported: result.unsupportedDimensions, disclosures: result.disclosureRequirements.map((item) => `${item.level}:${item.dimension}`) };
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
