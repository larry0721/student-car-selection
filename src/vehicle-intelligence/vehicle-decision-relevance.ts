import type { BuyerProfile, ScoreWeights } from "../../types/buyer";
import type { CanonicalDatum, CanonicalVehicleFieldPath, CanonicalVehicleRecord } from "../../types/canonicalVehicle";
import type { DecisionParticipation, DecisionParticipationPolicy } from "../../types/decisionPolicy";
import type {
  DecisionDisclosureRequirement,
  VehicleDecisionDimension,
  VehicleDecisionDimensionEvaluation,
  VehicleDecisionFieldEvaluation,
  VehicleDecisionReadiness,
  VehicleKnowledgeAvailability,
} from "../../types/vehicleFieldPolicy";

export const vehicleDecisionRelevancePolicyVersion = "1.0.0" as const;

type DimensionRequirement = {
  fields: CanonicalVehicleFieldPath[];
  minimumEligibleFields: number;
};

type RelevanceRequest = {
  participation: DecisionParticipation;
  importance?: number;
  source: "policy" | "constraint" | "weight" | "profile";
};

const dimensionRequirements: Record<VehicleDecisionDimension, DimensionRequirement> = {
  purchaseBudget: requirement(["financial.purchasePrice"]),
  monthlyPayment: requirement(["financial.monthlyPayment"]),
  totalOwnershipBudget: requirement(["financial.totalOwnershipCost"]),
  affordability: requirement(["financial.purchasePrice", "financial.totalOwnershipCost"], 1),
  maintenanceRisk: requirement(["financial.maintenanceCost", "reliability.repairFrequency", "reliability.repairSeverity", "reliability.knownIssues"], 1),
  insuranceCost: requirement(["financial.insuranceCost"]),
  fuelEnergyCost: requirement(["financial.fuelEnergyCost"]),
  fuelEconomy: requirement(["environment.fuelEconomy"]),
  resaleValue: requirement(["financial.resaleValue", "financial.depreciation"], 1),
  reliability: requirement(["reliability.longTermReliability"]),
  safety: requirement(["safety.crashSafety", "safety.activeSafety", "safety.passiveSafety", "safety.driverAssistanceSafety"], 1),
  performance: requirement(["driving.acceleration", "driving.handling", "driving.steering", "driving.rideControl", "driving.braking"], 1),
  make: requirement(["identity.make"]),
  model: requirement(["identity.model"]),
  bodyStyle: requirement(["identity.bodyStyle"]),
  vehicleCategory: requirement(["identity.vehicleCategory"]),
  fuelType: requirement(["identity.fuelType"]),
  drivetrain: requirement(["identity.drivetrain"]),
  transmission: requirement(["identity.transmission"]),
  seating: requirement(["practicality.passengerRoom"]),
  modelYear: requirement(["identity.modelYear"]),
  mileage: requirement(["identity.odometerMileage"]),
  condition: requirement(["identity.condition"]),
  practicality: requirement(["practicality.cargoCapacity", "practicality.passengerRoom", "practicality.parkingEase", "practicality.outwardVisibility", "practicality.storageUtility", "practicality.interiorFlexibility"], 1),
  comfort: requirement(["comfort.seatComfort", "comfort.suspensionComfort", "comfort.cabinNoise", "comfort.rideSmoothness", "comfort.climateComfort"], 1),
  technology: requirement(["technology.infotainment", "technology.smartphoneIntegration", "technology.navigation", "technology.driverAssistanceTechnology", "technology.softwareExperience"], 1),
  evRange: requirement(["environment.evRange"]),
  charging: requirement(["environment.chargingSpeed", "technology.chargingTechnology"], 1),
  emissions: requirement(["environment.emissions"]),
  image: requirement(["image.luxuryPerception", "image.sportyImage", "image.ruggedImage", "image.premiumImage", "image.understatedImage"], 1),
  lifestyle: requirement(["lifestyle.collegeStudentFit", "lifestyle.familyFit", "lifestyle.campingFit", "lifestyle.petFit", "lifestyle.commutingFit", "lifestyle.snowFit", "lifestyle.roadTripFit", "lifestyle.cityFit", "lifestyle.businessFit"], 1),
};

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

