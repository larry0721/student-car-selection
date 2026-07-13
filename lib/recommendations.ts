import { calculateBudget } from "./affordability";
import { getVehicleDataQualityMisses, isRecommendableVehicle } from "./data/vehicleValidation";
import type { BudgetSummary, BuyerProfile, ConstraintKey, ImportanceLevel, ScoreWeights } from "@/types/buyer";
import type {
  BetterAlternative,
  CandidatePipelineDebug,
  CandidatePipelineRunnerUpLoss,
  ConstraintBlocker,
  DecisionReport,
  DecisionReportChoice,
  EstimatedField,
  FieldProvenance,
  HardConstraintResult,
  MissingInformation,
  NoMatchResult,
  QualificationStatus,
  RecommendationAssumption,
  RecommendationConfidence,
  RecommendationDecisionSet,
  RecommendationObject,
  RecommendationSignal,
  RecommendationTradeoff,
  ScoredVehicle,
  Vehicle,
} from "@/types/vehicle";

type CategoryKey = keyof ScoreWeights;

type ScorePenalty = {
  label: string;
  points: number;
  reason: string;
};

type HardConstraintStatus = {
  status: QualificationStatus;
  passed: boolean;
  checked: string[];
  results: HardConstraintResult[];
  failures: HardConstraintResult[];
};

type Confidence = {
  score: number;
  level: "high" | "medium" | "low";
  reasons: string[];
};

type OwnershipEstimates = {
  maintenanceMonthly: number;
  fuelMonthly: number;
  depreciationAnnual: number;
  estimatedPayment: number;
  ownershipMonthly: number;
};

type CandidateDraft = {
  vehicle: Vehicle;
  hardConstraintStatus: HardConstraintStatus;
  assumptions: string[];
  missingDataWarnings: string[];
  confidence: Confidence;
  ownership: {
    insuranceMonthly: number;
    maintenanceMonthly: number;
    fuelMonthly: number;
    depreciationAnnual: number;
    estimatedPayment: number;
    ownershipMonthly: number;
  };
  firstYearOwnership: {
    insurance: number;
    maintenance: number;
    fuel: number;
    depreciation: number;
    total: number;
  };
};

type ScoreDraft = CandidateDraft & {
  rawScores: Record<CategoryKey, number>;
  reasons: string[];
  misses: string[];
  penalties: ScorePenalty[];
};

type CandidatePipelineOptions = {
  includeCompromises?: boolean;
  includeExcluded?: boolean;
  disablePriorityScaling?: boolean;
};

type CandidatePipelineResult = {
  rankedVehicles: ScoredVehicle[];
  decisionSet: RecommendationDecisionSet;
  pipelineDebug: CandidatePipelineDebug;
};

const categoryKeys: CategoryKey[] = [
  "affordability",
  "reliability",
  "safety",
  "fuelEnergyCost",
  "insuranceCost",
  "maintenanceRisk",
  "practicality",
  "resaleValue",
  "drivingPreferenceFit",
];

const spaciousTypes = new Set(["hatchback", "wagon", "suv", "minivan", "truck"]);
const snowDrivetrains = new Set(["AWD", "4WD"]);
const beginnerFriendlyTypes = new Set(["sedan", "hatchback", "suv", "wagon", "minivan"]);

export const defaultScoreWeights: ScoreWeights = {
  affordability: 25,
  reliability: 15,
  safety: 15,
  fuelEnergyCost: 10,
  insuranceCost: 10,
  maintenanceRisk: 10,
  practicality: 7,
  resaleValue: 5,
  drivingPreferenceFit: 3,
};

export const scoreWeightLabels: Record<CategoryKey, string> = {
  affordability: "Affordability",
  reliability: "Reliability",
  safety: "Safety",
  fuelEnergyCost: "Fuel and energy cost",
  insuranceCost: "Insurance cost",
  maintenanceRisk: "Maintenance risk",
  practicality: "Practicality",
  resaleValue: "Resale value",
  drivingPreferenceFit: "Driving preference fit",
};

export function rankRecommendations(
  profile: BuyerProfile,
  vehicles: Vehicle[],
  options: { includeCompromises?: boolean; includeExcluded?: boolean; includeDisqualified?: boolean } = {},
): RecommendationObject[] {
  return runCandidatePipeline(profile, vehicles, {
    includeCompromises: Boolean(options.includeCompromises || options.includeDisqualified),
    includeExcluded: Boolean(options.includeExcluded || options.includeDisqualified),
  }).rankedVehicles.map((vehicle) => vehicle.recommendation);
}

export function getRecommendationDecisionSet(profile: BuyerProfile, vehicles: Vehicle[]): RecommendationDecisionSet {
  return runCandidatePipeline(profile, vehicles, { includeCompromises: true, includeExcluded: true }).decisionSet;
}

export function buildDecisionReport(decisionSet: RecommendationDecisionSet): DecisionReport {
  const qualified = decisionSet.primaryRecommendations;
  const bestOverall = qualified[0];
  const bestValue = getBestValueRecommendation(qualified);
  const safestChoice = getSafestRecommendation(qualified);
  const userPreferredChoice = getUserPreferredRecommendation(qualified);
  const runnerUp = qualified[1];

  return {
    bestOverall: getDecisionChoice(bestOverall, "No vehicle qualifies as the best overall choice."),
    bestValue: getDecisionChoice(bestValue, "No qualified vehicle is available for a value pick.", "ownership_cost"),
    safestChoice: getDecisionChoice(safestChoice, "No qualified vehicle is available for a safety pick.", "safety"),
    userPreferredChoice: getDecisionChoice(userPreferredChoice, "No qualified vehicle satisfies the user's stated preference.", "drivingPreferenceFit"),
    executiveSummary: getExecutiveSummary(bestOverall, bestValue, safestChoice, userPreferredChoice, decisionSet),
    userPriorities: bestOverall?.reasonsForRecommendation.slice(0, 5) || [],
    hardRequirements: bestOverall?.hardConstraintResults || [],
    whySelected: bestOverall?.reasonsForRecommendation.slice(0, 6) || [],
    primaryTradeoffs: bestOverall?.tradeoffs.slice(0, 5) || [],
    runnerUp: runnerUp ? getDecisionChoice(runnerUp, "No qualified runner-up is available.") : undefined,
    whyRunnerUpLost: getWhyRunnerUpLost(bestOverall, runnerUp),
    assumptions: bestOverall?.assumptionsUsed || [],
    missingInformation: bestOverall?.missingInformation || [],
    estimatedFields: bestOverall?.estimatedFields || [],
    recommendationConfidence: bestOverall?.recommendationConfidence,
    dataQualityConfidence: bestOverall?.dataQualityConfidence,
    whatCouldChangeRecommendation: getWhatCouldChangeRecommendation(bestOverall, runnerUp),
  };
}

function getBestValueRecommendation(recommendations: RecommendationObject[]) {
  return [...recommendations].sort(
    (a, b) =>
      a.ownershipSummary.estimatedMonthlyTotal - b.ownershipSummary.estimatedMonthlyTotal ||
      b.overallMatchScore - a.overallMatchScore ||
      a.vehicle.price - b.vehicle.price,
  )[0];
}

function getSafestRecommendation(recommendations: RecommendationObject[]) {
  return [...recommendations].sort(
    (a, b) =>
      b.vehicle.safetyScore - a.vehicle.safetyScore ||
      b.overallMatchScore - a.overallMatchScore ||
      a.ownershipSummary.estimatedMonthlyTotal - b.ownershipSummary.estimatedMonthlyTotal,
  )[0];
}

function getUserPreferredRecommendation(recommendations: RecommendationObject[]) {
  const notRelaxed = recommendations.filter(
    (recommendation) => !recommendation.tradeoffs.some((tradeoff) => tradeoff.code === "make_preference_relaxed"),
  );
  const pool = notRelaxed.length ? notRelaxed : recommendations;

  return [...pool].sort(
    (a, b) =>
      getSignalScore(b, "drivingPreferenceFit") - getSignalScore(a, "drivingPreferenceFit") ||
      b.overallMatchScore - a.overallMatchScore,
  )[0];
}

function getDecisionChoice(
  recommendation: RecommendationObject | undefined,
  emptyReason: string,
  category?: keyof ScoreWeights | "ownership_cost",
): DecisionReportChoice {
  if (!recommendation) return { reason: emptyReason };

  return {
    vehicleId: recommendation.vehicleId,
    year: recommendation.vehicle.year,
    make: recommendation.vehicle.make,
    model: recommendation.vehicle.model,
    overallMatchScore: recommendation.overallMatchScore,
    categoryScore:
      category === "ownership_cost"
        ? recommendation.ownershipSummary.estimatedMonthlyTotal
        : category
          ? getOptionalSignalScore(recommendation, category)
          : undefined,
    reason: getChoiceReason(recommendation, category),
  };
}

function getChoiceReason(recommendation: RecommendationObject, category?: keyof ScoreWeights | "ownership_cost") {
  const label = `${recommendation.vehicle.year} ${recommendation.vehicle.make} ${recommendation.vehicle.model}`;
  if (category === "ownership_cost") {
    return `${label} has estimated monthly ownership cost of ${formatCurrency(recommendation.ownershipSummary.estimatedMonthlyTotal)} and match score ${recommendation.overallMatchScore}.`;
  }
  if (category) {
    const signal = recommendation.reasonsForRecommendation.find((item) => item.category === category);
    if (signal) {
      return `${label} has ${scoreWeightLabels[category]} score ${signal.score ?? signal.vehicleValue}/100 with ${signal.contribution ?? 0} weighted points.`;
    }
  }
  return `${label} has the highest qualified match score at ${recommendation.overallMatchScore}/100.`;
}

function getExecutiveSummary(
  bestOverall: RecommendationObject | undefined,
  bestValue: RecommendationObject | undefined,
  safestChoice: RecommendationObject | undefined,
  userPreferredChoice: RecommendationObject | undefined,
  decisionSet: RecommendationDecisionSet,
) {
  if (!bestOverall) {
    return [
      `No qualified vehicle was found from ${decisionSet.pipelineDebug.candidateCount} candidates.`,
      `${decisionSet.pipelineDebug.excludedCount} candidates were excluded by mandatory constraints.`,
    ];
  }

  const summary = [
    `${bestOverall.vehicle.year} ${bestOverall.vehicle.make} ${bestOverall.vehicle.model} is the best overall qualified match at ${bestOverall.overallMatchScore}/100.`,
    `Recommendation confidence is ${bestOverall.recommendationConfidence.score}/100 ${bestOverall.recommendationConfidence.level}; data quality confidence is ${bestOverall.dataQualityConfidence.score}/100 ${bestOverall.dataQualityConfidence.level}.`,
  ];
  if (bestValue && bestValue.vehicleId !== bestOverall.vehicleId) {
    summary.push(`Best value differs: ${bestValue.vehicle.year} ${bestValue.vehicle.make} ${bestValue.vehicle.model} has estimated monthly ownership cost of ${formatCurrency(bestValue.ownershipSummary.estimatedMonthlyTotal)}.`);
  }
  if (safestChoice && safestChoice.vehicleId !== bestOverall.vehicleId) {
    summary.push(`Safest qualified choice differs: ${safestChoice.vehicle.year} ${safestChoice.vehicle.make} ${safestChoice.vehicle.model} has safety score ${safestChoice.vehicle.safetyScore}/100.`);
  }
  if (userPreferredChoice?.tradeoffs.some((tradeoff) => tradeoff.code === "make_preference_relaxed")) {
    summary.push("The user preferred make is not satisfied by the top preferred-choice result.");
  }
  return summary;
}

