import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDecisionReport, defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import { buildHumanDecisionStory, buildVisibleThinkingSummary, CLOSE_DECISION_SCORE_GAP } from "../lib/visibleThinking";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { DecisionReport, RecommendationDecisionSet, RecommendationObject, Vehicle } from "../types/vehicle";

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

const normalContext = getContext(profileA);
const normalSummary = buildVisibleThinkingSummary(normalContext);
const normalStory = buildHumanDecisionStory(normalSummary);
const normalLoss = normalContext.decisionSet.pipelineDebug.runnerUpLossReasons[0];

assert.equal(normalSummary.catalogCount, normalContext.decisionSet.pipelineDebug.catalogCount);
assert.equal(normalSummary.candidateCount, normalContext.decisionSet.pipelineDebug.candidateCount);
assert.equal(normalSummary.excludedCount, normalContext.decisionSet.pipelineDebug.excludedCount);
assert.equal(normalSummary.qualifiedCount, normalContext.decisionSet.pipelineDebug.qualifiedCount);
assert.equal(normalSummary.compromiseCount, normalContext.decisionSet.pipelineDebug.compromiseCount);
assert.equal(normalSummary.hardestComparison?.winningVehicle.vehicleId, normalContext.decisionReport.bestOverall.vehicleId);
assert.equal(normalSummary.hardestComparison?.runnerUpVehicle.vehicleId, normalContext.decisionReport.runnerUp?.vehicleId);
assert.equal(normalSummary.hardestComparison?.exactStructuredReasonItLost, normalLoss.primaryReason);
assert.equal(normalSummary.decisionSteps.length <= 4, true);
assertNoInventedNarrative(normalSummary.shortSummary);
assertNoBannedDefaultLanguage(normalStory.defaultParagraphs.join(" "));
assert.equal(normalStory.defaultParagraphs.some((paragraph) => paragraph.includes("Subaru Legacy")), true);
assert.equal(normalStory.defaultParagraphs.some((paragraph) => paragraph.includes("Toyota 4Runner")), true);
assert.equal(normalStory.defaultParagraphs.some((paragraph) => paragraph.includes("fuel and ownership cost")), true);
assert.equal(normalStory.expandedSteps.some((step) => step.text.includes("Score gap:")), true);
assert.equal(normalStory.expandedSteps.some((step) => step.text.includes(normalLoss.primaryReason)), true);
assertDoesNotMutateInputs(profileA);

const closeContext = withRunnerUpScoreGap(normalContext, CLOSE_DECISION_SCORE_GAP);
const closeSummary = buildVisibleThinkingSummary(closeContext);
const closeStory = buildHumanDecisionStory(closeSummary);
assert.equal(closeSummary.hardestComparison?.isCloseDecision, true);
assert.ok(closeSummary.shortSummary.includes("The closest decision"), "close score gaps may use closest-decision language");
assert.ok(closeStory.defaultParagraphs.join(" ").includes("The final choice was close"), "small score gaps may call the final choice close");

const largeGapContext = withRunnerUpScoreGap(normalContext, CLOSE_DECISION_SCORE_GAP + 8);
const largeGapSummary = buildVisibleThinkingSummary(largeGapContext);
const largeGapStory = buildHumanDecisionStory(largeGapSummary);
assert.equal(largeGapSummary.hardestComparison?.isCloseDecision, false);
assert.ok(!largeGapSummary.shortSummary.includes("The closest decision"), "large score gaps must not claim the result was close");
assert.ok(!largeGapStory.defaultParagraphs.join(" ").includes("close"), "large score gaps must not call the human story close");

const oneQualifiedContext = withOneQualifiedVehicle(normalContext);
const oneQualifiedSummary = buildVisibleThinkingSummary(oneQualifiedContext);
const oneQualifiedStory = buildHumanDecisionStory(oneQualifiedSummary);
assert.equal(oneQualifiedSummary.hardestComparison, undefined);
assert.equal(oneQualifiedSummary.finalistVehicleIds.length, 1);
assert.equal(oneQualifiedSummary.conclusion.status, "single-qualified");
assert.ok(oneQualifiedSummary.shortSummary.includes("only vehicle"));
assert.ok(oneQualifiedStory.defaultParagraphs.join(" ").includes("Only one vehicle met every requirement"));
assert.ok(!oneQualifiedStory.defaultParagraphs.join(" ").includes("came down to"), "one-result state must not fabricate finalists");

