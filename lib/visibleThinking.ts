import { scoreWeightLabels } from "./recommendations";
import type { BuyerProfile, ScoreWeights } from "@/types/buyer";
import type {
  CandidatePipelineRunnerUpLoss,
  DecisionReport,
  HumanDecisionStory,
  HumanDecisionStoryExpandedStep,
  RecommendationDecisionSet,
  RecommendationObject,
  RecommendationSignal,
  VisibleThinkingDecisionStep,
  VisibleThinkingHardestComparison,
  VisibleThinkingSummary,
  VisibleThinkingVehicleRef,
} from "@/types/vehicle";

export const CLOSE_DECISION_SCORE_GAP = 3;

type BuildVisibleThinkingSummaryInput = {
  decisionReport: DecisionReport;
  decisionSet: RecommendationDecisionSet;
  profile: BuyerProfile;
  recommendation?: RecommendationObject;
};

export function buildVisibleThinkingSummary({
  decisionReport,
  decisionSet,
  profile,
  recommendation,
}: BuildVisibleThinkingSummaryInput): VisibleThinkingSummary {
  const debug = decisionSet.pipelineDebug;
  const winner = recommendation || decisionSet.primaryRecommendations[0] || decisionSet.compromiseRecommendations[0];
  const runnerUp = getRunnerUpRecommendation(decisionSet, decisionReport);
  const comparison = winner && runnerUp ? buildHardestComparison(winner, runnerUp, decisionSet.pipelineDebug.runnerUpLossReasons) : undefined;
  const finalistVehicleIds = [winner?.vehicleId, comparison?.runnerUpVehicle.vehicleId].filter(Boolean) as string[];
  const steps = buildDecisionSteps({ comparison, decisionSet, profile, runnerUp, winner });
  const conclusion = buildConclusion({ comparison, decisionSet, winner });
  const uncertaintyDisclosure = winner ? buildUncertaintyDisclosure(winner) : undefined;
  const shortSummary = buildShortSummary({ comparison, conclusion, decisionSet, uncertaintyDisclosure, winner });

  return {
    catalogCount: debug.catalogCount,
    candidateCount: debug.candidateCount,
    excludedCount: debug.excludedCount,
    qualifiedCount: debug.qualifiedCount,
    compromiseCount: debug.compromiseCount,
    finalistVehicleIds,
    shortSummary,
    hardestComparison: comparison,
    decisionSteps: steps.slice(0, 4),
    conclusion,
    uncertaintyDisclosure,
  };
}

export function buildHumanDecisionStory(summary: VisibleThinkingSummary): HumanDecisionStory {
  const uncertaintyNote = summary.uncertaintyDisclosure
    ? "I would still verify the live listing before treating this as a purchase target."
    : undefined;

  if (summary.conclusion.status === "no-match") {
    const blockers = extractBlockerNames(summary);
    const opening = "I looked through the usable catalog, but none of the vehicles met all of the requirements you confirmed.";
    const narrowingSummary = blockers ? `The main blockers were ${blockers}.` : "The current requirements removed every realistic option.";
    const conclusion = "I would adjust one requirement before comparing cars.";
    return {
      opening,
      narrowingSummary,
      conclusion,
      uncertaintyNote,
      defaultParagraphs: [opening, narrowingSummary, conclusion],
      expandedSteps: buildHumanExpandedSteps(summary),
    };
  }

  if (summary.conclusion.status === "compromise") {
    const opening = "I could not find a perfect fit, so I am showing the strongest compromise instead.";
    const narrowingSummary = `${summary.excludedCount} vehicles did not fit the requirements you gave me.`;
    const conclusion = "I would treat this as a backup option until you decide which requirement can bend.";
    return {
      opening,
      narrowingSummary,
      conclusion,
      uncertaintyNote,
      defaultParagraphs: [opening, narrowingSummary, conclusion, uncertaintyNote].filter(Boolean) as string[],
      expandedSteps: buildHumanExpandedSteps(summary),
    };
  }

  if (summary.conclusion.status === "single-qualified" || !summary.hardestComparison) {
    const opening = `Before I recommended anything, I ruled out ${summary.excludedCount} vehicles that did not fit the requirements you gave me.`;
    const narrowingSummary = "Only one vehicle met every requirement you confirmed, so there was not a close final comparison.";
    const conclusion = rewriteSingleVehicleConclusion(summary.conclusion.text);
    return {
      opening,
      narrowingSummary,
      conclusion,
      uncertaintyNote,
      defaultParagraphs: [opening, narrowingSummary, conclusion, uncertaintyNote].filter(Boolean) as string[],
      expandedSteps: buildHumanExpandedSteps(summary),
    };
  }

  const comparison = summary.hardestComparison;
  const winner = formatVehicleRef(comparison.winningVehicle);
  const runnerUp = formatVehicleRef(comparison.runnerUpVehicle);
  const winnerShort = comparison.winningVehicle.model;
  const opening = `Before I recommended anything, I ruled out ${summary.excludedCount} vehicles that did not fit the requirements you gave me.`;
  const narrowingSummary = `That left ${summary.qualifiedCount} realistic options worth comparing.`;
  const finalists = `${comparison.isCloseDecision ? "The final choice was close and came" : "The final choice came"} down to the ${winner} and the ${runnerUp}.`;
  const runnerUpAdvantage = getPlainRunnerUpAdvantage(comparison);
  const decidingPriority = getPlainDecidingPriority(comparison);
  const finalistContrast = `${formatVehicleRef(comparison.runnerUpVehicle)} looked better for ${runnerUpAdvantage}, but the ${winner} better matched ${decidingPriority}.`;
  const decidingFactor = `The deciding difference was ${decidingPriority}.`;
  const conclusion = `That is why I’d recommend the ${winnerShort}.`;

  return {
    opening,
    narrowingSummary,
    finalists,
    finalistContrast,
    decidingFactor,
    conclusion,
    uncertaintyNote,
    defaultParagraphs: [opening, narrowingSummary, finalists, finalistContrast, conclusion, uncertaintyNote].filter(Boolean) as string[],
    expandedSteps: buildHumanExpandedSteps(summary),
  };
}