function getWhyRunnerUpLost(bestOverall: RecommendationObject | undefined, runnerUp: RecommendationObject | undefined) {
  if (!bestOverall) return "No qualified winner exists, so there is no runner-up comparison.";
  if (!runnerUp) return "No qualified runner-up exists.";

  const strongestGap = categoryKeys
    .map((category) => ({
      category,
      gap: getSignalScore(bestOverall, category) - getSignalScore(runnerUp, category),
    }))
    .sort((a, b) => b.gap - a.gap)[0];
  const scoreGap = bestOverall.overallMatchScore - runnerUp.overallMatchScore;
  if (strongestGap && strongestGap.gap > 0) {
    return `${runnerUp.vehicle.year} ${runnerUp.vehicle.make} ${runnerUp.vehicle.model} lost to ${bestOverall.vehicle.year} ${bestOverall.vehicle.make} ${bestOverall.vehicle.model} by ${scoreGap} total points and trailed on ${scoreWeightLabels[strongestGap.category]} by ${Math.round(strongestGap.gap)} points.`;
  }
  return `${runnerUp.vehicle.year} ${runnerUp.vehicle.make} ${runnerUp.vehicle.model} had a lower total match score by ${scoreGap} points.`;
}

function getWhatCouldChangeRecommendation(bestOverall: RecommendationObject | undefined, runnerUp: RecommendationObject | undefined) {
  if (!bestOverall) return ["Relax at least one top hard-constraint blocker to unlock compromise candidates."];

  const changes: string[] = [];
  if (runnerUp) {
    changes.push(`A higher priority on ${getRunnerUpAdvantage(bestOverall, runnerUp)} could move the runner-up closer.`);
  }
  bestOverall.tradeoffs.slice(0, 2).forEach((tradeoff) => {
    changes.push(`Reducing the ${tradeoff.field} tradeoff could strengthen the current top choice.`);
  });
  bestOverall.missingInformation.slice(0, 2).forEach((missing) => {
    changes.push(`Adding ${missing.field} from ${missing.expectedSource} could change confidence.`);
  });
  bestOverall.betterAlternativesIfConstraintsChange.slice(0, 2).forEach((alternative) => {
    const firstChange = alternative.requiredConstraintChanges[0];
    if (firstChange) {
      changes.push(`Relaxing ${firstChange.label} could unlock ${alternative.year} ${alternative.make} ${alternative.model}.`);
    }
  });
  return changes.length ? changes : ["No single visible RecommendationObject field suggests a likely ranking change."];
}

function getRunnerUpAdvantage(bestOverall: RecommendationObject, runnerUp: RecommendationObject) {
  const advantage = categoryKeys
    .map((category) => ({
      category,
      gap: getSignalScore(runnerUp, category) - getSignalScore(bestOverall, category),
    }))
    .sort((a, b) => b.gap - a.gap)[0];
  return advantage && advantage.gap > 0 ? scoreWeightLabels[advantage.category] : "the runner-up's strongest category";
}

function getSignalScore(recommendation: RecommendationObject, category: keyof ScoreWeights) {
  const signal = recommendation.reasonsForRecommendation.find((item) => item.category === category);
  return Number(signal?.score ?? signal?.vehicleValue ?? 0);
}

function getOptionalSignalScore(recommendation: RecommendationObject, category: keyof ScoreWeights) {
  const signal = recommendation.reasonsForRecommendation.find((item) => item.category === category);
  if (!signal) return undefined;
  return Number(signal.score ?? signal.vehicleValue);
}

function getNoMatchResult(
  primaryRecommendations: RecommendationObject[],
  compromiseRecommendations: RecommendationObject[],
  excludedRecommendations: RecommendationObject[],
): NoMatchResult {
  return {
    noMatch: primaryRecommendations.length === 0,
    totalEvaluated: primaryRecommendations.length + compromiseRecommendations.length + excludedRecommendations.length,
    qualifiedCount: primaryRecommendations.length,
    compromiseCount: compromiseRecommendations.length,
    excludedCount: excludedRecommendations.length,
    topConstraintBlockers: getTopConstraintBlockers([...compromiseRecommendations, ...excludedRecommendations]),
    compromiseOptions: primaryRecommendations.length ? [] : compromiseRecommendations.slice(0, 3).map(getCompromiseGuidance),
  };
}

function getCompromiseGuidance(recommendation: RecommendationObject) {
  const failedConstraint = recommendation.hardConstraintResults.find((constraint) => !constraint.passed);
  return {
    vehicleId: recommendation.vehicleId,
    year: recommendation.vehicle.year,
    make: recommendation.vehicle.make,
    model: recommendation.vehicle.model,
    qualificationStatus: recommendation.qualificationStatus,
    overallMatchScore: recommendation.overallMatchScore,
    singleConstraintChange: failedConstraint || recommendation.hardConstraintResults[0],
  };
}

function getTopConstraintBlockers(recommendations: RecommendationObject[]): ConstraintBlocker[] {
  const blockers = new Map<ConstraintKey, ConstraintBlocker>();

  recommendations.forEach((recommendation) => {
    recommendation.hardConstraintResults
      .filter((constraint) => !constraint.passed)
      .forEach((constraint) => {
        const existing = blockers.get(constraint.code) || {
          code: constraint.code,
          label: constraint.label,
          excludedCount: 0,
          compromiseCount: 0,
        };
        if (recommendation.qualificationStatus === "compromise") existing.compromiseCount += 1;
        if (recommendation.qualificationStatus === "excluded") existing.excludedCount += 1;
        blockers.set(constraint.code, existing);
      });
  });

  return [...blockers.values()]
    .sort((a, b) => b.excludedCount + b.compromiseCount - (a.excludedCount + a.compromiseCount))
    .slice(0, 5);
}

export function rankVehicles(profile: BuyerProfile, vehicles: Vehicle[]): ScoredVehicle[] {
  return runCandidatePipeline(profile, vehicles, { includeCompromises: false, includeExcluded: false }).rankedVehicles;
}

export function runCandidatePipeline(
  profile: BuyerProfile,
  vehicles: Vehicle[],
  options: CandidatePipelineOptions = {},
): CandidatePipelineResult {
  const budget = calculateBudget(profile);
  const maxPrice = getEffectiveMaxPrice(profile, budget.maxPurchasePrice);
  const catalog = loadCatalog(vehicles);
  const candidateVehicles = generateCandidatePool(catalog);
  const candidateDrafts = applyConstraintFiltering(candidateVehicles, profile, budget, maxPrice);
  const filteredDrafts = candidateDrafts.filter((draft) => draft.hardConstraintStatus.status !== "excluded");
  const qualifiedDrafts = candidateDrafts.filter((draft) => draft.hardConstraintStatus.status === "qualified");
  const compromiseDrafts = candidateDrafts.filter((draft) => draft.hardConstraintStatus.status === "compromise");
  const excludedDrafts = candidateDrafts.filter((draft) => draft.hardConstraintStatus.status === "excluded");
  const filteredSuitabilityDrafts = evaluateSuitability(filteredDrafts, profile, budget, maxPrice);
  const excludedDiagnosticDrafts = evaluateSuitability(excludedDrafts, profile, budget, maxPrice);
  const suitabilityDrafts = [...filteredSuitabilityDrafts, ...excludedDiagnosticDrafts];
  const qualifiedSuitabilityDrafts = filteredSuitabilityDrafts.filter((draft) => draft.hardConstraintStatus.status === "qualified");

  const categoryStats = getCategoryStats(
    qualifiedSuitabilityDrafts.length
      ? qualifiedSuitabilityDrafts
      : filteredSuitabilityDrafts.length
        ? filteredSuitabilityDrafts
        : suitabilityDrafts,
  );
  const normalizedWeights = options.disablePriorityScaling ? normalizeScoreWeights(profile.scoreWeights) : getDynamicScoreWeights(profile);
  const allScoredVehicles = suitabilityDrafts
    .map((draft) => finalizeScoreDraft(draft, profile, normalizedWeights, categoryStats))
    .sort((a, b) => b.score - a.score || b.confidence.score - a.confidence.score || a.price - b.price);
  const hydratedVehicles = hydrateScoredVehicles(allScoredVehicles, profile);
  const rankedVehicles = hydratedVehicles.filter(
    (vehicle) =>
      vehicle.hardConstraintStatus.status === "qualified" ||
      (options.includeCompromises && vehicle.hardConstraintStatus.status === "compromise") ||
      (options.includeExcluded && vehicle.hardConstraintStatus.status === "excluded"),
  );
  const primaryRecommendations = hydratedVehicles
    .filter((vehicle) => vehicle.hardConstraintStatus.status === "qualified")
    .map((vehicle) => vehicle.recommendation);
  const compromiseRecommendations = hydratedVehicles
    .filter((vehicle) => vehicle.hardConstraintStatus.status === "compromise")
    .map((vehicle) => vehicle.recommendation);
  const excludedRecommendations = hydratedVehicles
    .filter((vehicle) => vehicle.hardConstraintStatus.status === "excluded")
    .map((vehicle) => vehicle.recommendation);
  const pipelineDebug = buildPipelineDebug({
    catalogCount: catalog.length,
    candidateCount: candidateDrafts.length,
    filteredCount: filteredDrafts.length,
    excludedCount: excludedDrafts.length,
    qualifiedCount: qualifiedDrafts.length,
    compromiseCount: compromiseDrafts.length,
    rankedVehicles: hydratedVehicles,
  });

  return {
    rankedVehicles,
    decisionSet: {
      primaryRecommendations,
      compromiseRecommendations,
      excludedRecommendations,
      noMatch: getNoMatchResult(primaryRecommendations, compromiseRecommendations, excludedRecommendations),
      pipelineDebug,
    },
    pipelineDebug,
  };
}

function loadCatalog(vehicles: Vehicle[]) {
  return vehicles;
}

function generateCandidatePool(catalog: Vehicle[]) {
  return catalog.filter(isRecommendableVehicle);
}

function applyConstraintFiltering(
  candidateVehicles: Vehicle[],
  profile: BuyerProfile,
  budget: BudgetSummary,
  maxPrice: number,
): CandidateDraft[] {
  return candidateVehicles.map((vehicle) => createCandidateDraft(vehicle, profile, budget, maxPrice));
}

