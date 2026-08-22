import { buildDecisionReport, runCandidatePipeline } from "../../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../../types/buyer";
import type { CanonicalDatum, CanonicalVehicleFieldPath, CanonicalVehicleRecord } from "../../types/canonicalVehicle";
import type { PublishedVehicleIntelligenceRecord } from "../../types/publishedVehicleIntelligence";
import type {
  LegacyCVREvidenceClassification,
  ShadowEvidenceComparison,
  ShadowRecommendationReadinessComparison,
  ShadowReadinessLevel,
  ShadowRequirementEvaluation,
  ShadowVehicleReadinessComparison,
} from "../../types/shadowRecommendationReadiness";
import type { Vehicle, RecommendationObject } from "../../types/vehicle";
import type { VehicleDecisionDimension, VehicleDecisionDimensionEvaluation } from "../../types/vehicleFieldPolicy";
import { evaluateVehicleDecisionReadiness, getVehicleDecisionDimensionRequirements } from "./vehicle-decision-relevance";

export const shadowRecommendationReadinessVersion = "1.0.0" as const;

type ShadowEvaluationInput = Readonly<{
  buyerProfileId: string;
  buyerProfile: BuyerProfile;
  catalog: readonly Vehicle[];
  publications: readonly PublishedVehicleIntelligenceRecord[];
}>;

const scoringDimensionByCategory: Record<keyof ScoreWeights, VehicleDecisionDimension> = {
  affordability: "affordability",
  reliability: "reliability",
  safety: "safety",
  fuelEnergyCost: "fuelEnergyCost",
  insuranceCost: "insuranceCost",
  maintenanceRisk: "maintenanceRisk",
  practicality: "practicality",
  resaleValue: "resaleValue",
  drivingPreferenceFit: "performance",
};

const legacyDirectDimensions = new Set<VehicleDecisionDimension>([
  "purchaseBudget", "monthlyPayment", "totalOwnershipBudget", "affordability",
  "maintenanceRisk", "insuranceCost", "fuelEnergyCost", "fuelEconomy", "resaleValue",
  "reliability", "safety", "performance", "make", "model", "bodyStyle", "fuelType",
  "drivetrain", "transmission", "seating", "modelYear", "mileage", "condition", "practicality",
]);

export function evaluateShadowRecommendationReadiness(
  input: ShadowEvaluationInput,
): ShadowRecommendationReadinessComparison {
  const profileBefore = stableValue(input.buyerProfile);
  const publicationsBefore = stableValue(input.publications);
  const pipeline = runCandidatePipeline(clone(input.buyerProfile), clone([...input.catalog]), {
    includeCompromises: true,
    includeExcluded: true,
  });
  const allRecommendations = [
    ...pipeline.decisionSet.primaryRecommendations,
    ...pipeline.decisionSet.compromiseRecommendations,
    ...pipeline.decisionSet.excludedRecommendations,
  ];
  const recommendationsByVehicle = new Map(allRecommendations.map((item) => [item.vehicleId, item]));
  const catalogByVehicle = new Map(input.catalog.map((item) => [item.id, item]));

  const vehicleComparisons = [...input.publications]
    .filter((publication) => publication.publicationStatus === "active")
    .sort((left, right) => left.vehicleId.localeCompare(right.vehicleId))
    .map((publication) => compareVehicle(
      input.buyerProfile,
      publication,
      catalogByVehicle.get(publication.vehicleId),
      recommendationsByVehicle.get(publication.vehicleId),
    ));

  if (stableValue(input.buyerProfile) !== profileBefore) throw new Error("Shadow evaluation mutated BuyerProfile.");
  if (stableValue(input.publications) !== publicationsBefore) throw new Error("Shadow evaluation mutated a Published CVR.");

  const primary = pipeline.decisionSet.primaryRecommendations;
  const materialMissing = unique(vehicleComparisons.flatMap((item) => item.decisionReadiness.disclosureRequirements
    .filter((disclosure) => disclosure.level === "REQUIRED")
    .map((disclosure) => disclosure.dimension)));
  const summary = {
    vehicleCount: vehicleComparisons.length,
    averageDecisionCoverage: average(vehicleComparisons.map((item) => item.decisionCoverage)),
    readinessCounts: countReadiness(vehicleComparisons),
    unsupportedRequiredDimensions: unique(vehicleComparisons.flatMap((item) => item.unsupportedRequiredDimensions)),
    materialMissingDimensions: materialMissing,
    disclosureRequiredCount: vehicleComparisons.filter((item) => item.disclosureRequirements.length > 0).length,
  };

  return deepFreeze({
    evaluationMode: "shadow_capability_only",
    buyerProfileId: input.buyerProfileId,
    buyerProfile: clone(input.buyerProfile),
    legacyResult: {
      catalogCount: pipeline.pipelineDebug.catalogCount,
      candidateCount: pipeline.pipelineDebug.candidateCount,
      qualifiedCount: pipeline.pipelineDebug.qualifiedCount,
      compromiseCount: pipeline.pipelineDebug.compromiseCount,
      excludedCount: pipeline.pipelineDebug.excludedCount,
      winner: primary[0] ? clone(primary[0]) : null,
      runnerUp: primary[1] ? clone(primary[1]) : null,
      decisionReport: buildDecisionReport(pipeline.decisionSet),
    },
    vehicleComparisons,
    summary,
    rankingProduced: false,
    productionRecommendationMutated: false,
  });
}

