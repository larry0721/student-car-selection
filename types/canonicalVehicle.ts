export const canonicalVehicleSchemaVersion = "1.0.0" as const;

export const canonicalVehicleSectionNames = [
  "identity",
  "financial",
  "safety",
  "reliability",
  "driving",
  "comfort",
  "technology",
  "practicality",
  "environment",
  "image",
  "lifestyle",
  "confidence",
] as const;

export type CanonicalVehicleSectionName = (typeof canonicalVehicleSectionNames)[number];

export const canonicalVehicleFieldNames = {
  identity: [
    "make",
    "model",
    "generation",
    "trim",
    "modelYear",
    "bodyStyle",
    "vehicleCategory",
    "drivetrain",
    "transmission",
    "fuelType",
    "odometerMileage",
    "condition",
  ],
  financial: [
    "purchasePrice",
    "monthlyPayment",
    "totalOwnershipCost",
    "maintenanceCost",
    "insuranceCost",
    "depreciation",
    "resaleValue",
    "fuelEnergyCost",
  ],
  safety: [
    "crashSafety",
    "activeSafety",
    "passiveSafety",
    "driverAssistanceSafety",
  ],
  reliability: [
    "longTermReliability",
    "repairFrequency",
    "repairSeverity",
    "knownIssues",
  ],
  driving: [
    "acceleration",
    "handling",
    "steering",
    "rideControl",
    "braking",
    "offRoadCapability",
    "towingCapacity",
  ],
  comfort: [
    "seatComfort",
    "suspensionComfort",
    "cabinNoise",
    "rideSmoothness",
    "climateComfort",
  ],
  technology: [
    "infotainment",
    "smartphoneIntegration",
    "navigation",
    "driverAssistanceTechnology",
    "softwareExperience",
    "chargingTechnology",
  ],
  practicality: [
    "cargoCapacity",
    "passengerRoom",
    "parkingEase",
    "outwardVisibility",
    "storageUtility",
    "interiorFlexibility",
  ],
  environment: [
    "fuelEconomy",
    "emissions",
    "evRange",
    "chargingSpeed",
  ],
  image: [
    "luxuryPerception",
    "sportyImage",
    "ruggedImage",
    "premiumImage",
    "understatedImage",
  ],
  lifestyle: [
    "collegeStudentFit",
    "familyFit",
    "campingFit",
    "petFit",
    "commutingFit",
    "snowFit",
    "roadTripFit",
    "cityFit",
    "businessFit",
  ],
  confidence: [
    "dataQuality",
    "evidenceQuality",
    "sourceAgreement",
  ],
} as const satisfies Record<CanonicalVehicleSectionName, readonly string[]>;

export type CanonicalVehicleFieldName = {
  [Section in CanonicalVehicleSectionName]: (typeof canonicalVehicleFieldNames)[Section][number];
}[CanonicalVehicleSectionName];

export type CanonicalVehicleFieldPath = {
  [Section in CanonicalVehicleSectionName]: `${Section}.${(typeof canonicalVehicleFieldNames)[Section][number]}`;
}[CanonicalVehicleSectionName];

export const canonicalVehicleFieldPaths = Object.entries(canonicalVehicleFieldNames)
  .flatMap(([section, fields]) => fields.map((field) => `${section}.${field}`)) as CanonicalVehicleFieldPath[];

export type CanonicalRecordScope = "model_year" | "configuration" | "listing" | "vin";
export type CanonicalRecordStatus = "example" | "draft" | "validated" | "recommendation_ready";

export const canonicalValueStatuses = ["verified", "sourced", "estimated", "derived", "missing"] as const;
export type CanonicalValueStatus = (typeof canonicalValueStatuses)[number];

export type CanonicalConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type CanonicalSourceAgreement = "single_source" | "agrees" | "mixed" | "conflicts" | "not_applicable";

export const canonicalMissingReasons = [
  "not_collected",
  "not_available",
  "not_applicable",
  "source_conflict",
  "insufficient_specificity",
  "stale",
  "invalid",
  "unsupported",
] as const;
export type CanonicalMissingReason = (typeof canonicalMissingReasons)[number];

export type CanonicalUnit =
  | "none"
  | "year"
  | "miles"
  | "usd"
  | "usd_per_month"
  | "usd_per_year"
  | "score_0_100"
  | "repairs_per_10k_miles"
  | "pounds"
  | "cubic_feet"
  | "decibels_a_weighted"
  | "mpg"
  | "mpge"
  | "kwh_per_100_miles"
  | "grams_co2e_per_mile"
  | "kilowatts";