function evaluateSuitability(
  candidateDrafts: CandidateDraft[],
  profile: BuyerProfile,
  budget: BudgetSummary,
  maxPrice: number,
): ScoreDraft[] {
  return candidateDrafts.map((draft) => addSuitabilityScores(draft, profile, budget, maxPrice));
}

function hydrateScoredVehicles(scoredVehicles: ScoredVehicle[], profile: BuyerProfile): ScoredVehicle[] {
  return scoredVehicles.map((vehicle) => {
    const similarAlternatives = getSimilarAlternatives(vehicle, scoredVehicles);
    const recommendation = buildRecommendationObject(vehicle, scoredVehicles, profile);
    return {
      ...vehicle,
      similarAlternatives,
      recommendation,
      reasons: getLegacyReasonsFromRecommendation(recommendation),
      misses: getLegacyMissesFromRecommendation(recommendation),
    };
  });
}

function buildPipelineDebug(input: {
  catalogCount: number;
  candidateCount: number;
  filteredCount: number;
  excludedCount: number;
  qualifiedCount: number;
  compromiseCount: number;
  rankedVehicles: ScoredVehicle[];
}): CandidatePipelineDebug {
  const qualifiedVehicles = input.rankedVehicles.filter((vehicle) => vehicle.hardConstraintStatus.status === "qualified");
  const compromiseVehicles = input.rankedVehicles.filter((vehicle) => vehicle.hardConstraintStatus.status === "compromise");
  const displayRanking = qualifiedVehicles.length ? qualifiedVehicles : compromiseVehicles;

  return {
    catalogCount: input.catalogCount,
    candidateCount: input.candidateCount,
    filteredCount: input.filteredCount,
    excludedCount: input.excludedCount,
    qualifiedCount: input.qualifiedCount,
    compromiseCount: input.compromiseCount,
    stages: [
      {
        stage: "loadCatalog",
        inputCount: input.catalogCount,
        outputCount: input.catalogCount,
        note: "Loaded the full vehicle catalog supplied to the engine.",
      },
      {
        stage: "candidateGeneration",
        inputCount: input.catalogCount,
        outputCount: input.candidateCount,
        note: "Kept records that passed vehicle data validation and can be considered for recommendation.",
      },
      {
        stage: "constraintFiltering",
        inputCount: input.candidateCount,
        outputCount: input.filteredCount,
        note: "Separated qualified or flexible-compromise candidates from vehicles that failed mandatory constraints.",
      },
      {
        stage: "suitabilityEvaluation",
        inputCount: input.filteredCount,
        outputCount: input.filteredCount,
        note: "Calculated category suitability for non-excluded candidates; excluded candidates are evaluated only for diagnostics.",
      },
      {
        stage: "ranking",
        inputCount: input.filteredCount,
        outputCount: displayRanking.length,
        note: "Ranked qualified vehicles first; compromise vehicles are used only when there are no qualified matches.",
      },
      {
        stage: "recommendationObject",
        inputCount: displayRanking.length,
        outputCount: displayRanking.length,
        note: "Converted ranked vehicles into deterministic structured recommendation objects.",
      },
      {
        stage: "advisorLayer",
        inputCount: displayRanking.length,
        outputCount: displayRanking.length,
        note: "Current advisor text is derived from RecommendationObject fields only.",
      },
    ],
    topFive: displayRanking.slice(0, 5).map((vehicle, index) => ({
      rank: index + 1,
      vehicleId: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      overallMatchScore: vehicle.score,
      qualificationStatus: vehicle.hardConstraintStatus.status,
    })),
    runnerUpLossReasons: getRunnerUpLossReasons(displayRanking.slice(0, 5)),
    advisorLayerSource: "recommendation_object",
  };
}

function getRunnerUpLossReasons(topVehicles: ScoredVehicle[]): CandidatePipelineRunnerUpLoss[] {
  const winner = topVehicles[0];
  if (!winner) return [];

  return topVehicles.slice(1).map((runnerUp, index) => {
    const strongestGap = categoryKeys
      .map((category) => ({
        category,
        gap: Math.round((winner.scoreBreakdown[category] || 0) - (runnerUp.scoreBreakdown[category] || 0)),
      }))
      .sort((a, b) => b.gap - a.gap)[0];
    const penaltyGap =
      runnerUp.penalties.reduce((sum, penalty) => sum + penalty.points, 0) -
      winner.penalties.reduce((sum, penalty) => sum + penalty.points, 0);
    const scoreGap = Math.max(0, winner.score - runnerUp.score);
    const categoryGap = strongestGap?.gap || 0;
    const primaryReason =
      categoryGap > 0
        ? `${runnerUp.year} ${runnerUp.make} ${runnerUp.model} trailed the top result on ${scoreWeightLabels[strongestGap.category]} by ${categoryGap} points.`
        : penaltyGap > 0
          ? `${runnerUp.year} ${runnerUp.make} ${runnerUp.model} had ${Math.round(penaltyGap)} more penalty points than the top result.`
          : `${runnerUp.year} ${runnerUp.make} ${runnerUp.model} had a lower overall match score after weighted ranking.`;

    return {
      rank: index + 2,
      vehicleId: runnerUp.id,
      year: runnerUp.year,
      make: runnerUp.make,
      model: runnerUp.model,
      overallMatchScore: runnerUp.score,
      lostToVehicleId: winner.id,
      scoreGap,
      primaryReason,
      category: strongestGap?.category,
      categoryGap: Math.max(0, categoryGap),
    };
  });
}

export function getRequirementMatches(profile: BuyerProfile, vehicles: Vehicle[]) {
  const budget = calculateBudget(profile);
  const maxPrice = getEffectiveMaxPrice(profile, budget.maxPurchasePrice);

  return vehicles.filter((vehicle) => {
    if (!isRecommendableVehicle(vehicle)) return false;
    const ownership = getOwnershipEstimates(vehicle, profile);
    return getHardConstraintStatus(vehicle, profile, budget, maxPrice, ownership.estimatedPayment).status === "qualified";
  });
}

export function getVehicleRequirementMisses(vehicle: Vehicle, profile: BuyerProfile) {
  const dataQualityMisses = getVehicleDataQualityMisses(vehicle);
  if (dataQualityMisses.length) return dataQualityMisses;

  const budget = calculateBudget(profile);
  const maxPrice = getEffectiveMaxPrice(profile, budget.maxPurchasePrice);
  const ownership = getOwnershipEstimates(vehicle, profile);
  return getHardConstraintStatus(vehicle, profile, budget, maxPrice, ownership.estimatedPayment).failures.map(
    (constraint) => constraint.exclusionReason || `${constraint.label} failed`,
  );
}

export function normalizeScoreWeights(weights: ScoreWeights) {
  const sanitized = Object.fromEntries(
    categoryKeys.map((key) => [key, Math.max(0, Number(weights?.[key] ?? defaultScoreWeights[key]) || 0)]),
  ) as ScoreWeights;
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (!total) return defaultScoreWeights;

  return Object.fromEntries(categoryKeys.map((key) => [key, (sanitized[key] / total) * 100])) as ScoreWeights;
}

export function getDynamicScoreWeights(profile: BuyerProfile): ScoreWeights {
  const baseWeights = normalizeScoreWeights(profile.scoreWeights);
  const multipliers: Record<CategoryKey, number> = {
    affordability: getAffordabilityPriorityMultiplier(profile),
    reliability: getImportanceMultiplier(getNumericImportanceLevel(profile.reliabilityImportance)),
    safety: getImportanceMultiplier(getSafetyImportanceLevel(profile.safetyPriority)),
    fuelEnergyCost: getImportanceMultiplier(getNumericImportanceLevel(profile.fuelEconomyImportance)),
    insuranceCost: profile.insuranceBudget ? 1.15 : 1,
    maintenanceRisk: profile.reliabilityImportance >= 4 ? 1.18 : 1,
    practicality: getPracticalityPriorityMultiplier(profile),
    resaleValue: getImportanceMultiplier(getNumericImportanceLevel(profile.resaleValueImportance)),
    drivingPreferenceFit: getDrivingPriorityMultiplier(profile),
  };

  const scaled = Object.fromEntries(
    categoryKeys.map((key) => [key, Math.max(0, baseWeights[key] * multipliers[key])]),
  ) as ScoreWeights;

  return normalizeScoreWeights(scaled);
}

function getImportanceMultiplier(level: ImportanceLevel) {
  const multipliers: Record<ImportanceLevel, number> = {
    low: 0.72,
    normal: 1,
    important: 1.35,
    "very-important": 1.75,
  };
  return multipliers[level];
}

function getNumericImportanceLevel(value: number): ImportanceLevel {
  if (value <= 2) return "low";
  if (value === 3) return "normal";
  if (value === 4) return "important";
  return "very-important";
}

function getSafetyImportanceLevel(value: BuyerProfile["safetyPriority"]): ImportanceLevel {
  if (value === "standard") return "normal";
  if (value === "high") return "important";
  if (value === "maximum") return "very-important";
  return "normal";
}

function getAffordabilityPriorityMultiplier(profile: BuyerProfile) {
  if (profile.paymentMethod === "cash") return 1.28;
  if (profile.maxPurchaseBudget <= 12000 || profile.monthlyBudget <= 450) return 1.2;
  return 1;
}

function getPracticalityPriorityMultiplier(profile: BuyerProfile) {
  let multiplier = 1;
  if (profile.cargoNeed === "high") multiplier *= 1.35;
  if (profile.familySize >= 4) multiplier *= 1.3;
  if (profile.bodyStyle !== "any") multiplier *= 1.18;
  if (profile.climate === "snow" || profile.climate === "rain") multiplier *= 1.12;
  return Math.min(multiplier, 1.55);
}

function getDrivingPriorityMultiplier(profile: BuyerProfile) {
  const performanceMultiplier = getImportanceMultiplier(getNumericImportanceLevel(profile.performanceImportance));
  const featureMultiplier = getImportanceMultiplier(getNumericImportanceLevel(profile.advancedFeaturesImportance));
  const makeMultiplier = profile.requiredMake || profile.preferredMake ? 1.25 : 1;
  return Math.max(performanceMultiplier, featureMultiplier) * makeMultiplier;
}

function createCandidateDraft(
  vehicle: Vehicle,
  profile: BuyerProfile,
  budget: BudgetSummary,
  maxPrice: number,
): CandidateDraft {
  const ownership = getOwnershipEstimates(vehicle, profile);
  const hardConstraintStatus = getHardConstraintStatus(vehicle, profile, budget, maxPrice, ownership.estimatedPayment);
  const assumptions = getAssumptions(vehicle);
  const missingDataWarnings = getMissingDataWarnings(vehicle);
  const confidence = getConfidence(vehicle, assumptions, missingDataWarnings);

  return {
    vehicle,
    hardConstraintStatus,
    assumptions,
    missingDataWarnings,
    confidence,
    ownership: {
      insuranceMonthly: vehicle.insurance,
      maintenanceMonthly: ownership.maintenanceMonthly,
      fuelMonthly: ownership.fuelMonthly,
      depreciationAnnual: ownership.depreciationAnnual,
      estimatedPayment: ownership.estimatedPayment,
      ownershipMonthly: ownership.ownershipMonthly,
    },
    firstYearOwnership: {
      insurance: vehicle.insurance * 12,
      maintenance: ownership.maintenanceMonthly * 12,
      fuel: ownership.fuelMonthly * 12,
      depreciation: ownership.depreciationAnnual,
      total: vehicle.insurance * 12 + ownership.maintenanceMonthly * 12 + ownership.fuelMonthly * 12 + ownership.depreciationAnnual,
    },
  };
}

