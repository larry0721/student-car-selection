import { decisionPolicyDimensionLabel } from "./decisionParticipationPolicy";
import { scoreWeightLabels } from "./recommendations";
import type { ConfirmedPreferenceItem, ConfirmedPreferenceProfile } from "./confirmedPreferenceProfile";
import type { ActionableProfileAssessment } from "./recommendationReadiness";
import type { BuyerProfile } from "@/types/buyer";
import type { DecisionParticipationPolicy } from "@/types/decisionPolicy";
import type { ScoreContributionRecord } from "@/types/scoring";
import type {
  ConstraintBlocker,
  DecisionReport,
  HardConstraintResult,
  RecommendationDecisionSet,
  RecommendationObject,
  RecommendationSignal,
  RecommendationTradeoff,
} from "@/types/vehicle";

export type AdvisorPolicySummary = {
  priorities: string[];
  requirements: string[];
  flexible: string[];
  ignored: string[];
  unresolved: string[];
  understoodNotScored: string[];
};

export type AdvisorConfidenceCopy = {
  recommendation: string;
  dataQuality: string;
};

export type AdvisorTechnicalDetail = {
  label: string;
  value: string;
};

export type AdvisorCommunicationViewModel = {
  mode: "recommendation" | "constraint_only" | "no_match";
  snapshotVehicleId?: string;
  advisorHeadline: string;
  recommendationSummary: string;
  mainReason: string;
  reasons: string[];
  mainTradeoff: string;
  verification: string;
  runnerUp?: {
    vehicleName: string;
    explanation: string;
  };
  policySummary: AdvisorPolicySummary;
  confidence: AdvisorConfidenceCopy;
  assumptions: string[];
  dataLimitations: string[];
  technicalDetails: {
    pipeline: AdvisorTechnicalDetail[];
    effectiveWeights: AdvisorTechnicalDetail[];
    contributions: AdvisorTechnicalDetail[];
    confidenceInputs: AdvisorTechnicalDetail[];
    constraints: AdvisorTechnicalDetail[];
  };
  noMatch?: {
    explanation: string;
    blockers: string[];
    actions: string[];
  };
};

export type AdvisorConfirmationViewModel = {
  advisorSummary: string;
  policySummary: AdvisorPolicySummary;
  readinessMessage?: string;
};

export function buildAdvisorCommunicationViewModel({
  decisionReport,
  decisionSet,
  profile,
}: {
  decisionReport: DecisionReport;
  decisionSet: RecommendationDecisionSet;
  profile: BuyerProfile;
}): AdvisorCommunicationViewModel {
  const recommendation = decisionSet.primaryRecommendations[0];
  if (!recommendation) return buildNoMatchCommunication(decisionSet, profile);

  const mode =
    recommendation.effectiveScoringPolicy.mode === "constraint_only"
      ? "constraint_only"
      : "recommendation";
  const reasons = recommendation.reasonsForRecommendation
    .filter((reason) => contributionAffectedRanking(recommendation, reason.category))
    .slice(0, 3)
    .map((reason) => formatRecommendationReason(reason));
  const requirementReason = getRequirementReason(recommendation);
  const visibleReasons = [...reasons];
  if (visibleReasons.length < 3 && requirementReason) visibleReasons.push(requirementReason);
  if (!visibleReasons.length) {
    visibleReasons.push("It passed the requirements you confirmed.");
  }

  const vehicleName = formatVehicleName(recommendation);
  const mainReason = visibleReasons[0];
  const runnerUp = buildRunnerUpCommunication(decisionSet, decisionReport);
  const policySummary = buildRecommendationPolicySummary(recommendation);

  return {
    mode,
    snapshotVehicleId: recommendation.vehicleId,
    advisorHeadline: `I’d start with the ${vehicleName}.`,
    recommendationSummary:
      mode === "constraint_only"
        ? `It is one of ${decisionSet.pipelineDebug.qualifiedCount} vehicles that met the requirements you set. Since you left most other preferences open, this is a fit-based shortlist rather than a decisive personal winner.`
        : `It was the strongest match after I applied the requirements and priorities you confirmed. ${mainReason}`,
    mainReason,
    reasons: visibleReasons.slice(0, 3),
    mainTradeoff: formatMainTradeoff(recommendation),
    verification: formatVerification(recommendation),
    runnerUp,
    policySummary,
    confidence: formatConfidence(recommendation, decisionSet),
    assumptions: decisionReport.assumptions.map(
      (item) => `${formatFieldLabel(item.field)} uses ${humanizeToken(item.method)}.`,
    ),
    dataLimitations: [
      ...recommendation.missingInformation.map(
        (item) => `${formatFieldLabel(item.field)} is still missing from ${humanizeSource(item.expectedSource)}.`,
      ),
      ...recommendation.estimatedFields.map(
        (item) => `${formatFieldLabel(item.field)} is currently estimated.`,
      ),
    ],
    technicalDetails: buildTechnicalDetails(recommendation, decisionSet),
  };
}

