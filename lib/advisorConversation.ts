import { formatMoney, formatNumber } from "./affordability";
import { scoreWeightLabels } from "./recommendations";
import type { BuyerProfile } from "@/types/buyer";
import type {
  ConstraintBlocker,
  DecisionReport,
  RecommendationDecisionSet,
  RecommendationObject,
  RecommendationSignal,
  RecommendationTradeoff,
} from "@/types/vehicle";

export type AdvisorIntent =
  | "explain_recommendation"
  | "compare_runner_up"
  | "explain_risk"
  | "explain_uncertainty"
  | "explain_change_conditions"
  | "request_cheaper"
  | "request_safer"
  | "request_sportier"
  | "request_more_reliable"
  | "challenge_recommendation"
  | "explore_preferred_vehicle"
  | "explain_no_match_blockers"
  | "relax_make_requirement"
  | "increase_budget"
  | "make_requirement_flexible"
  | "record_preference_discovery";

export type AdvisorAction = {
  intent: AdvisorIntent;
  label: string;
  relevance: number;
};

export type AdvisorResponsePlan = {
  intent: AdvisorIntent;
  directAnswer: string;
  evidence: string[];
  tradeoff?: string;
  confidenceNote?: string;
  preferenceConflict?: string;
  nextAction?: string;
  recalculationRequired: boolean;
  alternativeVehicleId?: string;
  preferenceLed: boolean;
  narrative?: HumanAdvisorNarrative;
};

export type HumanAdvisorNarrative = {
  openingRecommendation: string;
  buyerContextAcknowledgment: string;
  strongestReasons: string[];
  nearWinner?: {
    vehicleName: string;
    strongestAdvantage: string;
    whatCouldMakeItWin: string;
  };
  whyNearWinnerLost?: string;
  mainConcern: string;
  uncertaintyDisclosure: string;
  advisorOpinion: string;
  curiosityPrompt: string;
  suggestedActions: string[];
  whatIConsidered: string[];
};

export type AdvisorRenderedResponse = {
  title: string;
  paragraphs: string[];
};

export type AdvisorConversationEntry = {
  role: "advisor" | "user";
  label?: string;
  plan?: AdvisorResponsePlan;
  rendered: AdvisorRenderedResponse;
};

export type AdvisorSessionState = {
  entries: AdvisorConversationEntry[];
  preferenceDiscoveries: string[];
  officialTopVehicleId?: string;
};

export type AdvisorContext = {
  decisionSet: RecommendationDecisionSet;
  decisionReport: DecisionReport;
  profile: BuyerProfile;
};

export function createInitialAdvisorSession(context: AdvisorContext): AdvisorSessionState {
  const plan = createAdvisorResponsePlan(getOpeningIntent(context), context);
  return {
    entries: [createAdvisorEntry(plan)],
    preferenceDiscoveries: [],
    officialTopVehicleId: context.decisionReport.bestOverall.vehicleId,
  };
}

export function resetAdvisorSession(context: AdvisorContext): AdvisorSessionState {
  return createInitialAdvisorSession(context);
}

export function applyAdvisorIntent(
  state: AdvisorSessionState,
  intent: AdvisorIntent,
  context: AdvisorContext,
  userLabel = getAdvisorActionLabel(intent),
): AdvisorSessionState {
  const plan = createAdvisorResponsePlan(intent, context);
  const preferenceDiscoveries =
    intent === "record_preference_discovery"
      ? [...state.preferenceDiscoveries, "User may accept higher ownership cost for a preference-led improvement."]
      : state.preferenceDiscoveries;

  return {
    ...state,
    preferenceDiscoveries,
    entries: [
      ...state.entries,
      {
        role: "user",
        label: userLabel,
        rendered: { title: "You", paragraphs: [userLabel] },
      },
      createAdvisorEntry(plan),
    ],
  };
}

export function getRelevantAdvisorActions(context: AdvisorContext): AdvisorAction[] {
  const { decisionSet, decisionReport } = context;
  if (decisionSet.noMatch.noMatch || !decisionReport.bestOverall.vehicleId) {
    return getNoMatchActions(decisionSet);
  }

  const top = getTopRecommendation(decisionSet);
  const actions: AdvisorAction[] = [
    { intent: "explain_recommendation", label: "Why did you choose this one?", relevance: 100 },
    { intent: "compare_runner_up", label: "Which car came closest?", relevance: decisionReport.runnerUp?.vehicleId ? 92 : 25 },
    { intent: "explain_risk", label: "What should I watch out for?", relevance: top?.tradeoffs.length ? 90 : 58 },
    {
      intent: "explain_uncertainty",
      label: "How sure are you about the data?",
      relevance: top && (top.missingInformation.length || top.dataQualityConfidence.level !== "high") ? 88 : 45,
    },
    {
      intent: "explain_change_conditions",
      label: "What could change your mind?",
      relevance: decisionReport.whatCouldChangeRecommendation.length ? 84 : 40,
    },
    { intent: "request_cheaper", label: "Could I spend less?", relevance: hasAlternative(decisionSet, "cheaper") ? 76 : 30 },
    { intent: "request_safer", label: "Is there a safer choice?", relevance: hasAlternative(decisionSet, "safer") ? 74 : 28 },
    {
      intent: "request_more_reliable",
      label: "Is there a more reliable choice?",
      relevance: hasAlternative(decisionSet, "reliable") ? 72 : 28,
    },
    { intent: "request_sportier", label: "What if I want something more fun?", relevance: hasAlternative(decisionSet, "sportier") ? 68 : 24 },
    { intent: "challenge_recommendation", label: "I still prefer another car", relevance: 62 },
  ];

  return actions
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)
    .map(({ intent, label, relevance }) => ({ intent, label, relevance }));
}