function compareVehicle(
  profile: BuyerProfile,
  publication: PublishedVehicleIntelligenceRecord,
  legacyVehicle: Vehicle | undefined,
  legacyRecommendation: RecommendationObject | undefined,
): ShadowVehicleReadinessComparison {
  const cvr = publication.canonicalRecord;
  const decisionReadiness = evaluateVehicleDecisionReadiness(profile, cvr);
  const requirementEvaluations = evaluateRequirements(profile, cvr, decisionReadiness.relevantDimensions);
  const unsupportedRequiredDimensions = requirementEvaluations
    .filter((item) => item.status === "EVIDENCE_UNAVAILABLE")
    .map((item) => item.dimension);
  const failedRequiredDimensions = requirementEvaluations
    .filter((item) => item.status === "FAILED")
    .map((item) => item.dimension);
  const legacyDimensionsCurrentlyUsed = decisionReadiness.relevantDimensions
    .filter((item) => legacyUsesDimension(item.dimension, legacyVehicle, legacyRecommendation))
    .map((item) => item.dimension);
  const legacyDimensionsUnsupportedByCVR = legacyDimensionsCurrentlyUsed
    .filter((dimension) => decisionReadiness.unsupportedDimensions.includes(dimension));
  const trustedCVRDimensionsUnusedByLegacy = getTrustedCVRDimensions(cvr)
    .filter((dimension) => !legacyDirectDimensions.has(dimension));
  const evidenceComparisons = decisionReadiness.relevantDimensions.map((evaluation) => compareEvidence(
    evaluation,
    legacyUsesDimension(evaluation.dimension, legacyVehicle, legacyRecommendation),
    legacyVehicle,
    cvr,
  ));
  const readiness = classifyReadiness(
    decisionReadiness.decisionCoverage,
    unsupportedRequiredDimensions,
    failedRequiredDimensions,
    decisionReadiness.relevantDimensions,
  );
  const make = getDatumValue(cvr, "identity.make") ?? "Unknown make";
  const model = getDatumValue(cvr, "identity.model") ?? "Unknown model";
  const year = getDatumValue(cvr, "identity.modelYear") ?? "Unknown year";
  const diagnostics = [
    ...unsupportedRequiredDimensions.map((dimension) => `${dimension}: required evidence unavailable; qualification cannot be established.`),
    ...failedRequiredDimensions.map((dimension) => `${dimension}: trusted evidence does not satisfy the requirement.`),
    ...decisionReadiness.staleRelevantDimensions.map((dimension) => `${dimension}: relevant evidence is stale and excluded from decision support.`),
    ...decisionReadiness.conflictedRelevantDimensions.map((dimension) => `${dimension}: relevant evidence is conflicted and excluded from decision support.`),
    ...legacyDimensionsUnsupportedByCVR.map((dimension) => `${dimension}: legacy logic uses this dimension, but the CVR does not yet verify it.`),
  ];

  return {
    vehicleId: publication.vehicleId,
    vehicleLabel: `${year} ${make} ${model}`,
    publishedCVRVersion: publication.recordVersion,
    publicationFingerprint: publication.fingerprint,
    decisionReadiness,
    readiness,
    relevantDimensions: decisionReadiness.relevantDimensions.map((item) => item.dimension),
    supportedDimensions: decisionReadiness.supportedDimensions,
    unsupportedDimensions: decisionReadiness.unsupportedDimensions,
    unsupportedRequiredDimensions: unique(unsupportedRequiredDimensions),
    failedRequiredDimensions: unique(failedRequiredDimensions),
    staleRelevantDimensions: decisionReadiness.staleRelevantDimensions,
    conflictedRelevantDimensions: decisionReadiness.conflictedRelevantDimensions,
    disclosureRequirements: decisionReadiness.disclosureRequirements,
    decisionCoverage: decisionReadiness.decisionCoverage,
    legacyDimensionsCurrentlyUsed,
    legacyDimensionsUnsupportedByCVR,
    trustedCVRDimensionsUnusedByLegacy,
    potentialConfidenceImpact: decisionReadiness.confidenceImpact,
    requirementEvaluations,
    evidenceComparisons,
    diagnostics: unique(diagnostics),
  };
}

