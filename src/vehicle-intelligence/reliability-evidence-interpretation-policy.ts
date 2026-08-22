import type {
  DefectComponentCategory,
  DefectEvidenceType,
  VehicleDefectEvidenceEvent,
  VehicleReliabilityEvidenceSnapshot,
} from "../../types/nhtsaReliabilityEvidence";
import type {
  ReliabilityAssessmentState,
  ReliabilityCorroborationState,
  ReliabilityInterpretation,
  ReliabilityInterpretationConfidenceLevel,
  ReliabilityIssueCluster,
  ReliabilitySeveritySignal,
  ReliabilitySignalLevel,
} from "../../types/reliabilityInterpretation";

export const reliabilityEvidenceInterpretationPolicyVersion = "1.0.0" as const;

export function interpretReliabilityEvidence(
  snapshot: VehicleReliabilityEvidenceSnapshot,
): ReliabilityInterpretation {
  const events = [...snapshot.recalls, ...snapshot.complaints];
  const severitySignals = events.map(classifySeveritySignal);
  const severityByEvidenceId = new Map(severitySignals.map((signal) => [signal.evidenceId, signal]));
  const issueClusters = buildIssueClusters(events, severityByEvidenceId);
  const corroboration = summarizeCorroboration(issueClusters);
  const exposureContext = createExposureContext(snapshot);
  const applicability = createApplicability(snapshot, events);
  const assessmentState = determineAssessmentState(issueClusters, severitySignals, events.length > 0);
  const confidence = determineConfidence(snapshot, issueClusters, corroboration.state, applicability.confidence, exposureContext.state);
  const limitations = uniqueSorted([
    ...snapshot.limitations,
    "Component-level clustering indicates related vehicle systems, not proof that records describe one mechanical defect.",
    "Repeated complaints remain repeated allegations unless corroborated by a distinct authoritative evidence type.",
    "No reliability score or comparative rank is produced by this interpretation policy.",
    ...(snapshot.evidenceCoverage.investigations === "UNSUPPORTED" ? ["Investigation evidence is unavailable to the automated pipeline."] : []),
    ...(snapshot.evidenceCoverage.manufacturerCommunications === "UNSUPPORTED" ? ["Manufacturer-communication evidence is unavailable to the automated pipeline."] : []),
    ...(!exposureContext.complaintRateAvailable ? ["Exposure-adjusted complaint rate is unavailable."] : []),
  ]);

  return deepFreeze({
    schemaVersion: "1.0.0",
    policyVersion: reliabilityEvidenceInterpretationPolicyVersion,
    interpretationId: `reliability-interpretation:${stableHash(snapshot.snapshotId)}:${reliabilityEvidenceInterpretationPolicyVersion}`,
    vehicleId: snapshot.vehicle.vehicleId,
    generatedAt: snapshot.generatedAt,
    sourceSnapshotId: snapshot.snapshotId,
    scope: "model_year",
    evidenceAvailable: events.length > 0,
    issueClusters,
    seriousSignals: summarizeSeveritySignals(severitySignals),
    corroboration,
    exposureContext,
    applicability,
    limitations,
    confidence,
    assessmentState,
    reliabilityScore: null,
    comparativeRank: null,
    productionRecommendationConnected: false,
  });
}

export function classifyReliabilitySeverity(
  event: VehicleDefectEvidenceEvent,
): ReliabilitySeveritySignal {
  return classifySeveritySignal(event);
}