export function evaluateVehicleDecisionReadiness(
  buyerProfile: BuyerProfile,
  cvr: CanonicalVehicleRecord,
): VehicleDecisionReadiness {
  const requests = collectRelevanceRequests(buyerProfile);
  const relevantDimensions = [...requests.entries()]
    .filter(([, request]) => request.participation !== "disabled")
    .map(([dimension, request]) => evaluateDimension(cvr, dimension, request))
    .sort((left, right) => left.dimension.localeCompare(right.dimension));

  const weightTotal = relevantDimensions.reduce((sum, item) => sum + item.weight, 0);
  const coveredWeight = relevantDimensions.reduce(
    (sum, item) => sum + item.weight * item.supportRatio,
    0,
  );
  const decisionCoverage = weightTotal ? round(100 * coveredWeight / weightTotal) : 100;
  const disclosureRequirements = relevantDimensions.flatMap(buildDisclosureRequirement);
  const estimatedWeight = relevantDimensions.reduce(
    (sum, item) => sum + (item.estimatedSupport ? item.weight : 0),
    0,
  );
  const estimatedDataPenalty = weightTotal ? round(8 * estimatedWeight / weightTotal) : 0;
  const coveragePenalty = 100 - decisionCoverage;
  const confidencePenalty = Math.min(100, coveragePenalty + estimatedDataPenalty);
  const confidenceReasons = [
    ...(coveragePenalty ? [`${coveragePenalty} points of buyer-specific decision coverage are unavailable.`] : []),
    ...(estimatedDataPenalty ? [`Estimated evidence adds a ${estimatedDataPenalty}-point confidence caution without changing match score.`] : []),
  ];

  return deepFreeze({
    vehicleRecordId: cvr.recordId,
    relevantDimensions,
    supportedDimensions: relevantDimensions.filter((item) => item.scoreEligible).map((item) => item.dimension),
    unsupportedDimensions: relevantDimensions.filter((item) => !item.scoreEligible).map((item) => item.dimension),
    staleRelevantDimensions: relevantDimensions.filter((item) => item.fieldEvaluations.some((field) => field.availability === "STALE")).map((item) => item.dimension),
    conflictedRelevantDimensions: relevantDimensions.filter((item) => item.fieldEvaluations.some((field) => field.availability === "CONFLICTED")).map((item) => item.dimension),
    decisionCoverage,
    confidenceImpact: {
      coveragePenalty,
      estimatedDataPenalty,
      level: confidencePenalty === 0 ? "NONE" : confidencePenalty <= 10 ? "LOW" : confidencePenalty <= 30 ? "MODERATE" : "HIGH",
      reasons: confidenceReasons,
    },
    disclosureRequirements,
    scoringEligibleDimensions: relevantDimensions.filter((item) => item.scoreEligible).map((item) => item.dimension),
    scoringIneligibleDimensions: relevantDimensions.filter((item) => !item.scoreEligible).map((item) => item.dimension),
  });
}

export function getVehicleDecisionDimensionRequirements() {
  return deepFreeze(clone(dimensionRequirements));
}

