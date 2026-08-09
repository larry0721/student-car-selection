export type SemanticConcept =
  | "make"
  | "model"
  | "body_style"
  | "vehicle_category"
  | "powertrain"
  | "drivetrain"
  | "transmission"
  | "passenger_capacity"
  | "cargo"
  | "climate"
  | "snow_use"
  | "commute"
  | "parking"
  | "trip_distance"
  | "towing"
  | "purchase_budget"
  | "monthly_budget"
  | "insurance_sensitivity"
  | "fuel_sensitivity"
  | "maintenance_tolerance"
  | "depreciation_concern"
  | "acceleration"
  | "handling"
  | "comfort"
  | "quietness"
  | "technology"
  | "styling"
  | "luxury_feel"
  | "status_image"
  | "engagement"
  | "simplicity"
  | "reliability"
  | "safety"
  | "repair_risk"
  | "first_car_suitability"
  | "long_term_ownership"
  | "resale_value"
  | "unknown";

export type SemanticConceptGroup =
  | "identity"
  | "practical"
  | "financial"
  | "experience"
  | "risk";

export const canonicalSemanticIntentValues = [
  "required",
  "preferred",
  "allowed",
  "excluded",
  "uncertain",
] as const;

export type CanonicalSemanticIntent = (typeof canonicalSemanticIntentValues)[number];

export const semanticSupportStatusValues = [
  "supported_and_used",
  "supported_but_needs_confirmation",
  "understood_but_not_scored",
  "recognized_out_of_scope",
  "unresolved",
] as const;

export type SemanticSupportStatus = (typeof semanticSupportStatusValues)[number];

export type DecisionOntologyConcept =
  | "goal"
  | "hard_constraint"
  | "preference"
  | "allowed_fallback"
  | "exclusion"
  | "tradeoff"
  | "aversion"
  | "uncertainty"
  | "conflict"
  | "assumption"
  | "unresolved_concept"
  | "preserved_context";

export type VehicleDomainConcept =
  | "vehicle_make"
  | "vehicle_model"
  | "body_style"
  | "vehicle_category"
  | "fuel_type"
  | "drivetrain"
  | "transmission"
  | "seating_capacity"
  | "purchase_budget"
  | "ownership_budget"
  | "model_year"
  | "mileage"
  | "reliability"
  | "safety"
  | "fuel_economy"
  | "performance"
  | "resale_value"
  | "premium_appearance"
  | "comfort"
  | "quietness"
  | "camping_use"
  | "status_image"
  | "unknown";

export type ConversationOntologyIntent =
  | "direct_request"
  | "preference"
  | "exclusion"
  | "uncertainty"
  | "discovery_request"
  | "correction"
  | "comparison"
  | "compromise_permission"
  | "conflict_between_people"
  | "request_for_explanation";

export type SemanticProfileDestination =
  | "requiredMakes"
  | "preferredMakes"
  | "requiredMake"
  | "preferredMake"
  | "allowedMakes"
  | "excludedMakes"
  | "requiredBodyStyles"
  | "preferredBodyStyles"
  | "allowedBodyStyles"
  | "excludedBodyStyles"
  | "requiredVehicleCategories"
  | "preferredVehicleCategories"
  | "allowedVehicleCategories"
  | "excludedVehicleCategories"
  | "requiredFuelTypes"
  | "preferredFuelTypes"
  | "allowedFuelTypes"
  | "excludedFuelTypes"
  | "requiredDrivetrains"
  | "preferredDrivetrains"
  | "allowedDrivetrains"
  | "excludedDrivetrains"
  | "requiredTransmissions"
  | "preferredTransmissions"
  | "allowedTransmissions"
  | "excludedTransmissions"
  | "bodyStyle"
  | "requiredFuelType"
  | "drivetrainPreference"
  | "transmissionPreference"
  | "familySize"
  | "maxPurchaseBudget"
  | "monthlyBudget"
  | "minYear"
  | "maxMileage"
  | "reliabilityImportance"
  | "safetyPriority"
  | "fuelEconomyImportance"
  | "performanceImportance"
  | "resaleValueImportance";