function buildDecisionSteps({
  comparison,
  decisionSet,
  profile,
  runnerUp,
  winner,
}: {
  comparison?: VisibleThinkingHardestComparison;
  decisionSet: RecommendationDecisionSet;
  profile: BuyerProfile;
  runnerUp?: RecommendationObject;
  winner?: RecommendationObject;
}): VisibleThinkingDecisionStep[] {
  const debug = decisionSet.pipelineDebug;
  const steps: VisibleThinkingDecisionStep[] = [
    {
      code: "catalog_scope",
      text: `I started with ${debug.catalogCount} catalog vehicles, and ${debug.candidateCount} had usable data for comparison.`,
      evidenceCodes: ["pipelineDebug.catalogCount", "pipelineDebug.candidateCount"],
    },
    {
      code: "hard_constraint_filter",
      text: `${debug.excludedCount} failed one or more required conditions, leaving ${debug.qualifiedCount} qualified vehicle${plural(debug.qualifiedCount)}${
        debug.compromiseCount ? ` and ${debug.compromiseCount} compromise option${plural(debug.compromiseCount)}` : ""
      }.`,
      evidenceCodes: ["pipelineDebug.excludedCount", "pipelineDebug.qualifiedCount", "pipelineDebug.compromiseCount"],
    },
  ];

  if (!winner) {
    const blockers = formatBlockers(decisionSet);
    steps.push({
      code: "no_match_blockers",
      text: blockers
        ? `The largest blockers were ${blockers}.`
        : `No vehicle passed every confirmed requirement in the current catalog.`,
      evidenceCodes: ["decisionSet.noMatch.topConstraintBlockers"],
    });
    return steps;
  }

  if (winner.qualificationStatus === "compromise") {
    steps.push({
      code: "compromise_disclosure",
      text: `The leading option is a compromise because ${formatFailedConstraint(winner) || "at least one flexible requirement would need to change"}.`,
      evidenceCodes: ["recommendation.qualificationStatus", "recommendation.hardConstraintResults"],
    });
  } else if (!runnerUp) {
    steps.push({
      code: "single_qualified",
      text: `Only ${formatVehicleName(winner)} remained qualified, so I did not create a finalist comparison.`,
      evidenceCodes: ["decisionSet.primaryRecommendations", "decisionReport.runnerUp"],
    });
  } else if (comparison) {
    steps.push({
      code: "finalist_comparison",
      text: `${comparison.isCloseDecision ? "The closest decision" : "The final comparison"} was between ${formatVehicleRef(
        comparison.winningVehicle,
      )} and ${formatVehicleRef(comparison.runnerUpVehicle)}.`,
      evidenceCodes: ["decisionReport.bestOverall", "decisionReport.runnerUp", "pipelineDebug.runnerUpLossReasons"],
    });
    steps.push({
      code: "deciding_factor",
      text: `What decided it was ${formatDecidingFactor(comparison, profile)}. ${comparison.exactStructuredReasonItLost}`,
      evidenceCodes: comparison.evidenceCodes,
    });
  }

  return steps;
}