function collectRelevanceRequests(profile: BuyerProfile) {
  const requests = new Map<VehicleDecisionDimension, RelevanceRequest>();
  const set = (dimension: VehicleDecisionDimension, request: RelevanceRequest) => {
    const current = requests.get(dimension);
    if (!current || participationRank(request.participation) >= participationRank(current.participation)) {
      requests.set(dimension, request);
    }
  };

  for (const [dimension, policy] of Object.entries(profile.decisionPolicies ?? {})) {
    if (!policy) continue;
    const mapped = mapPolicyDimension(dimension as keyof NonNullable<BuyerProfile["decisionPolicies"]>);
    for (const target of mapped) set(target, requestFromPolicy(policy));
  }

  for (const [category, weight] of Object.entries(profile.scoreWeights) as [keyof ScoreWeights, number][]) {
    const dimension = scoringDimensionByCategory[category];
    if (isExplicitlyDisabled(profile, dimension, category)) continue;
    if (weight > 0) set(dimension, { participation: "active", importance: Math.min(1, weight / 30), source: "weight" });
  }

  if (profile.maxPurchaseBudget > 0 && !isExplicitlyDisabled(profile, "purchaseBudget")) set("purchaseBudget", { participation: "active", source: "profile" });
  if (profile.monthlyBudget > 0 && !isExplicitlyDisabled(profile, "monthlyPayment")) set("monthlyPayment", { participation: "active", source: "profile" });
  if (profile.minYear > 0) set("modelYear", { participation: "enforced", source: "constraint" });
  if (profile.maxMileage > 0) set("mileage", { participation: "enforced", source: "constraint" });
  if (profile.reliabilityMinimum !== undefined) set("reliability", { participation: "enforced", source: "constraint" });
  if (profile.safetyMinimum !== undefined) set("safety", { participation: "enforced", source: "constraint" });
  if (profile.performanceMinimum !== undefined) set("performance", { participation: "enforced", source: "constraint" });
  if (hasValues(profile.requiredMakes) || profile.requiredMake) set("make", { participation: "enforced", source: "constraint" });
  else if (hasValues(profile.preferredMakes) || profile.preferredMake) set("make", { participation: "active", source: "profile" });
  if (hasValues(profile.requiredBodyStyles) || profile.bodyStyle !== "any") set("bodyStyle", { participation: "enforced", source: "constraint" });
  else if (hasValues(profile.preferredBodyStyles)) set("bodyStyle", { participation: "active", source: "profile" });
  if (hasValues(profile.requiredVehicleCategories)) set("vehicleCategory", { participation: "enforced", source: "constraint" });
  else if (hasValues(profile.preferredVehicleCategories)) set("vehicleCategory", { participation: "active", source: "profile" });
  if (hasValues(profile.requiredFuelTypes) || profile.requiredFuelType) set("fuelType", { participation: "enforced", source: "constraint" });
  else if (hasValues(profile.preferredFuelTypes)) set("fuelType", { participation: "active", source: "profile" });
  if (hasElectricPreference(profile)) set("evRange", { participation: "active", importance: 0.7, source: "profile" });
  if (hasValues(profile.requiredDrivetrains) || profile.drivetrainPreference !== "any") set("drivetrain", { participation: "enforced", source: "constraint" });
  else if (hasValues(profile.preferredDrivetrains)) set("drivetrain", { participation: "active", source: "profile" });
  if (hasValues(profile.requiredTransmissions) || profile.transmissionPreference !== "any") set("transmission", { participation: "enforced", source: "constraint" });
  else if (hasValues(profile.preferredTransmissions)) set("transmission", { participation: "active", source: "profile" });
  if (profile.familySize > 0) set("seating", { participation: "active", source: "profile" });
  if (profile.cargoNeed !== "not-sure") set("practicality", { participation: "active", importance: profile.cargoNeed === "high" ? 1 : profile.cargoNeed === "medium" ? 0.6 : 0.3, source: "profile" });
  if (profile.fuelEconomyImportance > 1 && !isExplicitlyDisabled(profile, "fuelEnergyCost")) set("fuelEconomy", { participation: "active", importance: Math.min(1, profile.fuelEconomyImportance / 5), source: "profile" });

  return requests;
}

function evaluateDimension(
  cvr: CanonicalVehicleRecord,
  dimension: VehicleDecisionDimension,
  request: RelevanceRequest,
): VehicleDecisionDimensionEvaluation {
  const requirement = dimensionRequirements[dimension];
  const fieldEvaluations = requirement.fields.map((path) => evaluateField(path, getDatum(cvr, path)));
  const supported = fieldEvaluations.filter((item) => item.decisionEligible);
  const supportRatio = roundRatio(supported.length / requirement.fields.length);
  const scoreEligible = supported.length >= requirement.minimumEligibleFields;
  return {
    dimension,
    participation: request.participation,
    materiality: request.participation === "enforced" ? "REQUIRED" : (request.importance ?? 0) >= 0.7 ? "IMPORTANT" : "SUPPORTING",
    relevant: true,
    weight: relevanceWeight(request),
    fieldEvaluations,
    supportedFieldPaths: supported.map((item) => item.fieldPath),
    unsupportedFieldPaths: fieldEvaluations.filter((item) => !item.decisionEligible).map((item) => item.fieldPath),
    supportRatio,
    scoreEligible,
    estimatedSupport: supported.some((item) => item.availability === "ESTIMATED"),
  };
}

function evaluateField(
  fieldPath: CanonicalVehicleFieldPath,
  datum: CanonicalDatum<unknown> | undefined,
): VehicleDecisionFieldEvaluation {
  const availability = getAvailability(datum);
  const decisionEligible = availability === "TRUSTED" || availability === "ESTIMATED";
  return {
    fieldPath,
    availability,
    decisionEligible,
    estimated: availability === "ESTIMATED",
    reason: availabilityReason(availability),
  };
}