export function createAdvisorResponsePlan(intent: AdvisorIntent, context: AdvisorContext): AdvisorResponsePlan {
  const noMatch = context.decisionSet.noMatch.noMatch || !context.decisionReport.bestOverall.vehicleId;
  if (noMatch) return createNoMatchPlan(intent, context);

  switch (intent) {
    case "compare_runner_up":
      return createRunnerUpPlan(context);
    case "explain_risk":
      return createRiskPlan(context);
    case "explain_uncertainty":
      return createUncertaintyPlan(context);
    case "explain_change_conditions":
      return createChangeConditionsPlan(context);
    case "request_cheaper":
      return createAlternativePlan(context, "cheaper");
    case "request_safer":
      return createAlternativePlan(context, "safer");
    case "request_sportier":
      return createAlternativePlan(context, "sportier");
    case "request_more_reliable":
      return createAlternativePlan(context, "reliable");
    case "challenge_recommendation":
    case "explore_preferred_vehicle":
      return createChallengePlan(context);
    case "record_preference_discovery":
      return {
        intent,
        directAnswer: "I will treat that as a session-only preference signal, not a changed recommendation.",
        evidence: ["The official ranking remains the deterministic DecisionReport best overall result."],
        tradeoff: "Changing the official recommendation requires recalculating priorities and constraints.",
        nextAction: "Use Search matches after changing priorities if you want the official ranking to update.",
        recalculationRequired: true,
        preferenceLed: true,
      };
    case "explain_recommendation":
    default:
      return createRecommendationPlan(context);
  }
}

export function renderAdvisorResponse(plan: AdvisorResponsePlan): AdvisorRenderedResponse {
  if (plan.narrative) {
    const narrative = plan.narrative;
    return {
      title: getAdvisorActionLabel(plan.intent),
      paragraphs: [
        narrative.openingRecommendation,
        narrative.buyerContextAcknowledgment,
        narrative.strongestReasons.join(" "),
        narrative.advisorOpinion,
        narrative.mainConcern,
        narrative.uncertaintyDisclosure,
        narrative.curiosityPrompt,
      ].filter(Boolean),
    };
  }

  const paragraphs = [
    plan.directAnswer,
    plan.evidence.join(" "),
    plan.tradeoff || "",
    plan.preferenceConflict || "",
    plan.confidenceNote ? plan.confidenceNote : "",
    plan.recalculationRequired ? "I would need you to recalculate before treating that as the official recommendation." : "",
    plan.nextAction ? plan.nextAction : "",
  ].filter(Boolean);

  return {
    title: getAdvisorActionLabel(plan.intent),
    paragraphs,
  };
}

export function createAdvisorEntry(plan: AdvisorResponsePlan): AdvisorConversationEntry {
  return {
    role: "advisor",
    plan,
    rendered: renderAdvisorResponse(plan),
  };
}

export function getAdvisorActionLabel(intent: AdvisorIntent) {
  const labels: Record<AdvisorIntent, string> = {
    explain_recommendation: "Why did you choose this one?",
    compare_runner_up: "Which car came closest?",
    explain_risk: "What should I watch out for?",
    explain_uncertainty: "How sure are you about the data?",
    explain_change_conditions: "What could change your mind?",
    request_cheaper: "Could I spend less?",
    request_safer: "Is there a safer choice?",
    request_sportier: "What if I want something more fun?",
    request_more_reliable: "Is there a more reliable choice?",
    challenge_recommendation: "I still prefer another car",
    explore_preferred_vehicle: "Explore my preferred car",
    explain_no_match_blockers: "Show me the main blockers",
    relax_make_requirement: "Relax the make requirement",
    increase_budget: "Increase the budget",
    make_requirement_flexible: "Make one requirement flexible",
    record_preference_discovery: "Yes, I would accept that tradeoff",
  };
  return labels[intent];
}

function getOpeningIntent(context: AdvisorContext): AdvisorIntent {
  return context.decisionSet.noMatch.noMatch || !context.decisionReport.bestOverall.vehicleId
    ? "explain_no_match_blockers"
    : "explain_recommendation";
}

