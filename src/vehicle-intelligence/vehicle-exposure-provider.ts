import type {
  ExposureNormalizedReliabilityEvidence,
  VehicleExposureProvider,
  VehicleExposureQuery,
  VehicleExposureRecord,
  VehicleExposureResult,
} from "../../types/vehicleExposure";
import type { ReliabilityInterpretation } from "../../types/reliabilityInterpretation";

export function createUnsupportedVehicleExposureProvider(
  reason = "No trusted vehicle-population or mileage exposure provider is configured.",
): VehicleExposureProvider {
  return {
    providerId: "vehicle-exposure:unsupported",
    providerKind: "unsupported",
    dataUse: "production",
    async getExposure(query): Promise<VehicleExposureResult> {
      return deepFreeze({
        availability: "UNAVAILABLE",
        query: { ...query },
        record: null,
        limitations: [reason, "No complaint-rate or per-vehicle normalization may be calculated."],
        error: null,
        dataUse: "production",
      });
    },
  };
}

export function createFixtureVehicleExposureProvider(input: {
  dataUse: "test";
  providerId: string;
  fixtures: Readonly<Record<string, VehicleExposureRecord>>;
}): VehicleExposureProvider {
  const providerId = requireText(input.providerId, "providerId");
  const fixtures = clone(input.fixtures);
  return {
    providerId,
    providerKind: "fixture",
    dataUse: "test",
    async getExposure(query): Promise<VehicleExposureResult> {
      const record = fixtures[query.vehicleId] ?? null;
      return deepFreeze({
        availability: record ? exposureAvailability(record) : "UNAVAILABLE",
        query: { ...query },
        record: record ? clone(record) : null,
        limitations: record
          ? ["Fixture exposure is synthetic test data and is not eligible for production use."]
          : ["No fixture exposure record exists for this test vehicle."],
        error: null,
        dataUse: "test",
      });
    },
  };
}

export function normalizeReliabilityEvidenceWithExposure(
  interpretation: ReliabilityInterpretation,
  providerId: string,
  exposure: VehicleExposureResult,
): ExposureNormalizedReliabilityEvidence {
  const rawComplaintRecords = new Set(
    interpretation.seriousSignals.signals
      .filter((signal) => signal.evidenceType === "COMPLAINT")
      .map((signal) => signal.evidenceId),
  ).size;
  const denominator = selectDenominator(exposure.record);
  if (!denominator || exposure.availability === "UNAVAILABLE" || exposure.availability === "SOURCE_FAILURE") {
    return deepFreeze({
      availability: "UNAVAILABLE",
      sourceInterpretationId: interpretation.interpretationId,
      exposureProviderId: providerId,
      rawComplaintRecords,
      denominatorType: null,
      denominatorValue: null,
      complaintRecordsPerThousandVehicles: null,
      geography: exposure.record?.geography ?? null,
      observedAt: exposure.record?.observedAt ?? null,
      comparativeReliabilitySupported: false,
      reliabilityScore: null,
      limitations: [
        ...exposure.limitations,
        `${rawComplaintRecords} complaint record(s) observed; exposure-adjusted complaint rate unavailable.`,
      ],
    });
  }
  return deepFreeze({
    availability: "AVAILABLE",
    sourceInterpretationId: interpretation.interpretationId,
    exposureProviderId: providerId,
    rawComplaintRecords,
    denominatorType: denominator.type,
    denominatorValue: denominator.value,
    complaintRecordsPerThousandVehicles: round((rawComplaintRecords / denominator.value) * 1_000, 4),
    geography: exposure.record!.geography,
    observedAt: exposure.record!.observedAt,
    comparativeReliabilitySupported: false,
    reliabilityScore: null,
    limitations: [
      ...exposure.limitations,
      "A descriptive complaint-record rate is not a comparative reliability score and requires methodology review before cross-vehicle use.",
    ],
  });
}

export function createVehicleExposureQuery(input: {
  vehicleId: string;
  modelYear: number;
  make: string;
  model: string;
  geography?: string;
  asOfDate: string;
}): VehicleExposureQuery {
  if (!Number.isInteger(input.modelYear) || input.modelYear < 1886) throw new Error("modelYear must be a valid vehicle model year.");
  if (!Number.isFinite(Date.parse(input.asOfDate))) throw new Error("asOfDate must be a valid timestamp.");
  return {
    vehicleId: requireText(input.vehicleId, "vehicleId"),
    modelYear: input.modelYear,
    make: requireText(input.make, "make"),
    model: requireText(input.model, "model"),
    geography: input.geography?.trim() || "US",
    asOfDate: input.asOfDate,
  };
}

function exposureAvailability(record: VehicleExposureRecord) {
  const denominator = selectDenominator(record);
  const mileageKnown = record.annualMiles.mean !== null
    || record.annualMiles.median !== null
    || record.lifetimeMileageDistribution.median !== null;
  return denominator && mileageKnown ? "AVAILABLE" as const : "PARTIAL" as const;
}

function selectDenominator(record: VehicleExposureRecord | null) {
  if (!record) return null;
  if (record.estimatedVehiclesInOperation !== null && record.estimatedVehiclesInOperation > 0) {
    return { type: "estimated_vehicles_in_operation" as const, value: record.estimatedVehiclesInOperation };
  }
  if (record.registeredVehicleCount !== null && record.registeredVehicleCount > 0) {
    return { type: "registered_vehicle_count" as const, value: record.registeredVehicleCount };
  }
  return null;
}

function requireText(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
