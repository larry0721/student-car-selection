import type { VehicleDefectIdentity } from "../../types/nhtsaReliabilityEvidence";
import type {
  ReliabilityCorroborationState,
  ReliabilityInterpretation,
  ReliabilityIssueCluster,
  ReliabilitySeveritySignal,
} from "../../types/reliabilityInterpretation";
import type {
  ReliabilityConcern,
  ReliabilityConcernLevel,
  ReliabilityExplanationFact,
  ReliabilityRiskAssessment,
} from "../../types/reliabilityRiskAssessment";
import type { VehicleExposureProvider } from "../../types/vehicleExposure";
import {
  createUnsupportedVehicleExposureProvider,
  createVehicleExposureQuery,
  normalizeReliabilityEvidenceWithExposure,
} from "./vehicle-exposure-provider";

export const reliabilityRiskAssessmentPolicyVersion = "1.0.0" as const;

const componentPriority: Readonly<Record<ReliabilityIssueCluster["component"], number>> = {
  engine: 13,
  transmission: 12,
  powertrain: 11,
  brakes: 10,
  steering: 9,
  fuel_system: 8,
  battery_ev_system: 7,
  electrical: 6,
  suspension: 5,
  airbags: 4,
  structure: 3,
  climate: 2,
  unknown_other: 0,
};

export async function assessReliabilityRisk(input: {
  interpretation: ReliabilityInterpretation;
  vehicle: VehicleDefectIdentity;
  exposureProvider?: VehicleExposureProvider;
  allowTestExposureProvider?: boolean;
}): Promise<ReliabilityRiskAssessment> {
  validateInput(input.interpretation, input.vehicle);
  const provider = input.exposureProvider ?? createUnsupportedVehicleExposureProvider();
  if (provider.dataUse === "test" && input.allowTestExposureProvider !== true) {
    throw new Error("Test-only vehicle exposure providers require allowTestExposureProvider=true.");
  }

  const query = createVehicleExposureQuery({
    vehicleId: input.vehicle.vehicleId,
    modelYear: input.vehicle.modelYear,
    make: input.vehicle.make,
    model: input.vehicle.model,
    asOfDate: input.interpretation.generatedAt,
  });
  const providerResult = await provider.getExposure(query);
  validateProviderResult(provider.providerId, providerResult.query.vehicleId, input.vehicle.vehicleId);
  const normalizedEvidence = normalizeReliabilityEvidenceWithExposure(
    input.interpretation,
    provider.providerId,
    providerResult,
  );
  const selectedClusters = selectPrimaryClusters(input.interpretation);
  const primaryConcerns = selectedClusters.map((cluster) => toConcern(cluster));
  const corroboratedConcerns = input.interpretation.issueClusters
    .filter((cluster) => cluster.component !== "unknown_other" && isCorroborated(cluster.corroboration))
    .sort((left, right) => compareClusters(left, right, input.interpretation.seriousSignals.signals))
    .map((cluster) => toConcern(cluster));
  const concernLevel = determineConcernLevel(input.interpretation, selectedClusters);
  const explanationFacts = buildExplanationFacts(
    input.interpretation,
    selectedClusters,
    normalizedEvidence.availability,
    concernLevel,
  );

  return deepFreeze({
    schemaVersion: "1.0.0",
    policyVersion: reliabilityRiskAssessmentPolicyVersion,
    assessmentId: `reliability-risk:${stableHash(input.interpretation.interpretationId)}:${reliabilityRiskAssessmentPolicyVersion}`,
    vehicleId: input.vehicle.vehicleId,
    vehicle: { ...input.vehicle },
    sourceInterpretationId: input.interpretation.interpretationId,
    generatedAt: input.interpretation.generatedAt,
    assessmentState: input.interpretation.assessmentState,
    concernLevel,
    issueClusters: input.interpretation.issueClusters.map((cluster) => ({ ...cluster })),
    primaryConcerns,
    corroboratedConcerns,
    seriousSignals: {
      signals: input.interpretation.seriousSignals.signals.map((signal) => ({ ...signal })),
      criticalCount: input.interpretation.seriousSignals.criticalCount,
      seriousCount: input.interpretation.seriousSignals.seriousCount,
      materialCount: input.interpretation.seriousSignals.materialCount,
      limitedCount: input.interpretation.seriousSignals.limitedCount,
      unknownCount: input.interpretation.seriousSignals.unknownCount,
    },
    applicability: {
      scope: "model_year",
      confidence: input.interpretation.applicability.confidence,
      configurationSpecific: false,
      vinSpecific: false,
      basis: [...input.interpretation.applicability.basis],
    },
    evidenceConfidence: {
      level: input.interpretation.confidence.level,
      basis: [...input.interpretation.confidence.basis],
    },
    exposureContext: { providerResult, normalizedEvidence },
    limitations: uniqueSorted([
      ...input.interpretation.limitations,
      ...providerResult.limitations,
      ...normalizedEvidence.limitations,
      "Concern levels describe supported negative evidence; they are not comparative reliability grades.",
      "No concern level proves that every vehicle of this model year has the reported condition.",
      "This assessment is not connected to recommendation qualification, scoring, or ranking.",
    ]),
    explanationFacts,
    comparativeReliabilitySupported: false,
    recommendationScoringEligible: false,
    reliabilityScore: null,
    comparativeRank: null,
    productionRecommendationConnected: false,
  });
}