function createRecommendationPlan(context: AdvisorContext): AdvisorResponsePlan {
  const { decisionReport } = context;
  const top = requireTopRecommendation(context);
  const narrative = buildHumanAdvisorNarrative(context);
  return {
    intent: "explain_recommendation",
    directAnswer: narrative.openingRecommendation,
    evidence: narrative.strongestReasons,
    tradeoff: narrative.mainConcern,
    confidenceNote: narrative.uncertaintyDisclosure,
    nextAction: decisionReport.whatCouldChangeRecommendation[0]
      ? `What could change my mind first: ${decisionReport.whatCouldChangeRecommendation[0]}`
      : "You can compare alternatives by asking for value, safety, reliability, or performance perspectives.",
    recalculationRequired: false,
    preferenceLed: false,
    narrative,
  };
}

function createRunnerUpPlan(context: AdvisorContext): AdvisorResponsePlan {
  const top = requireTopRecommendation(context);
  const runnerUp = context.decisionReport.runnerUp;
  return {
    intent: "compare_runner_up",
    directAnswer: runnerUp?.vehicleId
      ? `The runner-up did not beat the ${formatRecommendationName(top)} because it lost on the structured comparison.`
      : "There is no qualified runner-up in the current DecisionReport.",
    evidence: [context.decisionReport.whyRunnerUpLost || "No runner-up loss reason is available."],
    tradeoff: runnerUp?.overallMatchScore !== undefined
      ? `Runner-up score: ${runnerUp.overallMatchScore}/100 versus ${top.overallMatchScore}/100 for the main recommendation.`
      : undefined,
    confidenceNote: formatConfidence(top),
    nextAction: "Use the comparison view if you want to inspect category-by-category differences.",
    recalculationRequired: false,
    preferenceLed: false,
  };
}

function createRiskPlan(context: AdvisorContext): AdvisorResponsePlan {
  const top = requireTopRecommendation(context);
  const tradeoff = getPrimaryTradeoff(top);
  return {
    intent: "explain_risk",
    directAnswer: tradeoff
      ? `The biggest recorded risk is ${formatFieldLabel(tradeoff.field).toLowerCase()}.`
      : `The ${formatRecommendationName(top)} has no major recorded tradeoff, but it still needs real-world verification.`,
    evidence: tradeoff
      ? [`${formatFieldLabel(tradeoff.field)} is ${String(tradeoff.vehicleValue)} with ${tradeoff.severity} severity and ${tradeoff.penaltyPoints} penalty points.`]
      : ["No penalty-bearing tradeoff was recorded for the top recommendation."],
    tradeoff: tradeoff ? formatTradeoff(tradeoff) : "Live listing condition, service history, and inspection results are still outside the deterministic catalog.",
    confidenceNote: formatConfidence(top),
    nextAction: "Before buying, verify condition, title status, maintenance history, and a pre-purchase inspection.",
    recalculationRequired: false,
    preferenceLed: false,
  };
}

function createUncertaintyPlan(context: AdvisorContext): AdvisorResponsePlan {
  const top = requireTopRecommendation(context);
  const missing = top.missingInformation.slice(0, 3);
  const estimated = top.estimatedFields.slice(0, 3);
  return {
    intent: "explain_uncertainty",
    directAnswer: `Data quality confidence is ${top.dataQualityConfidence.score}/100 ${top.dataQualityConfidence.level}.`,
    evidence: [
      ...missing.map((item) => `${formatFieldLabel(item.field)} is missing from ${item.expectedSource} (${item.impact} impact).`),
      ...estimated.map((item) => `${formatFieldLabel(item.field)} is ${formatEstimatedValue(item.value, item.unit)} by ${item.method}.`),
    ].slice(0, 4),
    tradeoff: "Estimated ownership costs are useful for comparison, but verified listing condition can change the real purchase decision.",
    confidenceNote: formatConfidence(top),
    nextAction: "The most useful next step is adding live listing, NHTSA, FuelEconomy.gov, or CSV overlay data.",
    recalculationRequired: false,
    preferenceLed: false,
  };
}

function createChangeConditionsPlan(context: AdvisorContext): AdvisorResponsePlan {
  const top = requireTopRecommendation(context);
  return {
    intent: "explain_change_conditions",
    directAnswer: `The ${formatRecommendationName(top)} stays best overall unless one of the structured change factors shifts.`,
    evidence: context.decisionReport.whatCouldChangeRecommendation.slice(0, 4),
    tradeoff: formatTradeoff(getPrimaryTradeoff(top)),
    confidenceNote: formatConfidence(top),
    nextAction: "Change the relevant preference or requirement, then run Search matches to recalculate the official recommendation.",
    recalculationRequired: true,
    preferenceLed: false,
  };
}