function buildHardestComparison(
  winner: RecommendationObject,
  runnerUp: RecommendationObject,
  runnerUpLossReasons: CandidatePipelineRunnerUpLoss[],
): VisibleThinkingHardestComparison {
  const loss =
    runnerUpLossReasons.find((item) => item.vehicleId === runnerUp.vehicleId) ||
    runnerUpLossReasons.find((item) => item.rank === 2);
  const scoreGap = Math.max(0, Math.round(winner.overallMatchScore - runnerUp.overallMatchScore));
  const runnerUpAdvantage = getRunnerUpAdvantage(winner, runnerUp);

  return {
    winningVehicle: toVehicleRef(winner),
    runnerUpVehicle: toVehicleRef(runnerUp),
    runnerUpStrongestMeaningfulAdvantage: runnerUpAdvantage,
    exactStructuredReasonItLost:
      loss?.primaryReason || `${formatVehicleName(runnerUp)} had a lower overall match score than ${formatVehicleName(winner)}.`,
    decidingUserPriorityOrCategory: loss?.category || getTopContributingCategory(winner) || "overallMatchScore",
    scoreGap: loss?.scoreGap ?? scoreGap,
    isCloseDecision: (loss?.scoreGap ?? scoreGap) <= CLOSE_DECISION_SCORE_GAP,
    evidenceCodes: [
      "pipelineDebug.runnerUpLossReasons.primaryReason",
      loss?.category ? `category.${loss.category}` : "decisionReport.whyRunnerUpLost",
      "recommendation.reasonsForRecommendation",
    ],
  };
}

function buildConclusion({
  comparison,
  decisionSet,
  winner,
}: {
  comparison?: VisibleThinkingHardestComparison;
  decisionSet: RecommendationDecisionSet;
  winner?: RecommendationObject;
}) {
  if (!winner) {
    const blockers = formatBlockers(decisionSet);
    return {
      status: "no-match" as const,
      text: blockers
        ? `I do not have a responsible match yet because the largest blockers were ${blockers}.`
        : "I do not have a responsible match yet because no vehicle passed every confirmed requirement.",
      evidenceCodes: ["decisionSet.noMatch", "decisionSet.noMatch.topConstraintBlockers"],
    };
  }

  if (winner.qualificationStatus === "compromise") {
    return {
      status: "compromise" as const,
      text: `${formatVehicleName(winner)} is only a compromise option, not a fully qualified recommendation.`,
      evidenceCodes: ["recommendation.qualificationStatus", "recommendation.hardConstraintResults"],
    };
  }

  if (!comparison) {
    return {
      status: "single-qualified" as const,
      text: `${formatVehicleName(winner)} is the recommendation because it was the only vehicle that stayed qualified under the current requirements.`,
      evidenceCodes: ["decisionSet.primaryRecommendations", "decisionReport.runnerUp"],
    };
  }

  return {
    status: "recommendation" as const,
    text: `${formatVehicleName(winner)} stayed ahead after the finalist comparison.`,
    evidenceCodes: ["decisionReport.bestOverall", "pipelineDebug.runnerUpLossReasons"],
  };
}

function buildShortSummary({
  comparison,
  conclusion,
  decisionSet,
  uncertaintyDisclosure,
  winner,
}: {
  comparison?: VisibleThinkingHardestComparison;
  conclusion: ReturnType<typeof buildConclusion>;
  decisionSet: RecommendationDecisionSet;
  uncertaintyDisclosure?: VisibleThinkingDecisionStep;
  winner?: RecommendationObject;
}) {
  const debug = decisionSet.pipelineDebug;

  if (!winner) {
    return [
      `I checked ${debug.candidateCount} usable vehicles, but none passed all of the requirements you confirmed.`,
      conclusion.text,
    ].join(" ");
  }

  const scope = `I compared ${debug.qualifiedCount} qualified vehicle${plural(debug.qualifiedCount)} after filtering out ${debug.excludedCount} that failed required conditions.`;
  const comparisonText = comparison
    ? `${comparison.isCloseDecision ? "The closest decision" : "The final comparison"} was ${formatVehicleRef(
        comparison.winningVehicle,
      )} versus ${formatVehicleRef(comparison.runnerUpVehicle)}; ${comparison.exactStructuredReasonItLost}`
    : conclusion.text;
  const uncertainty = uncertaintyDisclosure ? ` ${uncertaintyDisclosure.text}` : "";
  return `${scope} ${comparisonText}${uncertainty}`;
}

