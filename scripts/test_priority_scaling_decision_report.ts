import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDecisionReport,
  defaultScoreWeights,
  getDynamicScoreWeights,
  normalizeScoreWeights,
  runCandidatePipeline,
} from "../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { DecisionReport, FieldProvenanceStatus, RecommendationObject, Vehicle } from "../types/vehicle";

const vehicleCatalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 18000,
  monthlyBudget: 650,
  downPayment: 2000,
  loanTermMonths: 60,
  apr: 8.5,
  paymentMethod: "not-sure",
  purchaseCondition: "any",
  expectedAnnualMileage: 9000,
  fuelPrice: 4.25,
  insuranceBudget: 145,
  minYear: 2014,
  maxMileage: 110000,
  minMpg: 24,
  fuelEconomyImportance: 3,
  reliabilityImportance: 3,
  performanceImportance: 3,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "not-sure",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "standard",
  scoreWeights: defaultScoreWeights,
};

const profileA: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 12000,
  purchaseCondition: "used",
  expectedAnnualMileage: 12000,
  climate: "mild",
  reliabilityImportance: 5,
  reliabilityMinimum: 75,
  safetyPriority: "high",
  performanceImportance: 1,
};

const profileB: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 25000,
  bodyStyle: "suv",
  climate: "snow",
  drivetrainPreference: "AWD",
  familySize: 4,
  cargoNeed: "high",
  safetyPriority: "maximum",
  scoreWeights: weights({
    safety: 25,
    practicality: 20,
    reliability: 15,
    affordability: 15,
    maintenanceRisk: 10,
    insuranceCost: 5,
    fuelEnergyCost: 5,
    resaleValue: 5,
    drivingPreferenceFit: 0,
  }),
};

const profileC: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 13000,
  purchaseCondition: "used",
  requiredMake: "BMW",
  minMpg: 20,
  performanceImportance: 5,
  reliabilityImportance: 4,
  scoreWeights: weights({
    drivingPreferenceFit: 25,
    reliability: 20,
    maintenanceRisk: 20,
    affordability: 15,
    safety: 8,
    insuranceCost: 5,
    fuelEnergyCost: 3,
    practicality: 2,
    resaleValue: 2,
  }),
};

const reliabilityNormalProfile: BuyerProfile = {
  ...baseProfile,
  maxPurchaseBudget: 26000,
  maxMileage: 130000,
  minMpg: 18,
  reliabilityImportance: 3,
  performanceImportance: 5,
  scoreWeights: weights({ drivingPreferenceFit: 32, reliability: 12, affordability: 16, safety: 10, maintenanceRisk: 8 }),
};

const reliabilityVeryImportantProfile: BuyerProfile = {
  ...reliabilityNormalProfile,
  reliabilityImportance: 5,
};

const normalResult = runCandidatePipeline(reliabilityNormalProfile, vehicleCatalog);
const veryImportantResult = runCandidatePipeline(reliabilityVeryImportantProfile, vehicleCatalog);
assert.notEqual(
  normalResult.rankedVehicles.slice(0, 5).map((vehicle) => vehicle.id).join("|"),
  veryImportantResult.rankedVehicles.slice(0, 5).map((vehicle) => vehicle.id).join("|"),
  "raising reliability from normal to very important should materially change top-five ranking when category strengths differ",
);
assert.ok(
  getDynamicScoreWeights(reliabilityVeryImportantProfile).reliability >
    getDynamicScoreWeights(reliabilityNormalProfile).reliability,
  "very important reliability should increase normalized reliability weight",
);
assert.ok(Math.abs(sumWeights(getDynamicScoreWeights(reliabilityVeryImportantProfile)) - 100) < 0.001);
assert.ok(Math.abs(sumWeights(normalizeScoreWeights(reliabilityVeryImportantProfile.scoreWeights)) - 100) < 0.001);
assert.ok(
  veryImportantResult.rankedVehicles[0].reliabilityScore >= normalResult.rankedVehicles[0].reliabilityScore ||
    veryImportantResult.rankedVehicles[0].matchSummary.reliability >= normalResult.rankedVehicles[0].matchSummary.reliability,
  "very important reliability should favor stronger reliability at the top",
);

