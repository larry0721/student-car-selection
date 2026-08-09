import type {
  CanonicalConfidence,
  CanonicalMissingReason,
  CanonicalUnit,
} from "../types/canonicalVehicle";
import {
  canonicalContributionSchemaVersion,
  type CanonicalContributionDatum,
  type CanonicalVehicleContribution,
} from "../types/canonicalVehicleContribution";

const fixtureDate = "2026-08-06T12:00:00.000Z";

function confidence(score: number | null, basis: string[]): CanonicalConfidence {
  return {
    score,
    level: score === null ? "unknown" : score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low",
    sourceAgreement: "single_source",
    basis,
  };
}

function claim<Value, Unit extends CanonicalUnit>(
  value: Value,
  unit: Unit,
  evidenceIds: string[],
  confidenceScore = 0.9,
): CanonicalContributionDatum<Value, Unit> {
  return {
    value,
    unit,
    status: "sourced",
    confidence: confidence(confidenceScore, ["Fixture claim from one named source record."]),
    evidenceIds,
    attemptEvidenceIds: [],
    estimated: false,
    estimationMethod: null,
    asOfDate: fixtureDate,
    measurementContext: null,
    missingReason: null,
  };
}

function explicitlyMissing<Value, Unit extends CanonicalUnit>(
  unit: Unit,
  attemptEvidenceIds: string[],
  reason: CanonicalMissingReason = "not_available",
): CanonicalContributionDatum<Value, Unit> {
  return {
    value: null,
    unit,
    status: "missing",
    confidence: confidence(null, ["The fixture source exposed the field but supplied no usable value."]),
    evidenceIds: [],
    attemptEvidenceIds,
    estimated: false,
    estimationMethod: null,
    asOfDate: null,
    measurementContext: null,
    missingReason: reason,
  };
}

export const nhtsaVinContributionFixture = {
  schemaVersion: canonicalContributionSchemaVersion,
  contributionId: "fixture:nhtsa:vin:1HGCM82633A004352",
  dataUse: "fixture",
  normalizationVersion: "nhtsa-vin-fixture-1",
  recordScope: "vin",
  source: {
    sourceType: "nhtsa",
    providerName: "NHTSA vPIC fixture",
    sourceRecordId: "1HGCM82633A004352",
    sourceUrl: null,
    observedAt: null,
    retrievedAt: fixtureDate,
    market: "US",
    methodology: "Synthetic fixture shaped like a vPIC DecodeVinValues response.",
    license: "Fixture only; not production evidence",
  },
  linkage: {
    canonicalRecordId: null,
    vin: "1HGCM82633A004352",
    make: "Honda",
    model: "Accord",
    modelYear: 2003,
    generation: null,
    trim: null,
    configurationId: null,
    externalIds: [{ namespace: "nhtsa_vin", value: "1HGCM82633A004352" }],
  },
  sourceConfidence: confidence(0.96, ["VIN-scoped identity fixture modeled on an authoritative source."]),
  sourceMetadata: {
    apiOperation: "DecodeVinValues",
    fixtureNotice: "No live NHTSA request was made.",
  },
  evidence: [
    {
      evidenceId: "fixture:nhtsa:vin:direct",
      sourceType: "nhtsa",
      providerName: "NHTSA vPIC fixture",
      sourceRecordId: "1HGCM82633A004352",
      sourceUrl: null,
      scope: "vin",
      observedAt: null,
      retrievedAt: fixtureDate,
      market: "US",
      methodology: "Direct source-field projection from a synthetic fixture.",
      license: "Fixture only; not production evidence",
      dataUse: "fixture",
      sourceClaims: [
        { sourceField: "Make", originalSourceValue: "HONDA" },
        { sourceField: "Model", originalSourceValue: "Accord" },
        { sourceField: "ModelYear", originalSourceValue: "2003" },
      ],
      normalizationMethod: "direct",
      normalizationNotes: ["Make capitalization normalized for canonical display."],
    },
    {
      evidenceId: "fixture:nhtsa:vin:mapped",
      sourceType: "nhtsa",
      providerName: "NHTSA vPIC fixture",
      sourceRecordId: "1HGCM82633A004352",
      sourceUrl: null,
      scope: "vin",
      observedAt: null,
      retrievedAt: fixtureDate,
      market: "US",
      methodology: "Deterministic fixture mapping into canonical identity enums.",
      license: "Fixture only; not production evidence",
      dataUse: "fixture",
      sourceClaims: [
        { sourceField: "BodyClass", originalSourceValue: "Sedan/Saloon" },
        { sourceField: "VehicleType", originalSourceValue: "PASSENGER CAR" },
        { sourceField: "DriveType", originalSourceValue: "4x2" },
        { sourceField: "FuelTypePrimary", originalSourceValue: "Gasoline" },
        { sourceField: "TransmissionStyle", originalSourceValue: "Automatic" },
      ],
      normalizationMethod: "mapped",
      normalizationNotes: ["Values are illustrative; the NHTSA normalizer is not implemented yet."],
    },
  ],
  data: {
    identity: {
      make: claim("Honda", "none", ["fixture:nhtsa:vin:direct"]),
      model: claim("Accord", "none", ["fixture:nhtsa:vin:direct"]),
      modelYear: claim(2003, "year", ["fixture:nhtsa:vin:direct"]),
      bodyStyle: claim("sedan", "none", ["fixture:nhtsa:vin:mapped"]),
      vehicleCategory: claim("midsize_car", "none", ["fixture:nhtsa:vin:mapped"], 0.78),
      drivetrain: claim("FWD", "none", ["fixture:nhtsa:vin:mapped"], 0.78),
      fuelType: claim("gas", "none", ["fixture:nhtsa:vin:mapped"]),
      transmission: claim("automatic", "none", ["fixture:nhtsa:vin:mapped"]),
    },
  },
  issues: [],
} satisfies CanonicalVehicleContribution;