const noMatchContext = getContext(profileC);
const noMatchSummary = buildVisibleThinkingSummary(noMatchContext);
const noMatchStory = buildHumanDecisionStory(noMatchSummary);
assert.equal(noMatchSummary.hardestComparison, undefined);
assert.equal(noMatchSummary.qualifiedCount, 0);
assert.equal(noMatchSummary.conclusion.status, "no-match");
assert.ok(noMatchSummary.shortSummary.includes("none passed all of the requirements"));
assert.ok(noMatchSummary.decisionSteps.some((step) => step.code === "no_match_blockers"));
assert.ok(noMatchStory.defaultParagraphs.join(" ").includes("make requirement"));
assert.ok(noMatchStory.defaultParagraphs.join(" ").includes("total budget"));
assertNoBannedDefaultLanguage(noMatchStory.defaultParagraphs.join(" "));

const compromiseContext = withCompromiseOnly(normalContext);
const compromiseSummary = buildVisibleThinkingSummary(compromiseContext);
const compromiseStory = buildHumanDecisionStory(compromiseSummary);
assert.equal(compromiseSummary.conclusion.status, "compromise");
assert.equal(compromiseSummary.hardestComparison, undefined);
assert.ok(compromiseSummary.shortSummary.includes("compromise"));
assert.ok(compromiseSummary.decisionSteps.some((step) => step.code === "compromise_disclosure"));
assert.ok(compromiseStory.defaultParagraphs.join(" ").includes("strongest compromise"));

const lowDataConfidenceContext = withLowDataConfidence(getContext(profileB));
const lowDataSummary = buildVisibleThinkingSummary(lowDataConfidenceContext);
const lowDataStory = buildHumanDecisionStory(lowDataSummary);
assert.ok(lowDataSummary.uncertaintyDisclosure);
assert.ok(lowDataSummary.shortSummary.includes("data quality confidence is 35/100 low"));
assert.ok(lowDataStory.defaultParagraphs.join(" ").includes("verify the live listing"));
assert.ok(!lowDataStory.defaultParagraphs.join(" ").includes("35/100"));

console.log("Visible thinking summary contract passed.");
console.log("Profile A human decision story:");
console.log(normalStory.defaultParagraphs.join(" "));
console.log("Profile B human decision story:");
console.log(buildHumanDecisionStory(buildVisibleThinkingSummary(getContext(profileB))).defaultParagraphs.join(" "));
console.log("Profile C human decision story:");
console.log(noMatchStory.defaultParagraphs.join(" "));

function getContext(profile: BuyerProfile) {
  const decisionSet = runCandidatePipeline(profile, vehicleCatalog, { includeCompromises: true, includeExcluded: true }).decisionSet;
  return {
    decisionSet,
    decisionReport: buildDecisionReport(decisionSet),
    profile,
  };
}

function withRunnerUpScoreGap(context: ReturnType<typeof getContext>, scoreGap: number) {
  const decisionSet = clone(context.decisionSet);
  decisionSet.pipelineDebug.runnerUpLossReasons = decisionSet.pipelineDebug.runnerUpLossReasons.map((loss, index) =>
    index === 0 ? { ...loss, scoreGap } : loss,
  );
  return {
    ...context,
    decisionSet,
  };
}

function withOneQualifiedVehicle(context: ReturnType<typeof getContext>) {
  const decisionSet = clone(context.decisionSet);
  decisionSet.primaryRecommendations = decisionSet.primaryRecommendations.slice(0, 1);
  decisionSet.noMatch.qualifiedCount = 1;
  decisionSet.pipelineDebug.qualifiedCount = 1;
  decisionSet.pipelineDebug.topFive = decisionSet.pipelineDebug.topFive.slice(0, 1);
  decisionSet.pipelineDebug.runnerUpLossReasons = [];
  return {
    ...context,
    decisionSet,
    decisionReport: {
      ...context.decisionReport,
      runnerUp: undefined,
      whyRunnerUpLost: "No qualified runner-up exists.",
    },
  };
}