function addSuitabilityScores(
  draft: CandidateDraft,
  profile: BuyerProfile,
  budget: BudgetSummary,
  maxPrice: number,
): ScoreDraft {
  const ownership = {
    maintenanceMonthly: draft.ownership.maintenanceMonthly,
    fuelMonthly: draft.ownership.fuelMonthly,
    depreciationAnnual: draft.ownership.depreciationAnnual,
    estimatedPayment: draft.ownership.estimatedPayment,
    ownershipMonthly: draft.ownership.ownershipMonthly,
  };

  return {
    ...draft,
    rawScores: getRawCategoryScores(draft.vehicle, profile, budget, maxPrice, ownership),
    reasons: [],
    misses: [],
    penalties: getSoftPenalties(draft.vehicle, profile, ownership),
  };
}

function finalizeScoreDraft(
  draft: ScoreDraft,
  profile: BuyerProfile,
  normalizedWeights: ScoreWeights,
  categoryStats: Record<CategoryKey, { min: number; max: number }>,
): ScoredVehicle {
  const scoreBreakdown = Object.fromEntries(
    categoryKeys.map((key) => [key, Math.round(normalizeCategoryScore(draft.rawScores[key], categoryStats[key]))]),
  ) as Record<CategoryKey, number>;
  const weightedContributions = Object.fromEntries(
    categoryKeys.map((key) => [key, Math.round((scoreBreakdown[key] * normalizedWeights[key]) / 100)]),
  ) as Record<CategoryKey, number>;
  const positiveContributions = categoryKeys
    .map((key) => ({
      category: key,
      label: scoreWeightLabels[key],
      score: scoreBreakdown[key],
      weight: Math.round(normalizedWeights[key]),
      points: weightedContributions[key],
    }))
    .filter((contribution) => contribution.points > 0)
    .sort((a, b) => b.points - a.points);
  const penaltyTotal = draft.penalties.reduce((sum, penalty) => sum + penalty.points, 0);
  const weightedScore = Object.values(weightedContributions).reduce((sum, value) => sum + value, 0);
  const score = Math.round(clamp(weightedScore - penaltyTotal));

  return {
    ...draft.vehicle,
    score,
    matchSummary: {
      overall: score,
      affordability: scoreBreakdown.affordability,
      reliability: scoreBreakdown.reliability,
      safety: scoreBreakdown.safety,
      fuelEnergyCost: scoreBreakdown.fuelEnergyCost,
      insuranceCost: scoreBreakdown.insuranceCost,
      maintenanceRisk: scoreBreakdown.maintenanceRisk,
      ownershipCost: Math.round((scoreBreakdown.insuranceCost + scoreBreakdown.maintenanceRisk + scoreBreakdown.fuelEnergyCost) / 3),
      practicality: scoreBreakdown.practicality,
      resaleValue: scoreBreakdown.resaleValue,
      drivingPreferenceFit: scoreBreakdown.drivingPreferenceFit,
    },
    scoreBreakdown,
    weightedContributions,
    categoryWeights: normalizedWeights,
    positiveContributions,
    penalties: draft.penalties,
    hardConstraintStatus: draft.hardConstraintStatus,
    assumptions: draft.assumptions,
    missingDataWarnings: draft.missingDataWarnings,
    confidence: draft.confidence,
    reasons: draft.reasons,
    misses: draft.misses,
    ownership: draft.ownership,
    firstYearOwnership: draft.firstYearOwnership,
    similarAlternatives: [],
    recommendation: undefined as unknown as RecommendationObject,
    buyingTips: getBuyingTips(draft.vehicle, profile),
  };
}

function buildRecommendationObject(vehicle: ScoredVehicle, candidatePool: ScoredVehicle[], profile: BuyerProfile): RecommendationObject {
  const hardConstraintResults = getHardConstraintResults(vehicle);
  const hardConstraintsPassed = hardConstraintResults.filter((constraint) => constraint.passed);
  const failedConstraints = hardConstraintResults.filter((constraint) => !constraint.passed);
  const softPreferenceScore = getSoftPreferenceScore(vehicle);
  const dataQualityConfidence = getDataQualityConfidence(vehicle);

  return {
    vehicleId: vehicle.id,
    vehicle: getSourceVehicle(vehicle),
    qualified: vehicle.hardConstraintStatus.status === "qualified",
    qualificationStatus: vehicle.hardConstraintStatus.status,
    qualificationSummary: {
      status: vehicle.hardConstraintStatus.status,
      passedCount: hardConstraintsPassed.length,
      failedCount: failedConstraints.length,
      compromiseCount: failedConstraints.filter((constraint) => constraint.flexible).length,
    },
    hardConstraintResults,
    hardConstraintsPassed,
    softPreferenceScore,
    overallMatchScore: vehicle.score,
    recommendationConfidence: getRecommendationConfidence(vehicle, softPreferenceScore, dataQualityConfidence),
    dataQualityConfidence,
    reasonsForRecommendation: getRecommendationSignals(vehicle),
    tradeoffs: getRecommendationTradeoffs(vehicle, profile),
    assumptionsUsed: getStructuredAssumptions(vehicle),
    estimatedFields: getEstimatedFields(vehicle),
    missingInformation: getMissingInformation(vehicle),
    fieldProvenance: getFieldProvenance(vehicle),
    ownershipSummary: {
      estimatedMonthlyTotal:
        vehicle.ownership.insuranceMonthly +
        vehicle.ownership.maintenanceMonthly +
        vehicle.ownership.fuelMonthly +
        Math.round(vehicle.ownership.depreciationAnnual / 12),
      insuranceMonthly: vehicle.ownership.insuranceMonthly,
      maintenanceMonthly: vehicle.ownership.maintenanceMonthly,
      fuelMonthly: vehicle.ownership.fuelMonthly,
      depreciationMonthly: Math.round(vehicle.ownership.depreciationAnnual / 12),
    },
    firstYearOwnershipEstimate: vehicle.firstYearOwnership,
    betterAlternativesIfConstraintsChange: getBetterAlternativesIfConstraintsChange(vehicle, candidatePool),
  };
}

function getSourceVehicle(vehicle: ScoredVehicle): Vehicle {
  const {
    score: _score,
    matchSummary: _matchSummary,
    scoreBreakdown: _scoreBreakdown,
    weightedContributions: _weightedContributions,
    categoryWeights: _categoryWeights,
    positiveContributions: _positiveContributions,
    penalties: _penalties,
    hardConstraintStatus: _hardConstraintStatus,
    assumptions: _assumptions,
    missingDataWarnings: _missingDataWarnings,
    confidence: _confidence,
    recommendation: _recommendation,
    reasons: _reasons,
    misses: _misses,
    ownership: _ownership,
    firstYearOwnership: _firstYearOwnership,
    similarAlternatives: _similarAlternatives,
    buyingTips: _buyingTips,
    ...sourceVehicle
  } = vehicle;

  return sourceVehicle;
}

function getHardConstraintResults(vehicle: ScoredVehicle): HardConstraintResult[] {
  return vehicle.hardConstraintStatus.results;
}

function getSoftPreferenceScore(vehicle: ScoredVehicle) {
  const scores = [
    vehicle.scoreBreakdown.reliability,
    vehicle.scoreBreakdown.safety,
    vehicle.scoreBreakdown.fuelEnergyCost,
    vehicle.scoreBreakdown.insuranceCost,
    vehicle.scoreBreakdown.maintenanceRisk,
    vehicle.scoreBreakdown.practicality,
    vehicle.scoreBreakdown.resaleValue,
    vehicle.scoreBreakdown.drivingPreferenceFit,
  ];
  return Math.round(clamp(average(scores) - vehicle.penalties.reduce((sum, penalty) => sum + penalty.points, 0) * 0.35));
}

function getRecommendationSignals(vehicle: ScoredVehicle): RecommendationSignal[] {
  const failedCategories = new Set(
    vehicle.hardConstraintStatus.failures.map((constraint) => getConstraintCategory(constraint.code)).filter(Boolean),
  );

  return vehicle.positiveContributions.slice(0, 6).map((contribution) => ({
    code: `score_${contribution.category}`,
    category: contribution.category,
    field: contribution.category,
    vehicleValue: contribution.score,
    score: contribution.score,
    weight: contribution.weight,
    contribution: contribution.points,
  })).filter((signal) => !failedCategories.has(signal.category));
}

function getRecommendationTradeoffs(vehicle: ScoredVehicle, profile: BuyerProfile): RecommendationTradeoff[] {
  const tradeoffs: RecommendationTradeoff[] = vehicle.penalties.map((penalty) => {
    const mapped = mapPenaltyToCategory(penalty.label);
    return {
      code: toCode(penalty.label),
      category: mapped.category,
      field: mapped.field,
      vehicleValue: getTradeoffVehicleValue(vehicle, mapped.field),
      severity: penalty.points >= 10 ? "high" : penalty.points >= 7 ? "medium" : "low",
      penaltyPoints: penalty.points,
    };
  });

  if (profile.preferredMake?.trim() && normalizeText(vehicle.make) !== normalizeText(profile.preferredMake)) {
    tradeoffs.push({
      code: "make_preference_relaxed",
      category: "drivingPreferenceFit",
      field: "make",
      vehicleValue: vehicle.make,
      userPreference: profile.preferredMake.trim(),
      severity: "medium",
      penaltyPoints: 0,
    });
  }

  vehicle.hardConstraintStatus.failures
    .filter((constraint) => constraint.flexible)
    .forEach((constraint) => {
      tradeoffs.push({
        code: `${constraint.code}_constraint_relaxed`,
        category: getConstraintCategory(constraint.code) || "practicality",
        field: constraint.code,
        vehicleValue: constraint.actual ?? "",
        userPreference: constraint.limit,
        severity: "high",
        penaltyPoints: 0,
      });
    });

  return tradeoffs;
}

function getConstraintCategory(code: ConstraintKey): CategoryKey | undefined {
  const categories: Partial<Record<ConstraintKey, CategoryKey>> = {
    totalBudget: "affordability",
    monthlyPayment: "affordability",
    make: "drivingPreferenceFit",
    bodyStyle: "practicality",
    drivetrain: "practicality",
    maxMileage: "reliability",
    minYear: "reliability",
    purchaseCondition: "affordability",
    transmission: "drivingPreferenceFit",
    seating: "practicality",
    fuelType: "fuelEnergyCost",
    reliabilityMinimum: "reliability",
    safetyMinimum: "safety",
    performanceMinimum: "drivingPreferenceFit",
  };
  return categories[code];
}