function classifySeveritySignal(event: VehicleDefectEvidenceEvent): ReliabilitySeveritySignal {
  const reasons: string[] = [];
  let level: ReliabilitySignalLevel;
  if (event.severity.deaths > 0 || event.severity.parkIt) {
    level = "CRITICAL_SIGNAL";
    if (event.severity.deaths > 0) reasons.push(`${event.severity.deaths} death(s) explicitly reported.`);
    if (event.severity.parkIt) reasons.push("Official recall includes a stop-driving/park-it instruction.");
  } else if (event.severity.injuries > 0 || event.severity.fireReported || event.severity.crashReported || event.severity.parkOutside) {
    level = "SERIOUS_SIGNAL";
    if (event.severity.injuries > 0) reasons.push(`${event.severity.injuries} injury/injuries explicitly reported.`);
    if (event.severity.fireReported) reasons.push("Fire was explicitly reported.");
    if (event.severity.crashReported) reasons.push("Crash was explicitly reported.");
    if (event.severity.parkOutside) reasons.push("Official recall includes a park-outside instruction.");
  } else if (event.evidenceType === "RECALL") {
    level = "MATERIAL_SIGNAL";
    reasons.push("An official NHTSA safety recall campaign exists for this model-year scope.");
  } else if (event.evidenceType === "COMPLAINT") {
    level = "LIMITED_SIGNAL";
    reasons.push("A consumer allegation exists without an explicit crash, fire, injury, or death indicator.");
  } else {
    level = "UNKNOWN";
    reasons.push("No deterministic severity indicator is available.");
  }
  return {
    evidenceId: event.evidenceId,
    evidenceType: event.evidenceType,
    components: event.normalizedComponents,
    level,
    reasons,
    allegation: event.assertionStatus === "REPORTED_ALLEGATION",
  };
}

function buildIssueClusters(
  events: readonly VehicleDefectEvidenceEvent[],
  severityByEvidenceId: ReadonlyMap<string, ReliabilitySeveritySignal>,
) {
  const components = new Set(events.flatMap((event) => event.normalizedComponents));
  return [...components].map((component) => {
    const clusterEvents = events.filter((event) => event.normalizedComponents.includes(component));
    const complaints = clusterEvents.filter((event) => event.evidenceType === "COMPLAINT");
    const recalls = clusterEvents.filter((event) => event.evidenceType === "RECALL");
    const corroboration = component === "unknown_other"
      ? determineAmbiguousClusterCorroboration(complaints.length, recalls.length)
      : determineClusterCorroboration(complaints.length, recalls.length, 0, 0);
    const dates = sourceDateRange(clusterEvents);
    const confidence = clusterConfidence(corroboration, clusterEvents.length);
    return {
      component,
      complaintCount: complaints.length,
      recallCount: recalls.length,
      investigationCount: 0,
      manufacturerCommunicationCount: 0,
      seriousSignalCount: clusterEvents.filter((event) => {
        const level = severityByEvidenceId.get(event.evidenceId)?.level;
        return level === "CRITICAL_SIGNAL" || level === "SERIOUS_SIGNAL";
      }).length,
      evidenceIds: clusterEvents.map((event) => event.evidenceId).sort(),
      sourceTypes: uniqueSorted(clusterEvents.map((event) => event.evidenceType)) as DefectEvidenceType[],
      firstEvidenceDate: dates.first,
      lastEvidenceDate: dates.last,
      corroboration,
      sameDefectConfirmed: false,
      confidence,
    } satisfies ReliabilityIssueCluster;
  }).sort(compareClusters);
}

function determineClusterCorroboration(
  complaintCount: number,
  recallCount: number,
  investigationCount: number,
  communicationCount: number,
): ReliabilityCorroborationState {
  const authoritativeTypes = Number(recallCount > 0) + Number(investigationCount > 0) + Number(communicationCount > 0);
  if (authoritativeTypes >= 2) return "MULTIPLE_AUTHORITATIVE_EVIDENCE_TYPES";
  if (complaintCount >= 2 && investigationCount > 0) return "COMPLAINT_PATTERN_WITH_INVESTIGATION";
  if (complaintCount >= 2 && recallCount > 0) return "COMPLAINT_PATTERN_WITH_RECALL";
  if (complaintCount >= 2) return "REPEATED_ALLEGATIONS";
  if (complaintCount === 1 && recallCount === 0 && investigationCount === 0 && communicationCount === 0) return "ISOLATED_ALLEGATION";
  if (recallCount > 0 || investigationCount > 0 || communicationCount > 0) return "OFFICIAL_RECORD_ONLY";
  return "NONE";
}

function determineAmbiguousClusterCorroboration(
  complaintCount: number,
  recallCount: number,
): ReliabilityCorroborationState {
  if (complaintCount >= 2) return "REPEATED_ALLEGATIONS";
  if (complaintCount === 1) return "ISOLATED_ALLEGATION";
  if (recallCount > 0) return "OFFICIAL_RECORD_ONLY";
  return "NONE";
}

