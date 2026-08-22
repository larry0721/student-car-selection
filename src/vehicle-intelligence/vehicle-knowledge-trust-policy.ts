import type {
  CanonicalConfidence,
  CanonicalEvidence,
  CanonicalEvidenceNormalizationMethod,
  CanonicalRecordScope,
  CanonicalSourceType,
  CanonicalVehicleFieldPath,
} from "../../types/canonicalVehicle";
import type {
  VehicleKnowledgeConflictState,
  VehicleKnowledgeReviewContext,
  VehicleKnowledgeTrustAssessment,
} from "../../types/vehicleKnowledge";

export const vehicleKnowledgeTrustPolicyVersion = "1.0.0" as const;

type TrustEvaluationInput = {
  canonicalFieldPath: CanonicalVehicleFieldPath;
  sourceType: CanonicalSourceType;
  evidence: readonly CanonicalEvidence[];
  confidence: CanonicalConfidence;
  recordScope: CanonicalRecordScope;
  normalizationMethod: CanonicalEvidenceNormalizationMethod;
  observedAt: string | null;
  retrievedAt: string;
  reviewContext: VehicleKnowledgeReviewContext | null;
  conflictState?: VehicleKnowledgeConflictState;
  agreeingIndependentSourceCount?: number;
  asOf: string;
};

const staticIdentityFields = new Set<CanonicalVehicleFieldPath>([
  "identity.make",
  "identity.model",
  "identity.generation",
  "identity.trim",
  "identity.modelYear",
  "identity.bodyStyle",
  "identity.vehicleCategory",
  "identity.drivetrain",
  "identity.transmission",
  "identity.fuelType",
]);

const freshnessWindowsDays: Partial<Record<CanonicalVehicleFieldPath, number>> = {
  "financial.purchasePrice": 30,
  "financial.monthlyPayment": 30,
  "financial.totalOwnershipCost": 180,
  "financial.maintenanceCost": 365,
  "financial.insuranceCost": 180,
  "financial.depreciation": 365,
  "financial.fuelEnergyCost": 365,
};

export function evaluateVehicleKnowledgeTrust(input: TrustEvaluationInput): VehicleKnowledgeTrustAssessment {
  const assessedAt = requireDate(input.asOf, "asOf");
  const sourceAuthority = getVehicleKnowledgeSourceAuthority(
    input.canonicalFieldPath,
    input.sourceType,
    input.recordScope,
  );
  const evidenceQuality = scoreEvidence(input.evidence, input.sourceType);
  const sourceAgreement = scoreAgreement(input.agreeingIndependentSourceCount ?? 0, input.conflictState ?? "none");
  const freshness = scoreFreshness(input.canonicalFieldPath, input.observedAt ?? input.retrievedAt, assessedAt);
  const scopeSpecificity = scoreScope(input.recordScope);
  const normalizationReliability = scoreNormalization(input.normalizationMethod);
  const reviewerConfidence = input.reviewContext ? 95 : 50;
  const conflictState = input.conflictState ?? ((input.agreeingIndependentSourceCount ?? 0) > 0 ? "agrees" : "none");
  const trustScore = round(
    sourceAuthority * 0.3
    + evidenceQuality * 0.2
    + sourceAgreement * 0.15
    + freshness * 0.1
    + scopeSpecificity * 0.1
    + normalizationReliability * 0.1
    + reviewerConfidence * 0.05,
  );
  const basis = [
    `${input.sourceType} authority for ${input.canonicalFieldPath}: ${sourceAuthority}.`,
    `Evidence quality: ${evidenceQuality}; normalization reliability: ${normalizationReliability}.`,
    `Scope specificity: ${scopeSpecificity}; freshness: ${freshness}; source agreement: ${sourceAgreement}.`,
    input.reviewContext
      ? `Human review ${input.reviewContext.reviewDecisionId} is retained.`
      : "No human approval is attached to this claim.",
  ];

  let trustState: VehicleKnowledgeTrustAssessment["trustState"];
  if (evidenceQuality === 0 || input.confidence.level === "unknown") {
    trustState = "REJECTED";
    basis.push("The claim lacks valid evidence or source confidence.");
  } else if (conflictState === "blocking") {
    trustState = "CONFLICTED";
    basis.push("Comparable claims disagree without a safe authority winner.");
  } else if (freshness === 0) {
    trustState = "STALE";
    basis.push("The field is time-sensitive and its evidence is beyond the freshness window.");
  } else if (trustScore >= 75 && sourceAuthority >= 70 && evidenceQuality >= 70) {
    trustState = "TRUSTED";
    basis.push("The deterministic trust threshold is satisfied.");
  } else {
    trustState = "REVIEW_REQUIRED";
    basis.push("The claim does not satisfy unattended trust requirements.");
  }

  return {
    trustScore,
    trustLevel: trustScore >= 85 ? "high" : trustScore >= 70 ? "medium" : trustScore >= 45 ? "low" : "unknown",
    trustState,
    sourceAuthority,
    evidenceQuality,
    sourceAgreement,
    freshness,
    scopeSpecificity,
    normalizationReliability,
    reviewerConfidence,
    conflictState,
    basis,
    assessedAt,
    policyVersion: vehicleKnowledgeTrustPolicyVersion,
  };
}