export const epaContributionFixture = {
  schemaVersion: canonicalContributionSchemaVersion,
  contributionId: "fixture:epa:vehicle:46675",
  dataUse: "fixture",
  normalizationVersion: "epa-vehicle-fixture-1",
  recordScope: "configuration",
  source: {
    sourceType: "epa",
    providerName: "FuelEconomy.gov fixture",
    sourceRecordId: "46675",
    sourceUrl: null,
    observedAt: "2023-01-01T00:00:00.000Z",
    retrievedAt: fixtureDate,
    market: "US",
    methodology: "Synthetic EPA configuration fixture.",
    license: "Fixture only; not production evidence",
  },
  linkage: {
    canonicalRecordId: null,
    vin: null,
    make: "Toyota",
    model: "Prius Prime",
    modelYear: 2023,
    generation: null,
    trim: "SE",
    configurationId: "epa:46675",
    externalIds: [{ namespace: "fueleconomy_vehicle_id", value: "46675" }],
  },
  sourceConfidence: confidence(0.94, ["Configuration-scoped environmental fixture modeled on EPA data."]),
  sourceMetadata: {
    apiResource: "vehicle/46675",
    testCycle: "EPA combined",
    fixtureNotice: "Values are illustrative and never entered into production evidence.",
  },
  evidence: [
    {
      evidenceId: "fixture:epa:46675:environment",
      sourceType: "epa",
      providerName: "FuelEconomy.gov fixture",
      sourceRecordId: "46675",
      sourceUrl: null,
      scope: "configuration",
      observedAt: "2023-01-01T00:00:00.000Z",
      retrievedAt: fixtureDate,
      market: "US",
      methodology: "Synthetic direct and unit-normalized environmental fixture.",
      license: "Fixture only; not production evidence",
      dataUse: "fixture",
      sourceClaims: [
        { sourceField: "fuelType", originalSourceValue: "Plug-in Hybrid" },
        { sourceField: "comb08", originalSourceValue: 48 },
        { sourceField: "co2TailpipeGpm", originalSourceValue: 133 },
        { sourceField: "rangeA", originalSourceValue: 44 },
      ],
      normalizationMethod: "mapped",
      normalizationNotes: ["Fuel type is mapped to the canonical plug_in_hybrid enum."],
    },
  ],
  data: {
    identity: {
      fuelType: claim("plug_in_hybrid", "none", ["fixture:epa:46675:environment"]),
    },
    environment: {
      fuelEconomy: claim(48, "mpg", ["fixture:epa:46675:environment"]),
      emissions: claim(133, "grams_co2e_per_mile", ["fixture:epa:46675:environment"]),
      evRange: claim(44, "miles", ["fixture:epa:46675:environment"]),
    },
  },
  issues: [],
} satisfies CanonicalVehicleContribution;