export type SemanticMappingRule = {
  conceptType: VehicleDomainConcept;
  domainCategory: SemanticConceptGroup;
  sourceConcepts: SemanticConcept[];
  destinations: Partial<Record<CanonicalSemanticIntent, SemanticProfileDestination>>;
  supportByIntent: Record<CanonicalSemanticIntent, SemanticSupportStatus>;
  clarificationRule: string;
  preservationRule: string;
};

export type CarDomainConcept = {
  id: SemanticConcept;
  group: SemanticConceptGroup;
  allowedDestinations: string[];
  canBecomeHardConstraint: boolean;
  requiresExplicitConfirmationForHardConstraint: boolean;
};

export type CarDomainOntology = {
  version: string;
  concepts: Record<SemanticConcept, CarDomainConcept>;
};

function concept(
  id: SemanticConcept,
  group: SemanticConceptGroup,
  allowedDestinations: string[],
  canBecomeHardConstraint = false,
): CarDomainConcept {
  return {
    id,
    group,
    allowedDestinations,
    canBecomeHardConstraint,
    requiresExplicitConfirmationForHardConstraint: canBecomeHardConstraint,
  };
}

export const carDomainOntology: CarDomainOntology = {
  version: "2026-07-16.foundation-2.8a",
  concepts: {
    make: concept("make", "identity", ["requiredMakes", "preferredMakes", "allowedMakes", "excludedMakes"], true),
    model: concept("model", "identity", ["referenceEntities"], true),
    body_style: concept("body_style", "identity", ["requiredBodyStyles", "preferredBodyStyles", "allowedBodyStyles", "excludedBodyStyles"], true),
    vehicle_category: concept("vehicle_category", "identity", ["requiredVehicleCategories", "preferredVehicleCategories", "allowedVehicleCategories", "excludedVehicleCategories"]),
    powertrain: concept("powertrain", "identity", ["requiredFuelTypes", "preferredFuelTypes", "allowedFuelTypes", "excludedFuelTypes"], true),
    drivetrain: concept("drivetrain", "identity", ["requiredDrivetrains", "preferredDrivetrains", "allowedDrivetrains", "excludedDrivetrains"], true),
    transmission: concept("transmission", "identity", ["requiredTransmissions", "preferredTransmissions", "allowedTransmissions", "excludedTransmissions"], true),
    passenger_capacity: concept("passenger_capacity", "practical", ["familySize"], true),
    cargo: concept("cargo", "practical", ["cargoNeed"]),
    climate: concept("climate", "practical", ["climate"]),
    snow_use: concept("snow_use", "practical", ["climate", "drivetrainPreference"], true),
    commute: concept("commute", "practical", ["expectedAnnualMileage"]),
    parking: concept("parking", "practical", ["bodyStyle", "practicality"]),
    trip_distance: concept("trip_distance", "practical", ["expectedAnnualMileage"]),
    towing: concept("towing", "practical", ["vehicle_category"]),
    purchase_budget: concept("purchase_budget", "financial", ["maxPurchaseBudget"], true),
    monthly_budget: concept("monthly_budget", "financial", ["monthlyBudget"], true),
    insurance_sensitivity: concept("insurance_sensitivity", "financial", ["insuranceBudget", "insuranceCost"]),
    fuel_sensitivity: concept("fuel_sensitivity", "financial", ["minMpg", "fuelEnergyCost"]),
    maintenance_tolerance: concept("maintenance_tolerance", "financial", ["maintenanceRisk"]),
    depreciation_concern: concept("depreciation_concern", "financial", ["resaleValue"]),
    acceleration: concept("acceleration", "experience", ["performanceImportance", "performanceMinimum"]),
    handling: concept("handling", "experience", ["drivingPreferenceFit"]),
    comfort: concept("comfort", "experience", ["drivingPreferenceFit"]),
    quietness: concept("quietness", "experience", ["drivingPreferenceFit"]),
    technology: concept("technology", "experience", ["advancedFeaturesImportance"]),
    styling: concept("styling", "experience", ["drivingPreferenceFit"]),
    luxury_feel: concept("luxury_feel", "experience", ["drivingPreferenceFit"]),
    status_image: concept("status_image", "experience", ["drivingPreferenceFit"]),
    engagement: concept("engagement", "experience", ["performanceImportance"]),
    simplicity: concept("simplicity", "experience", ["first_car_suitability"]),
    reliability: concept("reliability", "risk", ["reliabilityImportance", "reliabilityMinimum"]),
    safety: concept("safety", "risk", ["safetyPriority", "safetyMinimum"]),
    repair_risk: concept("repair_risk", "risk", ["maintenanceRisk"]),
    first_car_suitability: concept("first_car_suitability", "risk", ["riskPosture"]),
    long_term_ownership: concept("long_term_ownership", "risk", ["resaleValue", "maintenanceRisk"]),
    resale_value: concept("resale_value", "risk", ["resaleValueImportance"]),
    unknown: concept("unknown", "experience", ["unresolvedConcepts"]),
  },
};

