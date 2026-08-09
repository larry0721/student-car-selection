import { isDecisionDimensionDisabled } from "./decisionParticipationPolicy";
import { getProfileDimensionState } from "./profileDimensions";
import type { BuyerProfile, ScoreWeights } from "@/types/buyer";
import type {
  DecisionParticipation,
  DecisionParticipationPolicy,
  DecisionPolicyDimension,
} from "@/types/decisionPolicy";
import type {
  EffectiveHardConstraintPolicy,
  EffectiveImportanceLevel,
  EffectiveScoringCategoryPolicy,
  EffectiveScoringPolicy,
  ScoringCategory,
} from "@/types/scoring";

export const scoringCategories: ScoringCategory[] = [
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

export const importanceMultipliers: Record<EffectiveImportanceLevel, number> = {
  low: 0.72,
  normal: 1,
  high: 1.35,
  top: 1.75,
};

export const deprioritizedParticipationMultiplier = 0.42;

const categoryDimensions: Partial<Record<ScoringCategory, DecisionPolicyDimension>> = {
  affordability: "affordability",
  reliability: "reliability",
  safety: "safety",
  fuelEnergyCost: "fuelEnergyCost",
  insuranceCost: "insuranceCost",
  maintenanceRisk: "maintenanceRisk",
  resaleValue: "resaleValue",
  drivingPreferenceFit: "performance",
};

type ResolveEffectiveScoringPolicyInput = {
  profile: BuyerProfile;
  baseWeights: ScoreWeights;
  availableVehicleDataCapabilities?: Partial<Record<ScoringCategory, boolean>>;
  applyLegacyPriorityScaling?: boolean;
};

export function resolveEffectiveScoringPolicy(
  input: ResolveEffectiveScoringPolicyInput,
): EffectiveScoringPolicy {
  assertValidBaseWeights(input.baseWeights);
  const baseWeights = normalizeWeights(input.baseWeights);
  const legacyProfile = !Object.keys(input.profile.decisionPolicies || {}).length;
  const capabilities = input.availableVehicleDataCapabilities || {};
  const exclusivePolicy = getExclusiveScoringPolicy(input.profile);
  const categoryPolicies = Object.fromEntries(
    scoringCategories.map((category) => {
      const policy = getEffectiveCategoryPolicy(input.profile, category, exclusivePolicy);
      const available = capabilities[category] !== false;
      return [
        category,
        buildCategoryPolicy({
          profile: input.profile,
          category,
          baseWeight: baseWeights[category],
          policy,
          available,
          applyLegacyPriorityScaling: input.applyLegacyPriorityScaling !== false,
        }),
      ];
    }),
  ) as Record<ScoringCategory, EffectiveScoringCategoryPolicy>;

  const effectiveHardConstraints = resolveEffectiveHardConstraints(input.profile);
  const hasEnforcedConstraint = effectiveHardConstraints.some(
    (constraint) => constraint.enforced && constraint.source !== "application_default",
  );
  const explicitPolicies = Object.values(input.profile.decisionPolicies || {}).filter(Boolean);
  const allMappedScoringPoliciesInactive =
    explicitPolicies.length > 0
    && Object.values(categoryPolicies)
      .filter((category) => category.category !== "practicality")
      .every((category) => category.participation === "disabled" || category.participation === "unresolved");

  let mode: EffectiveScoringPolicy["mode"] = "weighted";
  if (allMappedScoringPoliciesInactive) {
    mode = hasEnforcedConstraint ? "constraint_only" : "needs_clarification";
  }

  if (mode !== "weighted") {
    for (const category of scoringCategories) {
      categoryPolicies[category] = {
        ...categoryPolicies[category],
        normalizedEffectiveWeight: 0,
        scoringEnabled: false,
        mayAppearInExplanations: false,
        reason:
          mode === "constraint_only"
            ? "Hard constraints define the candidate set; no scoring preference is active."
            : "No positive supported decision criterion is active.",
      };
    }
  } else {
    normalizeCategoryPolicyWeights(categoryPolicies);
  }

  const effectiveWeights = Object.fromEntries(
    scoringCategories.map((category) => [
      category,
      categoryPolicies[category].normalizedEffectiveWeight,
    ]),
  ) as ScoreWeights;
  const positiveWeightTotal = roundWeight(
    Object.values(effectiveWeights).reduce((sum, weight) => sum + weight, 0),
  );

  return {
    mode,
    targetWeightTotal: 100,
    categories: categoryPolicies,
    effectiveWeights,
    effectiveHardConstraints,
    disabledCategories: scoringCategories.filter(
      (category) => categoryPolicies[category].participation === "disabled",
    ),
    unresolvedCategories: scoringCategories.filter(
      (category) => categoryPolicies[category].participation === "unresolved",
    ),
    positiveWeightTotal,
    legacyProfile,
    reason:
      mode === "weighted"
        ? legacyProfile
          ? "No participation policy was supplied; legacy priority scaling is preserved."
          : "Active policy categories were normalized to 100."
        : mode === "constraint_only"
          ? "All scoring dimensions were removed, but explicit hard constraints still define a deterministic candidate set."
          : "The profile contains policy instructions but no positive supported criterion.",
  };
}

export function getCategoryDecisionDimension(category: ScoringCategory) {
  return categoryDimensions[category];
}

function buildCategoryPolicy(input: {
  profile: BuyerProfile;
  category: ScoringCategory;
  baseWeight: number;
  policy?: DecisionParticipationPolicy;
  available: boolean;
  applyLegacyPriorityScaling: boolean;
}): EffectiveScoringCategoryPolicy {
  const participation = input.policy?.participation || "active";
  const legacyMultiplier = getLegacyCategoryMultiplier(input.profile, input.category);
  const importanceLevel = getEffectiveImportanceLevel(
    input.policy?.importance,
    getMultiplierLevel(legacyMultiplier),
  );
  const importanceMultiplier = input.applyLegacyPriorityScaling
    ? input.policy?.importance === undefined
      ? legacyMultiplier
      : importanceMultipliers[importanceLevel]
    : 1;
  const participationMultiplier =
    participation === "deprioritized"
      ? deprioritizedParticipationMultiplier
      : participation === "disabled" || participation === "unresolved"
        ? 0
        : 1;
  const effectiveRawWeight = input.available
    ? roundWeight(input.baseWeight * importanceMultiplier * participationMultiplier)
    : 0;
  const scoringEnabled = effectiveRawWeight > 0;
  const thresholdPresent = categoryHasThreshold(input.profile, input.category);

  return {
    category: input.category,
    baseWeight: input.baseWeight,
    participation,
    importance: input.policy?.importance,
    importanceLevel,
    importanceMultiplier,
    participationMultiplier,
    effectiveRawWeight,
    normalizedEffectiveWeight: 0,
    qualificationBehavior:
      participation === "disabled"
        ? "disabled"
        : participation === "unresolved"
          ? "unresolved"
          : thresholdPresent
            ? "constraint_and_score"
            : "score_only",
    scoringEnabled,
    reason: getCategoryPolicyReason(participation, input.policy, input.available),
    source: input.policy?.source || "application_default",
    dataAvailability: input.available ? "available" : "unavailable",
    mayAppearInExplanations: scoringEnabled,
  };
}

function getEffectiveCategoryPolicy(
  profile: BuyerProfile,
  category: ScoringCategory,
  exclusivePolicy?: DecisionParticipationPolicy,
): DecisionParticipationPolicy | undefined {
  const dimension = categoryDimensions[category];
  if (exclusivePolicy) {
    if (dimension === exclusivePolicy.dimension) {
      return {
        ...exclusivePolicy,
        importance: exclusivePolicy.importance ?? 1,
      };
    }
    return {
      ...exclusivePolicy,
      dimension: dimension || exclusivePolicy.dimension,
      participation: "disabled",
      importance: undefined,
      explanation: `${category} was excluded because the user named ${exclusivePolicy.dimension} as the only ranking priority.`,
    };
  }
  const direct = dimension ? profile.decisionPolicies?.[dimension] : undefined;
  if (direct) return direct;
  if (category !== "affordability") return undefined;

  const purchase = profile.decisionPolicies?.purchaseBudget;
  const monthly = profile.decisionPolicies?.monthlyPayment;
  if (purchase?.participation === "disabled") {
    if (monthly && (monthly.participation === "active" || monthly.participation === "enforced")) {
      return deriveAffordabilityPolicy(monthly, "Monthly payment remains active while purchase price is excluded.");
    }
    return deriveAffordabilityPolicy(purchase, "Purchase-price affordability is excluded and no explicit monthly-payment target remains active.", "disabled");
  }
  if (purchase?.participation === "unresolved") {
    if (monthly && (monthly.participation === "active" || monthly.participation === "enforced")) {
      return deriveAffordabilityPolicy(monthly, "Monthly payment remains active while purchase price is unresolved.");
    }
    return deriveAffordabilityPolicy(purchase, "Purchase-price affordability is unresolved.", "unresolved");
  }
  if (purchase) {
    return deriveAffordabilityPolicy(
      purchase,
      "Affordability scoring follows the active purchase-price target.",
      purchase.participation === "enforced" ? "active" : purchase.participation,
    );
  }
  return undefined;
}

function getExclusiveScoringPolicy(profile: BuyerProfile) {
  return Object.values(profile.decisionPolicies || {}).find(
    (policy): policy is DecisionParticipationPolicy =>
      Boolean(
        policy
        && (policy.participation === "active" || policy.participation === "enforced")
        && Object.values(categoryDimensions).includes(policy.dimension)
        && /\bonly\b/i.test(policy.sourceText),
      ),
  );
}

function deriveAffordabilityPolicy(
  source: DecisionParticipationPolicy,
  explanation: string,
  participation: DecisionParticipation = source.participation,
): DecisionParticipationPolicy {
  return {
    ...source,
    dimension: "affordability",
    participation,
    explanation,
  };
}

function normalizeCategoryPolicyWeights(
  policies: Record<ScoringCategory, EffectiveScoringCategoryPolicy>,
) {
  const positive = scoringCategories.filter(
    (category) => policies[category].scoringEnabled && policies[category].effectiveRawWeight > 0,
  );
  const total = positive.reduce(
    (sum, category) => sum + policies[category].effectiveRawWeight,
    0,
  );
  if (!total) return;

  let assigned = 0;
  positive.forEach((category, index) => {
    const normalized =
      index === positive.length - 1
        ? roundWeight(100 - assigned)
        : roundWeight((policies[category].effectiveRawWeight / total) * 100);
    assigned = roundWeight(assigned + normalized);
    policies[category] = {
      ...policies[category],
      normalizedEffectiveWeight: normalized,
    };
  });
}

function resolveEffectiveHardConstraints(
  profile: BuyerProfile,
): EffectiveHardConstraintPolicy[] {
  const dimensions: DecisionPolicyDimension[] = [
    "purchaseBudget",
    "monthlyPayment",
    "make",
    "bodyStyle",
    "fuelType",
    "drivetrain",
    "transmission",
    "seating",
    "modelYear",
    "mileage",
    "reliability",
    "safety",
    "performance",
  ];

  return dimensions.map((dimension) => {
    const directPolicy = profile.decisionPolicies?.[dimension];
    const affordabilityPolicy =
      (dimension === "purchaseBudget" || dimension === "monthlyPayment")
      && profile.decisionPolicies?.affordability?.participation === "disabled"
        ? profile.decisionPolicies.affordability
        : undefined;
    const policy = directPolicy || affordabilityPolicy;
    const exclusionPresent = hasExplicitExclusion(profile, dimension);
    const thresholdPresent = hasThreshold(profile, dimension);
    const legacyConstraint = hasLegacyConstraint(profile, dimension);
    const enforced = exclusionPresent
      || (policy
        ? !isDecisionDimensionDisabled(profile, dimension)
          && (
            policy.participation === "enforced"
            || (thresholdPresent && policy.participation === "active")
          )
        : legacyConstraint);
    return {
      dimension,
      participation: policy?.participation || (enforced ? "enforced" : "active"),
      enforced,
      source: policy?.source || "application_default",
      reason: exclusionPresent
        ? "An explicit excluded value remains a hard filter."
        : enforced
          ? thresholdPresent
            ? "An explicit numerical threshold is enforced."
            : policy
              ? "The current decision policy enforces this constraint."
              : "Legacy profile behavior applies because no decision policy was supplied."
          : policy?.participation === "disabled"
            ? "The user explicitly disabled this qualification dimension."
            : policy?.participation === "unresolved"
              ? "The dimension is unresolved and is not silently enforced."
              : "The dimension is available for preference matching but is not a hard filter.",
    };
  });
}

function hasLegacyConstraint(profile: BuyerProfile, dimension: DecisionPolicyDimension) {
  if (dimension === "purchaseBudget") return profile.maxPurchaseBudget > 0;
  if (dimension === "monthlyPayment") return profile.paymentMethod !== "cash" && profile.monthlyBudget > 0;
  if (dimension === "make") return hasDimensionConstraint(profile, "make") || Boolean(profile.requiredMake);
  if (dimension === "bodyStyle") return hasDimensionConstraint(profile, "bodyStyle") || profile.bodyStyle !== "any";
  if (dimension === "fuelType") return hasDimensionConstraint(profile, "fuelType") || Boolean(profile.requiredFuelType);
  if (dimension === "drivetrain") return hasDimensionConstraint(profile, "drivetrain") || profile.drivetrainPreference !== "any";
  if (dimension === "transmission") return hasDimensionConstraint(profile, "transmission") || profile.transmissionPreference !== "any";
  if (dimension === "seating") return profile.familySize > 1;
  if (dimension === "modelYear") return profile.minYear > 0;
  if (dimension === "mileage") return profile.maxMileage > 0;
  return hasThreshold(profile, dimension);
}

function hasDimensionConstraint(
  profile: BuyerProfile,
  dimension: "make" | "bodyStyle" | "fuelType" | "drivetrain" | "transmission",
) {
  const state = getProfileDimensionState(profile, dimension);
  return state.required.length > 0 || state.excluded.length > 0;
}

function hasExplicitExclusion(profile: BuyerProfile, dimension: DecisionPolicyDimension) {
  if (dimension === "make") return getProfileDimensionState(profile, "make").excluded.length > 0;
  if (dimension === "bodyStyle") {
    return getProfileDimensionState(profile, "bodyStyle").excluded.length > 0
      || getProfileDimensionState(profile, "vehicleCategory").excluded.length > 0;
  }
  if (dimension === "fuelType") return getProfileDimensionState(profile, "fuelType").excluded.length > 0;
  if (dimension === "drivetrain") return getProfileDimensionState(profile, "drivetrain").excluded.length > 0;
  if (dimension === "transmission") return getProfileDimensionState(profile, "transmission").excluded.length > 0;
  return false;
}

function hasThreshold(profile: BuyerProfile, dimension: DecisionPolicyDimension) {
  if (dimension === "reliability") return profile.reliabilityMinimum !== undefined;
  if (dimension === "safety") return profile.safetyMinimum !== undefined;
  if (dimension === "performance") return profile.performanceMinimum !== undefined;
  return false;
}

function categoryHasThreshold(profile: BuyerProfile, category: ScoringCategory) {
  if (category === "reliability") return profile.reliabilityMinimum !== undefined;
  if (category === "safety") return profile.safetyMinimum !== undefined;
  if (category === "drivingPreferenceFit") return profile.performanceMinimum !== undefined;
  return false;
}

function getEffectiveImportanceLevel(
  explicitImportance: number | undefined,
  legacyLevel: EffectiveImportanceLevel,
): EffectiveImportanceLevel {
  if (explicitImportance === undefined) return legacyLevel;
  if (explicitImportance <= 0.25) return "low";
  if (explicitImportance <= 0.55) return "normal";
  if (explicitImportance <= 0.8) return "high";
  return "top";
}

function getLegacyCategoryMultiplier(
  profile: BuyerProfile,
  category: ScoringCategory,
): number {
  if (category === "affordability") {
    return getLegacyAffordabilityMultiplier(profile);
  }
  if (category === "reliability") return importanceMultipliers[importanceLevelFromNumeric(profile.reliabilityImportance)];
  if (category === "safety") return importanceMultipliers[importanceLevelFromSafety(profile.safetyPriority)];
  if (category === "fuelEnergyCost") return importanceMultipliers[importanceLevelFromNumeric(profile.fuelEconomyImportance)];
  if (category === "insuranceCost") return profile.insuranceBudget ? 1.15 : 1;
  if (category === "maintenanceRisk") return profile.reliabilityImportance >= 4 ? 1.18 : 1;
  if (category === "practicality") return getLegacyPracticalityMultiplier(profile);
  if (category === "resaleValue") return importanceMultipliers[importanceLevelFromNumeric(profile.resaleValueImportance)];
  return getLegacyDrivingMultiplier(profile);
}

function importanceLevelFromNumeric(value: number): EffectiveImportanceLevel {
  if (value <= 2) return "low";
  if (value === 3) return "normal";
  if (value === 4) return "high";
  return "top";
}

function importanceLevelFromSafety(value: BuyerProfile["safetyPriority"]): EffectiveImportanceLevel {
  if (value === "high") return "high";
  if (value === "maximum") return "top";
  return "normal";
}

function getMultiplierLevel(multiplier: number): EffectiveImportanceLevel {
  if (multiplier <= importanceMultipliers.low) return "low";
  if (multiplier < importanceMultipliers.high) return "normal";
  if (multiplier < importanceMultipliers.top) return "high";
  return "top";
}

function getLegacyAffordabilityMultiplier(profile: BuyerProfile) {
  if (profile.paymentMethod === "cash") return 1.28;
  if (profile.maxPurchaseBudget <= 12000 || profile.monthlyBudget <= 450) return 1.2;
  return 1;
}

function getLegacyPracticalityMultiplier(profile: BuyerProfile) {
  let multiplier = 1;
  if (profile.cargoNeed === "high") multiplier *= 1.35;
  if (profile.familySize >= 4) multiplier *= 1.3;
  if (profile.bodyStyle !== "any") multiplier *= 1.18;
  if (profile.climate === "snow" || profile.climate === "rain") multiplier *= 1.12;
  return Math.min(multiplier, 1.55);
}

function getLegacyDrivingMultiplier(profile: BuyerProfile) {
  const performance = importanceMultipliers[importanceLevelFromNumeric(profile.performanceImportance)];
  const features = importanceMultipliers[importanceLevelFromNumeric(profile.advancedFeaturesImportance)];
  const make = profile.requiredMake || profile.preferredMake ? 1.25 : 1;
  return Math.max(performance, features) * make;
}

function getCategoryPolicyReason(
  participation: DecisionParticipation,
  policy: DecisionParticipationPolicy | undefined,
  available: boolean,
) {
  if (!available) return "The catalog does not provide usable data for this category.";
  if (!policy) return "No policy override exists; legacy profile priority behavior is preserved.";
  if (participation === "disabled") return "The user explicitly excluded this category from qualification and ranking.";
  if (participation === "unresolved") return "The category remains unresolved and receives no weight until clarified.";
  if (participation === "deprioritized") return "The category remains active at the documented reduced participation factor.";
  if (participation === "enforced") return "The category is enforced where a supported constraint exists and strongly active within qualified candidates.";
  return "The category participates using its validated importance.";
}

function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const total = scoringCategories.reduce((sum, category) => sum + weights[category], 0);
  if (total <= 0) throw new Error("At least one base scoring weight must be positive.");
  return Object.fromEntries(
    scoringCategories.map((category) => [category, (weights[category] / total) * 100]),
  ) as ScoreWeights;
}

function assertValidBaseWeights(weights: ScoreWeights) {
  for (const category of scoringCategories) {
    if (!Number.isFinite(weights[category]) || weights[category] < 0) {
      throw new Error(`Invalid base scoring weight for ${category}.`);
    }
  }
}

function roundWeight(value: number) {
  return Number(value.toFixed(6));
}