export function buildConfirmationCommunicationViewModel(
  draft: ConfirmedPreferenceProfile,
  readiness: ActionableProfileAssessment,
): AdvisorConfirmationViewModel {
  const activeItems = draft.items.filter(
    (item) =>
      !draft.removedItemIds.includes(item.id)
      && isMeaningfulConfirmationItem(item),
  );
  const policyItems = Object.values(draft.decisionPolicies || {}).filter(
    (item): item is DecisionParticipationPolicy => Boolean(item),
  );
  const policySummary: AdvisorPolicySummary = {
    priorities: policyItems
      .filter((item) => item.participation === "active" || item.participation === "deprioritized")
      .map(formatPolicyLine),
    requirements: [
      ...policyItems.filter((item) => item.participation === "enforced").map(formatPolicyLine),
      ...activeItems
        .filter((item) => item.constraintStrength === "required" && !item.policyDimension)
        .map(formatConfirmationItem),
    ],
    flexible: activeItems
      .filter(
        (item) =>
          item.recommendationSupport === "used_in_recommendation"
          && item.constraintStrength !== "required"
          && !item.policyDimension,
      )
      .map(formatConfirmationItem),
    ignored: policyItems.filter((item) => item.participation === "disabled").map(formatPolicyLine),
    unresolved: [
      ...policyItems.filter((item) => item.participation === "unresolved").map(formatPolicyLine),
      ...activeItems.filter((item) => item.certainty === "needs_answer").map(formatConfirmationItem),
    ],
    understoodNotScored: activeItems
      .filter((item) => item.recommendationSupport === "understood_not_ranked")
      .map(
        (item) =>
          `${item.label}: ${item.displayValue}. I understood this, but the current car data cannot score it reliably yet.`,
      ),
  };

  return {
    advisorSummary: capitalizeSentenceStarts(draft.advisorSummary),
    policySummary: dedupePolicySummary(policySummary),
    readinessMessage: readiness.ready
      ? undefined
      : `I need one useful detail before I look for cars. ${readiness.clarificationQuestion}`,
  };
}

export function formatPolicyLine(policy: DecisionParticipationPolicy) {
  const label = decisionPolicyDimensionLabel(policy.dimension);
  if (policy.participation === "disabled") {
    return `${label}: not part of this recommendation.`;
  }
  if (policy.participation === "unresolved") {
    return `${label}: I still need to know whether this matters to you.`;
  }
  if (policy.participation === "deprioritized") {
    return `${label}: considered, but less important than your other priorities.`;
  }
  if (policy.participation === "enforced") {
    return `${label}: required.`;
  }
  if ((policy.importance ?? 0) > 0.8) {
    return `${label}: top priority.`;
  }
  if ((policy.importance ?? 0) > 0.55) {
    return `${label}: important.`;
  }
  return `${label}: considered normally.`;
}

export function getOutOfScopeAdvisorMessage(sourceText: string) {
  const match = sourceText.match(/\b(motorcycle|motorbike|scooter|moped|rv|atv|boat)\b/i);
  if (!match) return undefined;
  const subject = match[1].toLowerCase();
  return `I understand that you’re asking about a ${subject}. This version currently focuses on passenger cars and light trucks.`;
}