function mapPenaltyToCategory(label: string): { category: CategoryKey; field: string } {
  if (label.includes("Insurance")) return { category: "insuranceCost", field: "insurance" };
  if (label.includes("Fuel")) return { category: "fuelEnergyCost", field: "mpg" };
  if (label.includes("Snow")) return { category: "practicality", field: "drivetrain" };
  if (label.includes("Seating")) return { category: "practicality", field: "seats" };
  if (label.includes("Safety")) return { category: "safety", field: "safetyScore" };
  if (label.includes("Reliability")) return { category: "reliability", field: "reliabilityScore" };
  return { category: "maintenanceRisk", field: "ownershipMonthly" };
}

function getTradeoffVehicleValue(vehicle: ScoredVehicle, field: string) {
  if (field === "insurance") return vehicle.insurance;
  if (field === "mpg") return vehicle.mpg;
  if (field === "drivetrain") return vehicle.drivetrain;
  if (field === "seats") return vehicle.seats;
  if (field === "safetyScore") return vehicle.safetyScore;
  if (field === "reliabilityScore") return vehicle.reliabilityScore;
  if (field === "ownershipMonthly") {
    return vehicle.ownership.insuranceMonthly + vehicle.ownership.maintenanceMonthly + vehicle.ownership.fuelMonthly + Math.round(vehicle.ownership.depreciationAnnual / 12);
  }
  return "";
}

function getStructuredAssumptions(vehicle: Vehicle): RecommendationAssumption[] {
  const assumptions: RecommendationAssumption[] = [];
  if (vehicle.maintenanceEstimate === undefined) {
    assumptions.push({ code: "estimated_maintenance", field: "maintenanceMonthly", method: "age_mileage_condition_body_brand" });
  }
  if (vehicle.depreciationEstimate === undefined) {
    assumptions.push({ code: "estimated_depreciation", field: "depreciationAnnual", method: "price_age_resale_score" });
  }
  if (!vehicle.listingUrl) assumptions.push({ code: "missing_listing_url", field: "listingUrl", method: "catalog_fallback" });
  if (!vehicle.imageVerified) assumptions.push({ code: "unverified_photo", field: "imageVerified", method: "photo_fallback", value: false });
  if (!vehicle.dataSources?.length || vehicle.dataSources.every((source) => source === "seed")) {
    assumptions.push({ code: "seed_catalog", field: "dataSources", method: "processed_catalog", value: "seed" });
  }
  return assumptions.slice(0, 5);
}

function getEstimatedFields(vehicle: ScoredVehicle): EstimatedField[] {
  const estimatedMonthlyTotal =
    vehicle.ownership.insuranceMonthly +
    vehicle.ownership.maintenanceMonthly +
    vehicle.ownership.fuelMonthly +
    Math.round(vehicle.ownership.depreciationAnnual / 12);
  const estimatedFields: EstimatedField[] = [
    { field: "insuranceMonthly", value: vehicle.ownership.insuranceMonthly, unit: "usd_per_month", method: "catalog_or_estimate" },
    { field: "fuelMonthly", value: vehicle.ownership.fuelMonthly, unit: "usd_per_month", method: "mpg_annual_mileage_fuel_price" },
    { field: "ownershipMonthly", value: estimatedMonthlyTotal, unit: "usd_per_month", method: "insurance_maintenance_fuel_depreciation" },
    { field: "overallMatchScore", value: vehicle.score, unit: "score", method: "deterministic_weighted_scoring" },
  ];
  if (vehicle.maintenanceEstimate === undefined) {
    estimatedFields.push({ field: "maintenanceMonthly", value: vehicle.ownership.maintenanceMonthly, unit: "usd_per_month", method: "age_mileage_condition_body_brand" });
  }
  if (vehicle.depreciationEstimate === undefined) {
    estimatedFields.push({ field: "depreciationAnnual", value: vehicle.ownership.depreciationAnnual, unit: "usd_per_year", method: "price_age_resale_score" });
  }
  return estimatedFields;
}

function getMissingInformation(vehicle: Vehicle): MissingInformation[] {
  const missing: MissingInformation[] = [];
  if (!vehicle.dataSources?.some((source) => source === "listing-api")) {
    missing.push({ field: "liveListing", expectedSource: "listing-api", impact: "high" });
  }
  if (!vehicle.dataSources?.some((source) => source === "fueleconomy.gov")) {
    missing.push({ field: "fuelEconomyOverlay", expectedSource: "fueleconomy.gov", impact: "medium" });
  }
  if (!vehicle.dataSources?.some((source) => source === "nhtsa")) {
    missing.push({ field: "bodyAndSafetyOverlay", expectedSource: "nhtsa", impact: "medium" });
  }
  if (vehicle.maintenanceEstimate === undefined) missing.push({ field: "maintenanceOverlay", expectedSource: "csv-import", impact: "medium" });
  return missing.slice(0, 5);
}

function getFieldProvenance(vehicle: ScoredVehicle): FieldProvenance[] {
  const sources = vehicle.dataSources || ["seed"];
  const hasListing = sources.includes("listing-api");
  const hasFuelEconomy = sources.includes("fueleconomy.gov");
  const hasNhtsa = sources.includes("nhtsa");
  const hasCsv = sources.includes("csv-import");
  const catalogSource = hasCsv ? "csv-import" : "seed-catalog";

  return [
    { field: "make", status: hasListing ? "verified" : "sourced", source: hasListing ? "listing-api" : catalogSource, method: "catalog_identity" },
    { field: "model", status: hasListing ? "verified" : "sourced", source: hasListing ? "listing-api" : catalogSource, method: "catalog_identity" },
    { field: "year", status: hasListing || hasNhtsa ? "verified" : "sourced", source: hasNhtsa ? "nhtsa" : hasListing ? "listing-api" : catalogSource, method: "model_year_lookup" },
    { field: "bodyType", status: hasNhtsa ? "verified" : "sourced", source: hasNhtsa ? "nhtsa" : catalogSource, method: "body_style_lookup" },
    { field: "drivetrain", status: hasListing ? "verified" : "sourced", source: hasListing ? "listing-api" : catalogSource, method: "catalog_drivetrain" },
    { field: "transmission", status: hasListing ? "verified" : "sourced", source: hasListing ? "listing-api" : catalogSource, method: "catalog_transmission" },
    { field: "price", status: hasListing ? "verified" : "sourced", source: hasListing ? "listing-api" : catalogSource, method: "listing_or_catalog_price" },
    { field: "mileage", status: hasListing ? "verified" : "sourced", source: hasListing ? "listing-api" : catalogSource, method: "listing_or_catalog_mileage" },
    { field: "mpg", status: hasFuelEconomy ? "verified" : "sourced", source: hasFuelEconomy ? "fueleconomy.gov" : catalogSource, method: "fuel_economy_lookup" },
    { field: "reliabilityScore", status: hasCsv ? "sourced" : "estimated", source: hasCsv ? "csv-import" : "engine", method: hasCsv ? "csv_overlay" : "catalog_score_fallback" },
    { field: "safetyScore", status: hasNhtsa ? "verified" : "sourced", source: hasNhtsa ? "nhtsa" : catalogSource, method: "safety_score_lookup" },
    { field: "insuranceMonthly", status: "estimated", source: "engine", method: "catalog_or_estimate" },
    {
      field: "maintenanceMonthly",
      status: vehicle.maintenanceEstimate === undefined ? "estimated" : "sourced",
      source: vehicle.maintenanceEstimate === undefined ? "engine" : "csv-import",
      method: vehicle.maintenanceEstimate === undefined ? "age_mileage_condition_body_brand" : "maintenance_overlay",
    },
    { field: "fuelMonthly", status: "derived", source: "engine", method: "mpg_annual_mileage_fuel_price" },
    {
      field: "depreciationMonthly",
      status: vehicle.depreciationEstimate === undefined ? "estimated" : "sourced",
      source: vehicle.depreciationEstimate === undefined ? "engine" : "csv-import",
      method: vehicle.depreciationEstimate === undefined ? "price_age_resale_score" : "depreciation_overlay",
    },
    { field: "ownershipMonthly", status: "derived", source: "engine", method: "insurance_maintenance_fuel_depreciation" },
    { field: "overallMatchScore", status: "derived", source: "engine", method: "deterministic_weighted_scoring" },
    {
      field: "listingUrl",
      status: vehicle.listingUrl ? (hasListing ? "verified" : "sourced") : "missing",
      source: vehicle.listingUrl ? (hasListing ? "listing-api" : catalogSource) : "engine",
      method: vehicle.listingUrl ? "provider_listing_link" : "not_available",
    },
    {
      field: "imageUrl",
      status: vehicle.imageUrl ? (vehicle.imageVerified ? "verified" : "sourced") : "missing",
      source: vehicle.imageSource ? "listing-api" : vehicle.imageUrl ? catalogSource : "engine",
      method: vehicle.imageUrl ? "vehicle_photo" : "not_available",
    },
  ];
}

function getRecommendationConfidence(
  vehicle: ScoredVehicle,
  softPreferenceScore: number,
  dataQualityConfidence: RecommendationConfidence,
): RecommendationConfidence {
  const penaltyTotal = vehicle.penalties.reduce((sum, penalty) => sum + penalty.points, 0);
  const score = Math.round(clamp(vehicle.score * 0.55 + softPreferenceScore * 0.25 + dataQualityConfidence.score * 0.2 - penaltyTotal * 0.25));
  return {
    score,
    level: score >= 78 ? "high" : score >= 58 ? "medium" : "low",
    factors: [
      { code: "overall_match_score", value: vehicle.score, impact: vehicle.score >= 70 ? "positive" : vehicle.score >= 55 ? "neutral" : "negative" },
      { code: "soft_preference_score", value: softPreferenceScore, impact: softPreferenceScore >= 70 ? "positive" : softPreferenceScore >= 55 ? "neutral" : "negative" },
      { code: "data_quality_confidence", value: dataQualityConfidence.score, impact: dataQualityConfidence.score >= 70 ? "positive" : "neutral" },
      { code: "penalty_total", value: penaltyTotal, impact: penaltyTotal ? "negative" : "positive" },
      { code: "qualified", value: vehicle.hardConstraintStatus.passed, impact: vehicle.hardConstraintStatus.passed ? "positive" : "negative" },
    ],
  };
}

function getDataQualityConfidence(vehicle: ScoredVehicle): RecommendationConfidence {
  return {
    score: vehicle.confidence.score,
    level: vehicle.confidence.level,
    factors: [
      { code: "data_completeness", value: vehicle.confidence.score, impact: vehicle.confidence.score >= 70 ? "positive" : "neutral" },
      { code: "assumption_count", value: vehicle.assumptions.length, impact: vehicle.assumptions.length ? "negative" : "positive" },
      { code: "missing_information_count", value: vehicle.missingDataWarnings.length, impact: vehicle.missingDataWarnings.length ? "negative" : "positive" },
      { code: "has_listing_api", value: Boolean(vehicle.dataSources?.includes("listing-api")), impact: vehicle.dataSources?.includes("listing-api") ? "positive" : "negative" },
    ],
  };
}