function buildUncertaintyDisclosure(recommendation: RecommendationObject): VisibleThinkingDecisionStep | undefined {
  if (recommendation.dataQualityConfidence.level === "high" && recommendation.missingInformation.length === 0) return undefined;
  return {
    code: "data_confidence_disclosure",
    text: `I’d verify the live listing details because data quality confidence is ${recommendation.dataQualityConfidence.score}/100 ${recommendation.dataQualityConfidence.level}.`,
    evidenceCodes: ["recommendation.dataQualityConfidence", "recommendation.missingInformation"],
  };
}

function buildHumanExpandedSteps(summary: VisibleThinkingSummary): HumanDecisionStoryExpandedStep[] {
  const steps: HumanDecisionStoryExpandedStep[] = [
    {
      label: "Counts checked",
      text: `Catalog ${summary.catalogCount}; usable ${summary.candidateCount}; ruled out ${summary.excludedCount}; realistic options ${summary.qualifiedCount}; compromises ${summary.compromiseCount}.`,
      evidenceCodes: ["pipelineDebug.catalogCount", "pipelineDebug.candidateCount", "pipelineDebug.excludedCount", "pipelineDebug.qualifiedCount", "pipelineDebug.compromiseCount"],
    },
    ...summary.decisionSteps.map((step) => ({
      label: getExpandedStepLabel(step.code),
      text: step.text,
      evidenceCodes: step.evidenceCodes,
    })),
  ];

  if (summary.hardestComparison) {
    steps.push({
      label: "Final comparison evidence",
      text: `Score gap: ${summary.hardestComparison.scoreGap}. Exact recorded reason: ${summary.hardestComparison.exactStructuredReasonItLost}`,
      evidenceCodes: summary.hardestComparison.evidenceCodes,
    });
  }

  if (summary.uncertaintyDisclosure) {
    steps.push({
      label: "Listing verification",
      text: summary.uncertaintyDisclosure.text,
      evidenceCodes: summary.uncertaintyDisclosure.evidenceCodes,
    });
  }

  return steps;
}

function getExpandedStepLabel(code: VisibleThinkingDecisionStep["code"]) {
  const labels: Record<VisibleThinkingDecisionStep["code"], string> = {
    catalog_scope: "Catalog scope",
    hard_constraint_filter: "Requirement check",
    finalist_comparison: "Finalist comparison",
    deciding_factor: "Recorded deciding factor",
    no_match_blockers: "No-match blockers",
    single_qualified: "One surviving vehicle",
    compromise_disclosure: "Compromise disclosure",
    data_confidence_disclosure: "Listing verification",
  };
  return labels[code];
}

function getPlainRunnerUpAdvantage(comparison: VisibleThinkingHardestComparison) {
  const match = comparison.runnerUpStrongestMeaningfulAdvantage.match(/stronger on (.+?) by/i);
  if (!match?.[1]) return "one useful area";
  return humanizeCategoryLabel(match[1]);
}

function getPlainDecidingPriority(comparison: VisibleThinkingHardestComparison) {
  const category = comparison.decidingUserPriorityOrCategory;
  if (!category || category === "overallMatchScore" || category === "penalty") return "the priorities you confirmed";
  return humanizeCategory(category);
}

function humanizeCategory(category: keyof ScoreWeights) {
  const labels: Record<keyof ScoreWeights, string> = {
    affordability: "your budget",
    reliability: "reliability",
    safety: "safety",
    fuelEnergyCost: "fuel and ownership cost",
    insuranceCost: "insurance cost",
    maintenanceRisk: "maintenance risk",
    practicality: "everyday practicality",
    resaleValue: "resale value",
    drivingPreferenceFit: "driving feel",
  };
  return labels[category];
}

function humanizeCategoryLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("fuel")) return "fuel and ownership cost";
  if (normalized.includes("affordability")) return "budget fit";
  if (normalized.includes("reliability")) return "reliability";
  if (normalized.includes("safety")) return "safety";
  if (normalized.includes("insurance")) return "insurance cost";
  if (normalized.includes("maintenance")) return "maintenance risk";
  if (normalized.includes("practicality")) return "capability and practicality";
  if (normalized.includes("resale")) return "resale value";
  if (normalized.includes("driving")) return "driving feel";
  return label.toLowerCase();
}