function classifyReadiness(
  coverage: number,
  unsupportedRequired: VehicleDecisionDimension[],
  failedRequired: VehicleDecisionDimension[],
  dimensions: VehicleDecisionDimensionEvaluation[],
): ShadowReadinessLevel {
  if (unsupportedRequired.length || failedRequired.length) return "BLOCKED";
  if (coverage >= 85 && !dimensions.some((item) => item.materiality === "IMPORTANT" && !item.scoreEligible)) return "READY";
  if (coverage >= 50) return "PARTIALLY_READY";
  return "INSUFFICIENT";
}

function evaluateRequirements(
  profile: BuyerProfile,
  cvr: CanonicalVehicleRecord,
  dimensions: VehicleDecisionDimensionEvaluation[],
): ShadowRequirementEvaluation[] {
  return dimensions
    .filter((item) => item.participation === "enforced")
    .map((item) => evaluateRequirement(profile, cvr, item));
}

function evaluateRequirement(
  profile: BuyerProfile,
  cvr: CanonicalVehicleRecord,
  evaluation: VehicleDecisionDimensionEvaluation,
): ShadowRequirementEvaluation {
  const requiredValue = getRequiredValue(profile, evaluation.dimension);
  if (!evaluation.scoreEligible) {
    return { dimension: evaluation.dimension, requiredValue, actualValue: null, evidenceAvailable: false, status: "EVIDENCE_UNAVAILABLE", reason: "Trusted CVR evidence is unavailable, so qualification cannot be established." };
  }
  const actualValue = getActualValue(cvr, evaluation.dimension);
  const passed = requirementPasses(evaluation.dimension, requiredValue, actualValue);
  return {
    dimension: evaluation.dimension,
    requiredValue,
    actualValue,
    evidenceAvailable: true,
    status: passed ? "PASSED" : "FAILED",
    reason: passed ? "Trusted CVR evidence satisfies the requirement." : "Trusted CVR evidence does not satisfy the requirement.",
  };
}