const profileReports = {
  A: getProfileReport(profileA),
  B: getProfileReport(profileB),
  C: getProfileReport(profileC),
  A2: getProfileReport({ ...profileA, reliabilityMinimum: 85 }),
  B2: getProfileReport({ ...profileB, safetyMinimum: 90 }),
  C2: getProfileReport({ ...profileC, requiredMake: undefined, preferredMake: "BMW" }),
};

assert.ok(profileReports.A.after.topFive.length > 0);
assert.ok(profileReports.B.after.topFive.length > 0);
assert.equal(profileReports.C.after.qualifiedCount, 0, "Profile C should still have no fabricated required-BMW matches");
assert.equal(profileReports.A2.after.qualifiedBelowThresholdCount, 0, "Profile A2 must exclude reliability below 85");
assert.equal(profileReports.B2.after.qualifiedBelowThresholdCount, 0, "Profile B2 must exclude safety below 90");
assert.ok(profileReports.C2.after.nonBmwAlternativesReturned, "Profile C2 should return non-BMW alternatives");
assert.ok(profileReports.C2.after.preferredMakeUnsatisfiedStated, "Profile C2 should state preferred make was relaxed");

const decisionA = runCandidatePipeline(profileA, vehicleCatalog, { includeCompromises: true, includeExcluded: true }).decisionSet;
const decisionB = runCandidatePipeline(profileB, vehicleCatalog, { includeCompromises: true, includeExcluded: true }).decisionSet;
const reportA = buildDecisionReport(decisionA);
const reportB = buildDecisionReport(decisionB);
assertDecisionReport(reportA);
assertDecisionReport(reportB);
decisionA.primaryRecommendations.slice(0, 5).forEach(assertProvenanceConsistency);
decisionB.primaryRecommendations.slice(0, 5).forEach(assertProvenanceConsistency);

console.log("Priority scaling and DecisionReport contract passed.");
console.log("Priority scaling benchmark report:");
Object.entries(profileReports).forEach(([name, report]) => {
  console.log(formatProfileReport(name, report));
});
console.log("Sample DecisionReport A:");
console.log(JSON.stringify(summarizeDecisionReport(reportA), null, 2));
console.log("Sample DecisionReport B:");
console.log(JSON.stringify(summarizeDecisionReport(reportB), null, 2));

function getProfileReport(profile: BuyerProfile) {
  const before = runCandidatePipeline(profile, vehicleCatalog, { disablePriorityScaling: true, includeCompromises: true, includeExcluded: true });
  const after = runCandidatePipeline(profile, vehicleCatalog, { includeCompromises: true, includeExcluded: true });
  return {
    before: summarizePipeline(before, profile),
    after: summarizePipeline(after, profile),
  };
}

function summarizePipeline(result: ReturnType<typeof runCandidatePipeline>, profile: BuyerProfile) {
  const primary = result.decisionSet.primaryRecommendations;
  return {
    qualifiedCount: result.pipelineDebug.qualifiedCount,
    excludedCount: result.pipelineDebug.excludedCount,
    compromiseCount: result.pipelineDebug.compromiseCount,
    topFive: result.pipelineDebug.topFive.map((vehicle) => `${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.overallMatchScore})`),
    qualifiedBelowThresholdCount: primary.filter((recommendation) => {
      if (profile.reliabilityMinimum !== undefined) return recommendation.vehicle.reliabilityScore < profile.reliabilityMinimum;
      if (profile.safetyMinimum !== undefined) return recommendation.vehicle.safetyScore < profile.safetyMinimum;
      return false;
    }).length,
    nonBmwAlternativesReturned: primary.some((recommendation) => recommendation.vehicle.make !== "BMW"),
    preferredMakeUnsatisfiedStated: primary[0]?.tradeoffs.some((tradeoff) => tradeoff.code === "make_preference_relaxed") || false,
    weights: primary[0]?.reasonsForRecommendation.map((signal) => `${signal.category}:${signal.weight}`).join(", ") || "none",
  };
}