function createAlternativePlan(context: AdvisorContext, category: "cheaper" | "safer" | "sportier" | "reliable"): AdvisorResponsePlan {
  const top = requireTopRecommendation(context);
  const alternative = getBestQualifiedAlternative(context.decisionSet, category);
  const label = getAlternativeLabel(category);
  const categoryEvidence = alternative ? getAlternativeEvidence(alternative, top, category) : "";

  return {
    intent: getAlternativeIntent(category),
    directAnswer: alternative
      ? `As an alternative perspective, the ${formatRecommendationName(alternative)} is the strongest ${label} qualified option I can show.`
      : `I do not have a stronger qualified ${label} alternative than the current recommendation.`,
    evidence: alternative
      ? [categoryEvidence, `The official best overall remains ${formatRecommendationName(top)} at ${top.overallMatchScore}/100.`]
      : [`The current recommendation remains the highest qualified result in the available recommendation set.`],
    tradeoff: alternative ? compareAlternativeTradeoff(alternative, top) : formatTradeoff(getPrimaryTradeoff(top)),
    confidenceNote: alternative ? formatConfidence(alternative) : formatConfidence(top),
    preferenceConflict: category === "sportier"
      ? "You may value driving enjoyment more than your original answers suggested."
      : category === "cheaper"
        ? "You may value monthly cost more than the current score weights suggest."
        : undefined,
    nextAction:
      category === "sportier"
        ? "Would you accept higher insurance or maintenance costs for better driving performance?"
        : "Change the relevant priority and run Search matches if you want this alternative perspective to become the official ranking.",
    recalculationRequired: true,
    alternativeVehicleId: alternative?.vehicleId,
    preferenceLed: true,
  };
}

function createChallengePlan(context: AdvisorContext): AdvisorResponsePlan {
  const top = requireTopRecommendation(context);
  const primaryTradeoff = getPrimaryTradeoff(top);
  return {
    intent: "challenge_recommendation",
    directAnswer: "I understand that you may still prefer another vehicle. I can explore that preference, but I would keep the current recommendation as the official best overall for now.",
    evidence: [`The DecisionReport best overall is still ${formatRecommendationName(top)} at ${top.overallMatchScore}/100.`],
    tradeoff: primaryTradeoff
      ? `The current top choice already carries this tradeoff: ${formatTradeoff(primaryTradeoff)}`
      : "A preference-led option may still lose on affordability, reliability, safety, or ownership risk.",
    preferenceConflict: "A weaker option can be worth exploring for personal reasons, but it should be labeled preference-led rather than best overall.",
    nextAction: "What attracts you most: brand, design, driving feel, size, or price?",
    recalculationRequired: false,
    preferenceLed: true,
  };
}

function createNoMatchPlan(intent: AdvisorIntent, context: AdvisorContext): AdvisorResponsePlan {
  const narrative = buildHumanAdvisorNarrative(context);
  const blockers = context.decisionSet.noMatch.topConstraintBlockers.slice(0, 3);
  const blockerEvidence = blockers.length
    ? blockers.map(formatBlocker)
    : [`${context.decisionSet.noMatch.excludedCount} vehicles were excluded and ${context.decisionSet.noMatch.qualifiedCount} qualified.`];
  const directAnswer =
    intent === "relax_make_requirement"
      ? "Relaxing a required make into a preference is the cleanest next experiment when make is one of the blockers."
      : intent === "increase_budget"
        ? "Increasing the budget can help only if budget is one of the constraints removing candidates."
        : intent === "make_requirement_flexible"
          ? "Making one requirement flexible can create compromise options, but it should be explicit."
          : "I do not have a responsible match under your current requirements.";

  return {
    intent,
    directAnswer,
    evidence: blockerEvidence,
    tradeoff: "I would rather show no match than recommend a vehicle that violates a true hard constraint.",
    nextAction: getNoMatchNextAction(intent, blockers),
    recalculationRequired: true,
    preferenceLed: false,
    narrative: intent === "explain_no_match_blockers" ? narrative : undefined,
  };
}

export function buildHumanAdvisorNarrative(context: AdvisorContext): HumanAdvisorNarrative {
  const noMatch = context.decisionSet.noMatch.noMatch || !context.decisionReport.bestOverall.vehicleId;
  if (noMatch) return buildNoMatchNarrative(context);

  const top = requireTopRecommendation(context);
  const runnerUp = findRecommendationByChoice(context, context.decisionReport.runnerUp);
  const strongestReasons = top.reasonsForRecommendation.slice(0, 2).map((signal) => formatHumanReason(signal, top));
  const tradeoff = getPrimaryTradeoff(top);
  const nearWinner = runnerUp ? buildNearWinner(context, top, runnerUp) : undefined;
  const mainConcern = getHumanConcern(top, tradeoff);
  const curiosityPrompt = chooseCuriosityPrompt(context, top);

  return {
    openingRecommendation: `Based on what you told me, I’d choose the ${formatRecommendationName(top)}.`,
    buyerContextAcknowledgment: getBuyerContextAcknowledgment(context.profile),
    strongestReasons: strongestReasons.length
      ? strongestReasons
      : [`It came out ahead after applying your hard requirements and current priorities.`],
    nearWinner,
    whyNearWinnerLost: runnerUp ? context.decisionReport.whyRunnerUpLost : undefined,
    mainConcern,
    uncertaintyDisclosure: getHumanUncertainty(top),
    advisorOpinion: getAdvisorOpinion(top, tradeoff),
    curiosityPrompt,
    suggestedActions: getRelevantAdvisorActions(context).map((action) => action.label),
    whatIConsidered: buildConsideredSteps(context, top, runnerUp),
  };
}

