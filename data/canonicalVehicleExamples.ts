import {
  canonicalVehicleSchemaVersion,
  type CanonicalConfidence,
  type CanonicalDatum,
  type CanonicalMissingReason,
  type CanonicalTechnologyAssessment,
  type CanonicalUnit,
  type CanonicalValueStatus,
  type CanonicalVehicleRecord,
} from "../types/canonicalVehicle";

const exampleDate = "2026-07-28";

function confidence(
  score: number | null,
  basis: string[],
  sourceAgreement: CanonicalConfidence["sourceAgreement"] = "single_source",
): CanonicalConfidence {
  return {
    score,
    level: score === null ? "unknown" : score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low",
    sourceAgreement,
    basis,
  };
}

function datum<T, Unit extends CanonicalUnit>(
  value: T,
  unit: Unit,
  evidenceIds: string[],
  options: {
    status?: Exclude<CanonicalValueStatus, "missing">;
    confidenceScore?: number;
    estimationMethod?: string | null;
    measurementContext?: Record<string, string | number | boolean> | null;
    sourceAgreement?: CanonicalConfidence["sourceAgreement"];
  } = {},
): CanonicalDatum<T, Unit> {
  const status = options.status || "sourced";
  return {
    value,
    unit,
    status,
    confidence: confidence(
      options.confidenceScore ?? 0.8,
      [`Illustrative ${status} value for the CVR example.`],
      options.sourceAgreement,
    ),
    evidenceIds,
    estimated: status === "estimated",
    estimationMethod: options.estimationMethod ?? null,
    asOfDate: exampleDate,
    measurementContext: options.measurementContext ?? null,
    missingReason: null,
  };
}

function missing<T, Unit extends CanonicalUnit>(
  unit: Unit,
  missingReason: CanonicalMissingReason = "not_collected",
): CanonicalDatum<T, Unit> {
  return {
    value: null,
    unit,
    status: "missing",
    confidence: confidence(null, ["No usable evidence is available."], "not_applicable"),
    evidenceIds: [],
    estimated: false,
    estimationMethod: null,
    asOfDate: null,
    measurementContext: null,
    missingReason,
  };
}

function technology(
  score: number,
  verifiedFeatures: string[],
  unavailableFeatures: string[] = [],
  unknownFeatures: string[] = [],
): CanonicalTechnologyAssessment {
  return { score, verifiedFeatures, unavailableFeatures, unknownFeatures };
}

/**
 * Illustrative fixture only. Values exercise every CVR field and are not
 * production vehicle evidence or a recommendation-engine input.
 */