function getAvailability(datum: CanonicalDatum<unknown> | undefined): VehicleKnowledgeAvailability {
  if (!datum) return "MISSING";
  if (datum.missingReason === "source_conflict" || datum.confidence.sourceAgreement === "conflicts") return "CONFLICTED";
  if (datum.missingReason === "stale") return "STALE";
  if (datum.value === null || datum.status === "missing") return "MISSING";
  if (!datum.evidenceIds.length || datum.confidence.level === "unknown" || datum.confidence.score === null) return "UNTRUSTED";
  if (datum.status === "estimated" || datum.estimated) return confidenceAllowsEstimate(datum) ? "ESTIMATED" : "UNTRUSTED";
  return "TRUSTED";
}

function buildDisclosureRequirement(
  evaluation: VehicleDecisionDimensionEvaluation,
): DecisionDisclosureRequirement[] {
  if (evaluation.scoreEligible && evaluation.supportRatio === 1) return [];
  if (!evaluation.unsupportedFieldPaths.length) return [];
  if (evaluation.materiality === "REQUIRED" || evaluation.materiality === "IMPORTANT") {
    return [{
      dimension: evaluation.dimension,
      level: "REQUIRED",
      reason: `${evaluation.dimension} is material to this buyer, but current trusted knowledge is incomplete or unavailable.`,
      fieldPaths: evaluation.unsupportedFieldPaths,
    }];
  }
  return [{
    dimension: evaluation.dimension,
    level: "CONFIDENCE_ONLY",
    reason: `${evaluation.dimension} has incomplete support and should reduce confidence without leading the explanation.`,
    fieldPaths: evaluation.unsupportedFieldPaths,
  }];
}

function mapPolicyDimension(dimension: string): VehicleDecisionDimension[] {
  if (dimension === "affordability") return ["affordability"];
  return [dimension as VehicleDecisionDimension];
}

function requestFromPolicy(policy: DecisionParticipationPolicy): RelevanceRequest {
  return {
    participation: policy.participation,
    importance: policy.importance,
    source: "policy",
  };
}

function isExplicitlyDisabled(
  profile: BuyerProfile,
  dimension: VehicleDecisionDimension,
  category?: keyof ScoreWeights,
) {
  const direct = profile.decisionPolicies?.[dimension as keyof NonNullable<BuyerProfile["decisionPolicies"]>];
  if (direct?.participation === "disabled") return true;
  if (category === "affordability" && profile.decisionPolicies?.affordability?.participation === "disabled") return true;
  return false;
}

function hasElectricPreference(profile: BuyerProfile) {
  return profile.requiredFuelType === "electric"
    || profile.requiredFuelTypes?.includes("electric")
    || profile.preferredFuelTypes?.includes("electric");
}

function confidenceAllowsEstimate(datum: CanonicalDatum<unknown>) {
  const score = datum.confidence.score;
  if (score === null) return false;
  const normalized = score <= 1 ? score * 100 : score;
  return normalized >= 55 && (datum.confidence.level === "high" || datum.confidence.level === "medium");
}

function availabilityReason(availability: VehicleKnowledgeAvailability) {
  return ({
    TRUSTED: "Current sourced or derived evidence is eligible for this decision.",
    ESTIMATED: "A sufficiently supported estimate is eligible with a confidence caution.",
    MISSING: "No usable value is available; no default score may be substituted.",
    STALE: "The value is stale and unavailable for current scoring.",
    CONFLICTED: "Source conflict prevents decision participation.",
    UNTRUSTED: "The value lacks sufficient evidence or confidence for decision use.",
  } as const)[availability];
}

function relevanceWeight(request: RelevanceRequest) {
  if (request.participation === "enforced") return 4;
  if (request.participation === "deprioritized") return 0.5;
  if (request.participation === "unresolved") return 1;
  return roundRatio(1 + 2 * Math.max(0, Math.min(1, request.importance ?? 0.5)));
}

function participationRank(participation: DecisionParticipation) {
  return ({ disabled: 0, unresolved: 1, deprioritized: 2, active: 3, enforced: 4 } as const)[participation];
}

function requirement(fields: CanonicalVehicleFieldPath[], minimumEligibleFields = fields.length): DimensionRequirement {
  return { fields, minimumEligibleFields };
}

function getDatum(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath): CanonicalDatum<unknown> | undefined {
  const [section, fieldName] = path.split(".");
  return (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section]?.[fieldName];
}

function hasValues(values: readonly unknown[] | undefined) {
  return Boolean(values?.length);
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function roundRatio(value: number) {
  return Math.round(value * 1000) / 1000;
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