function buildNoMatchNarrative(context: AdvisorContext): HumanAdvisorNarrative {
  const blockers = context.decisionSet.noMatch.topConstraintBlockers.slice(0, 3);
  const topBlocker = blockers[0];
  const topBlockerLabel =
    topBlocker?.code === "make" && context.profile.requiredMake
      ? `${context.profile.requiredMake} requirement`
      : topBlocker?.label;
  const blockerText = topBlocker
    ? `${topBlockerLabel} removed ${topBlocker.excludedCount} vehicle${topBlocker.excludedCount === 1 ? "" : "s"} from the current catalog.`
    : `${context.decisionSet.noMatch.excludedCount} vehicles were excluded by the current requirements.`;

  return {
    openingRecommendation: "I don’t have a responsible recommendation under these requirements.",
    buyerContextAcknowledgment: "Your selected requirements are being treated as hard limits.",
    strongestReasons: [
      blockerText,
      "I would rather tell you that clearly than invent an option that is not in the available data.",
    ],
    mainConcern: "The current filters remove every qualified vehicle before ranking begins.",
    uncertaintyDisclosure: "This is a constraint issue, not a data-generation issue; no vehicle is being fabricated to fill the gap.",
    advisorOpinion: "I would loosen one requirement and recalculate before comparing cars.",
    curiosityPrompt: chooseNoMatchQuestion(blockers),
    suggestedActions: getNoMatchActions(context.decisionSet).map((action) => action.label),
    whatIConsidered: blockers.length
      ? blockers.map((blocker) => {
          const blockerLabel =
            blocker.code === "make" && context.profile.requiredMake
              ? `${context.profile.requiredMake} requirement`
              : blocker.label;
          return `${blockerLabel} removed ${blocker.excludedCount} candidate${blocker.excludedCount === 1 ? "" : "s"}.`;
        })
      : ["The engine evaluated the catalog and found zero qualified vehicles."],
  };
}

function getBestQualifiedAlternative(
  decisionSet: RecommendationDecisionSet,
  category: "cheaper" | "safer" | "sportier" | "reliable",
) {
  const primary = decisionSet.primaryRecommendations.filter((recommendation) => recommendation.qualified);
  const topVehicleId = primary[0]?.vehicleId;
  const alternatives = primary.filter((recommendation) => recommendation.vehicleId !== topVehicleId);
  if (!alternatives.length) return undefined;

  return [...alternatives].sort((a, b) => {
    if (category === "cheaper") return a.ownershipSummary.estimatedMonthlyTotal - b.ownershipSummary.estimatedMonthlyTotal;
    if (category === "safer") return b.vehicle.safetyScore - a.vehicle.safetyScore || b.overallMatchScore - a.overallMatchScore;
    if (category === "sportier") return b.vehicle.performanceScore - a.vehicle.performanceScore || b.overallMatchScore - a.overallMatchScore;
    return b.vehicle.reliabilityScore - a.vehicle.reliabilityScore || b.overallMatchScore - a.overallMatchScore;
  })[0];
}

function hasAlternative(decisionSet: RecommendationDecisionSet, category: "cheaper" | "safer" | "sportier" | "reliable") {
  return Boolean(getBestQualifiedAlternative(decisionSet, category));
}

function getAlternativeEvidence(
  alternative: RecommendationObject,
  top: RecommendationObject,
  category: "cheaper" | "safer" | "sportier" | "reliable",
) {
  if (category === "cheaper") {
    return `${formatRecommendationName(alternative)} is estimated at ${formatMoney(alternative.ownershipSummary.estimatedMonthlyTotal)}/mo versus ${formatMoney(top.ownershipSummary.estimatedMonthlyTotal)}/mo for ${formatRecommendationName(top)}.`;
  }
  if (category === "safer") {
    return `${formatRecommendationName(alternative)} has safety ${alternative.vehicle.safetyScore}/100 versus ${top.vehicle.safetyScore}/100 for ${formatRecommendationName(top)}.`;
  }
  if (category === "sportier") {
    return `${formatRecommendationName(alternative)} has performance ${alternative.vehicle.performanceScore}/100 versus ${top.vehicle.performanceScore}/100 for ${formatRecommendationName(top)}.`;
  }
  return `${formatRecommendationName(alternative)} has reliability ${alternative.vehicle.reliabilityScore}/100 versus ${top.vehicle.reliabilityScore}/100 for ${formatRecommendationName(top)}.`;
}

function compareAlternativeTradeoff(alternative: RecommendationObject, top: RecommendationObject) {
  const weakerCategory = getLargestSignalDrop(alternative, top);
  const tradeoff = getPrimaryTradeoff(alternative);
  if (weakerCategory) return `It gives up ${weakerCategory} compared with ${formatRecommendationName(top)}.`;
  if (tradeoff) return formatTradeoff(tradeoff);
  return `It is not the best overall because its total match is ${alternative.overallMatchScore}/100 versus ${top.overallMatchScore}/100.`;
}