function selectPrimaryClusters(interpretation: ReliabilityInterpretation) {
  return interpretation.issueClusters
    .filter((cluster) => isMeaningfulCluster(cluster))
    .sort((left, right) => compareClusters(left, right, interpretation.seriousSignals.signals))
    .slice(0, 3);
}

function isMeaningfulCluster(cluster: ReliabilityIssueCluster) {
  return cluster.component !== "unknown_other"
    && (cluster.complaintCount >= 2
      || cluster.recallCount > 0
      || cluster.investigationCount > 0
      || cluster.manufacturerCommunicationCount > 0
      || cluster.seriousSignalCount > 0);
}

function compareClusters(
  left: ReliabilityIssueCluster,
  right: ReliabilityIssueCluster,
  signals: readonly ReliabilitySeveritySignal[],
) {
  const leftSeverity = highestSeverity(left, signals);
  const rightSeverity = highestSeverity(right, signals);
  const leftOfficial = Number(isCorroborated(left.corroboration));
  const rightOfficial = Number(isCorroborated(right.corroboration));
  return rightOfficial - leftOfficial
    || rightSeverity - leftSeverity
    || componentPriority[right.component] - componentPriority[left.component]
    || left.component.localeCompare(right.component);
}

function highestSeverity(cluster: ReliabilityIssueCluster, signals: readonly ReliabilitySeveritySignal[]) {
  const levels: Record<ReliabilitySeveritySignal["level"], number> = {
    CRITICAL_SIGNAL: 4,
    SERIOUS_SIGNAL: 3,
    MATERIAL_SIGNAL: 2,
    LIMITED_SIGNAL: 1,
    UNKNOWN: 0,
  };
  const evidenceIds = new Set(cluster.evidenceIds);
  return Math.max(0, ...signals.filter((signal) => evidenceIds.has(signal.evidenceId)).map((signal) => levels[signal.level]));
}

function toConcern(cluster: ReliabilityIssueCluster): ReliabilityConcern {
  const selectionReasons: ReliabilityConcern["selectionReasons"][number][] = [];
  if (isCorroborated(cluster.corroboration)) selectionReasons.push("CORROBORATED");
  if (cluster.complaintCount >= 2) selectionReasons.push("RECURRING");
  if (cluster.seriousSignalCount > 0) selectionReasons.push("SERIOUS_SIGNAL");
  if (componentPriority[cluster.component] > 0) selectionReasons.push("DECISION_RELEVANT_COMPONENT");
  return {
    component: cluster.component,
    complaintCount: cluster.complaintCount,
    recallCount: cluster.recallCount,
    seriousSignalPresent: cluster.seriousSignalCount > 0,
    corroboration: cluster.corroboration,
    confidence: { ...cluster.confidence, basis: [...cluster.confidence.basis] },
    evidenceIds: [...cluster.evidenceIds],
    selectionReasons,
  };
}

function determineConcernLevel(
  interpretation: ReliabilityInterpretation,
  primaryClusters: readonly ReliabilityIssueCluster[],
): ReliabilityConcernLevel {
  if (!interpretation.evidenceAvailable || interpretation.assessmentState === "INSUFFICIENT_EVIDENCE") {
    return "INSUFFICIENT_EVIDENCE";
  }
  if (!primaryClusters.length) return "NO_MEANINGFUL_SIGNAL";
  if (interpretation.assessmentState === "STRONG_NEGATIVE_SIGNAL") return "ELEVATED_CONCERN";
  if (interpretation.assessmentState === "CORROBORATED_PATTERN") return "MEANINGFUL_CONCERN";
  if (
    interpretation.assessmentState === "POTENTIAL_PATTERN"
    && primaryClusters.some((cluster) => cluster.seriousSignalCount > 0)
  ) return "MEANINGFUL_CONCERN";
  return "LIMITED_CONCERN";
}

