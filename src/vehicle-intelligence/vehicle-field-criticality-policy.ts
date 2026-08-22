import { canonicalVehicleFieldPaths, type CanonicalVehicleFieldPath } from "../../types/canonicalVehicle";
import type {
  CanonicalVehicleFieldPolicy,
  FieldMissingBehavior,
  FieldStaleBehavior,
  PublicationCriticality,
  VehicleDecisionDimension,
  VehicleFieldFreshnessClass,
  VehicleFieldRecommendationRole,
} from "../../types/vehicleFieldPolicy";
import type { ScoreWeights } from "../../types/buyer";

export const vehicleFieldCriticalityPolicyVersion = "1.0.0" as const;

type PolicyInput = {
  concept: string;
  criticality: PublicationCriticality;
  roles?: VehicleFieldRecommendationRole[];
  scores?: (keyof ScoreWeights)[];
  freshness?: VehicleFieldFreshnessClass;
  dimensions?: VehicleDecisionDimension[];
  missing?: FieldMissingBehavior;
  stale?: FieldStaleBehavior;
};

const field = (
  fieldPath: CanonicalVehicleFieldPath,
  input: PolicyInput,
): CanonicalVehicleFieldPolicy => ({
  fieldPath,
  ontologyConcept: input.concept,
  publicationCriticality: input.criticality,
  recommendationRoles: input.roles ?? ["EXPLANATION"],
  scoringCategories: input.scores ?? [],
  freshnessClass: input.freshness ?? "STATIC",
  missingBehavior: input.missing ?? (input.criticality === "REQUIRED_IDENTITY" ? "BLOCK_PUBLICATION" : "ALLOW_WITH_DIAGNOSTIC"),
  staleBehavior: input.stale ?? (input.criticality === "REQUIRED_IDENTITY" ? "BLOCK_PUBLICATION" : "DIAGNOSE_AND_EXCLUDE_FROM_DECISION"),
  supportedDecisionDimensions: input.dimensions ?? [],
});