function getLargestSignalDrop(alternative: RecommendationObject, top: RecommendationObject) {
  const topSignals = new Map(top.reasonsForRecommendation.map((signal) => [signal.category, signal.score ?? 0]));
  const drops = alternative.reasonsForRecommendation
    .map((signal) => ({
      category: signal.category,
      drop: (topSignals.get(signal.category) || 0) - (signal.score || 0),
    }))
    .filter((item) => item.drop > 0)
    .sort((a, b) => b.drop - a.drop);
  return drops[0] ? scoreWeightLabels[drops[0].category].toLowerCase() : "";
}

function getAlternativeLabel(category: "cheaper" | "safer" | "sportier" | "reliable") {
  if (category === "cheaper") return "cost-led";
  if (category === "safer") return "safety-led";
  if (category === "sportier") return "performance-led";
  return "reliability-led";
}

function getAlternativeIntent(category: "cheaper" | "safer" | "sportier" | "reliable"): AdvisorIntent {
  if (category === "cheaper") return "request_cheaper";
  if (category === "safer") return "request_safer";
  if (category === "sportier") return "request_sportier";
  return "request_more_reliable";
}

function getNoMatchActions(decisionSet: RecommendationDecisionSet): AdvisorAction[] {
  const blockers = decisionSet.noMatch.topConstraintBlockers;
  const hasMakeBlocker = blockers.some((blocker) => blocker.code === "make");
  const hasBudgetBlocker = blockers.some((blocker) => blocker.code === "totalBudget" || blocker.code === "monthlyPayment");
  const actions: AdvisorAction[] = [
    { intent: "explain_no_match_blockers", label: "Show the main blockers", relevance: 100 },
    { intent: "relax_make_requirement", label: "Relax the make requirement", relevance: hasMakeBlocker ? 92 : 10 },
    { intent: "increase_budget", label: "Increase the budget", relevance: hasBudgetBlocker ? 88 : 12 },
    { intent: "make_requirement_flexible", label: "Make one requirement flexible", relevance: blockers.length ? 82 : 20 },
  ];

  return actions.filter((action) => action.relevance >= 20).sort((a, b) => b.relevance - a.relevance).slice(0, 4);
}

function buildConsideredSteps(
  context: AdvisorContext,
  top: RecommendationObject,
  runnerUp?: RecommendationObject,
) {
  const leadSignal = top.reasonsForRecommendation[0];
  const contributionText = leadSignal
    ? `${scoreWeightLabels[leadSignal.category]} carried ${formatNumber(leadSignal.weight || 0)}% weight and contributed ${formatNumber(leadSignal.contribution || 0)} points.`
    : `${formatRecommendationName(top)} stayed balanced across the weighted categories.`;
  const steps = [
    getPriorityStep(context.profile),
    contributionText,
    `${formatRecommendationName(top)} stood out because ${lowerFirst(formatHumanReason(leadSignal, top))}`,
  ];

  if (runnerUp) {
    steps.push(`${formatRecommendationName(runnerUp)} was close, but ${context.decisionReport.whyRunnerUpLost}`);
  }

  const hardRequirements = context.decisionReport.hardRequirements.filter((constraint) => constraint.passed).length;
  if (hardRequirements) {
    steps.push(`I kept only vehicles that passed your selected hard requirements before comparing preferences.`);
  }

  return steps.slice(0, 4);
}

function buildNearWinner(
  context: AdvisorContext,
  top: RecommendationObject,
  runnerUp: RecommendationObject,
) {
  const advantage = getRunnerUpAdvantage(runnerUp, top);
  return {
    vehicleName: formatRecommendationName(runnerUp),
    strongestAdvantage: advantage.text,
    whatCouldMakeItWin: `If ${advantage.preferenceShift} becomes more important, I would recalculate the comparison rather than assume it wins.`,
  };
}

function getRunnerUpAdvantage(runnerUp: RecommendationObject, top: RecommendationObject) {
  const comparisons = [
    {
      score: runnerUp.vehicle.performanceScore - top.vehicle.performanceScore,
      text: "it has stronger driving appeal in the current data",
      preferenceShift: "driving enjoyment",
    },
    {
      score: runnerUp.vehicle.safetyScore - top.vehicle.safetyScore,
      text: "it has a stronger safety profile in the current data",
      preferenceShift: "safety",
    },
    {
      score: runnerUp.vehicle.reliabilityScore - top.vehicle.reliabilityScore,
      text: "it has a stronger reliability profile in the current data",
      preferenceShift: "reliability",
    },
    {
      score: top.ownershipSummary.estimatedMonthlyTotal - runnerUp.ownershipSummary.estimatedMonthlyTotal,
      text: "it has a lower estimated monthly ownership cost",
      preferenceShift: "monthly ownership cost",
    },
    {
      score: runnerUp.vehicle.cargoScore - top.vehicle.cargoScore,
      text: "it has a stronger practicality profile",
      preferenceShift: "space and practicality",
    },
  ].sort((a, b) => b.score - a.score);

  const best = comparisons[0];
  if (best && best.score > 0) return best;
  return {
    text: "it remained close overall",
    preferenceShift: "its strongest category",
  };
}