export const fullyPopulatedPriusRecord = {
  schemaVersion: canonicalVehicleSchemaVersion,
  recordId: "example:2021-toyota-prius-prime-le",
  recordScope: "configuration",
  recordStatus: "example",
  createdAt: exampleDate,
  updatedAt: exampleDate,
  evidence: [
    {
      evidenceId: "example:prius:identity",
      sourceType: "example_fixture",
      providerName: "Phase 3.2B illustrative fixture",
      sourceRecordId: "identity",
      sourceUrl: null,
      scope: "configuration",
      observedAt: exampleDate,
      retrievedAt: exampleDate,
      market: "US",
      methodology: "Synthetic canonical example; not production evidence.",
      license: "Project documentation fixture",
    },
    {
      evidenceId: "example:prius:listing",
      sourceType: "example_fixture",
      providerName: "Phase 3.2B illustrative fixture",
      sourceRecordId: "listing",
      sourceUrl: null,
      scope: "listing",
      observedAt: exampleDate,
      retrievedAt: exampleDate,
      market: "US",
      methodology: "Synthetic listing and ownership example.",
      license: "Project documentation fixture",
    },
    {
      evidenceId: "example:prius:safety",
      sourceType: "example_fixture",
      providerName: "Phase 3.2B illustrative fixture",
      sourceRecordId: "safety",
      sourceUrl: null,
      scope: "model_year",
      observedAt: exampleDate,
      retrievedAt: exampleDate,
      market: "US",
      methodology: "Synthetic normalized safety example.",
      license: "Project documentation fixture",
    },
    {
      evidenceId: "example:prius:ownership",
      sourceType: "example_fixture",
      providerName: "Phase 3.2B illustrative fixture",
      sourceRecordId: "ownership",
      sourceUrl: null,
      scope: "population",
      observedAt: exampleDate,
      retrievedAt: exampleDate,
      market: "US",
      methodology: "Synthetic ownership and reliability example.",
      license: "Project documentation fixture",
    },
    {
      evidenceId: "example:prius:review",
      sourceType: "example_fixture",
      providerName: "Phase 3.2B illustrative fixture",
      sourceRecordId: "review",
      sourceUrl: null,
      scope: "configuration",
      observedAt: exampleDate,
      retrievedAt: exampleDate,
      market: "US",
      methodology: "Synthetic structured review and perception example.",
      license: "Project documentation fixture",
    },
  ],
  identity: {
    make: datum("Toyota", "none", ["example:prius:identity"], { confidenceScore: 0.99 }),
    model: datum("Prius Prime", "none", ["example:prius:identity"], { confidenceScore: 0.99 }),
    generation: datum("XW50", "none", ["example:prius:identity"], { confidenceScore: 0.9 }),
    trim: datum("LE", "none", ["example:prius:identity"], { confidenceScore: 0.95 }),
    modelYear: datum(2021, "year", ["example:prius:identity"], { confidenceScore: 0.99 }),
    bodyStyle: datum("hatchback", "none", ["example:prius:identity"], { confidenceScore: 0.95 }),
    vehicleCategory: datum("compact_car", "none", ["example:prius:identity"], { confidenceScore: 0.85 }),
    drivetrain: datum("FWD", "none", ["example:prius:identity"], { confidenceScore: 0.98 }),
    transmission: datum("cvt", "none", ["example:prius:identity"], { confidenceScore: 0.98 }),
    fuelType: datum("plug_in_hybrid", "none", ["example:prius:identity"], { confidenceScore: 0.98 }),
    odometerMileage: datum(48000, "miles", ["example:prius:listing"], { confidenceScore: 0.9 }),
    condition: datum(82, "score_0_100", ["example:prius:listing"], {
      status: "estimated",
      confidenceScore: 0.62,
      estimationMethod: "Illustrative condition normalization.",
    }),
  },
  financial: {
    purchasePrice: datum(22900, "usd", ["example:prius:listing"], { confidenceScore: 0.82 }),
    monthlyPayment: datum(418, "usd_per_month", ["example:prius:listing"], {
      status: "derived",
      confidenceScore: 0.72,
      estimationMethod: "Illustrative financing assumptions.",
    }),
    totalOwnershipCost: datum(612, "usd_per_month", ["example:prius:listing", "example:prius:ownership"], {
      status: "derived",
      confidenceScore: 0.68,
      estimationMethod: "Payment excluded; insurance, maintenance, energy, and depreciation combined.",
      sourceAgreement: "agrees",
    }),
    maintenanceCost: datum(74, "usd_per_month", ["example:prius:ownership"], {
      status: "estimated",
      confidenceScore: 0.66,
      estimationMethod: "Illustrative population estimate.",
    }),
    insuranceCost: datum(148, "usd_per_month", ["example:prius:ownership"], {
      status: "estimated",
      confidenceScore: 0.58,
      estimationMethod: "Illustrative driver-neutral estimate.",
    }),
    depreciation: datum(2820, "usd_per_year", ["example:prius:listing", "example:prius:ownership"], {
      status: "estimated",
      confidenceScore: 0.64,
      estimationMethod: "Illustrative retained-value curve.",
    }),
    resaleValue: datum(81, "score_0_100", ["example:prius:ownership"], {
      status: "estimated",
      confidenceScore: 0.7,
      estimationMethod: "Illustrative resale normalization.",
    }),
    fuelEnergyCost: datum(63, "usd_per_month", ["example:prius:ownership"], {
      status: "derived",
      confidenceScore: 0.7,
      estimationMethod: "Illustrative annual mileage, electricity, and gasoline assumptions.",
    }),
  },
  safety: {
    crashSafety: datum(88, "score_0_100", ["example:prius:safety"], { confidenceScore: 0.8 }),
    activeSafety: datum(86, "score_0_100", ["example:prius:safety"], { confidenceScore: 0.78 }),
    passiveSafety: datum(84, "score_0_100", ["example:prius:safety"], { confidenceScore: 0.76 }),
    driverAssistanceSafety: datum(83, "score_0_100", ["example:prius:safety"], { confidenceScore: 0.74 }),
  },
  reliability: {
    longTermReliability: datum(87, "score_0_100", ["example:prius:ownership"], { confidenceScore: 0.76 }),
    repairFrequency: datum(0.22, "repairs_per_10k_miles", ["example:prius:ownership"], {
      status: "estimated",
      confidenceScore: 0.6,
      estimationMethod: "Illustrative repair-population rate.",
    }),
    repairSeverity: datum(520, "usd", ["example:prius:ownership"], {
      status: "estimated",
      confidenceScore: 0.58,
      estimationMethod: "Illustrative average unscheduled repair severity.",
    }),
    knownIssues: datum([
      {
        issueId: "example:prius:issue-1",
        title: "Illustrative model-specific inspection item",
        description: "Example only; a production record must replace this with sourced generation and configuration evidence.",
        affectedModelYears: [2021],
        affectedConfigurations: ["LE"],
        frequency: "unknown",
        severity: "unknown",
        evidenceIds: ["example:prius:ownership"],
      },
    ], "none", ["example:prius:ownership"], { confidenceScore: 0.5 }),
  },
  driving: {
    acceleration: datum(54, "score_0_100", ["example:prius:review"], { confidenceScore: 0.68 }),
    handling: datum(60, "score_0_100", ["example:prius:review"], { confidenceScore: 0.66 }),
    steering: datum(58, "score_0_100", ["example:prius:review"], { confidenceScore: 0.62 }),
    rideControl: datum(69, "score_0_100", ["example:prius:review"], { confidenceScore: 0.64 }),
    braking: datum(71, "score_0_100", ["example:prius:review"], { confidenceScore: 0.64 }),
    offRoadCapability: datum(18, "score_0_100", ["example:prius:review"], { confidenceScore: 0.7 }),
    towingCapacity: datum(0, "pounds", ["example:prius:identity"], {
      confidenceScore: 0.75,
      measurementContext: { meaning: "No rated towing capability in this illustrative configuration." },
    }),
  },
  comfort: {
    seatComfort: datum(72, "score_0_100", ["example:prius:review"], { confidenceScore: 0.6 }),
    suspensionComfort: datum(74, "score_0_100", ["example:prius:review"], { confidenceScore: 0.6 }),
    cabinNoise: datum(68, "decibels_a_weighted", ["example:prius:review"], {
      confidenceScore: 0.57,
      measurementContext: { speedMph: 70, surface: "illustrative standardized road" },
    }),
    rideSmoothness: datum(73, "score_0_100", ["example:prius:review"], { confidenceScore: 0.6 }),
    climateComfort: datum(70, "score_0_100", ["example:prius:review"], { confidenceScore: 0.58 }),
  },
  technology: {
    infotainment: datum(technology(66, ["Touchscreen", "Bluetooth"]), "none", ["example:prius:review"], { confidenceScore: 0.67 }),
    smartphoneIntegration: datum(technology(76, ["Apple CarPlay"], [], ["Android Auto"]), "none", ["example:prius:review"], { confidenceScore: 0.65 }),
    navigation: datum(technology(45, [], ["Built-in navigation"], []), "none", ["example:prius:review"], { confidenceScore: 0.62 }),
    driverAssistanceTechnology: datum(technology(82, ["Automatic emergency braking", "Lane support"]), "none", ["example:prius:safety"], { confidenceScore: 0.72 }),
    softwareExperience: datum(technology(61, ["Connected interface"], [], ["Long-term update support"]), "none", ["example:prius:review"], { confidenceScore: 0.55 }),
    chargingTechnology: datum(technology(52, ["AC charging"], ["DC fast charging"], []), "none", ["example:prius:identity"], { confidenceScore: 0.72 }),
  },
  practicality: {
    cargoCapacity: datum(19.8, "cubic_feet", ["example:prius:identity"], { confidenceScore: 0.82 }),
    passengerRoom: datum(71, "score_0_100", ["example:prius:review"], { confidenceScore: 0.62 }),
    parkingEase: datum(84, "score_0_100", ["example:prius:review"], { confidenceScore: 0.62 }),
    outwardVisibility: datum(64, "score_0_100", ["example:prius:review"], { confidenceScore: 0.58 }),
    storageUtility: datum(68, "score_0_100", ["example:prius:review"], { confidenceScore: 0.57 }),
    interiorFlexibility: datum(74, "score_0_100", ["example:prius:review"], { confidenceScore: 0.6 }),
  },
  environment: {
    fuelEconomy: datum(133, "mpge", ["example:prius:identity"], {
      confidenceScore: 0.85,
      measurementContext: { cycle: "illustrative combined electric operation" },
    }),
    emissions: datum(78, "grams_co2e_per_mile", ["example:prius:identity"], {
      status: "derived",
      confidenceScore: 0.62,
      estimationMethod: "Illustrative tailpipe-equivalent calculation.",
      measurementContext: { boundary: "illustrative combined operation" },
    }),
    evRange: datum(25, "miles", ["example:prius:identity"], { confidenceScore: 0.82 }),
    chargingSpeed: datum(3.3, "kilowatts", ["example:prius:identity"], { confidenceScore: 0.8 }),
  },
  image: {
    luxuryPerception: datum(48, "score_0_100", ["example:prius:review"], { confidenceScore: 0.42 }),
    sportyImage: datum(36, "score_0_100", ["example:prius:review"], { confidenceScore: 0.42 }),
    ruggedImage: datum(20, "score_0_100", ["example:prius:review"], { confidenceScore: 0.42 }),
    premiumImage: datum(51, "score_0_100", ["example:prius:review"], { confidenceScore: 0.42 }),
    understatedImage: datum(79, "score_0_100", ["example:prius:review"], { confidenceScore: 0.42 }),
  },
  lifestyle: {
    collegeStudentFit: datum(82, "score_0_100", ["example:prius:listing", "example:prius:ownership"], {
      status: "derived",
      confidenceScore: 0.58,
      estimationMethod: "Illustrative composite from costs, reliability, and practicality.",
    }),
    familyFit: datum(68, "score_0_100", ["example:prius:safety", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.58,
      estimationMethod: "Illustrative safety and practicality composite.",
    }),
    campingFit: datum(49, "score_0_100", ["example:prius:review"], {
      status: "derived",
      confidenceScore: 0.45,
      estimationMethod: "Illustrative cargo, traction, and trip-cost composite.",
    }),
    petFit: datum(61, "score_0_100", ["example:prius:review"], {
      status: "derived",
      confidenceScore: 0.44,
      estimationMethod: "Illustrative access and cargo composite.",
    }),
    commutingFit: datum(91, "score_0_100", ["example:prius:ownership", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.68,
      estimationMethod: "Illustrative efficiency, reliability, and parking composite.",
    }),
    snowFit: datum(42, "score_0_100", ["example:prius:identity", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.5,
      estimationMethod: "Illustrative drivetrain and climate composite; tires are unknown.",
    }),
    roadTripFit: datum(74, "score_0_100", ["example:prius:ownership", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.6,
      estimationMethod: "Illustrative range, comfort, reliability, and cargo composite.",
    }),
    cityFit: datum(88, "score_0_100", ["example:prius:identity", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.66,
      estimationMethod: "Illustrative dimensions, efficiency, and parking composite.",
    }),
    businessFit: datum(63, "score_0_100", ["example:prius:review", "example:prius:ownership"], {
      status: "derived",
      confidenceScore: 0.45,
      estimationMethod: "Illustrative image, comfort, reliability, and cost composite.",
    }),
  },
  confidence: {
    dataQuality: datum(82, "score_0_100", ["example:prius:identity", "example:prius:listing", "example:prius:safety", "example:prius:ownership", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.82,
      estimationMethod: "Illustrative completeness, freshness, and provenance calculation.",
      sourceAgreement: "agrees",
    }),
    evidenceQuality: datum(68, "score_0_100", ["example:prius:identity", "example:prius:safety", "example:prius:ownership", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.7,
      estimationMethod: "Illustrative evidence specificity and methodology calculation.",
      sourceAgreement: "agrees",
    }),
    sourceAgreement: datum(76, "score_0_100", ["example:prius:identity", "example:prius:listing", "example:prius:safety", "example:prius:ownership", "example:prius:review"], {
      status: "derived",
      confidenceScore: 0.68,
      estimationMethod: "Illustrative cross-source agreement calculation.",
      sourceAgreement: "agrees",
    }),
  },
} satisfies CanonicalVehicleRecord;