function buildNoMatchCommunication(
  decisionSet: RecommendationDecisionSet,
  profile: BuyerProfile,
): AdvisorCommunicationViewModel {
  const blockers = decisionSet.noMatch.topConstraintBlockers.slice(0, 3);
  const blockerCopy = blockers.map((blocker) => formatBlocker(blocker, profile));
  return {
    mode: "no_match",
    advisorHeadline: "I couldn’t find a responsible match that satisfies everything you asked for.",
    recommendationSummary:
      blockerCopy[0]
      || "The current requirements removed every vehicle before I could make a responsible comparison.",
    mainReason: blockerCopy[0] || "No vehicle passed all confirmed requirements.",
    reasons: blockerCopy.slice(0, 2),
    mainTradeoff: "I’d rather show no match than recommend a vehicle that violates a requirement you marked as mandatory.",
    verification: "The detailed exclusion counts remain available below if you want to inspect them.",
    policySummary: emptyPolicySummary(),
    confidence: {
      recommendation: "There is no recommendation to express confidence in yet.",
      dataQuality: "The no-match result reflects the current catalog and the requirements you confirmed.",
    },
    assumptions: [],
    dataLimitations: [],
    technicalDetails: {
      pipeline: formatPipeline(decisionSet),
      effectiveWeights: [],
      contributions: [],
      confidenceInputs: [],
      constraints: blockers.map((item) => ({
        label: item.label,
        value: `${item.excludedCount} excluded; ${item.compromiseCount} possible compromises`,
      })),
    },
    noMatch: {
      explanation:
        blockerCopy[0]
        || "The available catalog does not contain a vehicle that passes every confirmed requirement.",
      blockers: blockerCopy,
      actions: getNoMatchActions(blockers, profile),
    },
  };
}

function buildRecommendationPolicySummary(
  recommendation: RecommendationObject,
): AdvisorPolicySummary {
  const categoryPolicies = Object.values(recommendation.effectiveScoringPolicy.categories);
  const hardPolicies = recommendation.effectiveScoringPolicy.effectiveHardConstraints;
  return {
    priorities: categoryPolicies
      .filter((item) => item.scoringEnabled)
      .sort((a, b) => b.normalizedEffectiveWeight - a.normalizedEffectiveWeight)
      .slice(0, 5)
      .map((item) => {
        const label = scoreWeightLabels[item.category];
        if (item.participation === "deprioritized") {
          return `${label}: considered, but less than your other priorities.`;
        }
        if (item.importanceLevel === "top") return `${label}: carried the most weight.`;
        if (item.importanceLevel === "high") return `${label}: one of your main priorities.`;
        return `${label}: considered normally.`;
      }),
    requirements: hardPolicies
      .filter((item) => item.enforced)
      .map((item) => `${decisionPolicyDimensionLabel(item.dimension)}: required.`),
    flexible: hardPolicies
      .filter((item) => !item.enforced && item.participation === "active")
      .map((item) => `${decisionPolicyDimensionLabel(item.dimension)}: left flexible.`),
    ignored: [
      ...categoryPolicies
        .filter((item) => item.participation === "disabled")
        .map((item) => `${scoreWeightLabels[item.category]}: intentionally excluded.`),
      ...hardPolicies
        .filter((item) => item.participation === "disabled")
        .map((item) => `${decisionPolicyDimensionLabel(item.dimension)}: no restriction applied.`),
    ],
    unresolved: categoryPolicies
      .filter((item) => item.participation === "unresolved")
      .map((item) => `${scoreWeightLabels[item.category]}: still unresolved.`),
    understoodNotScored: [],
  };
}

function buildTechnicalDetails(
  recommendation: RecommendationObject,
  decisionSet: RecommendationDecisionSet,
) {
  return {
    pipeline: formatPipeline(decisionSet),
    effectiveWeights: recommendation.scoreContributions.map((item) => ({
      label: scoreWeightLabels[item.category],
      value: `${item.normalizedEffectiveWeight.toFixed(2)}% effective weight; ${humanizeToken(item.participation)}`,
    })),
    contributions: recommendation.scoreContributions.map(formatContribution),
    confidenceInputs: [
      ...recommendation.recommendationConfidence.factors.map((item) => ({
        label: formatFieldLabel(item.code),
        value: `${String(item.value)} (${item.impact})`,
      })),
      ...recommendation.dataQualityConfidence.factors.map((item) => ({
        label: `Data: ${formatFieldLabel(item.code)}`,
        value: `${String(item.value)} (${item.impact})`,
      })),
    ],
    constraints: recommendation.hardConstraintResults.map(formatConstraint),
  };
}

function buildRunnerUpCommunication(
  decisionSet: RecommendationDecisionSet,
  decisionReport: DecisionReport,
) {
  const runner = decisionReport.runnerUp;
  if (!runner?.vehicleId) return undefined;
  const structuredLoss = decisionSet.pipelineDebug.runnerUpLossReasons.find(
    (item) => item.vehicleId === runner.vehicleId,
  );
  const category = structuredLoss?.category;
  const categoryLabel = category ? scoreWeightLabels[category].toLowerCase() : undefined;
  return {
    vehicleName: `${runner.year} ${runner.make} ${runner.model}`,
    explanation: categoryLabel
      ? `It came closest, but it fell behind mainly on ${categoryLabel}, which had more influence under the priorities you confirmed.`
      : "It came closest, but the selected vehicle stayed ahead across the factors you asked me to use.",
  };
}