function determineAssessmentState(
  clusters: readonly ReliabilityIssueCluster[],
  signals: readonly ReliabilitySeveritySignal[],
  evidenceAvailable: boolean,
): ReliabilityAssessmentState {
  if (!evidenceAvailable) return "INSUFFICIENT_EVIDENCE";
  const corroborated = clusters.filter((cluster) => isCorroborated(cluster.corroboration));
  const criticalIds = new Set(signals.filter((signal) => signal.level === "CRITICAL_SIGNAL").map((signal) => signal.evidenceId));
  const corroboratedCritical = corroborated.some((cluster) => cluster.evidenceIds.some((id) => criticalIds.has(id)));
  if (corroboratedCritical) return "STRONG_NEGATIVE_SIGNAL";
  if (corroborated.length) return "CORROBORATED_PATTERN";
  const repeatedNonUnknown = clusters.some((cluster) => cluster.component !== "unknown_other" && cluster.corroboration === "REPEATED_ALLEGATIONS");
  if (repeatedNonUnknown) return "POTENTIAL_PATTERN";
  return "EVIDENCE_AVAILABLE";
}

function summarizeCorroboration(clusters: readonly ReliabilityIssueCluster[]) {
  const strength: Record<ReliabilityCorroborationState, number> = {
    NONE: 0,
    ISOLATED_ALLEGATION: 1,
    OFFICIAL_RECORD_ONLY: 2,
    REPEATED_ALLEGATIONS: 3,
    COMPLAINT_PATTERN_WITH_RECALL: 4,
    COMPLAINT_PATTERN_WITH_INVESTIGATION: 5,
    MULTIPLE_AUTHORITATIVE_EVIDENCE_TYPES: 6,
  };
  const strongest = Math.max(0, ...clusters.map((cluster) => strength[cluster.corroboration]));
  const state = (Object.entries(strength).find(([, value]) => value === strongest)?.[0] ?? "NONE") as ReliabilityCorroborationState;
  const strongestComponents = clusters.filter((cluster) => strength[cluster.corroboration] === strongest).map((cluster) => cluster.component).sort();
  const basis = state === "NONE"
    ? ["No interpretable defect evidence is available."]
    : [
        `Strongest component-level corroboration state: ${state}.`,
        "Component agreement does not establish that records describe one identical defect.",
      ];
  return { state, strongestComponents, basis };
}

function createExposureContext(snapshot: VehicleReliabilityEvidenceSnapshot) {
  const generatedYear = new Date(snapshot.generatedAt).getUTCFullYear();
  const modelAgeYears = Number.isFinite(generatedYear) ? Math.max(0, generatedYear - snapshot.vehicle.modelYear) : null;
  return {
    state: modelAgeYears === null ? "UNKNOWN" as const : "PARTIAL" as const,
    vehiclePopulation: null,
    salesVolume: null,
    mileageDistribution: null,
    timeOnRoadYears: modelAgeYears,
    reportingBehaviorAdjustment: null,
    complaintRateAvailable: false as const,
    complaintRate: null,
    basis: [
      modelAgeYears === null ? "Model age could not be derived." : `Model age proxy is ${modelAgeYears} year(s) from model year to snapshot year.`,
      "Vehicle population, sales volume, mileage distribution, and reporting-behavior adjustment are unavailable.",
      `${snapshot.complaints.length} complaint record(s) observed; exposure-adjusted complaint rate unavailable.`,
    ],
  };
}

function createApplicability(
  snapshot: VehicleReliabilityEvidenceSnapshot,
  events: readonly VehicleDefectEvidenceEvent[],
) {
  if (!events.length) {
    return {
      scope: "model_year" as const,
      confidence: "UNKNOWN" as const,
      configurationSpecific: false as const,
      vinSpecific: false as const,
      basis: ["No defect event is available for applicability interpretation."],
    };
  }
  const allModelYear = events.every((event) => event.sourceScope === "model_year");
  return {
    scope: "model_year" as const,
    confidence: allModelYear ? "MEDIUM" as const : "LOW" as const,
    configurationSpecific: false as const,
    vinSpecific: false as const,
    basis: [
      `Evidence was retrieved for ${snapshot.vehicle.modelYear} ${snapshot.vehicle.make} ${snapshot.vehicle.model}.`,
      "Year/make/model evidence does not establish trim, engine, drivetrain, configuration, or VIN applicability.",
    ],
  };
}