export function getVehicleKnowledgeSourceAuthority(
  fieldPath: CanonicalVehicleFieldPath,
  sourceType: CanonicalSourceType,
  recordScope: CanonicalRecordScope,
) {
  const section = fieldPath.split(".")[0];

  if (sourceType === "nhtsa") {
    if (section === "identity") return recordScope === "vin" ? 98 : 82;
    if (section === "safety") return 96;
    if (section === "environment" || section === "financial") return 25;
    return 55;
  }
  if (sourceType === "epa") {
    if (section === "environment") return 98;
    if (fieldPath === "financial.fuelEnergyCost") return 94;
    if (section === "identity") return 74;
    if (section === "safety" || section === "reliability") return 15;
    return 45;
  }
  if (sourceType === "listing") {
    if (fieldPath === "financial.purchasePrice" || fieldPath === "identity.odometerMileage") return 94;
    if (section === "safety" || section === "reliability") return 18;
    return 52;
  }
  if (sourceType === "repair" || sourceType === "warranty") {
    if (section === "reliability" || fieldPath === "financial.maintenanceCost") return 96;
    return 30;
  }
  if (sourceType === "iihs") return section === "safety" ? 98 : 25;
  if (sourceType === "transaction") return section === "financial" ? 97 : 30;
  if (sourceType === "insurance") return fieldPath === "financial.insuranceCost" ? 96 : 28;
  if (sourceType === "oem") return section === "identity" || section === "technology" ? 94 : 75;
  if (sourceType === "inspection") return recordScope === "vin" || recordScope === "listing" ? 92 : 70;
  if (sourceType === "legacy_catalog") return 35;
  if (sourceType === "example_fixture") return 40;
  if (sourceType === "derived") return 42;
  return 55;
}

export function isTimeSensitiveKnowledgeField(fieldPath: CanonicalVehicleFieldPath) {
  return Object.hasOwn(freshnessWindowsDays, fieldPath);
}

export function getKnowledgeFreshnessWindowDays(fieldPath: CanonicalVehicleFieldPath) {
  return freshnessWindowsDays[fieldPath] ?? null;
}

export function isStaticIdentityKnowledgeField(fieldPath: CanonicalVehicleFieldPath) {
  return staticIdentityFields.has(fieldPath);
}

function scoreEvidence(evidence: readonly CanonicalEvidence[], sourceType: CanonicalSourceType) {
  const matching = evidence.filter((item) => item.sourceType === sourceType && item.evidenceId.trim());
  if (!matching.length) return 0;
  const methods = matching.map((item) => item.normalizationMethod).filter(Boolean);
  const methodScore = methods.includes("direct") ? 96 : methods.includes("mapped") ? 84 : methods.includes("derived") ? 62 : 45;
  const metadataScore = matching.every((item) => item.providerName && item.retrievedAt && item.sourceRecordId) ? 95 : 72;
  return round(methodScore * 0.65 + metadataScore * 0.35);
}

function scoreAgreement(independentSources: number, conflictState: VehicleKnowledgeConflictState) {
  if (conflictState === "blocking") return 0;
  if (conflictState === "resolvable") return 35;
  if (conflictState === "agrees" || independentSources > 0) return Math.min(100, 82 + independentSources * 8);
  return 50;
}

function scoreFreshness(fieldPath: CanonicalVehicleFieldPath, sourceDate: string, asOf: string) {
  const window = freshnessWindowsDays[fieldPath];
  if (!window) return 100;
  const sourceTime = Date.parse(sourceDate);
  const asOfTime = Date.parse(asOf);
  if (!Number.isFinite(sourceTime) || sourceTime > asOfTime) return 0;
  const ageDays = (asOfTime - sourceTime) / 86_400_000;
  if (ageDays > window) return 0;
  return round(Math.max(40, 100 - (ageDays / window) * 55));
}

function scoreScope(scope: CanonicalRecordScope) {
  return ({ vin: 100, listing: 95, configuration: 90, model_year: 75 } as const)[scope];
}

function scoreNormalization(method: CanonicalEvidenceNormalizationMethod) {
  return ({ direct: 100, mapped: 86, derived: 62, estimated: 38 } as const)[method];
}

function requireDate(value: string, field: string) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be a valid timestamp.`);
  return value;
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}