function formatRecommendationReason(signal: RecommendationSignal) {
  const label = scoreWeightLabels[signal.category];
  const score = Number(signal.score ?? signal.vehicleValue);
  const strength = score >= 90 ? "excellent" : score >= 80 ? "strong" : score >= 70 ? "solid" : "acceptable";
  if (signal.category === "affordability") return `Its purchase and payment fit is ${strength} for the limits you asked me to use.`;
  if (signal.category === "reliability") return `Reliability is ${strength} compared with the other qualified cars.`;
  if (signal.category === "safety") return `Its safety evidence is ${strength} for this shortlist.`;
  if (signal.category === "fuelEnergyCost") return `Fuel and energy cost looks ${strength} among the qualified options.`;
  if (signal.category === "insuranceCost") return `The insurance estimate is ${strength} relative to the other options.`;
  if (signal.category === "maintenanceRisk") return `Its maintenance-risk estimate is ${strength} for this comparison.`;
  if (signal.category === "practicality") return `It is a ${strength} fit for the space and daily-use needs you confirmed.`;
  if (signal.category === "resaleValue") return `Its resale outlook is ${strength} in the current data.`;
  return `${label} is ${strength} for the preferences you confirmed.`;
}

function formatMainTradeoff(recommendation: RecommendationObject) {
  const tradeoff = [...recommendation.tradeoffs].sort(
    (a, b) => b.penaltyPoints - a.penaltyPoints,
  )[0];
  if (!tradeoff) {
    return "I don’t see a major tradeoff under the priorities you confirmed.";
  }
  return formatTradeoff(tradeoff);
}

function formatTradeoff(tradeoff: RecommendationTradeoff) {
  const comparison =
    tradeoff.userPreference === undefined
      ? ""
      : ` compared with your target of ${String(tradeoff.userPreference)}`;
  return `My biggest concern is ${formatFieldLabel(tradeoff.field).toLowerCase()}: the current value is ${String(tradeoff.vehicleValue)}${comparison}.`;
}

function formatVerification(recommendation: RecommendationObject) {
  const highImpactMissing = recommendation.missingInformation.find((item) => item.impact === "high");
  if (highImpactMissing) {
    return `Before buying, I’d verify ${formatFieldLabel(highImpactMissing.field).toLowerCase()} through ${humanizeSource(highImpactMissing.expectedSource)}.`;
  }
  const estimated = recommendation.estimatedFields[0];
  if (estimated) {
    return `Before buying, I’d verify the ${formatFieldLabel(estimated.field).toLowerCase()} because it is currently estimated.`;
  }
  return "Before buying, I’d verify the live price, mileage, title history, condition, and inspection results.";
}

function formatConfidence(
  recommendation: RecommendationObject,
  decisionSet: RecommendationDecisionSet,
): AdvisorConfidenceCopy {
  const gap = decisionSet.pipelineDebug.runnerUpLossReasons[0]?.scoreGap ?? 0;
  const recommendationCopy =
    recommendation.effectiveScoringPolicy.mode === "constraint_only"
      ? "The shortlist fits your requirements, but you left too few positive preferences for me to call one vehicle a decisive personal winner."
      : recommendation.recommendationConfidence.level === "high" && gap > 3
        ? "The result is well supported by the priorities you confirmed, and the winner had a clear advantage."
        : recommendation.recommendationConfidence.level === "low"
          ? "I can give you a shortlist, but I would not treat one vehicle as a decisive winner yet."
          : "This is a reasonable starting point, but the top options were fairly close.";
  const estimatedCount = recommendation.scoreContributions.filter(
    (item) => item.affectedRanking && item.dataStatus !== "available",
  ).length;
  const dataCopy =
    recommendation.dataQualityConfidence.level === "high" && estimatedCount === 0
      ? "The active comparison factors are supported by complete current catalog evidence."
      : estimatedCount
        ? `The ranking is reasonably supported, although ${estimatedCount} active factor${estimatedCount === 1 ? " uses" : "s use"} estimated information.`
        : "The available vehicle facts support a shortlist, but live listing condition still needs verification.";
  return { recommendation: recommendationCopy, dataQuality: dataCopy };
}

