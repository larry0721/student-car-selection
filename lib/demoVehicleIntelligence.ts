import snapshotJson from "../data/demo/goldenVehicleIntelligence.v1.json";
import type {
  DemoIntelligenceSource,
  DemoTrustedVehicleFact,
  DemoVehicleIntelligenceRecord,
  DemoVehicleIntelligenceSnapshot,
  VehicleIntelligenceViewModel,
  VehicleIntelligenceViewModelInput,
} from "../types/demoVehicleIntelligence";

const snapshot = snapshotJson as DemoVehicleIntelligenceSnapshot;

export function getDemoVehicleIntelligence(vehicleId: string): DemoVehicleIntelligenceRecord | null {
  return snapshot.vehicles.find((vehicle) => vehicle.vehicleId === vehicleId) ?? null;
}

export function listDemoVehicleIntelligence(): readonly DemoVehicleIntelligenceRecord[] {
  return snapshot.vehicles;
}

export function getDemoVehicleIntelligenceSnapshotMetadata() {
  return {
    snapshotId: snapshot.snapshotId,
    goldenDatasetVersion: snapshot.goldenDatasetVersion,
    generatedAt: snapshot.generatedAt,
    vehicleCount: snapshot.vehicles.length,
    recommendationRuntimeConnected: snapshot.recommendationRuntimeConnected,
  } as const;
}

export function buildVehicleIntelligenceViewModel(
  input: VehicleIntelligenceViewModelInput,
): VehicleIntelligenceViewModel {
  const record = getDemoVehicleIntelligence(input.vehicleId);
  if (!record) {
    return {
      available: false,
      vehicleId: input.vehicleId,
      message: "Detailed trusted vehicle intelligence has not been added for this vehicle yet.",
    };
  }

  const trustedFacts = record.trustedFacts.map((fact) => ({
    label: factLabel(fact.field),
    value: formatFactValue(fact),
    confidence: fact.confidence,
  }));
  const safety = buildSafetyView(record);
  const reliability = buildReliabilityView(record);
  const confidenceItems = [
    {
      label: "Safety evidence",
      detail: `High confidence — official NHTSA ${record.safety.ratingState === "RATED" ? "crash-test record" : "vehicle identification record"}.`,
    },
    {
      label: "Reliability concern",
      detail: `${capitalize(record.reliability.evidenceConfidence)} confidence — ${reliabilityConfidenceBasis(record)}.`,
    },
    ...fuelEconomyConfidence(record),
  ];

  return {
    available: true,
    vehicleId: record.vehicleId,
    displayName: record.displayName,
    publicationLabel: `Trusted source snapshot v${snapshot.goldenDatasetVersion}`,
    trustedFacts,
    safety,
    reliability,
    confidenceItems,
    limitations: buyerRelevantLimitations(record, input),
    sources: collectSources(record),
  };
}

function buildSafetyView(record: DemoVehicleIntelligenceRecord) {
  if (record.safety.ratingState === "NOT_RATED") {
    return {
      state: "not_rated" as const,
      statusText: "NHTSA identifies this vehicle, but no numeric NCAP crash-test rating is available for this configuration.",
      ratingRows: [],
      technology: technologyFacts(record),
      confidenceText: "High confidence — official NHTSA vehicle record; numeric crash ratings are unavailable.",
      source: record.safety.source,
    };
  }
  const rows = [
    ["Overall", record.safety.ratings.overall],
    ["Front crash", record.safety.ratings.frontCrash],
    ["Side crash", record.safety.ratings.sideCrash],
    ["Rollover", record.safety.ratings.rollover],
  ].flatMap(([label, value]) => typeof value === "number" ? [{ label: String(label), value: `${value} / 5` }] : []);
  return {
    state: "rated" as const,
    statusText: "Official NHTSA crash-test evidence is available for this configuration.",
    ratingRows: rows,
    technology: technologyFacts(record),
    confidenceText: "High confidence — official NHTSA crash-test record.",
    source: record.safety.source,
  };
}

function buildReliabilityView(record: DemoVehicleIntelligenceRecord) {
  return {
    concernLabel: concernLabel(record.reliability.concernLevel),
    framing: concernFraming(record.reliability.concernLevel),
    primaryConcerns: record.reliability.primaryConcerns.map((concern) => formatComponent(concern.component)),
    confidenceText: `${capitalize(record.reliability.evidenceConfidence)} confidence in the evidence pattern — not a reliability grade.`,
    scopeText: `${record.displayName.split(" ")[0]} model-year evidence; not specific to an individual car or VIN.`,
    limitation: "Vehicle-population and mileage exposure are unavailable, so this evidence cannot be interpreted as a comparative failure rate.",
    source: record.reliability.source,
  };
}

