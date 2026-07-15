import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyAdvisorIntent,
  buildHumanAdvisorNarrative,
  createAdvisorResponsePlan,
  createInitialAdvisorSession,
  getRelevantAdvisorActions,
  renderAdvisorResponse,
  resetAdvisorSession,
  type AdvisorContext,
} from "../lib/advisorConversation";
import { buildDecisionReport, defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { RecommendationDecisionSet, Vehicle } from "../types/vehicle";

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

const profileC2: BuyerProfile = {
  ...profileC,
  requiredMake: undefined,
  preferredMake: "BMW",
};

const contextA = getAdvisorContext(profileA);
const contextB = getAdvisorContext(profileB);
const contextC = getAdvisorContext(profileC);
const contextC2 = getAdvisorContext(profileC2);

const topA = contextA.decisionSet.primaryRecommendations[0];
const recommendationPlanA = createAdvisorResponsePlan("explain_recommendation", contextA);
const renderedA = renderAdvisorResponse(recommendationPlanA);
assert.ok(renderedA.paragraphs.join(" ").includes(formatName(topA)), "advisor should name the DecisionReport best overall");
assert.equal(topA.vehicleId, contextA.decisionReport.bestOverall.vehicleId, "advisor top must match DecisionReport best overall");
assert.equal(contextA.decisionSet.primaryRecommendations[0].vehicleId, topA.vehicleId, "advisor must not change rankings");
assertHumanNarrativeShape(contextA, "reliability-focused student");
assertHumanNarrativeShape(contextB, "safety-focused parent");
assertHumanNarrativeShape(contextC2, "performance-focused user");
assertNoRoboticPhrases("Profile A default", renderedA.paragraphs.join(" "));

const runnerUpPlan = createAdvisorResponsePlan("compare_runner_up", contextA);
assert.ok(
  runnerUpPlan.evidence.includes(contextA.decisionReport.whyRunnerUpLost),
  "runner-up explanation must use the structured DecisionReport loss reason",
);

const cheaperPlan = createAdvisorResponsePlan("request_cheaper", contextA);
assert.equal(cheaperPlan.preferenceLed, true, "alternative requests should be preference-led");
assert.ok(renderAdvisorResponse(cheaperPlan).paragraphs.join(" ").includes("alternative perspective"));
if (cheaperPlan.alternativeVehicleId) {
  const cheaperAlternative = contextA.decisionSet.primaryRecommendations.find(
    (recommendation) => recommendation.vehicleId === cheaperPlan.alternativeVehicleId,
  );
  assert.ok(cheaperAlternative?.qualified, "alternatives must be qualified vehicles");
}

const sportierPlan = createAdvisorResponsePlan("request_sportier", contextA);
assert.equal(sportierPlan.preferenceLed, true);
assert.ok(sportierPlan.preferenceConflict?.includes("driving enjoyment"));
assert.equal(contextA.decisionSet.primaryRecommendations[0].vehicleId, topA.vehicleId, "sportier exploration must not rerank");

const lowConfidenceContext = withLowDataConfidence(contextA);
const uncertaintyPlan = createAdvisorResponsePlan("explain_uncertainty", lowConfidenceContext);
assert.ok(
  renderAdvisorResponse(uncertaintyPlan).paragraphs.join(" ").includes("Data quality confidence is 35/100 low"),
  "low data confidence should produce an uncertainty disclosure",
);
assert.ok(
  buildHumanAdvisorNarrative(lowConfidenceContext).uncertaintyDisclosure.includes("low"),
  "medium or low data confidence should be disclosed in the human narrative",
);

const noMatchPlan = createAdvisorResponsePlan("explain_no_match_blockers", contextC);
assert.ok(noMatchPlan.directAnswer.startsWith("I do not have a responsible match"));
assert.equal(noMatchPlan.alternativeVehicleId, undefined, "no-match responses must not fabricate a vehicle id");
assert.equal(contextC.decisionSet.primaryRecommendations.length, 0, "Profile C should have no fabricated BMW match");
assert.ok(getRelevantAdvisorActions(contextC).every((action) => action.intent !== "request_cheaper"), "no-match actions should be blocker actions only");
const noMatchNarrative = buildHumanAdvisorNarrative(contextC);
assert.ok(noMatchNarrative.openingRecommendation.includes("responsible recommendation"), "no-match should use direct human language");
assert.ok(noMatchNarrative.strongestReasons.join(" ").includes("invent"), "no-match should refuse fabrication");
assertNoRoboticPhrases("Profile C no-match", renderAdvisorResponse(noMatchPlan).paragraphs.join(" "));

let session = createInitialAdvisorSession(contextA);
const officialTopBefore = session.officialTopVehicleId;
session = applyAdvisorIntent(session, "request_sportier", contextA, "Show me a sportier option");
session = applyAdvisorIntent(session, "record_preference_discovery", contextA, "Yes, I would accept that tradeoff");
assert.equal(session.officialTopVehicleId, officialTopBefore, "session preference discovery must not change official top vehicle");
assert.ok(session.preferenceDiscoveries.length > 0, "preference discovery should be stored in session only");
assert.equal(contextA.decisionSet.primaryRecommendations[0].vehicleId, officialTopBefore);
session = resetAdvisorSession(contextA);
assert.equal(session.entries.length, 1, "reset should return to one opening advisor message");
assert.equal(session.preferenceDiscoveries.length, 0, "reset should clear session-only discoveries");

session.entries.forEach((entry) => {
  if (entry.role === "advisor") {
    assert.ok(entry.plan, "advisor entries must retain a structured response plan");
    assert.deepEqual(entry.rendered, renderAdvisorResponse(entry.plan), "rendered text must be produced from the response plan");
  }
});

assert.ok(getRelevantAdvisorActions(contextA).length >= 4 && getRelevantAdvisorActions(contextA).length <= 6);
assert.ok(getRelevantAdvisorActions(contextB).length >= 4 && getRelevantAdvisorActions(contextB).length <= 6);
assert.ok(
  createAdvisorResponsePlan("challenge_recommendation", contextC2).preferenceConflict?.includes("preference-led"),
  "challenge responses should label weaker options as preference-led",
);
assert.equal(buildHumanAdvisorNarrative(contextA).curiosityPrompt, "Are you planning to keep the car for more than five years?");
assert.equal(buildHumanAdvisorNarrative(contextB).curiosityPrompt, "Will you regularly carry family or passengers?");
assert.equal(
  buildHumanAdvisorNarrative(contextC2).curiosityPrompt,
  "Would you accept somewhat higher insurance or maintenance costs for a more engaging car?",
);
assert.ok(
  buildHumanAdvisorNarrative(contextA).whyNearWinnerLost === contextA.decisionReport.whyRunnerUpLost,
  "runner-up language must use DecisionReport loss reason",
);
assert.ok(
  buildHumanAdvisorNarrative(contextB).whyNearWinnerLost === contextB.decisionReport.whyRunnerUpLost,
  "safety profile runner-up language must use DecisionReport loss reason",
);
assertNoFabricatedVehicle(contextA);
assertNoFabricatedVehicle(contextB);
assertNoUnsupportedClaims(contextA);
assertNoUnsupportedClaims(contextB);
assertNoUnsupportedClaims(contextC2);

console.log("Advisor conversation contract passed.");
console.log("Visible advisor responses:");
console.log(`Profile A: ${renderAdvisorResponse(createAdvisorResponsePlan("explain_recommendation", contextA)).paragraphs.join(" ")}`);
console.log(`Profile B: ${renderAdvisorResponse(createAdvisorResponsePlan("explain_recommendation", contextB)).paragraphs.join(" ")}`);
console.log(`Profile C: ${renderAdvisorResponse(createAdvisorResponsePlan("explain_no_match_blockers", contextC)).paragraphs.join(" ")}`);
console.log(`Profile C2: ${renderAdvisorResponse(createAdvisorResponsePlan("explain_recommendation", contextC2)).paragraphs.join(" ")}`);
console.log("What I considered:");
console.log(`Profile A: ${buildHumanAdvisorNarrative(contextA).whatIConsidered.join(" | ")}`);
console.log(`Profile B: ${buildHumanAdvisorNarrative(contextB).whatIConsidered.join(" | ")}`);
console.log("Runner-up explanations:");
console.log(`Profile A: ${buildHumanAdvisorNarrative(contextA).whyNearWinnerLost || "None"}`);
console.log(`Profile B: ${buildHumanAdvisorNarrative(contextB).whyNearWinnerLost || "None"}`);
console.log("Advisor questions:");
console.log(`Profile A: ${buildHumanAdvisorNarrative(contextA).curiosityPrompt}`);
console.log(`Profile B: ${buildHumanAdvisorNarrative(contextB).curiosityPrompt}`);
console.log(`Profile C: ${buildHumanAdvisorNarrative(contextC).curiosityPrompt}`);
console.log(`Profile C2: ${buildHumanAdvisorNarrative(contextC2).curiosityPrompt}`);

function getAdvisorContext(profile: BuyerProfile) {
  const decisionSet = runCandidatePipeline(profile, vehicleCatalog, { includeCompromises: true, includeExcluded: true }).decisionSet;
  return {
    decisionSet,
    decisionReport: buildDecisionReport(decisionSet),
    profile,
  };
}

function withLowDataConfidence(context: AdvisorContext) {
  const primary = context.decisionSet.primaryRecommendations;
  const lowTop = {
    ...primary[0],
    dataQualityConfidence: {
      ...primary[0].dataQualityConfidence,
      score: 35,
      level: "low" as const,
    },
  };
  const decisionSet: RecommendationDecisionSet = {
    ...context.decisionSet,
    primaryRecommendations: [lowTop, ...primary.slice(1)],
  };
  return {
    decisionSet,
    decisionReport: {
      ...context.decisionReport,
      dataQualityConfidence: lowTop.dataQualityConfidence,
    },
    profile: context.profile,
  };
}

function formatName(recommendation: { vehicle: Vehicle }) {
  return `${recommendation.vehicle.year} ${recommendation.vehicle.make} ${recommendation.vehicle.model}`;
}

function weights(partial: Partial<ScoreWeights>): ScoreWeights {
  return {
    ...defaultScoreWeights,
    ...partial,
  };
}

function assertHumanNarrativeShape(context: AdvisorContext, label: string) {
  const narrative = buildHumanAdvisorNarrative(context);
  assert.ok(narrative.openingRecommendation, `${label}: openingRecommendation is required`);
  assert.ok(narrative.buyerContextAcknowledgment, `${label}: buyerContextAcknowledgment is required`);
  assert.ok(narrative.strongestReasons.length > 0, `${label}: strongestReasons are required`);
  assert.ok(narrative.mainConcern, `${label}: mainConcern is required`);
  assert.ok(narrative.uncertaintyDisclosure, `${label}: uncertaintyDisclosure is required`);
  assert.ok(narrative.advisorOpinion, `${label}: advisorOpinion is required`);
  assert.ok(narrative.curiosityPrompt.endsWith("?"), `${label}: curiosityPrompt should be one question`);
  assert.ok(narrative.suggestedActions.length > 0 && narrative.suggestedActions.length <= 5, `${label}: actions should be focused`);
  assert.ok(narrative.whatIConsidered.length >= 3 && narrative.whatIConsidered.length <= 4, `${label}: whatIConsidered should be concise`);
  if (context.decisionReport.runnerUp?.vehicleId) {
    assert.equal(narrative.whyNearWinnerLost, context.decisionReport.whyRunnerUpLost, `${label}: runner-up reason must match DecisionReport`);
    assert.ok(narrative.nearWinner?.vehicleName, `${label}: nearWinner should be present when runner-up exists`);
  }
  assertNoRoboticPhrases(label, [
    narrative.openingRecommendation,
    narrative.buyerContextAcknowledgment,
    ...narrative.strongestReasons,
    narrative.mainConcern,
    narrative.uncertaintyDisclosure,
    narrative.advisorOpinion,
    narrative.curiosityPrompt,
    ...narrative.whatIConsidered,
  ].join(" "));
}

function assertNoRoboticPhrases(label: string, text: string) {
  const forbidden = [
    "strongest qualified overall fit",
    "No major compromise was recorded",
    "This response",
    "The recommendation is",
    "Affordability scored",
    "scored 84/100 at",
  ];
  forbidden.forEach((phrase) => {
    assert.ok(!text.includes(phrase), `${label}: visible text should not include "${phrase}"`);
  });
}

function assertNoFabricatedVehicle(context: AdvisorContext) {
  const catalogNames = new Set(vehicleCatalog.map((vehicle) => `${vehicle.year} ${vehicle.make} ${vehicle.model}`));
  const narrative = buildHumanAdvisorNarrative(context);
  const mentioned = [
    narrative.nearWinner?.vehicleName,
    context.decisionSet.primaryRecommendations[0] ? formatName(context.decisionSet.primaryRecommendations[0]) : undefined,
  ].filter(Boolean);
  mentioned.forEach((name) => {
    assert.ok(catalogNames.has(name as string), `advisor mentioned a vehicle absent from the catalog: ${name}`);
  });
}

function assertNoUnsupportedClaims(context: AdvisorContext) {
  const text = renderAdvisorResponse(createAdvisorResponsePlan("explain_recommendation", context)).paragraphs.join(" ");
  const unsupported = ["beautiful", "gorgeous", "stylish", "exciting-looking", "you will love"];
  unsupported.forEach((claim) => {
    assert.ok(!text.toLowerCase().includes(claim), `advisor should not make unsupported appearance or emotion claim: ${claim}`);
  });
}