function buildExplanationFacts(
  interpretation: ReliabilityInterpretation,
  primaryClusters: readonly ReliabilityIssueCluster[],
  exposureAvailability: "AVAILABLE" | "UNAVAILABLE",
  concernLevel: ReliabilityConcernLevel,
): ReliabilityExplanationFact[] {
  const facts: ReliabilityExplanationFact[] = [];
  for (const cluster of primaryClusters) {
    if (cluster.complaintCount >= 2) {
      facts.push(fact(interpretation, "RECURRING_COMPONENT_PATTERN", cluster, cluster.complaintCount, "Repeated records share a normalized component; identical root cause is not established."));
    }
    if (cluster.recallCount > 0 && cluster.complaintCount >= 2) {
      facts.push(fact(interpretation, "CORROBORATED_BY_RECALL", cluster, cluster.recallCount, "Complaint recurrence and official recall evidence overlap at component level."));
    }
    if (cluster.seriousSignalCount > 0) {
      facts.push(fact(interpretation, "SERIOUS_SIGNAL_PRESENT", cluster, cluster.seriousSignalCount, "Crash, fire, injury, death, park-it, or park-outside indicators are preserved from source evidence."));
    }
  }
  facts.push({
    factId: `${interpretation.interpretationId}:applicability`,
    kind: "MODEL_YEAR_APPLICABILITY",
    component: null,
    evidenceIds: uniqueSorted(primaryClusters.flatMap((cluster) => cluster.evidenceIds)),
    value: interpretation.scope,
    qualifier: "Evidence applies to year/make/model scope, not a specific trim, configuration, VIN, or individual vehicle.",
  });
  if (exposureAvailability === "UNAVAILABLE") {
    facts.push({
      factId: `${interpretation.interpretationId}:exposure-unavailable`,
      kind: "EXPOSURE_RATE_UNAVAILABLE",
      component: null,
      evidenceIds: [],
      value: null,
      qualifier: "No trusted vehicle-population denominator is available; no complaint rate or per-1,000-vehicle claim is produced.",
    });
  }
  const complaintIds = uniqueSorted(interpretation.seriousSignals.signals
    .filter((signal) => signal.evidenceType === "COMPLAINT")
    .map((signal) => signal.evidenceId));
  if (complaintIds.length) {
    facts.push({
      factId: `${interpretation.interpretationId}:allegations`,
      kind: "COMPLAINTS_REMAIN_ALLEGATIONS",
      component: null,
      evidenceIds: complaintIds,
      value: complaintIds.length,
      qualifier: "Consumer complaints remain reported allegations unless supported by distinct authoritative evidence.",
    });
  }
  if (concernLevel === "NO_MEANINGFUL_SIGNAL") {
    facts.push({
      factId: `${interpretation.interpretationId}:not-perfect-reliability`,
      kind: "NO_MEANINGFUL_SIGNAL_IS_NOT_PERFECT_RELIABILITY",
      component: null,
      evidenceIds: [],
      value: false,
      qualifier: "No meaningful signal means this evidence set did not support a decision-relevant concern; it does not establish perfect reliability.",
    });
  }
  return facts;
}

function fact(
  interpretation: ReliabilityInterpretation,
  kind: ReliabilityExplanationFact["kind"],
  cluster: ReliabilityIssueCluster,
  value: number,
  qualifier: string,
): ReliabilityExplanationFact {
  return {
    factId: `${interpretation.interpretationId}:${kind.toLowerCase()}:${cluster.component}`,
    kind,
    component: cluster.component,
    evidenceIds: [...cluster.evidenceIds],
    value,
    qualifier,
  };
}

function isCorroborated(state: ReliabilityCorroborationState) {
  return state === "COMPLAINT_PATTERN_WITH_RECALL"
    || state === "COMPLAINT_PATTERN_WITH_INVESTIGATION"
    || state === "MULTIPLE_AUTHORITATIVE_EVIDENCE_TYPES";
}

function validateInput(interpretation: ReliabilityInterpretation, vehicle: VehicleDefectIdentity) {
  if (interpretation.vehicleId !== vehicle.vehicleId) {
    throw new Error(`Reliability interpretation vehicleId ${interpretation.vehicleId} does not match ${vehicle.vehicleId}.`);
  }
  if (interpretation.scope !== "model_year" || interpretation.applicability.scope !== "model_year") {
    throw new Error("Reliability risk assessment currently supports model-year interpretations only.");
  }
}

function validateProviderResult(providerId: string, resultVehicleId: string, expectedVehicleId: string) {
  if (resultVehicleId !== expectedVehicleId) {
    throw new Error(`Vehicle exposure provider ${providerId} returned a result for ${resultVehicleId}, expected ${expectedVehicleId}.`);
  }
}

function uniqueSorted<T extends string>(values: readonly T[]) {
  return [...new Set(values)].sort();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