export const canonicalVehicleFieldUnits = {
  identity: {
    make: "none",
    model: "none",
    generation: "none",
    trim: "none",
    modelYear: "year",
    bodyStyle: "none",
    vehicleCategory: "none",
    drivetrain: "none",
    transmission: "none",
    fuelType: "none",
    odometerMileage: "miles",
    condition: "score_0_100",
  },
  financial: {
    purchasePrice: "usd",
    monthlyPayment: "usd_per_month",
    totalOwnershipCost: "usd_per_month",
    maintenanceCost: "usd_per_month",
    insuranceCost: "usd_per_month",
    depreciation: "usd_per_year",
    resaleValue: "score_0_100",
    fuelEnergyCost: "usd_per_month",
  },
  safety: {
    crashSafety: "score_0_100",
    activeSafety: "score_0_100",
    passiveSafety: "score_0_100",
    driverAssistanceSafety: "score_0_100",
  },
  reliability: {
    longTermReliability: "score_0_100",
    repairFrequency: "repairs_per_10k_miles",
    repairSeverity: "usd",
    knownIssues: "none",
  },
  driving: {
    acceleration: "score_0_100",
    handling: "score_0_100",
    steering: "score_0_100",
    rideControl: "score_0_100",
    braking: "score_0_100",
    offRoadCapability: "score_0_100",
    towingCapacity: "pounds",
  },
  comfort: {
    seatComfort: "score_0_100",
    suspensionComfort: "score_0_100",
    cabinNoise: "decibels_a_weighted",
    rideSmoothness: "score_0_100",
    climateComfort: "score_0_100",
  },
  technology: {
    infotainment: "none",
    smartphoneIntegration: "none",
    navigation: "none",
    driverAssistanceTechnology: "none",
    softwareExperience: "none",
    chargingTechnology: "none",
  },
  practicality: {
    cargoCapacity: "cubic_feet",
    passengerRoom: "score_0_100",
    parkingEase: "score_0_100",
    outwardVisibility: "score_0_100",
    storageUtility: "score_0_100",
    interiorFlexibility: "score_0_100",
  },
  environment: {
    fuelEconomy: "mpg",
    emissions: "grams_co2e_per_mile",
    evRange: "miles",
    chargingSpeed: "kilowatts",
  },
  image: {
    luxuryPerception: "score_0_100",
    sportyImage: "score_0_100",
    ruggedImage: "score_0_100",
    premiumImage: "score_0_100",
    understatedImage: "score_0_100",
  },
  lifestyle: {
    collegeStudentFit: "score_0_100",
    familyFit: "score_0_100",
    campingFit: "score_0_100",
    petFit: "score_0_100",
    commutingFit: "score_0_100",
    snowFit: "score_0_100",
    roadTripFit: "score_0_100",
    cityFit: "score_0_100",
    businessFit: "score_0_100",
  },
  confidence: {
    dataQuality: "score_0_100",
    evidenceQuality: "score_0_100",
    sourceAgreement: "score_0_100",
  },
} as const satisfies {
  [Section in CanonicalVehicleSectionName]: Record<
    (typeof canonicalVehicleFieldNames)[Section][number],
    CanonicalUnit
  >;
};

export type CanonicalConfidence = {
  score: number | null;
  level: CanonicalConfidenceLevel;
  sourceAgreement: CanonicalSourceAgreement;
  basis: string[];
};

export type CanonicalDatum<T, Unit extends CanonicalUnit = CanonicalUnit> = {
  value: T | null;
  unit: Unit;
  status: CanonicalValueStatus;
  confidence: CanonicalConfidence;
  evidenceIds: string[];
  estimated: boolean;
  estimationMethod: string | null;
  asOfDate: string | null;
  measurementContext: Record<string, string | number | boolean> | null;
  missingReason: CanonicalMissingReason | null;
};

export type CanonicalSourceType =
  | "oem"
  | "nhtsa"
  | "epa"
  | "iihs"
  | "listing"
  | "transaction"
  | "insurance"
  | "repair"
  | "warranty"
  | "survey"
  | "professional_review"
  | "inspection"
  | "charging_network"
  | "derived"
  | "csv_import"
  | "legacy_catalog"
  | "example_fixture";

export type CanonicalEvidenceScope =
  | "make"
  | "model"
  | "generation"
  | "model_year"
  | "trim"
  | "configuration"
  | "listing"
  | "vin"
  | "population";

export type CanonicalEvidenceDataUse = "production" | "fixture" | "test" | "example";
export type CanonicalEvidenceNormalizationMethod = "direct" | "mapped" | "derived" | "estimated";
export type CanonicalEvidenceSourceValue =
  | string
  | number
  | boolean
  | null
  | CanonicalEvidenceSourceValue[]
  | { [key: string]: CanonicalEvidenceSourceValue };
export type CanonicalEvidenceSourceClaim = {
  sourceField: string;
  originalSourceValue: CanonicalEvidenceSourceValue;
};