function getRequiredValue(profile: BuyerProfile, dimension: VehicleDecisionDimension): unknown {
  if (dimension === "make") return profile.requiredMakes?.length ? profile.requiredMakes : profile.requiredMake;
  if (dimension === "bodyStyle") return profile.requiredBodyStyles?.length ? profile.requiredBodyStyles : profile.bodyStyle;
  if (dimension === "vehicleCategory") return profile.requiredVehicleCategories;
  if (dimension === "fuelType") return profile.requiredFuelTypes?.length ? profile.requiredFuelTypes : profile.requiredFuelType;
  if (dimension === "drivetrain") return profile.requiredDrivetrains?.length ? profile.requiredDrivetrains : profile.drivetrainPreference;
  if (dimension === "transmission") return profile.requiredTransmissions?.length ? profile.requiredTransmissions : profile.transmissionPreference;
  if (dimension === "modelYear") return profile.minYear;
  if (dimension === "mileage") return profile.maxMileage;
  if (dimension === "purchaseBudget") return profile.maxPurchaseBudget;
  if (dimension === "monthlyPayment") return profile.monthlyBudget;
  if (dimension === "reliability") return profile.reliabilityMinimum;
  if (dimension === "safety") return profile.safetyMinimum;
  if (dimension === "performance") return profile.performanceMinimum;
  return null;
}

function getActualValue(cvr: CanonicalVehicleRecord, dimension: VehicleDecisionDimension): unknown {
  const paths = getVehicleDecisionDimensionRequirements()[dimension].fields;
  const values = paths.map((path) => getDatumValue(cvr, path)).filter((value) => value !== null && value !== undefined);
  return values.length === 1 ? values[0] : values;
}

function requirementPasses(dimension: VehicleDecisionDimension, required: unknown, actual: unknown) {
  if (required === null || required === undefined || required === "any") return true;
  if (dimension === "modelYear") return Number(actual) >= Number(required);
  if (dimension === "mileage" || dimension === "purchaseBudget" || dimension === "monthlyPayment") return Number(actual) <= Number(required);
  if (dimension === "reliability" || dimension === "safety" || dimension === "performance") {
    const values = Array.isArray(actual) ? actual.map(Number).filter(Number.isFinite) : [Number(actual)];
    return values.length > 0 && Math.max(...values) >= Number(required);
  }
  const requiredValues = (Array.isArray(required) ? required : [required]).map(normalizeComparable);
  const actualValues = (Array.isArray(actual) ? actual : [actual]).map(normalizeComparable);
  return actualValues.some((value) => requiredValues.includes(value));
}

function compareEvidence(
  evaluation: VehicleDecisionDimensionEvaluation,
  legacyUsed: boolean,
  legacyVehicle: Vehicle | undefined,
  cvr: CanonicalVehicleRecord,
): ShadowEvidenceComparison {
  const cvrSupported = evaluation.scoreEligible;
  const classification = classifyEvidence(evaluation, legacyUsed, legacyVehicle, cvr);
  return {
    dimension: evaluation.dimension,
    classification,
    legacyUsed,
    cvrSupported,
    fieldPaths: evaluation.fieldEvaluations.map((item) => item.fieldPath),
    reason: evidenceReason(classification),
  };
}

function classifyEvidence(
  evaluation: VehicleDecisionDimensionEvaluation,
  legacyUsed: boolean,
  legacyVehicle: Vehicle | undefined,
  cvr: CanonicalVehicleRecord,
): LegacyCVREvidenceClassification {
  if (evaluation.fieldEvaluations.some((field) => field.availability === "CONFLICTED")) return "CVR_CONFLICTED";
  if (evaluation.fieldEvaluations.some((field) => field.availability === "STALE")) return "CVR_STALE";
  if (evaluation.dimension === "fuelEconomy" && legacyVehicle) {
    const datum = getDatum(cvr, "environment.fuelEconomy");
    if (datum?.value !== null && datum?.unit !== "mpg" && legacyVehicle.mpg > 0) return "DIFFERENT_SEMANTICS";
  }
  if (legacyUsed && evaluation.scoreEligible) return isMoreSpecific(evaluation.dimension, legacyVehicle, cvr) ? "CVR_MORE_SPECIFIC" : "LEGACY_SUPPORTED_BY_CVR";
  if (legacyUsed && !evaluation.scoreEligible) return "LEGACY_NOT_YET_VERIFIED";
  if (!legacyUsed && evaluation.scoreEligible) return "CVR_MORE_SPECIFIC";
  return "CVR_MISSING";
}