/**
 * A sparse source is still normalized into every CVR field. Unknown values are
 * explicit missing data and cannot inherit values from another record.
 */
export const partiallyKnownVehicleRecord = {
  schemaVersion: canonicalVehicleSchemaVersion,
  recordId: "example:partial-2016-honda-civic",
  recordScope: "listing",
  recordStatus: "example",
  createdAt: exampleDate,
  updatedAt: exampleDate,
  evidence: [
    {
      evidenceId: "example:partial:listing",
      sourceType: "example_fixture",
      providerName: "Phase 3.2B partial fixture",
      sourceRecordId: "partial-listing",
      sourceUrl: null,
      scope: "listing",
      observedAt: exampleDate,
      retrievedAt: exampleDate,
      market: "US",
      methodology: "Synthetic sparse listing example.",
      license: "Project documentation fixture",
    },
  ],
  identity: {
    make: datum("Honda", "none", ["example:partial:listing"], { confidenceScore: 0.92 }),
    model: datum("Civic", "none", ["example:partial:listing"], { confidenceScore: 0.9 }),
    generation: missing("none", "not_collected"),
    trim: missing("none", "not_collected"),
    modelYear: datum(2016, "year", ["example:partial:listing"], { confidenceScore: 0.9 }),
    bodyStyle: datum("sedan", "none", ["example:partial:listing"], { confidenceScore: 0.75 }),
    vehicleCategory: missing("none", "insufficient_specificity"),
    drivetrain: missing("none", "not_collected"),
    transmission: missing("none", "not_collected"),
    fuelType: datum("gas", "none", ["example:partial:listing"], { confidenceScore: 0.72 }),
    odometerMileage: datum(98000, "miles", ["example:partial:listing"], { confidenceScore: 0.82 }),
    condition: missing("score_0_100", "not_collected"),
  },
  financial: {
    purchasePrice: datum(12900, "usd", ["example:partial:listing"], { confidenceScore: 0.82 }),
    monthlyPayment: missing("usd_per_month", "insufficient_specificity"),
    totalOwnershipCost: missing("usd_per_month", "not_collected"),
    maintenanceCost: missing("usd_per_month", "not_collected"),
    insuranceCost: missing("usd_per_month", "not_collected"),
    depreciation: missing("usd_per_year", "not_collected"),
    resaleValue: missing("score_0_100", "not_collected"),
    fuelEnergyCost: missing("usd_per_month", "insufficient_specificity"),
  },
  safety: {
    crashSafety: missing("score_0_100"),
    activeSafety: missing("score_0_100"),
    passiveSafety: missing("score_0_100"),
    driverAssistanceSafety: missing("score_0_100"),
  },
  reliability: {
    longTermReliability: missing("score_0_100"),
    repairFrequency: missing("repairs_per_10k_miles"),
    repairSeverity: missing("usd"),
    knownIssues: missing("none"),
  },
  driving: {
    acceleration: missing("score_0_100"),
    handling: missing("score_0_100"),
    steering: missing("score_0_100"),
    rideControl: missing("score_0_100"),
    braking: missing("score_0_100"),
    offRoadCapability: missing("score_0_100"),
    towingCapacity: missing("pounds"),
  },
  comfort: {
    seatComfort: missing("score_0_100"),
    suspensionComfort: missing("score_0_100"),
    cabinNoise: missing("decibels_a_weighted"),
    rideSmoothness: missing("score_0_100"),
    climateComfort: missing("score_0_100"),
  },
  technology: {
    infotainment: missing("none"),
    smartphoneIntegration: missing("none"),
    navigation: missing("none"),
    driverAssistanceTechnology: missing("none"),
    softwareExperience: missing("none"),
    chargingTechnology: missing("none", "not_applicable"),
  },
  practicality: {
    cargoCapacity: missing("cubic_feet"),
    passengerRoom: missing("score_0_100"),
    parkingEase: missing("score_0_100"),
    outwardVisibility: missing("score_0_100"),
    storageUtility: missing("score_0_100"),
    interiorFlexibility: missing("score_0_100"),
  },
  environment: {
    fuelEconomy: missing("mpg"),
    emissions: missing("grams_co2e_per_mile"),
    evRange: missing("miles", "not_applicable"),
    chargingSpeed: missing("kilowatts", "not_applicable"),
  },
  image: {
    luxuryPerception: missing("score_0_100", "unsupported"),
    sportyImage: missing("score_0_100", "unsupported"),
    ruggedImage: missing("score_0_100", "unsupported"),
    premiumImage: missing("score_0_100", "unsupported"),
    understatedImage: missing("score_0_100", "unsupported"),
  },
  lifestyle: {
    collegeStudentFit: missing("score_0_100", "not_collected"),
    familyFit: missing("score_0_100", "not_collected"),
    campingFit: missing("score_0_100", "unsupported"),
    petFit: missing("score_0_100", "unsupported"),
    commutingFit: missing("score_0_100", "not_collected"),
    snowFit: missing("score_0_100", "not_collected"),
    roadTripFit: missing("score_0_100", "not_collected"),
    cityFit: missing("score_0_100", "not_collected"),
    businessFit: missing("score_0_100", "unsupported"),
  },
  confidence: {
    dataQuality: datum(31, "score_0_100", ["example:partial:listing"], {
      status: "derived",
      confidenceScore: 0.72,
      estimationMethod: "Illustrative field-completeness and provenance calculation.",
    }),
    evidenceQuality: datum(38, "score_0_100", ["example:partial:listing"], {
      status: "derived",
      confidenceScore: 0.68,
      estimationMethod: "Illustrative source-specificity calculation.",
    }),
    sourceAgreement: missing("score_0_100", "insufficient_specificity"),
  },
} satisfies CanonicalVehicleRecord;