export type CanonicalEvidence = {
  evidenceId: string;
  sourceType: CanonicalSourceType;
  providerName: string;
  sourceRecordId: string | null;
  sourceUrl: string | null;
  scope: CanonicalEvidenceScope;
  observedAt: string | null;
  retrievedAt: string;
  market: string | null;
  methodology: string | null;
  license: string | null;
  dataUse?: CanonicalEvidenceDataUse;
  sourceClaims?: CanonicalEvidenceSourceClaim[];
  normalizationMethod?: CanonicalEvidenceNormalizationMethod;
  normalizationNotes?: string[];
};

export const canonicalBodyStyles = [
  "sedan",
  "suv",
  "hatchback",
  "truck",
  "coupe",
  "convertible",
  "wagon",
  "minivan",
] as const;
export type CanonicalBodyStyle = (typeof canonicalBodyStyles)[number];

export const canonicalVehicleCategories = [
  "subcompact_car",
  "compact_car",
  "midsize_car",
  "large_car",
  "sports_car",
  "luxury_car",
  "crossover",
  "suv",
  "pickup",
  "minivan",
  "van",
  "other",
] as const;
export type CanonicalVehicleCategory = (typeof canonicalVehicleCategories)[number];

export const canonicalDrivetrains = ["FWD", "RWD", "AWD", "4WD"] as const;
export type CanonicalDrivetrain = (typeof canonicalDrivetrains)[number];

export const canonicalTransmissions = ["automatic", "manual", "cvt"] as const;
export type CanonicalTransmission = (typeof canonicalTransmissions)[number];

export const canonicalFuelTypes = ["gas", "hybrid", "plug_in_hybrid", "electric", "diesel", "hydrogen"] as const;
export type CanonicalFuelType = (typeof canonicalFuelTypes)[number];

export type CanonicalKnownIssue = {
  issueId: string;
  title: string;
  description: string;
  affectedModelYears: number[];
  affectedConfigurations: string[];
  frequency: "rare" | "occasional" | "common" | "unknown";
  severity: "low" | "medium" | "high" | "unknown";
  evidenceIds: string[];
};

export type CanonicalTechnologyAssessment = {
  score: number;
  verifiedFeatures: string[];
  unavailableFeatures: string[];
  unknownFeatures: string[];
};