function buyerRelevantLimitations(
  record: DemoVehicleIntelligenceRecord,
  input: VehicleIntelligenceViewModelInput,
) {
  const profile = input.profile;
  const limitations = [
    "Condition, service history, and inspection results for an individual used car still need verification.",
  ];
  if (!profile || profile.reliabilityImportance >= 3 || profile.reliabilityMinimum !== undefined) {
    limitations.push("Comparative reliability is unavailable because trusted vehicle-population and mileage exposure are not available.");
  }
  if (profile?.performanceImportance && profile.performanceImportance >= 4) {
    limitations.push("Verified acceleration and handling evidence is not available in this source snapshot.");
  }
  if (profile?.scoreWeights.insuranceCost && profile.scoreWeights.insuranceCost >= 15) {
    limitations.push("A verified insurance quote is not available; the ownership estimate is separate from trusted vehicle facts.");
  }
  if (
    profile
    && (profile.fuelEconomyImportance >= 4 || profile.minMpg > 0)
    && !record.trustedFacts.some((fact) => fact.field === "fuelEconomy")
  ) {
    limitations.push("Trusted fuel-economy evidence is not available for this configuration.");
  }
  if (
    profile
    && requiredBodyStyle(profile)
    && !record.trustedFacts.some((fact) => fact.field === "bodyStyle")
  ) {
    limitations.push("Body style has not been independently verified in the published source snapshot.");
  }
  if (
    profile
    && requiredElectric(profile)
    && !record.trustedFacts.some((fact) => fact.field === "evRange")
  ) {
    limitations.push("Trusted driving-range evidence is not available for this electric configuration.");
  }
  return [...new Set(limitations)].slice(0, 4);
}

function requiredBodyStyle(profile: NonNullable<VehicleIntelligenceViewModelInput["profile"]>) {
  return profile.bodyStyle !== "any" || Boolean(profile.requiredBodyStyles?.length);
}

function requiredElectric(profile: NonNullable<VehicleIntelligenceViewModelInput["profile"]>) {
  return profile.requiredFuelType === "electric" || profile.requiredFuelTypes?.includes("electric") === true;
}

function technologyFacts(record: DemoVehicleIntelligenceRecord) {
  const entries = [
    ["Electronic stability control", record.safety.technology.electronicStabilityControl],
    ["Forward collision warning", record.safety.technology.forwardCollisionWarning],
    ["Lane departure warning", record.safety.technology.laneDepartureWarning],
  ];
  return entries.flatMap(([label, value]) => value ? [`${label}: ${value}`] : []);
}

function fuelEconomyConfidence(record: DemoVehicleIntelligenceRecord) {
  const fuelEconomy = record.trustedFacts.find((fact) => fact.field === "fuelEconomy");
  return fuelEconomy ? [{
    label: "Efficiency evidence",
    detail: `${capitalize(fuelEconomy.confidence)} confidence — EPA configuration evidence.`,
  }] : [];
}

function collectSources(record: DemoVehicleIntelligenceRecord) {
  const sources: DemoIntelligenceSource[] = [
    record.safety.source,
    record.reliability.source,
    ...record.trustedFacts.flatMap((fact) => fact.sources),
  ];
  return [...new Map(sources.map((source) => [`${source.providerName}:${source.sourceRecordId}`, source])).values()];
}

function reliabilityConfidenceBasis(record: DemoVehicleIntelligenceRecord) {
  return record.reliability.primaryConcerns.some((concern) => concern.corroboration.includes("RECALL"))
    ? "repeated reports with corroborating recall evidence"
    : "repeated reports without independent component-level corroboration";
}

function concernLabel(level: DemoVehicleIntelligenceRecord["reliability"]["concernLevel"]) {
  return level.toLowerCase().split("_").map(capitalize).join(" ");
}

function concernFraming(level: DemoVehicleIntelligenceRecord["reliability"]["concernLevel"]) {
  if (level === "ELEVATED_CONCERN") return "We found a strong evidence pattern that deserves careful review before purchase.";
  if (level === "MEANINGFUL_CONCERN") return "We found a meaningful pattern worth knowing about.";
  if (level === "LIMITED_CONCERN") return "We found a limited signal worth keeping in context.";
  if (level === "NO_MEANINGFUL_SIGNAL") return "This evidence set did not show a meaningful pattern, but that does not establish perfect reliability.";
  return "There is not enough evidence to characterize a reliability concern.";
}

function factLabel(field: DemoTrustedVehicleFact["field"]) {
  const labels: Record<DemoTrustedVehicleFact["field"], string> = {
    bodyStyle: "Body style",
    vehicleCategory: "Vehicle category",
    drivetrain: "Drivetrain",
    transmission: "Transmission",
    fuelType: "Fuel type",
    fuelEconomy: "Combined efficiency",
    emissions: "Tailpipe emissions",
    evRange: "EPA driving range",
    chargingSpeed: "Charging speed",
  };
  return labels[field];
}

function formatFactValue(fact: DemoTrustedVehicleFact) {
  if (fact.unit === "mpg") return `${fact.value} mpg`;
  if (fact.unit === "mpge") return `${fact.value} MPGe`;
  if (fact.unit === "kwh_per_100_miles") return `${fact.value} kWh/100 mi`;
  if (fact.unit === "grams_co2e_per_mile") return `${fact.value} g/mi`;
  if (fact.unit === "miles") return `${fact.value} miles`;
  if (fact.unit === "kilowatts") return `${fact.value} kW`;
  return formatComponent(String(fact.value));
}

function formatComponent(value: string) {
  return value.replace(/_/g, " ").split(" ").map(capitalize).join(" ");
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : value;
}