function determineConfidence(
  snapshot: VehicleReliabilityEvidenceSnapshot,
  clusters: readonly ReliabilityIssueCluster[],
  corroboration: ReliabilityCorroborationState,
  applicability: "MEDIUM" | "LOW" | "UNKNOWN",
  exposure: "KNOWN" | "PARTIAL" | "UNKNOWN",
) {
  const sourceTypes = new Set([...snapshot.recalls, ...snapshot.complaints].map((event) => event.evidenceType));
  const evidenceCompleteness = snapshot.evidenceCoverage.recalls !== "SOURCE_FAILURE" && snapshot.evidenceCoverage.complaints !== "SOURCE_FAILURE"
    ? "PARTIAL" as const
    : clusters.length ? "LIMITED" as const : "NONE" as const;
  let level: ReliabilityInterpretationConfidenceLevel = "UNKNOWN";
  if (clusters.length && isCorroborated(corroboration) && applicability === "MEDIUM") level = "MEDIUM";
  else if (clusters.length) level = "LOW";
  return {
    level,
    evidenceCompleteness,
    sourceDiversity: sourceTypes.size,
    corroboration,
    applicability,
    exposure,
    basis: [
      `Interpretation uses ${sourceTypes.size} observed evidence type(s).`,
      `Applicability confidence is ${applicability}; exposure context is ${exposure}.`,
      snapshot.evidenceCoverage.investigations === "UNSUPPORTED" && snapshot.evidenceCoverage.manufacturerCommunications === "UNSUPPORTED"
        ? "Investigation and manufacturer-communication acquisition are unavailable, limiting source completeness."
        : "Additional authoritative source coverage is available.",
      "Confidence describes confidence in the interpretation, not vehicle reliability quality.",
    ],
  };
}

function clusterConfidence(corroboration: ReliabilityCorroborationState, eventCount: number) {
  const level: ReliabilityInterpretationConfidenceLevel = isCorroborated(corroboration)
    ? "MEDIUM"
    : eventCount > 0 ? "LOW" : "UNKNOWN";
  return {
    level,
    basis: [
      `Component cluster contains ${eventCount} source record(s).`,
      `Corroboration is ${corroboration}.`,
      "Confidence is limited to component-level recurrence; identical root cause is not established.",
    ],
  };
}

function summarizeSeveritySignals(signals: readonly ReliabilitySeveritySignal[]) {
  return {
    signals,
    criticalCount: countLevel(signals, "CRITICAL_SIGNAL"),
    seriousCount: countLevel(signals, "SERIOUS_SIGNAL"),
    materialCount: countLevel(signals, "MATERIAL_SIGNAL"),
    limitedCount: countLevel(signals, "LIMITED_SIGNAL"),
    unknownCount: countLevel(signals, "UNKNOWN"),
  };
}

function countLevel(signals: readonly ReliabilitySeveritySignal[], level: ReliabilitySignalLevel) {
  return signals.filter((signal) => signal.level === level).length;
}

function sourceDateRange(events: readonly VehicleDefectEvidenceEvent[]) {
  const dated = events.flatMap((event) => {
    if (!event.sourceDate) return [];
    const timestamp = parseSourceDate(event.sourceDate);
    return timestamp === null ? [] : [{ value: event.sourceDate, timestamp }];
  }).sort((left, right) => left.timestamp - right.timestamp);
  return { first: dated[0]?.value ?? null, last: dated.at(-1)?.value ?? null };
}

function parseSourceDate(value: string) {
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  const timestamp = Date.parse(us ? `${us[3]}-${us[1]}-${us[2]}T00:00:00.000Z` : value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isCorroborated(state: ReliabilityCorroborationState) {
  return state === "COMPLAINT_PATTERN_WITH_RECALL"
    || state === "COMPLAINT_PATTERN_WITH_INVESTIGATION"
    || state === "MULTIPLE_AUTHORITATIVE_EVIDENCE_TYPES";
}

function compareClusters(left: ReliabilityIssueCluster, right: ReliabilityIssueCluster) {
  const leftEvidence = left.complaintCount + left.recallCount + left.investigationCount + left.manufacturerCommunicationCount;
  const rightEvidence = right.complaintCount + right.recallCount + right.investigationCount + right.manufacturerCommunicationCount;
  return rightEvidence - leftEvidence || left.component.localeCompare(right.component);
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