function withCompromiseOnly(context: ReturnType<typeof getContext>) {
  const decisionSet = clone(context.decisionSet);
  const compromise = {
    ...decisionSet.primaryRecommendations[0],
    qualified: false,
    qualificationStatus: "compromise" as const,
    qualificationSummary: {
      ...decisionSet.primaryRecommendations[0].qualificationSummary,
      status: "compromise" as const,
      failedCount: 1,
      compromiseCount: 1,
    },
    hardConstraintResults: [
      {
        code: "make" as const,
        label: "Make",
        passed: false,
        actual: "Toyota",
        limit: "BMW",
        flexible: true,
        exclusionReason: "make did not match the flexible preference",
      },
      ...decisionSet.primaryRecommendations[0].hardConstraintResults,
    ],
  } satisfies RecommendationObject;
  decisionSet.primaryRecommendations = [];
  decisionSet.compromiseRecommendations = [compromise];
  decisionSet.noMatch = {
    ...decisionSet.noMatch,
    noMatch: true,
    qualifiedCount: 0,
    compromiseCount: 1,
  };
  decisionSet.pipelineDebug = {
    ...decisionSet.pipelineDebug,
    qualifiedCount: 0,
    compromiseCount: 1,
    topFive: [
      {
        rank: 1,
        vehicleId: compromise.vehicleId,
        year: compromise.vehicle.year,
        make: compromise.vehicle.make,
        model: compromise.vehicle.model,
        overallMatchScore: compromise.overallMatchScore,
        qualificationStatus: "compromise",
      },
    ],
    runnerUpLossReasons: [],
  };
  return {
    ...context,
    decisionSet,
    decisionReport: buildDecisionReport(decisionSet),
    recommendation: compromise,
  };
}

function withLowDataConfidence(context: ReturnType<typeof getContext>) {
  const decisionSet = clone(context.decisionSet);
  const lowTop = {
    ...decisionSet.primaryRecommendations[0],
    dataQualityConfidence: {
      ...decisionSet.primaryRecommendations[0].dataQualityConfidence,
      score: 35,
      level: "low" as const,
    },
  };
  decisionSet.primaryRecommendations = [lowTop, ...decisionSet.primaryRecommendations.slice(1)];
  return {
    ...context,
    decisionSet,
    decisionReport: {
      ...context.decisionReport,
      dataQualityConfidence: lowTop.dataQualityConfidence,
    } satisfies DecisionReport,
    recommendation: lowTop,
  };
}

function assertDoesNotMutateInputs(profile: BuyerProfile) {
  const context = getContext(profile);
  const beforeDecisionSet = JSON.stringify(context.decisionSet);
  const beforeDecisionReport = JSON.stringify(context.decisionReport);
  const beforeTopVehicleId = context.decisionSet.primaryRecommendations[0]?.vehicleId;
  buildVisibleThinkingSummary(context);
  assert.equal(JSON.stringify(context.decisionSet), beforeDecisionSet);
  assert.equal(JSON.stringify(context.decisionReport), beforeDecisionReport);
  assert.equal(context.decisionSet.primaryRecommendations[0]?.vehicleId, beforeTopVehicleId);
}

function assertNoInventedNarrative(text: string) {
  ["initially expected", "changed my mind", "spent extra time", "surprised", "chain of thought", "the algorithm", "the system"].forEach(
    (phrase) => assert.ok(!text.toLowerCase().includes(phrase), `visible summary must not include unsupported phrase: ${phrase}`),
  );
}

function assertNoBannedDefaultLanguage(text: string) {
  const banned = [
    "pipeline",
    "candidate",
    "qualified",
    "filtered",
    "filtering out",
    "contribution",
    "category score",
    "overall match score",
    "trailed the top result",
    "runner-up loss reason",
    "data provenance",
    "hard constraint",
    "soft preference",
    "data quality confidence",
  ];
  const lower = text.toLowerCase();
  banned.forEach((phrase) => {
    assert.ok(!lower.includes(phrase), `human story should not include engineering phrase: ${phrase}`);
  });
  assert.ok(!/\b\d+\/100\b/.test(text), "default story should not expose score fractions");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function weights(partial: Partial<ScoreWeights>): ScoreWeights {
  return {
    ...defaultScoreWeights,
    ...partial,
  };
}