function formatBlocker(blocker: ConstraintBlocker, profile: BuyerProfile) {
  if (blocker.code === "make") {
    const make = profile.requiredMake || profile.requiredMakes?.[0];
    if (make) {
      return `You asked me to require ${make}, but the current catalog does not contain a ${make} that passes the other requirements.`;
    }
  }
  return `${blocker.label} removed ${blocker.excludedCount} vehicle${blocker.excludedCount === 1 ? "" : "s"} from consideration.`;
}

function getNoMatchActions(blockers: ConstraintBlocker[], profile: BuyerProfile) {
  const actions = ["Change another requirement", "Update the request"];
  if (blockers.some((item) => item.code === "make") && (profile.requiredMake || profile.requiredMakes?.length)) {
    actions.unshift(`Keep ${profile.requiredMake || profile.requiredMakes?.[0]} required`);
    actions.splice(1, 0, "Consider similar vehicles");
  }
  return actions.slice(0, 4);
}

function formatPipeline(decisionSet: RecommendationDecisionSet): AdvisorTechnicalDetail[] {
  const debug = decisionSet.pipelineDebug;
  return [
    { label: "Catalog", value: `${debug.catalogCount} vehicles` },
    { label: "Initial candidates", value: `${debug.candidateCount}` },
    { label: "Excluded", value: `${debug.excludedCount}` },
    { label: "Qualified", value: `${debug.qualifiedCount}` },
    { label: "Compromises", value: `${debug.compromiseCount}` },
  ];
}

function formatContribution(item: ScoreContributionRecord): AdvisorTechnicalDetail {
  return {
    label: scoreWeightLabels[item.category],
    value: `${item.normalizedCategoryScore.toFixed(1)}/100 × ${item.normalizedEffectiveWeight.toFixed(2)}% = ${item.weightedContribution.toFixed(2)} points; ${item.dataStatus}`,
  };
}

function formatConstraint(item: HardConstraintResult): AdvisorTechnicalDetail {
  return {
    label: item.label,
    value: `${item.passed ? "Passed" : "Failed"}; required ${String(item.limit)}; actual ${String(item.actual)}`,
  };
}

function contributionAffectedRanking(
  recommendation: RecommendationObject,
  category: RecommendationSignal["category"],
) {
  return recommendation.scoreContributions.some(
    (item) => item.category === category && item.affectedRanking,
  );
}

function getRequirementReason(recommendation: RecommendationObject) {
  const passed = recommendation.hardConstraintResults.filter((item) => item.passed);
  if (!passed.length) return "";
  return `It passed all ${passed.length} requirements that were checked.`;
}

function formatConfirmationItem(item: ConfirmedPreferenceItem) {
  return `${item.label}: ${item.displayValue}.`;
}

function isMeaningfulConfirmationItem(item: ConfirmedPreferenceItem) {
  if (typeof item.value === "boolean" || item.value === null || item.value === undefined) return false;
  const displayValue = item.displayValue.trim().toLowerCase();
  return Boolean(displayValue)
    && displayValue !== "false"
    && displayValue !== "true"
    && displayValue !== "none";
}

function capitalizeSentenceStarts(value: string) {
  return value.replace(/(^|[.!?]\s+)([a-z])/g, (_match, prefix: string, letter: string) => {
    return `${prefix}${letter.toUpperCase()}`;
  });
}

function dedupePolicySummary(summary: AdvisorPolicySummary): AdvisorPolicySummary {
  return Object.fromEntries(
    Object.entries(summary).map(([key, items]) => [key, Array.from(new Set(items))]),
  ) as unknown as AdvisorPolicySummary;
}

function emptyPolicySummary(): AdvisorPolicySummary {
  return {
    priorities: [],
    requirements: [],
    flexible: [],
    ignored: [],
    unresolved: [],
    understoodNotScored: [],
  };
}

function formatVehicleName(recommendation: RecommendationObject) {
  return `${recommendation.vehicle.year} ${recommendation.vehicle.make} ${recommendation.vehicle.model}`;
}

function formatFieldLabel(field: string) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function humanizeToken(value: string) {
  return value.replace(/[_-]/g, " ");
}

function humanizeSource(value: string) {
  if (value === "listing-api") return "a live listing source";
  if (value === "fueleconomy.gov") return "FuelEconomy.gov";
  if (value === "nhtsa") return "NHTSA";
  return humanizeToken(value);
}