function findRecommendationByChoice(context: AdvisorContext, choice = context.decisionReport.runnerUp) {
  if (!choice?.vehicleId) return undefined;
  return context.decisionSet.primaryRecommendations.find((recommendation) => recommendation.vehicleId === choice.vehicleId);
}

function getPriorityStep(profile: BuyerProfile) {
  if (profile.reliabilityImportance >= 4 && profile.performanceImportance <= 2) {
    return "You placed reliability clearly above performance.";
  }
  if (profile.safetyPriority === "maximum" || profile.safetyPriority === "high") {
    return "You made safety one of the most important parts of the decision.";
  }
  if (profile.performanceImportance >= 4) {
    return "You gave driving enjoyment more weight than a typical first-car profile.";
  }
  if (profile.maxPurchaseBudget <= 14000 || profile.monthlyBudget <= 500) {
    return "Your budget leaves less room for ownership surprises.";
  }
  return "I started with your hard requirements, then compared the cars on your stated priorities.";
}

function getBuyerContextAcknowledgment(profile: BuyerProfile) {
  if (profile.reliabilityImportance >= 4 && profile.performanceImportance <= 2) {
    return "You leaned toward dependability over excitement, so I treated daily ownership risk seriously.";
  }
  if (profile.safetyPriority === "maximum") {
    return "You put safety at the top, so I treated protection and family practicality as central.";
  }
  if (profile.performanceImportance >= 4) {
    return "You care about driving feel, but I still checked whether the car remains responsible to own.";
  }
  if (profile.bodyStyle !== "any") {
    return `You asked for a ${profile.bodyStyle}, so I kept that requirement in front of the softer preferences.`;
  }
  if (profile.maxPurchaseBudget <= 14000) {
    return "Your budget is tight enough that ownership cost matters as much as purchase price.";
  }
  return "I treated your hard requirements as the first filter, then compared the tradeoffs that remain.";
}

function formatHumanReason(signal: RecommendationSignal | undefined, recommendation: RecommendationObject) {
  if (!signal) return `${formatRecommendationName(recommendation)} stayed balanced across your priority categories.`;
  const quality = getScoreMeaning(Number(signal.score ?? signal.vehicleValue));
  if (signal.category === "affordability") return `It is ${withArticle(quality)} fit for the budget and ownership-cost limits you gave me.`;
  if (signal.category === "reliability") {
    return quality === "excellent"
      ? "Reliability is one of this car’s strongest qualities."
      : `Reliability looks ${quality} in the current comparison.`;
  }
  if (signal.category === "safety") return `Its safety profile looks ${quality} for this shortlist.`;
  if (signal.category === "fuelEnergyCost") return `Fuel cost should be ${quality} compared with the other qualified options.`;
  if (signal.category === "insuranceCost") return `Insurance cost looks ${quality} under the current estimate.`;
  if (signal.category === "maintenanceRisk") return `Maintenance risk is ${quality} for the current comparison.`;
  if (signal.category === "practicality") return `It is ${withArticle(quality)} fit for the space and daily-use needs.`;
  if (signal.category === "resaleValue") return `Resale strength looks ${quality} in the current data.`;
  return `The driving-preference fit is ${quality} for your answers.`;
}