export const marketplaceContributionFixture = {
  schemaVersion: canonicalContributionSchemaVersion,
  contributionId: "fixture:marketplace:listing:abc-123",
  dataUse: "fixture",
  normalizationVersion: "marketplace-listing-fixture-1",
  recordScope: "listing",
  source: {
    sourceType: "listing",
    providerName: "Marketplace fixture",
    sourceRecordId: "abc-123",
    sourceUrl: null,
    observedAt: "2026-08-05T18:00:00.000Z",
    retrievedAt: fixtureDate,
    market: "US-CA",
    methodology: "Synthetic sparse listing fixture.",
    license: "Fixture only; not production evidence",
  },
  linkage: {
    canonicalRecordId: null,
    vin: "2T1BURHE0JC012345",
    make: "Toyota",
    model: "Corolla",
    modelYear: 2018,
    generation: null,
    trim: null,
    configurationId: null,
    externalIds: [{ namespace: "marketplace_listing_id", value: "abc-123" }],
  },
  sourceConfidence: confidence(0.72, ["Listing-scoped fixture with incomplete trim information."]),
  sourceMetadata: {
    photoUrl: "https://fixtures.invalid/abc-123.jpg",
    sellerType: "dealer",
    fixtureNotice: "Photo URL is source metadata because CVR 1.0 has no media field.",
  },
  evidence: [
    {
      evidenceId: "fixture:marketplace:abc-123:listing",
      sourceType: "listing",
      providerName: "Marketplace fixture",
      sourceRecordId: "abc-123",
      sourceUrl: null,
      scope: "listing",
      observedAt: "2026-08-05T18:00:00.000Z",
      retrievedAt: fixtureDate,
      market: "US-CA",
      methodology: "Synthetic direct listing fields; no ownership estimates.",
      license: "Fixture only; not production evidence",
      dataUse: "fixture",
      sourceClaims: [
        { sourceField: "make", originalSourceValue: "Toyota" },
        { sourceField: "model", originalSourceValue: "Corolla" },
        { sourceField: "year", originalSourceValue: 2018 },
        { sourceField: "vin", originalSourceValue: "2T1BURHE0JC012345" },
        { sourceField: "price", originalSourceValue: 14990 },
        { sourceField: "mileage", originalSourceValue: 62400 },
        { sourceField: "trim", originalSourceValue: null },
        { sourceField: "photo_url", originalSourceValue: "https://fixtures.invalid/abc-123.jpg" },
      ],
      normalizationMethod: "direct",
      normalizationNotes: ["VIN and photo URL remain linkage/source metadata rather than CVR identity fields."],
    },
  ],
  data: {
    identity: {
      make: claim("Toyota", "none", ["fixture:marketplace:abc-123:listing"], 0.8),
      model: claim("Corolla", "none", ["fixture:marketplace:abc-123:listing"], 0.8),
      modelYear: claim(2018, "year", ["fixture:marketplace:abc-123:listing"], 0.8),
      odometerMileage: claim(62400, "miles", ["fixture:marketplace:abc-123:listing"], 0.76),
      trim: explicitlyMissing("none", ["fixture:marketplace:abc-123:listing"]),
    },
    financial: {
      purchasePrice: claim(14990, "usd", ["fixture:marketplace:abc-123:listing"], 0.76),
    },
  },
  issues: [
    {
      code: "listing_trim_missing",
      kind: "explicit_source_missing",
      fieldPath: "identity.trim",
      severity: "warning",
      message: "The listing exposed a trim field but did not provide a value.",
      evidenceIds: ["fixture:marketplace:abc-123:listing"],
      sourceField: "trim",
    },
  ],
} satisfies CanonicalVehicleContribution;

export const canonicalVehicleContributionFixtures = [
  nhtsaVinContributionFixture,
  epaContributionFixture,
  marketplaceContributionFixture,
] satisfies CanonicalVehicleContribution[];