function assertDecisionReport(report: DecisionReport) {
  assert.ok(report.bestOverall.vehicleId, "DecisionReport should name best overall when qualified results exist");
  assert.ok(report.bestValue.vehicleId, "DecisionReport should name best value when qualified results exist");
  assert.ok(report.safestChoice.vehicleId, "DecisionReport should name safest choice when qualified results exist");
  assert.ok(report.userPreferredChoice.vehicleId, "DecisionReport should name user preferred choice when qualified results exist");
  assert.ok(report.executiveSummary.length > 0);
  assert.ok(report.userPriorities.length > 0);
  assert.ok(report.hardRequirements.length > 0);
  assert.ok(report.whySelected.length > 0);
  assert.ok(report.whyRunnerUpLost.length > 0);
  assert.ok(report.recommendationConfidence?.score !== undefined);
  assert.ok(report.dataQualityConfidence?.score !== undefined);
  assert.ok(report.whatCouldChangeRecommendation.length > 0);
}

function assertProvenanceConsistency(recommendation: RecommendationObject) {
  const allowedStatuses: FieldProvenanceStatus[] = ["verified", "sourced", "estimated", "derived", "missing"];
  const provenanceByField = new Map(recommendation.fieldProvenance.map((item) => [item.field, item]));
  const requiredFields = [
    "make",
    "model",
    "year",
    "bodyType",
    "drivetrain",
    "price",
    "mileage",
    "mpg",
    "safetyScore",
    "insuranceMonthly",
    "fuelMonthly",
    "ownershipMonthly",
    "overallMatchScore",
  ];
  requiredFields.forEach((field) => assert.ok(provenanceByField.has(field), `${field} should have provenance`));
  recommendation.fieldProvenance.forEach((item) => assert.ok(allowedStatuses.includes(item.status), `${item.field} has valid provenance status`));
  recommendation.estimatedFields.forEach((field) => {
    const provenance = provenanceByField.get(field.field);
    assert.ok(provenance, `${field.field} estimated field should have provenance`);
    assert.ok(provenance.status === "estimated" || provenance.status === "derived", `${field.field} should be estimated or derived`);
  });
}

function summarizeDecisionReport(report: DecisionReport) {
  return {
    bestOverall: report.bestOverall,
    bestValue: report.bestValue,
    safestChoice: report.safestChoice,
    userPreferredChoice: report.userPreferredChoice,
    executiveSummary: report.executiveSummary,
    whyRunnerUpLost: report.whyRunnerUpLost,
    assumptions: report.assumptions,
    missingInformation: report.missingInformation,
    estimatedFields: report.estimatedFields,
    recommendationConfidence: report.recommendationConfidence,
    dataQualityConfidence: report.dataQualityConfidence,
    whatCouldChangeRecommendation: report.whatCouldChangeRecommendation,
  };
}

function formatProfileReport(name: string, report: ReturnType<typeof getProfileReport>) {
  return [
    `Profile ${name}`,
    `before top five ${report.before.topFive.join(" | ") || "none"}`,
    `after top five ${report.after.topFive.join(" | ") || "none"}`,
    `after qualified ${report.after.qualifiedCount}`,
    `after excluded ${report.after.excludedCount}`,
    `after compromises ${report.after.compromiseCount}`,
  ].join("; ");
}

function weights(overrides: Partial<ScoreWeights>): ScoreWeights {
  return { ...defaultScoreWeights, ...overrides };
}

function sumWeights(weightsToSum: ScoreWeights) {
  return Object.values(weightsToSum).reduce((sum, value) => sum + value, 0);
}