function withArticle(word: string) {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function lowerFirst(text: string) {
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
}

function getScoreMeaning(score: number) {
  if (score >= 90) return "excellent";
  if (score >= 80) return "strong";
  if (score >= 70) return "solid";
  if (score >= 60) return "acceptable";
  return "concerning";
}

function getHumanConcern(recommendation: RecommendationObject, tradeoff?: RecommendationTradeoff) {
  const hasHighMissingInfo = recommendation.missingInformation.some((item) => item.impact === "high");
  if (tradeoff?.severity === "high") {
    return `I would be cautious about ${formatFieldLabel(tradeoff.field).toLowerCase()} before treating this as a purchase target.`;
  }
  if (tradeoff) {
    return `The main tradeoff is ${formatFieldLabel(tradeoff.field).toLowerCase()}, but it is not strong enough to overturn the recommendation by itself.`;
  }
  if (hasHighMissingInfo || recommendation.dataQualityConfidence.level !== "high") {
    return "I do not see a major red flag in the comparison, but I would verify the actual listing condition.";
  }
  return "The tradeoffs are relatively small under your current priorities.";
}

function getHumanUncertainty(recommendation: RecommendationObject) {
  if (recommendation.dataQualityConfidence.level === "low") {
    return "My caution is higher because the underlying data quality is low.";
  }
  if (recommendation.dataQualityConfidence.level === "medium") {
    const missing = recommendation.missingInformation[0];
    return missing
      ? `Data confidence is medium because ${formatFieldLabel(missing.field).toLowerCase()} still needs ${missing.expectedSource} support.`
      : "Data confidence is medium, so I would still verify the live listing before buying.";
  }
  return "The data confidence is high enough for a shortlist decision, though a real inspection still matters.";
}

function getAdvisorOpinion(recommendation: RecommendationObject, tradeoff?: RecommendationTradeoff) {
  if (recommendation.recommendationConfidence.level === "low") {
    return "I would treat this as the best available lead, not a car to buy without more verification.";
  }
  if (tradeoff?.severity === "high") {
    return "I would keep it on the list, but only after checking that concern carefully.";
  }
  return "I would be comfortable shortlisting it before checking condition, title, and local price.";
}

function chooseCuriosityPrompt(context: AdvisorContext, top: RecommendationObject) {
  const profile = context.profile;
  const monthlyHeadroom = profile.monthlyBudget - top.ownershipSummary.estimatedMonthlyTotal;
  if (profile.performanceImportance >= 4) {
    return "Would you accept somewhat higher insurance or maintenance costs for a more engaging car?";
  }
  if (profile.reliabilityImportance >= 4) {
    return "Are you planning to keep the car for more than five years?";
  }
  if (profile.safetyPriority === "maximum" || profile.safetyPriority === "high") {
    return "Will you regularly carry family or passengers?";
  }
  if (monthlyHeadroom < 100 || profile.maxPurchaseBudget <= 14000) {
    return "Is your purchase budget completely fixed, or could you stretch it for a meaningfully stronger option?";
  }
  return "Would you rather optimize next for lower cost, more safety, or a more engaging drive?";
}

function chooseNoMatchQuestion(blockers: ConstraintBlocker[]) {
  const hasMake = blockers.some((blocker) => blocker.code === "make");
  const hasBudget = blockers.some((blocker) => blocker.code === "totalBudget" || blocker.code === "monthlyPayment");
  if (hasMake && hasBudget) return "Would you prefer to relax the brand requirement or increase the budget?";
  if (hasMake) return "Would you rather make the brand a preference instead of a requirement?";
  if (hasBudget) return "Is the budget completely fixed, or should I test a higher limit?";
  return "Which requirement are you most willing to make flexible?";
}

function getNoMatchNextAction(intent: AdvisorIntent, blockers: ConstraintBlocker[]) {
  if (intent === "relax_make_requirement") return "Change required make to preferred make, then run Search matches again.";
  if (intent === "increase_budget") return "Raise purchase or monthly budget, then run Search matches again.";
  if (intent === "make_requirement_flexible") return "Pick the single least important hard requirement and make it flexible before recalculating.";
  const topBlocker = blockers[0];
  return topBlocker
    ? `Start with ${topBlocker.label}; it removed ${topBlocker.excludedCount} candidate${topBlocker.excludedCount === 1 ? "" : "s"}.`
    : "Relax one strict requirement and recalculate.";
}

function requireTopRecommendation(context: AdvisorContext) {
  const top = getTopRecommendation(context.decisionSet);
  if (!top) throw new Error("Advisor response requires a qualified top recommendation.");
  return top;
}

function getTopRecommendation(decisionSet: RecommendationDecisionSet) {
  return decisionSet.primaryRecommendations[0];
}

function getPrimaryTradeoff(recommendation: RecommendationObject) {
  return [...recommendation.tradeoffs].sort((a, b) => b.penaltyPoints - a.penaltyPoints)[0];
}

function formatSignalEvidence(signal: RecommendationSignal) {
  const score = signal.score !== undefined ? `${signal.score}/100` : String(signal.vehicleValue);
  const weight = signal.weight !== undefined ? ` at ${formatNumber(signal.weight)}% weight` : "";
  return `${scoreWeightLabels[signal.category]} was ${score}${weight}.`;
}

function formatTradeoff(tradeoff?: RecommendationTradeoff) {
  if (!tradeoff) return "I do not see a major red flag in the current comparison.";
  const preference = tradeoff.userPreference !== undefined ? ` versus target ${String(tradeoff.userPreference)}` : "";
  return `${formatFieldLabel(tradeoff.field)} is ${formatTradeoffValue(tradeoff.field, tradeoff.vehicleValue)}${preference}, with ${tradeoff.severity} severity.`;
}

function formatConfidence(recommendation: RecommendationObject) {
  return `Recommendation confidence is ${recommendation.recommendationConfidence.score}/100 ${recommendation.recommendationConfidence.level}; data quality confidence is ${recommendation.dataQualityConfidence.score}/100 ${recommendation.dataQualityConfidence.level}.`;
}

function formatRecommendationName(recommendation: RecommendationObject) {
  return `${recommendation.vehicle.year} ${recommendation.vehicle.make} ${recommendation.vehicle.model}`;
}

function formatBlocker(blocker: ConstraintBlocker) {
  return `${blocker.label} excluded ${blocker.excludedCount} candidate${blocker.excludedCount === 1 ? "" : "s"}.`;
}

function formatEstimatedValue(value: string | number | boolean, unit: string) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (unit === "usd" || unit === "usd_per_month" || unit === "usd_per_year") return formatMoney(value);
  return formatNumber(value);
}

function formatTradeoffValue(field: string, value: string | number | boolean) {
  if (typeof value !== "number") return String(value);
  const moneyFields = ["price", "monthly", "insurance", "fuel", "maintenance", "depreciation", "ownership"];
  if (moneyFields.some((moneyField) => field.toLowerCase().includes(moneyField))) return formatMoney(value);
  return formatNumber(value);
}

function formatFieldLabel(field: string) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}