export type CanonicalIdentitySection = {
  make: CanonicalDatum<string, "none">;
  model: CanonicalDatum<string, "none">;
  generation: CanonicalDatum<string, "none">;
  trim: CanonicalDatum<string, "none">;
  modelYear: CanonicalDatum<number, "year">;
  bodyStyle: CanonicalDatum<CanonicalBodyStyle, "none">;
  vehicleCategory: CanonicalDatum<CanonicalVehicleCategory, "none">;
  drivetrain: CanonicalDatum<CanonicalDrivetrain, "none">;
  transmission: CanonicalDatum<CanonicalTransmission, "none">;
  fuelType: CanonicalDatum<CanonicalFuelType, "none">;
  odometerMileage: CanonicalDatum<number, "miles">;
  condition: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalFinancialSection = {
  purchasePrice: CanonicalDatum<number, "usd">;
  monthlyPayment: CanonicalDatum<number, "usd_per_month">;
  totalOwnershipCost: CanonicalDatum<number, "usd_per_month">;
  maintenanceCost: CanonicalDatum<number, "usd_per_month">;
  insuranceCost: CanonicalDatum<number, "usd_per_month">;
  depreciation: CanonicalDatum<number, "usd_per_year">;
  resaleValue: CanonicalDatum<number, "score_0_100">;
  fuelEnergyCost: CanonicalDatum<number, "usd_per_month">;
};

export type CanonicalSafetySection = {
  crashSafety: CanonicalDatum<number, "score_0_100">;
  activeSafety: CanonicalDatum<number, "score_0_100">;
  passiveSafety: CanonicalDatum<number, "score_0_100">;
  driverAssistanceSafety: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalReliabilitySection = {
  longTermReliability: CanonicalDatum<number, "score_0_100">;
  repairFrequency: CanonicalDatum<number, "repairs_per_10k_miles">;
  repairSeverity: CanonicalDatum<number, "usd">;
  knownIssues: CanonicalDatum<CanonicalKnownIssue[], "none">;
};

export type CanonicalDrivingSection = {
  acceleration: CanonicalDatum<number, "score_0_100">;
  handling: CanonicalDatum<number, "score_0_100">;
  steering: CanonicalDatum<number, "score_0_100">;
  rideControl: CanonicalDatum<number, "score_0_100">;
  braking: CanonicalDatum<number, "score_0_100">;
  offRoadCapability: CanonicalDatum<number, "score_0_100">;
  towingCapacity: CanonicalDatum<number, "pounds">;
};

export type CanonicalComfortSection = {
  seatComfort: CanonicalDatum<number, "score_0_100">;
  suspensionComfort: CanonicalDatum<number, "score_0_100">;
  cabinNoise: CanonicalDatum<number, "decibels_a_weighted">;
  rideSmoothness: CanonicalDatum<number, "score_0_100">;
  climateComfort: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalTechnologySection = {
  infotainment: CanonicalDatum<CanonicalTechnologyAssessment, "none">;
  smartphoneIntegration: CanonicalDatum<CanonicalTechnologyAssessment, "none">;
  navigation: CanonicalDatum<CanonicalTechnologyAssessment, "none">;
  driverAssistanceTechnology: CanonicalDatum<CanonicalTechnologyAssessment, "none">;
  softwareExperience: CanonicalDatum<CanonicalTechnologyAssessment, "none">;
  chargingTechnology: CanonicalDatum<CanonicalTechnologyAssessment, "none">;
};

export type CanonicalPracticalitySection = {
  cargoCapacity: CanonicalDatum<number, "cubic_feet">;
  passengerRoom: CanonicalDatum<number, "score_0_100">;
  parkingEase: CanonicalDatum<number, "score_0_100">;
  outwardVisibility: CanonicalDatum<number, "score_0_100">;
  storageUtility: CanonicalDatum<number, "score_0_100">;
  interiorFlexibility: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalEnvironmentSection = {
  fuelEconomy: CanonicalDatum<number, "mpg" | "mpge" | "kwh_per_100_miles">;
  emissions: CanonicalDatum<number, "grams_co2e_per_mile">;
  evRange: CanonicalDatum<number, "miles">;
  chargingSpeed: CanonicalDatum<number, "kilowatts">;
};

export type CanonicalImageSection = {
  luxuryPerception: CanonicalDatum<number, "score_0_100">;
  sportyImage: CanonicalDatum<number, "score_0_100">;
  ruggedImage: CanonicalDatum<number, "score_0_100">;
  premiumImage: CanonicalDatum<number, "score_0_100">;
  understatedImage: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalLifestyleSection = {
  collegeStudentFit: CanonicalDatum<number, "score_0_100">;
  familyFit: CanonicalDatum<number, "score_0_100">;
  campingFit: CanonicalDatum<number, "score_0_100">;
  petFit: CanonicalDatum<number, "score_0_100">;
  commutingFit: CanonicalDatum<number, "score_0_100">;
  snowFit: CanonicalDatum<number, "score_0_100">;
  roadTripFit: CanonicalDatum<number, "score_0_100">;
  cityFit: CanonicalDatum<number, "score_0_100">;
  businessFit: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalConfidenceSection = {
  dataQuality: CanonicalDatum<number, "score_0_100">;
  evidenceQuality: CanonicalDatum<number, "score_0_100">;
  sourceAgreement: CanonicalDatum<number, "score_0_100">;
};

export type CanonicalVehicleRecord = {
  schemaVersion: typeof canonicalVehicleSchemaVersion;
  recordId: string;
  recordScope: CanonicalRecordScope;
  recordStatus: CanonicalRecordStatus;
  createdAt: string;
  updatedAt: string;
  evidence: CanonicalEvidence[];
  identity: CanonicalIdentitySection;
  financial: CanonicalFinancialSection;
  safety: CanonicalSafetySection;
  reliability: CanonicalReliabilitySection;
  driving: CanonicalDrivingSection;
  comfort: CanonicalComfortSection;
  technology: CanonicalTechnologySection;
  practicality: CanonicalPracticalitySection;
  environment: CanonicalEnvironmentSection;
  image: CanonicalImageSection;
  lifestyle: CanonicalLifestyleSection;
  confidence: CanonicalConfidenceSection;
};

export type CanonicalValidationSeverity = "warning" | "error";

export type CanonicalValidationIssue = {
  code: string;
  fieldPath: CanonicalVehicleFieldPath | "record";
  severity: CanonicalValidationSeverity;
  message: string;
  evidenceIds: string[];
};

export type CanonicalIngestionContext = {
  ingestionId: string;
  retrievedAt: string;
  market: string | null;
  sourceType: CanonicalSourceType;
};

export type CanonicalIngestionResult = {
  records: CanonicalVehicleRecord[];
  rejectedSourceRecordIds: string[];
  issues: CanonicalValidationIssue[];
};

export interface CanonicalVehicleIngestionAdapter<SourceRecord> {
  readonly sourceType: CanonicalSourceType;
  normalize(
    sourceRecords: readonly SourceRecord[],
    context: CanonicalIngestionContext,
  ): Promise<CanonicalIngestionResult>;
}