function getBetterAlternativesIfConstraintsChange(vehicle: ScoredVehicle, candidatePool: ScoredVehicle[]): BetterAlternative[] {
  return candidatePool
    .filter((candidate) => candidate.id !== vehicle.id && !candidate.hardConstraintStatus.passed && candidate.score > vehicle.score)
    .slice(0, 3)
    .map((candidate) => ({
      vehicleId: candidate.id,
      year: candidate.year,
      make: candidate.make,
      model: candidate.model,
      overallMatchScore: candidate.score,
      requiredConstraintChanges: getHardConstraintResults(candidate).filter((constraint) => !constraint.passed),
    }));
}

function getCategoryStats(drafts: ScoreDraft[]) {
  return Object.fromEntries(
    categoryKeys.map((key) => {
      const values = drafts.map((draft) => draft.rawScores[key]);
      return [
        key,
        {
          min: Math.min(...values, 100),
          max: Math.max(...values, 0),
        },
      ];
    }),
  ) as Record<CategoryKey, { min: number; max: number }>;
}

function normalizeCategoryScore(rawScore: number, stats: { min: number; max: number }) {
  const raw = clamp(rawScore);
  const spread = stats.max - stats.min;
  if (spread < 8) return raw;

  const stretched = 15 + ((raw - stats.min) / spread) * 82;
  return clamp(raw * 0.36 + stretched * 0.64);
}

function getRawCategoryScores(
  vehicle: Vehicle,
  profile: BuyerProfile,
  budget: BudgetSummary,
  maxPrice: number,
  ownership: OwnershipEstimates,
): Record<CategoryKey, number> {
  const priceFit = scoreLowerCost(vehicle.price, maxPrice, 0.58, 1.18);
  const paymentFit = getPaymentFit(ownership.estimatedPayment, budget.paymentBudget, profile);
  const affordability = priceFit * 0.55 + paymentFit * 0.45;
  const reliability = getReliabilityFit(vehicle, profile);
  const safety = getSafetyFit(vehicle, profile);
  const mpgFit = getFuelEconomyFit(vehicle, profile);
  const fuelCostFit = scoreLowerCost(ownership.fuelMonthly, Math.max(75, profile.monthlyBudget * 0.16), 0.55, 1.75);
  const fuelEnergyCost = mpgFit * 0.62 + fuelCostFit * 0.38;
  const insuranceCost = getInsuranceFit(vehicle, profile);
  const maintenanceCostFit = scoreLowerCost(ownership.maintenanceMonthly, Math.max(95, profile.monthlyBudget * 0.16), 0.7, 1.8);
  const maintenanceRisk = maintenanceCostFit * 0.58 + scaleRange(vehicle.condition, 2, 5) * 0.18 + reliability * 0.24;
  const practicality = getPracticalityFit(vehicle, profile);
  const resaleValue = getResaleFit(vehicle, profile);
  const drivingPreferenceFit = getDrivingPreferenceFit(vehicle, profile);

  return {
    affordability,
    reliability,
    safety,
    fuelEnergyCost,
    insuranceCost,
    maintenanceRisk,
    practicality,
    resaleValue,
    drivingPreferenceFit,
  };
}

function getHardConstraintStatus(
  vehicle: Vehicle,
  profile: BuyerProfile,
  budget: BudgetSummary,
  maxPrice: number,
  estimatedPayment: number,
): HardConstraintStatus {
  const results: HardConstraintResult[] = [];

  addConstraintResult(results, profile, {
    code: "totalBudget",
    label: "Total budget",
    passed: vehicle.price <= maxPrice,
    actual: vehicle.price,
    limit: Math.round(maxPrice),
    exclusionReason: `price ${formatCurrency(vehicle.price)} is above ${formatCurrency(maxPrice)}`,
  });

  if (profile.paymentMethod !== "cash" && budget.paymentBudget > 0) {
    addConstraintResult(results, profile, {
      code: "monthlyPayment",
      label: "Monthly payment",
      passed: estimatedPayment <= budget.paymentBudget,
      actual: Math.round(estimatedPayment),
      limit: Math.round(budget.paymentBudget),
      exclusionReason: `estimated payment ${formatCurrency(estimatedPayment)}/mo is above ${formatCurrency(budget.paymentBudget)}/mo payment room`,
    });
  }

  if (profile.requiredMake?.trim()) {
    const requiredMake = normalizeText(profile.requiredMake);
    addConstraintResult(results, profile, {
      code: "make",
      label: "Make requirement",
      passed: normalizeText(vehicle.make) === requiredMake,
      actual: vehicle.make,
      limit: profile.requiredMake.trim(),
      exclusionReason: `${vehicle.make} does not match required make ${profile.requiredMake.trim()}`,
    });
  }

  if (profile.bodyStyle !== "any") {
    addConstraintResult(results, profile, {
      code: "bodyStyle",
      label: "Body style",
      passed: vehicle.bodyType === profile.bodyStyle,
      actual: vehicle.bodyType,
      limit: profile.bodyStyle,
      exclusionReason: `${vehicle.bodyType} is not the required ${profile.bodyStyle} body style`,
    });
  }

  if (profile.maxMileage) {
    addConstraintResult(results, profile, {
      code: "maxMileage",
      label: "Maximum mileage",
      passed: vehicle.mileage <= profile.maxMileage,
      actual: vehicle.mileage,
      limit: profile.maxMileage,
      exclusionReason: `mileage ${vehicle.mileage.toLocaleString("en-US")} is above ${profile.maxMileage.toLocaleString("en-US")}`,
    });
  }

  if (profile.minYear) {
    addConstraintResult(results, profile, {
      code: "purchaseCondition",
      label: "Minimum model year",
      passed: vehicle.year >= profile.minYear,
      actual: vehicle.year,
      limit: profile.minYear,
      exclusionReason: `${vehicle.year} is older than the required ${profile.minYear} minimum model year`,
    });
  }

  if (profile.drivetrainPreference !== "any") {
    addConstraintResult(results, profile, {
      code: "drivetrain",
      label: "Drivetrain",
      passed: drivetrainMeetsRequirement(vehicle.drivetrain, profile.drivetrainPreference),
      actual: vehicle.drivetrain,
      limit: profile.drivetrainPreference,
      exclusionReason: `${vehicle.drivetrain} does not match required ${profile.drivetrainPreference}`,
    });
  }

  if (profile.purchaseCondition !== "any") {
    const currentYear = new Date().getFullYear();
    const passesCondition =
      (profile.purchaseCondition === "new" && vehicle.year >= currentYear - 1) ||
      (profile.purchaseCondition === "used" && vehicle.year < currentYear);
    addConstraintResult(results, profile, {
      code: "minYear",
      label: "Purchase condition",
      passed: passesCondition,
      actual: vehicle.year,
      limit: profile.purchaseCondition === "new" ? "new or nearly new" : "used",
      exclusionReason:
        profile.purchaseCondition === "new"
          ? `${vehicle.year} is not new or nearly new`
          : `${vehicle.year} is not a used-car match`,
    });
  }

  if (profile.transmissionPreference !== "any") {
    addConstraintResult(results, profile, {
      code: "transmission",
      label: "Transmission",
      passed: transmissionMeetsRequirement(vehicle.transmission, profile.transmissionPreference),
      actual: vehicle.transmission,
      limit: profile.transmissionPreference,
      exclusionReason: `${vehicle.transmission} does not match required ${profile.transmissionPreference} transmission`,
    });
  }

  if (profile.familySize > 1) {
    addConstraintResult(results, profile, {
      code: "seating",
      label: "Seating",
      passed: vehicle.seats >= profile.familySize,
      actual: vehicle.seats,
      limit: profile.familySize,
      exclusionReason: `${vehicle.seats} seats do not cover family size ${profile.familySize}`,
    });
  }

  if (profile.requiredFuelType) {
    addConstraintResult(results, profile, {
      code: "fuelType",
      label: "Fuel type",
      passed: normalizeText(vehicle.fuelType) === normalizeText(profile.requiredFuelType),
      actual: vehicle.fuelType,
      limit: profile.requiredFuelType,
      exclusionReason: `${vehicle.fuelType} does not match required ${profile.requiredFuelType}`,
    });
  }

  if (profile.reliabilityMinimum !== undefined) {
    addConstraintResult(results, profile, {
      code: "reliabilityMinimum",
      label: "Reliability minimum",
      passed: vehicle.reliabilityScore >= profile.reliabilityMinimum,
      actual: vehicle.reliabilityScore,
      limit: profile.reliabilityMinimum,
      exclusionReason: `reliability ${vehicle.reliabilityScore}/100 is below required minimum ${profile.reliabilityMinimum}/100`,
    });
  }

  if (profile.safetyMinimum !== undefined) {
    addConstraintResult(results, profile, {
      code: "safetyMinimum",
      label: "Safety minimum",
      passed: vehicle.safetyScore >= profile.safetyMinimum,
      actual: vehicle.safetyScore,
      limit: profile.safetyMinimum,
      exclusionReason: `safety ${vehicle.safetyScore}/100 is below required minimum ${profile.safetyMinimum}/100`,
    });
  }

  if (profile.performanceMinimum !== undefined) {
    addConstraintResult(results, profile, {
      code: "performanceMinimum",
      label: "Performance minimum",
      passed: vehicle.performanceScore >= profile.performanceMinimum,
      actual: vehicle.performanceScore,
      limit: profile.performanceMinimum,
      exclusionReason: `performance ${vehicle.performanceScore}/100 is below required minimum ${profile.performanceMinimum}/100`,
    });
  }

  const checked = results.map((result) => result.label);
  const failures = results.filter((result) => !result.passed);
  const hardFailures = failures.filter((result) => !result.flexible);
  const status: QualificationStatus = hardFailures.length ? "excluded" : failures.length ? "compromise" : "qualified";

  return {
    status,
    passed: status === "qualified",
    checked,
    results,
    failures,
  };
}

function addConstraintResult(
  results: HardConstraintResult[],
  profile: BuyerProfile,
  result: Omit<HardConstraintResult, "flexible">,
) {
  const flexible = Boolean(profile.flexibleConstraints?.includes(result.code));
  results.push({
    ...result,
    flexible,
    exclusionReason: result.passed ? undefined : result.exclusionReason,
  });
}

function drivetrainMeetsRequirement(drivetrain: string, requirement: BuyerProfile["drivetrainPreference"]) {
  if (drivetrain === requirement) return true;
  if (requirement === "AWD" && drivetrain === "4WD") return true;
  if (requirement === "4WD" && drivetrain === "AWD") return true;
  return false;
}

function transmissionMeetsRequirement(transmission: string, requirement: BuyerProfile["transmissionPreference"]) {
  if (requirement === "automatic") return transmission !== "manual";
  return transmission === "manual";
}