export function isKnownSemanticConcept(value: string): value is SemanticConcept {
  return value in carDomainOntology.concepts;
}

const allSupported: Record<CanonicalSemanticIntent, SemanticSupportStatus> = {
  required: "supported_and_used",
  preferred: "supported_and_used",
  allowed: "supported_and_used",
  excluded: "supported_and_used",
  uncertain: "supported_but_needs_confirmation",
};

function support(
  overrides: Partial<Record<CanonicalSemanticIntent, SemanticSupportStatus>> = {},
): Record<CanonicalSemanticIntent, SemanticSupportStatus> {
  return { ...allSupported, ...overrides };
}

export const semanticMappingRegistry: Record<VehicleDomainConcept, SemanticMappingRule> = {
  vehicle_make: {
    conceptType: "vehicle_make",
    domainCategory: "identity",
    sourceConcepts: ["make"],
    destinations: {
      required: "requiredMakes",
      preferred: "preferredMakes",
      allowed: "allowedMakes",
      excluded: "excludedMakes",
    },
    supportByIntent: allSupported,
    clarificationRule: "Clarify whether an underspecified make is required, preferred, allowed, or excluded.",
    preservationRule: "Preserve the make and its intent until the user confirms or revises it.",
  },
  vehicle_model: {
    conceptType: "vehicle_model",
    domainCategory: "identity",
    sourceConcepts: ["model"],
    destinations: {},
    supportByIntent: support({
      required: "understood_but_not_scored",
      preferred: "understood_but_not_scored",
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Clarify the model meaning because BuyerProfile has no model filter.",
    preservationRule: "Preserve model intent as advisor context without filtering the catalog.",
  },
  body_style: {
    conceptType: "body_style",
    domainCategory: "identity",
    sourceConcepts: ["body_style"],
    destinations: { required: "requiredBodyStyles", preferred: "preferredBodyStyles", allowed: "allowedBodyStyles", excluded: "excludedBodyStyles" },
    supportByIntent: allSupported,
    clarificationRule: "Clarify an underspecified body style before treating it as a filter.",
    preservationRule: "Preserve the body-style intent and apply it consistently during qualification.",
  },
  vehicle_category: {
    conceptType: "vehicle_category",
    domainCategory: "identity",
    sourceConcepts: ["vehicle_category"],
    destinations: { required: "requiredVehicleCategories", preferred: "preferredVehicleCategories", allowed: "allowedVehicleCategories", excluded: "excludedVehicleCategories" },
    supportByIntent: allSupported,
    clarificationRule: "Clarify categories that do not normalize to a supported passenger-vehicle body style.",
    preservationRule: "Preserve unscored or out-of-scope categories without generating a recommendation.",
  },
  fuel_type: {
    conceptType: "fuel_type",
    domainCategory: "identity",
    sourceConcepts: ["powertrain"],
    destinations: { required: "requiredFuelTypes", preferred: "preferredFuelTypes", allowed: "allowedFuelTypes", excluded: "excludedFuelTypes" },
    supportByIntent: allSupported,
    clarificationRule: "Clarify an underspecified fuel type before treating it as a filter.",
    preservationRule: "Preserve fuel intent and use it during qualification when supported.",
  },
  drivetrain: {
    conceptType: "drivetrain",
    domainCategory: "identity",
    sourceConcepts: ["drivetrain", "snow_use"],
    destinations: { required: "requiredDrivetrains", preferred: "preferredDrivetrains", allowed: "allowedDrivetrains", excluded: "excludedDrivetrains" },
    supportByIntent: allSupported,
    clarificationRule: "Clarify drivetrain strength before applying a hard filter.",
    preservationRule: "Preserve unsupported drivetrain sets as advisor context.",
  },
  transmission: {
    conceptType: "transmission",
    domainCategory: "identity",
    sourceConcepts: ["transmission"],
    destinations: { required: "requiredTransmissions", preferred: "preferredTransmissions", allowed: "allowedTransmissions", excluded: "excludedTransmissions" },
    supportByIntent: allSupported,
    clarificationRule: "Clarify transmission strength before applying a hard filter.",
    preservationRule: "Preserve unsupported transmission sets as advisor context.",
  },
  seating_capacity: {
    conceptType: "seating_capacity",
    domainCategory: "practical",
    sourceConcepts: ["passenger_capacity"],
    destinations: { required: "familySize", preferred: "familySize" },
    supportByIntent: support({
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Clarify the number of regular passengers when capacity is vague.",
    preservationRule: "Preserve vague seating needs until a numeric capacity is confirmed.",
  },
  purchase_budget: {
    conceptType: "purchase_budget",
    domainCategory: "financial",
    sourceConcepts: ["purchase_budget"],
    destinations: { required: "maxPurchaseBudget", preferred: "maxPurchaseBudget" },
    supportByIntent: support({
      preferred: "supported_but_needs_confirmation",
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify whether a budget is a maximum or a target.",
    preservationRule: "Preserve target-budget language until a maximum is confirmed.",
  },
  ownership_budget: {
    conceptType: "ownership_budget",
    domainCategory: "financial",
    sourceConcepts: ["monthly_budget", "insurance_sensitivity", "maintenance_tolerance"],
    destinations: { required: "monthlyBudget" },
    supportByIntent: support({
      preferred: "supported_but_needs_confirmation",
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify whether the amount is a hard monthly limit.",
    preservationRule: "Preserve ownership-cost sensitivity when no numeric limit exists.",
  },
  model_year: {
    conceptType: "model_year",
    domainCategory: "identity",
    sourceConcepts: [],
    destinations: { required: "minYear" },
    supportByIntent: support({
      preferred: "supported_but_needs_confirmation",
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify whether the year is a minimum.",
    preservationRule: "Preserve non-minimum year preferences without filtering.",
  },
  mileage: {
    conceptType: "mileage",
    domainCategory: "practical",
    sourceConcepts: ["commute", "trip_distance"],
    destinations: { required: "maxMileage" },
    supportByIntent: support({
      preferred: "supported_but_needs_confirmation",
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify whether mileage means annual use or maximum odometer mileage.",
    preservationRule: "Preserve ambiguous mileage context without applying the wrong field.",
  },
  reliability: {
    conceptType: "reliability",
    domainCategory: "risk",
    sourceConcepts: ["reliability", "repair_risk", "long_term_ownership"],
    destinations: { required: "reliabilityImportance", preferred: "reliabilityImportance" },
    supportByIntent: support({
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Use importance for general priority; require a separate numeric minimum for exclusion.",
    preservationRule: "Preserve reliability intent without inventing a minimum threshold.",
  },
  safety: {
    conceptType: "safety",
    domainCategory: "risk",
    sourceConcepts: ["safety"],
    destinations: { required: "safetyPriority", preferred: "safetyPriority" },
    supportByIntent: support({
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Use priority for general safety intent; require a numeric minimum for exclusion.",
    preservationRule: "Preserve safety intent without inventing a minimum threshold.",
  },
  fuel_economy: {
    conceptType: "fuel_economy",
    domainCategory: "financial",
    sourceConcepts: ["fuel_sensitivity"],
    destinations: { required: "fuelEconomyImportance", preferred: "fuelEconomyImportance" },
    supportByIntent: support({
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify a minimum MPG separately from fuel-economy importance.",
    preservationRule: "Preserve fuel-cost intent without inventing an MPG threshold.",
  },
  performance: {
    conceptType: "performance",
    domainCategory: "experience",
    sourceConcepts: ["acceleration", "handling", "engagement"],
    destinations: { required: "performanceImportance", preferred: "performanceImportance" },
    supportByIntent: support({
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify which performance quality matters when the request is vague.",
    preservationRule: "Preserve specific performance meaning separately from the ranking importance.",
  },
  resale_value: {
    conceptType: "resale_value",
    domainCategory: "risk",
    sourceConcepts: ["resale_value", "depreciation_concern"],
    destinations: { required: "resaleValueImportance", preferred: "resaleValueImportance" },
    supportByIntent: support({
      allowed: "unresolved",
      excluded: "unresolved",
    }),
    clarificationRule: "Clarify resale importance if it may change ranking.",
    preservationRule: "Preserve resale concern without inventing a minimum.",
  },
  premium_appearance: {
    conceptType: "premium_appearance",
    domainCategory: "experience",
    sourceConcepts: ["styling", "luxury_feel"],
    destinations: {},
    supportByIntent: support({
      required: "understood_but_not_scored",
      preferred: "understood_but_not_scored",
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Ask for an actionable proxy only when the request has no supported search field.",
    preservationRule: "Preserve appearance intent without translating it into make or performance.",
  },
  comfort: {
    conceptType: "comfort",
    domainCategory: "experience",
    sourceConcepts: ["comfort"],
    destinations: {},
    supportByIntent: support({
      required: "understood_but_not_scored",
      preferred: "understood_but_not_scored",
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Ask for an actionable proxy only when necessary.",
    preservationRule: "Preserve comfort intent without fabricating a comfort score.",
  },
  quietness: {
    conceptType: "quietness",
    domainCategory: "experience",
    sourceConcepts: ["quietness"],
    destinations: {},
    supportByIntent: support({
      required: "understood_but_not_scored",
      preferred: "understood_but_not_scored",
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Ask for an actionable proxy only when necessary.",
    preservationRule: "Preserve quietness intent without fabricating a quietness score.",
  },
  camping_use: {
    conceptType: "camping_use",
    domainCategory: "practical",
    sourceConcepts: ["cargo", "towing"],
    destinations: {},
    supportByIntent: support({
      required: "understood_but_not_scored",
      preferred: "understood_but_not_scored",
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Clarify cargo, rough-road capability, sleeping space, or towing.",
    preservationRule: "Preserve camping use until it maps to a supported objective field.",
  },
  status_image: {
    conceptType: "status_image",
    domainCategory: "experience",
    sourceConcepts: ["status_image"],
    destinations: {},
    supportByIntent: support({
      required: "understood_but_not_scored",
      preferred: "understood_but_not_scored",
      allowed: "understood_but_not_scored",
      excluded: "understood_but_not_scored",
    }),
    clarificationRule: "Ask for an actionable proxy only when the request has no supported search field.",
    preservationRule: "Preserve status intent without translating it into a luxury make.",
  },
  unknown: {
    conceptType: "unknown",
    domainCategory: "experience",
    sourceConcepts: ["unknown"],
    destinations: {},
    supportByIntent: {
      required: "unresolved",
      preferred: "unresolved",
      allowed: "unresolved",
      excluded: "unresolved",
      uncertain: "unresolved",
    },
    clarificationRule: "Ask one focused question about the unresolved concept.",
    preservationRule: "Preserve the original source text without applying a profile update.",
  },
};

export function getMappingRuleForSemanticConcept(concept: SemanticConcept) {
  return Object.values(semanticMappingRegistry).find((rule) => rule.sourceConcepts.includes(concept))
    || semanticMappingRegistry.unknown;
}