export const canonicalVehicleFieldPolicy = {
  "identity.make": field("identity.make", { concept: "make", criticality: "REQUIRED_IDENTITY", roles: ["QUALIFICATION", "EXPLANATION"], dimensions: ["make"] }),
  "identity.model": field("identity.model", { concept: "model", criticality: "REQUIRED_IDENTITY", roles: ["QUALIFICATION", "EXPLANATION"], dimensions: ["model"] }),
  "identity.generation": field("identity.generation", { concept: "generation", criticality: "CORE_VEHICLE" }),
  "identity.trim": field("identity.trim", { concept: "trim", criticality: "CORE_VEHICLE" }),
  "identity.modelYear": field("identity.modelYear", { concept: "model_year", criticality: "REQUIRED_IDENTITY", roles: ["QUALIFICATION", "EXPLANATION"], dimensions: ["modelYear"] }),
  "identity.bodyStyle": field("identity.bodyStyle", { concept: "body_style", criticality: "CORE_VEHICLE", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["bodyStyle", "practicality"] }),
  "identity.vehicleCategory": field("identity.vehicleCategory", { concept: "vehicle_category", criticality: "CORE_VEHICLE", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["vehicleCategory", "practicality"] }),
  "identity.drivetrain": field("identity.drivetrain", { concept: "drivetrain", criticality: "CORE_VEHICLE", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["practicality", "drivingPreferenceFit"], dimensions: ["drivetrain", "practicality", "performance"] }),
  "identity.transmission": field("identity.transmission", { concept: "transmission", criticality: "CORE_VEHICLE", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["drivingPreferenceFit"], dimensions: ["transmission", "performance"] }),
  "identity.fuelType": field("identity.fuelType", { concept: "fuel_type", criticality: "CORE_VEHICLE", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["fuelEnergyCost"], dimensions: ["fuelType", "fuelEnergyCost", "fuelEconomy", "evRange"] }),
  "identity.odometerMileage": field("identity.odometerMileage", { concept: "odometer_mileage", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["affordability", "reliability", "resaleValue"], freshness: "HIGHLY_DYNAMIC", dimensions: ["mileage", "affordability", "reliability", "resaleValue"] }),
  "identity.condition": field("identity.condition", { concept: "condition", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["affordability", "maintenanceRisk", "resaleValue"], freshness: "HIGHLY_DYNAMIC", dimensions: ["condition", "affordability", "maintenanceRisk", "resaleValue"] }),

  "financial.purchasePrice": field("financial.purchasePrice", { concept: "purchase_price", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["affordability"], freshness: "HIGHLY_DYNAMIC", dimensions: ["purchaseBudget", "affordability"] }),
  "financial.monthlyPayment": field("financial.monthlyPayment", { concept: "monthly_payment", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["affordability"], freshness: "HIGHLY_DYNAMIC", dimensions: ["monthlyPayment", "affordability"] }),
  "financial.totalOwnershipCost": field("financial.totalOwnershipCost", { concept: "ownership_cost", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["affordability"], freshness: "DYNAMIC", dimensions: ["totalOwnershipBudget", "affordability"] }),
  "financial.maintenanceCost": field("financial.maintenanceCost", { concept: "maintenance_cost", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["maintenanceRisk"], freshness: "SLOW_CHANGING", dimensions: ["maintenanceRisk"] }),
  "financial.insuranceCost": field("financial.insuranceCost", { concept: "insurance_cost", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["insuranceCost"], freshness: "DYNAMIC", dimensions: ["insuranceCost"] }),
  "financial.depreciation": field("financial.depreciation", { concept: "depreciation", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["resaleValue", "affordability"], freshness: "DYNAMIC", dimensions: ["resaleValue", "affordability"] }),
  "financial.resaleValue": field("financial.resaleValue", { concept: "resale_value", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["resaleValue"], freshness: "SLOW_CHANGING", dimensions: ["resaleValue"] }),
  "financial.fuelEnergyCost": field("financial.fuelEnergyCost", { concept: "fuel_cost", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["fuelEnergyCost"], freshness: "DYNAMIC", dimensions: ["fuelEnergyCost"] }),

  "safety.crashSafety": field("safety.crashSafety", { concept: "crash_safety", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["safety"], freshness: "SLOW_CHANGING", dimensions: ["safety"] }),
  "safety.activeSafety": field("safety.activeSafety", { concept: "active_safety", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["safety"], freshness: "SLOW_CHANGING", dimensions: ["safety"] }),
  "safety.passiveSafety": field("safety.passiveSafety", { concept: "passive_safety", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["safety"], freshness: "SLOW_CHANGING", dimensions: ["safety"] }),
  "safety.driverAssistanceSafety": field("safety.driverAssistanceSafety", { concept: "driver_assistance", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["safety"], freshness: "SLOW_CHANGING", dimensions: ["safety", "technology"] }),

  "reliability.longTermReliability": field("reliability.longTermReliability", { concept: "long_term_reliability", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["reliability"], freshness: "SLOW_CHANGING", dimensions: ["reliability"] }),
  "reliability.repairFrequency": field("reliability.repairFrequency", { concept: "repair_frequency", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["reliability", "maintenanceRisk"], freshness: "SLOW_CHANGING", dimensions: ["reliability", "maintenanceRisk"] }),
  "reliability.repairSeverity": field("reliability.repairSeverity", { concept: "repair_severity", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["reliability", "maintenanceRisk"], freshness: "SLOW_CHANGING", dimensions: ["reliability", "maintenanceRisk"] }),
  "reliability.knownIssues": field("reliability.knownIssues", { concept: "known_issues", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["reliability", "maintenanceRisk"], freshness: "SLOW_CHANGING", dimensions: ["reliability", "maintenanceRisk"] }),

  "driving.acceleration": field("driving.acceleration", { concept: "acceleration", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["drivingPreferenceFit"], dimensions: ["performance"] }),
  "driving.handling": field("driving.handling", { concept: "handling", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["drivingPreferenceFit"], dimensions: ["performance"] }),
  "driving.steering": field("driving.steering", { concept: "steering", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["drivingPreferenceFit"], dimensions: ["performance"] }),
  "driving.rideControl": field("driving.rideControl", { concept: "ride", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["drivingPreferenceFit"], dimensions: ["performance", "comfort"] }),
  "driving.braking": field("driving.braking", { concept: "braking", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["drivingPreferenceFit", "safety"], dimensions: ["performance", "safety"] }),
  "driving.offRoadCapability": field("driving.offRoadCapability", { concept: "off_road", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["practicality", "drivingPreferenceFit"], dimensions: ["performance", "practicality", "lifestyle"] }),
  "driving.towingCapacity": field("driving.towingCapacity", { concept: "towing", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["practicality", "lifestyle"] }),

  "comfort.seatComfort": field("comfort.seatComfort", { concept: "seat_comfort", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["comfort"] }),
  "comfort.suspensionComfort": field("comfort.suspensionComfort", { concept: "suspension_comfort", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["comfort"] }),
  "comfort.cabinNoise": field("comfort.cabinNoise", { concept: "cabin_noise", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["comfort"] }),
  "comfort.rideSmoothness": field("comfort.rideSmoothness", { concept: "ride_smoothness", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["comfort"] }),
  "comfort.climateComfort": field("comfort.climateComfort", { concept: "climate_comfort", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["comfort"] }),

  "technology.infotainment": field("technology.infotainment", { concept: "infotainment", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], dimensions: ["technology"] }),
  "technology.smartphoneIntegration": field("technology.smartphoneIntegration", { concept: "smartphone_integration", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], dimensions: ["technology"] }),
  "technology.navigation": field("technology.navigation", { concept: "navigation", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], dimensions: ["technology"] }),
  "technology.driverAssistanceTechnology": field("technology.driverAssistanceTechnology", { concept: "driver_assistance", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["safety"], dimensions: ["technology", "safety"] }),
  "technology.softwareExperience": field("technology.softwareExperience", { concept: "software", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["technology"] }),
  "technology.chargingTechnology": field("technology.chargingTechnology", { concept: "charging", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["technology", "charging"] }),

  "practicality.cargoCapacity": field("practicality.cargoCapacity", { concept: "cargo", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["practicality", "lifestyle"] }),
  "practicality.passengerRoom": field("practicality.passengerRoom", { concept: "passenger_room", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["seating", "practicality", "lifestyle"] }),
  "practicality.parkingEase": field("practicality.parkingEase", { concept: "parking_ease", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["practicality", "lifestyle"] }),
  "practicality.outwardVisibility": field("practicality.outwardVisibility", { concept: "visibility", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["practicality", "safety"], dimensions: ["practicality", "safety"] }),
  "practicality.storageUtility": field("practicality.storageUtility", { concept: "storage", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["practicality", "lifestyle"] }),
  "practicality.interiorFlexibility": field("practicality.interiorFlexibility", { concept: "flexibility", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["practicality"], dimensions: ["practicality", "lifestyle"] }),

  "environment.fuelEconomy": field("environment.fuelEconomy", { concept: "fuel_economy", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], scores: ["fuelEnergyCost"], dimensions: ["fuelEconomy", "fuelEnergyCost"] }),
  "environment.emissions": field("environment.emissions", { concept: "emissions", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], dimensions: ["emissions"] }),
  "environment.evRange": field("environment.evRange", { concept: "ev_range", criticality: "DECISION_RELEVANT", roles: ["QUALIFICATION", "SCORING", "EXPLANATION"], dimensions: ["evRange"] }),
  "environment.chargingSpeed": field("environment.chargingSpeed", { concept: "charging_speed", criticality: "DECISION_RELEVANT", roles: ["SCORING", "EXPLANATION"], dimensions: ["charging"] }),

  "image.luxuryPerception": field("image.luxuryPerception", { concept: "luxury_perception", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["image"] }),
  "image.sportyImage": field("image.sportyImage", { concept: "sporty_image", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["image"] }),
  "image.ruggedImage": field("image.ruggedImage", { concept: "rugged_image", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["image"] }),
  "image.premiumImage": field("image.premiumImage", { concept: "premium_image", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["image"] }),
  "image.understatedImage": field("image.understatedImage", { concept: "understated_image", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["image"] }),

  "lifestyle.collegeStudentFit": field("lifestyle.collegeStudentFit", { concept: "college_student_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.familyFit": field("lifestyle.familyFit", { concept: "family_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.campingFit": field("lifestyle.campingFit", { concept: "camping_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.petFit": field("lifestyle.petFit", { concept: "pet_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.commutingFit": field("lifestyle.commutingFit", { concept: "commuting_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.snowFit": field("lifestyle.snowFit", { concept: "snow_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.roadTripFit": field("lifestyle.roadTripFit", { concept: "road_trip_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.cityFit": field("lifestyle.cityFit", { concept: "city_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),
  "lifestyle.businessFit": field("lifestyle.businessFit", { concept: "business_fit", criticality: "OPTIONAL_ENRICHMENT", roles: ["SCORING", "EXPLANATION"], freshness: "SLOW_CHANGING", dimensions: ["lifestyle"] }),

  "confidence.dataQuality": field("confidence.dataQuality", { concept: "data_quality", criticality: "OPTIONAL_ENRICHMENT", roles: ["CONFIDENCE", "EXPLANATION"], freshness: "DYNAMIC" }),
  "confidence.evidenceQuality": field("confidence.evidenceQuality", { concept: "evidence_quality", criticality: "OPTIONAL_ENRICHMENT", roles: ["CONFIDENCE", "EXPLANATION"], freshness: "DYNAMIC" }),
  "confidence.sourceAgreement": field("confidence.sourceAgreement", { concept: "source_agreement", criticality: "OPTIONAL_ENRICHMENT", roles: ["CONFIDENCE", "EXPLANATION"], freshness: "DYNAMIC" }),
} as const satisfies Record<CanonicalVehicleFieldPath, CanonicalVehicleFieldPolicy>;

export const requiredPublicationIdentityFields = Object.freeze(
  canonicalVehicleFieldPaths.filter(
    (path) => canonicalVehicleFieldPolicy[path].publicationCriticality === "REQUIRED_IDENTITY",
  ),
);

export function getCanonicalVehicleFieldPolicy(path: CanonicalVehicleFieldPath) {
  return canonicalVehicleFieldPolicy[path];
}

export function isPublicationBlockingMissingField(path: CanonicalVehicleFieldPath) {
  return canonicalVehicleFieldPolicy[path].missingBehavior === "BLOCK_PUBLICATION";
}

export function isPublicationBlockingStaleField(path: CanonicalVehicleFieldPath) {
  return canonicalVehicleFieldPolicy[path].staleBehavior === "BLOCK_PUBLICATION";
}

export function assertCompleteCanonicalVehicleFieldPolicy() {
  const policyPaths = Object.keys(canonicalVehicleFieldPolicy).sort();
  const canonicalPaths = [...canonicalVehicleFieldPaths].sort();
  if (policyPaths.length !== 73 || policyPaths.length !== canonicalPaths.length) {
    throw new Error(`Canonical vehicle field policy must cover all 73 fields; received ${policyPaths.length}.`);
  }
  if (policyPaths.some((path, index) => path !== canonicalPaths[index])) {
    throw new Error("Canonical vehicle field policy paths do not match the authoritative CVR schema.");
  }
}