function getEffectiveMaxPrice(profile: BuyerProfile, estimatedBudget: number) {
  const statedBudget = profile.maxPurchaseBudget || 0;
  if (profile.paymentMethod === "cash" && statedBudget) return statedBudget;
  if (statedBudget && estimatedBudget) return Math.min(Math.max(statedBudget, estimatedBudget * 0.75), estimatedBudget * 1.2);
  return statedBudget || estimatedBudget || 18000;
}

function getPaymentFit(estimatedPayment: number, paymentBudget: number, profile: BuyerProfile) {
  if (profile.paymentMethod === "cash") return 78;
  const target = paymentBudget || Math.max(120, profile.monthlyBudget * 0.42);
  return scoreLowerCost(estimatedPayment, target, 0.58, 1.18);
}

function getInsuranceFit(vehicle: Vehicle, profile: BuyerProfile) {
  const target = profile.insuranceBudget || Math.max(120, profile.monthlyBudget * 0.22);
  return scoreLowerCost(vehicle.insurance, target, 0.64, 1.55);
}

function getFuelEconomyFit(vehicle: Vehicle, profile: BuyerProfile) {
  const target = profile.minMpg || (profile.expectedAnnualMileage >= 12000 ? 32 : 26);
  const maxRatio = vehicle.fuelType === "electric" ? 4.1 : vehicle.fuelType === "hybrid" ? 2.1 : 1.65;
  const base = scoreHigherAgainstTarget(vehicle.mpg, target, 0.68, maxRatio);
  return applyImportance(base, profile.fuelEconomyImportance);
}

function getReliabilityFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.reliabilityScore, 60, 96);
  const mileagePenalty = vehicle.mileage > 140000 ? 18 : vehicle.mileage > 110000 ? 10 : vehicle.mileage > 85000 ? 5 : 0;
  return applyImportance(base - mileagePenalty, profile.reliabilityImportance);
}

function getSafetyFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.safetyScore, 70, 96);
  const importance = profile.safetyPriority === "maximum" ? 5 : profile.safetyPriority === "high" ? 4 : 3;
  return applyImportance(base, importance);
}

function getPracticalityFit(vehicle: Vehicle, profile: BuyerProfile) {
  const bodyFit = getBodyStyleFit(vehicle, profile);
  const cargoFit = getCargoFit(vehicle, profile);
  const familyFit = getFamilyFit(vehicle, profile);
  const climateFit = getClimateFit(vehicle, profile);
  const mileageFit = getMileageFit(vehicle, profile);
  const yearFit = getYearFit(vehicle, profile);
  const featureFit = getFeatureFit(vehicle, profile);

  return (
    bodyFit * 0.24 +
    cargoFit * 0.2 +
    familyFit * 0.18 +
    mileageFit * 0.12 +
    climateFit * 0.1 +
    yearFit * 0.08 +
    featureFit * 0.08
  );
}

function getDrivingPreferenceFit(vehicle: Vehicle, profile: BuyerProfile) {
  const performanceFit = getPerformanceFit(vehicle, profile);
  const transmissionFit = getTransmissionFit(vehicle, profile);
  const drivetrainFit = getDrivetrainFit(vehicle, profile);
  const modificationFit = getModificationFit(vehicle, profile);
  const featureFit = getFeatureFit(vehicle, profile);

  return performanceFit * 0.42 + transmissionFit * 0.18 + drivetrainFit * 0.18 + modificationFit * 0.12 + featureFit * 0.1;
}

function getBodyStyleFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.bodyStyle === "any") return beginnerFriendlyTypes.has(vehicle.bodyType) ? 76 : 58;
  if (vehicle.bodyType === profile.bodyStyle) return 100;
  if (profile.bodyStyle === "suv" && spaciousTypes.has(vehicle.bodyType)) return 56;
  return 18;
}

function getDrivetrainFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.drivetrainPreference === "any") {
    if (profile.climate === "snow") return snowDrivetrains.has(vehicle.drivetrain) ? 96 : 28;
    return snowDrivetrains.has(vehicle.drivetrain) ? 78 : 72;
  }
  if (vehicle.drivetrain === profile.drivetrainPreference) return 100;
  if (profile.drivetrainPreference === "4WD" && vehicle.drivetrain === "AWD") return 80;
  if (profile.drivetrainPreference === "AWD" && vehicle.drivetrain === "4WD") return 78;
  return 12;
}

function getTransmissionFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.transmissionPreference === "any") return vehicle.transmission === "manual" ? 70 : 78;
  if (profile.transmissionPreference === "automatic") return vehicle.transmission === "manual" ? 10 : 100;
  return vehicle.transmission === "manual" ? 100 : 10;
}

function getCargoFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.cargoNeed === "not-sure") return scaleRange(vehicle.cargoScore, 30, 90);
  const target = profile.cargoNeed === "high" ? 86 : profile.cargoNeed === "medium" ? 66 : 38;
  return scoreHigherAgainstTarget(vehicle.cargoScore, target, 0.62, 1.12);
}

function getClimateFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.climate === "not-sure" || profile.climate === "mild") return 74;
  if (profile.climate === "snow") return snowDrivetrains.has(vehicle.drivetrain) ? 100 : 18;
  if (profile.climate === "rain") return vehicle.safetyScore >= 88 || snowDrivetrains.has(vehicle.drivetrain) ? 92 : 58;
  return 74;
}

function getModificationFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.modificationPlans !== "yes") return 72;
  if (vehicle.bodyType === "truck" || vehicle.model.includes("Civic") || vehicle.model.includes("3")) return 94;
  if (vehicle.bodyType === "coupe" || vehicle.bodyType === "hatchback") return 86;
  return 44;
}

function getMileageFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.maxMileage) return scoreLowerCost(vehicle.mileage, profile.maxMileage, 0.42, 1.15);

  const expectedMileage = Math.max(12000, (new Date().getFullYear() - vehicle.year) * 12000);
  return scoreLowerCost(vehicle.mileage, expectedMileage, 0.52, 1.6);
}

function getYearFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (!profile.minYear) return scaleRange(vehicle.year, 2008, new Date().getFullYear());
  if (vehicle.year < profile.minYear) return Math.max(8, 52 - (profile.minYear - vehicle.year) * 10);
  return clamp(70 + (vehicle.year - profile.minYear) * 4);
}

function getPerformanceFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.performanceScore, 38, 92);
  return applyImportance(base, profile.performanceImportance);
}

function getResaleFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.resaleScore, 54, 92);
  return applyImportance(base, profile.resaleValueImportance);
}

function getFeatureFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.featureScore, 42, 92);
  return applyImportance(base, profile.advancedFeaturesImportance);
}

function getFamilyFit(vehicle: Vehicle, profile: BuyerProfile) {
  const seatsNeeded = Math.max(profile.familySize || 1, 1);
  if (seatsNeeded <= 1) return scaleRange(vehicle.seats, 2, 7);
  if (vehicle.seats < seatsNeeded) return 12;
  return clamp(76 + Math.min(vehicle.seats - seatsNeeded, 3) * 7);
}

function getOwnershipEstimates(vehicle: Vehicle, profile: BuyerProfile) {
  const maintenanceMonthly = vehicle.maintenanceEstimate ?? estimateMaintenanceMonthly(vehicle);
  const fuelMonthly = Math.round(estimateFuelCost(vehicle, profile));
  const depreciationAnnual = vehicle.depreciationEstimate ?? estimateDepreciationAnnual(vehicle);
  const estimatedPayment = Math.round(estimateMonthlyPayment(vehicle, profile));
  const ownershipMonthly = vehicle.insurance + maintenanceMonthly + fuelMonthly + Math.round(depreciationAnnual / 12);

  return {
    maintenanceMonthly,
    fuelMonthly,
    depreciationAnnual,
    estimatedPayment,
    ownershipMonthly,
  };
}

function estimateMonthlyPayment(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.paymentMethod === "cash") return 0;
  const amountFinanced = Math.max(0, vehicle.price * 1.08 - profile.downPayment);
  const monthlyRate = profile.apr / 100 / 12;
  if (!monthlyRate) return amountFinanced / Math.max(profile.loanTermMonths, 1);
  return (amountFinanced * monthlyRate) / (1 - (1 + monthlyRate) ** -Math.max(profile.loanTermMonths, 1));
}

function estimateFuelCost(vehicle: Vehicle, profile: BuyerProfile) {
  if (!vehicle.mpg) return 0;
  return (profile.expectedAnnualMileage / 12 / vehicle.mpg) * profile.fuelPrice;
}

function estimateMaintenanceMonthly(vehicle: Vehicle) {
  const age = Math.max(1, new Date().getFullYear() - vehicle.year);
  const mileageFactor = vehicle.mileage > 90000 ? 55 : vehicle.mileage > 70000 ? 35 : 20;
  const conditionFactor = Math.max(0, 5 - vehicle.condition) * 18;
  const bodyFactor = vehicle.bodyType === "truck" || vehicle.bodyType === "suv" ? 25 : 0;
  const brandFactor = /toyota|honda/i.test(vehicle.make) ? -15 : /subaru|mazda|hyundai/i.test(vehicle.make) ? 0 : 20;

  return Math.max(75, Math.round(55 + age * 5 + mileageFactor + conditionFactor + bodyFactor + brandFactor));
}

function estimateDepreciationAnnual(vehicle: Vehicle) {
  const age = Math.max(1, new Date().getFullYear() - vehicle.year);
  const ageRate = age <= 3 ? 0.12 : age <= 7 ? 0.08 : 0.045;
  const resaleAdjustment = (100 - vehicle.resaleScore) / 1000;
  return Math.round(vehicle.price * (ageRate + resaleAdjustment));
}