function isMoreSpecific(dimension: VehicleDecisionDimension, legacyVehicle: Vehicle | undefined, cvr: CanonicalVehicleRecord) {
  if (!legacyVehicle) return true;
  if (dimension === "transmission") return normalizeComparable(getDatumValue(cvr, "identity.transmission")) !== normalizeComparable(legacyVehicle.transmission);
  if (dimension === "model") return normalizeComparable(getDatumValue(cvr, "identity.model")) !== normalizeComparable(legacyVehicle.model);
  return false;
}

function evidenceReason(classification: LegacyCVREvidenceClassification) {
  return ({
    LEGACY_SUPPORTED_BY_CVR: "The legacy dimension has corresponding trusted CVR evidence.",
    LEGACY_NOT_YET_VERIFIED: "Legacy logic uses the dimension, but trusted CVR support is not yet available.",
    CVR_MORE_SPECIFIC: "The CVR provides trusted detail beyond the legacy field or capability.",
    CVR_MISSING: "The CVR has no decision-eligible evidence for this dimension.",
    CVR_STALE: "Relevant CVR evidence is stale and excluded from decision support.",
    CVR_CONFLICTED: "Relevant CVR evidence conflicts and is excluded from decision support.",
    DIFFERENT_SEMANTICS: "The CVR and legacy field use materially different units or meanings.",
    NOT_RELEVANT_TO_BUYER: "The dimension does not participate for this buyer.",
  } as const)[classification];
}

function legacyUsesDimension(
  dimension: VehicleDecisionDimension,
  vehicle: Vehicle | undefined,
  recommendation: RecommendationObject | undefined,
) {
  if (!vehicle || !recommendation || !legacyDirectDimensions.has(dimension)) return false;
  const category = (Object.entries(scoringDimensionByCategory) as [keyof ScoreWeights, VehicleDecisionDimension][])
    .find(([, mapped]) => mapped === dimension)?.[0];
  if (category) return recommendation.scoreContributions.some((item) => item.category === category && item.affectedRanking);
  if (dimension === "fuelEconomy") return vehicle.mpg > 0;
  return true;
}

function getTrustedCVRDimensions(cvr: CanonicalVehicleRecord) {
  const requirements = getVehicleDecisionDimensionRequirements();
  return (Object.entries(requirements) as [VehicleDecisionDimension, { fields: CanonicalVehicleFieldPath[]; minimumEligibleFields: number }][])
    .filter(([, requirement]) => requirement.fields.filter((path) => isTrusted(getDatum(cvr, path))).length >= requirement.minimumEligibleFields)
    .map(([dimension]) => dimension);
}

function isTrusted(datum: CanonicalDatum<unknown> | undefined) {
  return Boolean(datum && datum.value !== null && datum.evidenceIds.length && datum.confidence.score !== null && datum.confidence.level !== "unknown" && datum.missingReason !== "stale" && datum.missingReason !== "source_conflict");
}

function getDatum(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath): CanonicalDatum<unknown> | undefined {
  const [section, field] = path.split(".");
  return (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section]?.[field];
}

function getDatumValue(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath) {
  return getDatum(record, path)?.value ?? null;
}

function normalizeComparable(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function countReadiness(items: ShadowVehicleReadinessComparison[]) {
  const counts: Record<ShadowReadinessLevel, number> = { READY: 0, PARTIALLY_READY: 0, INSUFFICIENT: 0, BLOCKED: 0 };
  for (const item of items) counts[item.readiness] += 1;
  return counts;
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function unique<Value extends string>(values: Value[]) {
  return [...new Set(values)].sort();
}

function stableValue(value: unknown) {
  return JSON.stringify(value);
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