function extractBlockerNames(summary: VisibleThinkingSummary) {
  const blockerStep = summary.decisionSteps.find((step) => step.code === "no_match_blockers");
  const blockerText = blockerStep?.text || summary.conclusion.text;
  const afterWere = blockerText.split("were ")[1] || blockerText.split("were: ")[1] || "";
  return afterWere
    .replace(/\.$/, "")
    .replace(/\s*\(\d+ vehicles?\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rewriteSingleVehicleConclusion(text: string) {
  return text
    .replace("is the recommendation because it was the only vehicle that stayed qualified under the current requirements", "is where I would start because it was the only vehicle that met every requirement you confirmed")
    .replace("qualified", "realistic");
}

function getRunnerUpRecommendation(decisionSet: RecommendationDecisionSet, decisionReport: DecisionReport) {
  if (!decisionReport.runnerUp?.vehicleId) return undefined;
  return decisionSet.primaryRecommendations.find((item) => item.vehicleId === decisionReport.runnerUp?.vehicleId);
}

function toVehicleRef(recommendation: RecommendationObject): VisibleThinkingVehicleRef {
  return {
    vehicleId: recommendation.vehicleId,
    year: recommendation.vehicle.year,
    make: recommendation.vehicle.make,
    model: recommendation.vehicle.model,
    overallMatchScore: recommendation.overallMatchScore,
  };
}

function getRunnerUpAdvantage(winner: RecommendationObject, runnerUp: RecommendationObject) {
  const advantage = getCategoryScores(runnerUp)
    .map((signal) => {
      const winnerScore = getCategoryScore(winner, signal.category);
      return {
        category: signal.category,
        gap: Number(signal.score ?? signal.vehicleValue ?? 0) - winnerScore,
      };
    })
    .filter((item) => item.gap > 0)
    .sort((a, b) => b.gap - a.gap)[0];

  if (!advantage) return `${formatVehicleName(runnerUp)} did not have a stronger weighted category than the recommendation.`;
  return `${formatVehicleName(runnerUp)} was stronger on ${scoreWeightLabels[advantage.category]} by ${Math.round(advantage.gap)} points.`;
}

function getCategoryScores(recommendation: RecommendationObject): RecommendationSignal[] {
  return recommendation.reasonsForRecommendation.filter((signal) => signal.category);
}

function getCategoryScore(recommendation: RecommendationObject, category: keyof ScoreWeights) {
  const signal = recommendation.reasonsForRecommendation.find((item) => item.category === category);
  return Number(signal?.score ?? signal?.vehicleValue ?? 0);
}

function getTopContributingCategory(recommendation: RecommendationObject) {
  return [...recommendation.reasonsForRecommendation].sort((a, b) => Number(b.contribution || 0) - Number(a.contribution || 0))[0]?.category;
}

function formatDecidingFactor(comparison: VisibleThinkingHardestComparison, profile: BuyerProfile) {
  if (comparison.decidingUserPriorityOrCategory && comparison.decidingUserPriorityOrCategory !== "overallMatchScore" && comparison.decidingUserPriorityOrCategory !== "penalty") {
    return `${scoreWeightLabels[comparison.decidingUserPriorityOrCategory]} in your confirmed profile`;
  }
  if (profile.reliabilityMinimum !== undefined) return `your reliability minimum of ${profile.reliabilityMinimum}`;
  if (profile.safetyMinimum !== undefined) return `your safety minimum of ${profile.safetyMinimum}`;
  return "the weighted match score";
}

function formatBlockers(decisionSet: RecommendationDecisionSet) {
  const blockers = decisionSet.noMatch.topConstraintBlockers.slice(0, 2);
  if (!blockers.length) return "";
  return blockers
    .map((blocker) => `${blocker.label.toLowerCase()} (${blocker.excludedCount + blocker.compromiseCount} vehicle${plural(blocker.excludedCount + blocker.compromiseCount)})`)
    .join(" and ");
}

function formatFailedConstraint(recommendation: RecommendationObject) {
  const failed = recommendation.hardConstraintResults.find((constraint) => !constraint.passed);
  if (!failed) return "";
  return failed.exclusionReason || `${failed.label.toLowerCase()} did not match the confirmed requirement`;
}

function formatVehicleRef(vehicle: VisibleThinkingVehicleRef) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

function formatVehicleName(recommendation: RecommendationObject) {
  return `${recommendation.vehicle.year} ${recommendation.vehicle.make} ${recommendation.vehicle.model}`;
}

function plural(count: number) {
  return count === 1 ? "" : "s";
}