function getSoftPenalties(vehicle: Vehicle, profile: BuyerProfile, ownership: OwnershipEstimates): ScorePenalty[] {
  const penalties: ScorePenalty[] = [];

  if (profile.insuranceBudget && vehicle.insurance > profile.insuranceBudget) {
    const ratio = vehicle.insurance / profile.insuranceBudget;
    penalties.push({
      label: "Insurance over budget",
      points: Math.round(clamp((ratio - 1) * 18, 3, 12)),
      reason: `${formatCurrency(vehicle.insurance)}/mo is above the ${formatCurrency(profile.insuranceBudget)}/mo insurance target.`,
    });
  }

  if (profile.minMpg && vehicle.mpg < profile.minMpg) {
    penalties.push({
      label: "Fuel economy shortfall",
      points: Math.round(clamp((1 - vehicle.mpg / profile.minMpg) * 34, 4, 18)),
      reason: `${vehicle.mpg} MPG is below the ${profile.minMpg} MPG target.`,
    });
  }

  if (profile.climate === "snow" && profile.drivetrainPreference === "any" && !snowDrivetrains.has(vehicle.drivetrain)) {
    penalties.push({
      label: "Snow traction concern",
      points: 10,
      reason: `${vehicle.drivetrain} is weaker for snow than AWD or 4WD.`,
    });
  }

  if (profile.familySize > 1 && vehicle.seats < profile.familySize) {
    penalties.push({
      label: "Seating concern",
      points: 12,
      reason: `${vehicle.seats} seats do not cover a family size of ${profile.familySize}.`,
    });
  }

  if (profile.safetyPriority === "maximum" && vehicle.safetyScore < 90) {
    penalties.push({
      label: "Safety priority concern",
      points: 10,
      reason: `${vehicle.safetyScore}/100 safety is below a maximum-safety target.`,
    });
  } else if (profile.safetyPriority === "high" && vehicle.safetyScore < 84) {
    penalties.push({
      label: "Safety priority concern",
      points: 7,
      reason: `${vehicle.safetyScore}/100 safety is below a high-safety target.`,
    });
  }

  if (profile.reliabilityImportance >= 5 && vehicle.reliabilityScore < 82) {
    penalties.push({
      label: "Reliability concern",
      points: 8,
      reason: `${vehicle.reliabilityScore}/100 reliability is weak for a maximum reliability preference.`,
    });
  }

  if (profile.expectedAnnualMileage >= 15000 && vehicle.reliabilityScore < 75) {
    penalties.push({
      label: "High-mileage reliability concern",
      points: 6,
      reason: `${vehicle.reliabilityScore}/100 reliability is risky for ${profile.expectedAnnualMileage.toLocaleString("en-US")} expected annual miles.`,
    });
  }

  if (profile.expectedAnnualMileage >= 15000 && vehicle.mileage > 60000) {
    penalties.push({
      label: "High-mileage wear concern",
      points: vehicle.mileage > 90000 ? 5 : 2,
      reason: `${vehicle.mileage.toLocaleString("en-US")} existing miles leaves less durability room for ${profile.expectedAnnualMileage.toLocaleString("en-US")} expected annual miles.`,
    });
  }

  if (ownership.ownershipMonthly > Math.max(220, profile.monthlyBudget * 0.62)) {
    penalties.push({
      label: "Ownership cost concern",
      points: 7,
      reason: `${formatCurrency(ownership.ownershipMonthly)}/mo estimated ownership cost is high relative to the ${formatCurrency(profile.monthlyBudget)}/mo budget.`,
    });
  }

  return penalties.slice(0, 5);
}

function getAssumptions(vehicle: Vehicle) {
  const assumptions: string[] = [];
  if (vehicle.maintenanceEstimate === undefined) assumptions.push("Maintenance is estimated from age, mileage, condition, body type, and brand.");
  if (vehicle.depreciationEstimate === undefined) assumptions.push("Depreciation is estimated from price, age, and resale score.");
  if (!vehicle.listingUrl) assumptions.push("No live listing URL is attached to this vehicle.");
  if (!vehicle.imageVerified) assumptions.push("No verified vehicle photo is attached.");
  if (!vehicle.dataSources?.length || vehicle.dataSources.every((source) => source === "seed")) {
    assumptions.push("Recommendation uses the processed catalog without live provider overlays.");
  }
  return assumptions.slice(0, 5);
}

function getMissingDataWarnings(vehicle: Vehicle) {
  const warnings: string[] = [];
  if (!vehicle.dataSources?.some((source) => source === "listing-api")) warnings.push("Missing live listing confirmation for current market price and mileage.");
  if (!vehicle.dataSources?.some((source) => source === "fueleconomy.gov")) warnings.push("Fuel economy may come from catalog data rather than a live FuelEconomy.gov match.");
  if (!vehicle.dataSources?.some((source) => source === "nhtsa")) warnings.push("Body-style verification may come from catalog data rather than a live NHTSA match.");
  return warnings.slice(0, 4);
}

function getConfidence(vehicle: Vehicle, assumptions: string[], missingDataWarnings: string[]): Confidence {
  const requiredValues = [
    vehicle.make,
    vehicle.model,
    vehicle.year,
    vehicle.bodyType,
    vehicle.drivetrain,
    vehicle.transmission,
    vehicle.price,
    vehicle.mileage,
    vehicle.mpg,
    vehicle.insurance,
    vehicle.reliabilityScore,
    vehicle.safetyScore,
  ];
  const completeness = requiredValues.filter((value) => value !== undefined && value !== null && value !== "").length / requiredValues.length;
  const sources = vehicle.dataSources || ["seed"];
  const sourceQuality = getSourceQuality(sources);
  const score = Math.round(clamp(28 + completeness * 34 + sourceQuality * 28 - assumptions.length * 3.5 - missingDataWarnings.length * 4));
  const reasons = [
    `${Math.round(completeness * 100)}% of required scoring fields are present.`,
    `Source quality is based on ${sources.join(", ")}.`,
  ];
  if (assumptions.length) reasons.push(`${assumptions.length} estimate assumption${assumptions.length === 1 ? "" : "s"} used.`);
  if (missingDataWarnings.length) reasons.push(`${missingDataWarnings.length} missing-data warning${missingDataWarnings.length === 1 ? "" : "s"} present.`);

  return {
    score,
    level: score >= 78 ? "high" : score >= 58 ? "medium" : "low",
    reasons,
  };
}

function getSourceQuality(sources: string[]) {
  let quality = 0.56;
  if (sources.includes("seed")) quality = Math.max(quality, 0.62);
  if (sources.includes("nhtsa")) quality = Math.max(quality, 0.78);
  if (sources.includes("fueleconomy.gov")) quality = Math.max(quality, 0.82);
  if (sources.includes("csv-import")) quality = Math.max(quality, 0.72);
  if (sources.includes("listing-api")) quality = Math.max(quality, 0.9);
  return Math.min(1, quality + Math.max(0, sources.length - 1) * 0.04);
}

function getSimilarAlternatives(vehicle: Vehicle & { score: number }, vehicles: Array<Vehicle & { score: number }>) {
  const seenNames = new Set<string>();
  return vehicles
    .filter((candidate) => candidate.id !== vehicle.id)
    .map((candidate) => ({
      name: `${candidate.make} ${candidate.model}`,
      similarity:
        (candidate.bodyType === vehicle.bodyType ? 5 : spaciousTypes.has(candidate.bodyType) && spaciousTypes.has(vehicle.bodyType) ? 2 : 0) +
        (candidate.drivetrain === vehicle.drivetrain ? 2 : 0) +
        (candidate.fuelType === vehicle.fuelType ? 1 : 0) +
        (Math.abs(candidate.price - vehicle.price) <= 3000 ? 2 : 0) +
        (Math.abs(candidate.score - vehicle.score) <= 5 ? 1 : 0),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))
    .filter((candidate) => {
      if (seenNames.has(candidate.name)) return false;
      seenNames.add(candidate.name);
      return true;
    })
    .slice(0, 3)
    .map((candidate) => candidate.name);
}

function getBuyingTips(vehicle: Vehicle, profile: BuyerProfile) {
  const tips = [
    "Compare at least three listings before negotiating.",
    "Ask for maintenance records and a pre-purchase inspection.",
  ];

  if (vehicle.transmission === "CVT") tips.push("Confirm CVT fluid service history and test for smooth acceleration.");
  if (vehicle.drivetrain === "AWD") tips.push("Check that all four tires match in brand, size, and tread depth.");
  if (vehicle.fuelType === "hybrid") tips.push("Ask for hybrid battery health information before buying.");
  if (vehicle.bodyType === "truck") tips.push("Inspect the frame, suspension, bed, and signs of towing or work use.");
  if (vehicle.bodyType === "coupe" || vehicle.bodyType === "convertible") tips.push("Confirm insurance cost and visibility comfort before buying.");
  if (vehicle.bodyType === "minivan") tips.push("Check sliding doors, rear HVAC, and third-row folding hardware.");
  if (profile.paymentMethod === "financing") tips.push("Get loan preapproval before visiting sellers.");
  if (profile.paymentMethod === "cash") tips.push("Keep taxes, registration, inspection, and first maintenance outside the purchase offer.");
  if (profile.climate === "snow") tips.push("Budget for quality tires; AWD does not replace winter traction.");

  return tips.slice(0, 4);
}

function getLegacyReasonsFromRecommendation(recommendation: RecommendationObject) {
  return recommendation.reasonsForRecommendation.slice(0, 4).map((signal) => {
    const label = scoreWeightLabels[signal.category];
    const contribution = signal.contribution !== undefined ? ` and contributes ${signal.contribution} points` : "";
    return `${label} score is ${signal.score ?? signal.vehicleValue}/100${contribution}.`;
  });
}

function getLegacyMissesFromRecommendation(recommendation: RecommendationObject) {
  const tradeoffs = recommendation.tradeoffs.slice(0, 3).map((tradeoff) => {
    if (tradeoff.code === "make_preference_relaxed") {
      return `Make preference relaxed from ${tradeoff.userPreference} to ${tradeoff.vehicleValue}.`;
    }
    return `${tradeoff.field} tradeoff: ${tradeoff.vehicleValue}${tradeoff.userPreference !== undefined ? ` vs ${tradeoff.userPreference}` : ""}.`;
  });
  const missing = recommendation.missingInformation.slice(0, 2).map((item) => `Missing ${item.field} from ${item.expectedSource}.`);
  return [...tradeoffs, ...missing];
}

function scoreLowerCost(actual: number, target: number, idealRatio: number, maxRatio: number) {
  if (!Number.isFinite(actual) || actual < 0) return 0;
  if (!target || target <= 0) return 58;

  const ratio = actual / target;
  if (ratio <= idealRatio) return clamp(96 - ratio * 7);
  if (ratio <= 1) return interpolate(ratio, idealRatio, 1, 92, 68);
  if (ratio <= maxRatio) return interpolate(ratio, 1, maxRatio, 68, 12);
  return Math.max(0, 12 - (ratio - maxRatio) * 32);
}

function scoreHigherAgainstTarget(actual: number, target: number, weakRatio: number, excellentRatio: number) {
  if (!Number.isFinite(actual) || actual <= 0) return 0;
  if (!target || target <= 0) return 58;

  const ratio = actual / target;
  if (ratio <= weakRatio) return interpolate(ratio, 0, weakRatio, 8, 42);
  if (ratio <= 1) return interpolate(ratio, weakRatio, 1, 42, 74);
  if (ratio <= excellentRatio) return interpolate(ratio, 1, excellentRatio, 74, 96);
  return 96;
}

function scaleRange(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(((value - low) / Math.max(high - low, 1)) * 100);
}

function applyImportance(score: number, importance: number) {
  const clamped = clamp(score);
  if (!importance || importance <= 2) return clamp(62 + clamped * 0.28);
  if (importance === 3) return clamped;
  const exponent = importance >= 5 ? 1.38 : 1.18;
  return clamp(Math.pow(clamped / 100, exponent) * 100);
}

function interpolate(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number) {
  if (inputMax === inputMin) return outputMax;
  const progress = (value - inputMin) / (inputMax - inputMin);
  return outputMin + (outputMax - outputMin) * progress;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function toCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value || 0));
}
