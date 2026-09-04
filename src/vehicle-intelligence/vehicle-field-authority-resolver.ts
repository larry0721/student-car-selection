import type { CanonicalDatum, CanonicalVehicleFieldPath } from "../../types/canonicalVehicle";
import type { PublishedVehicleIntelligenceRecord } from "../../types/publishedVehicleIntelligence";
import type { Vehicle } from "../../types/vehicle";
import type {
  DecisionVehicleFieldName,
  ResolvedDecisionVehicleResult,
  VehicleFieldAuthorityResolution,
  VehicleFieldAuthorityShadowReport,
} from "../../types/vehicleFieldAuthority";
import { getCanonicalVehicleFieldPolicy } from "./vehicle-field-criticality-policy";
import { evaluateCanonicalVehicleDecisionField } from "./vehicle-decision-relevance";
import { parseVehicleEnergyAuthority, toLegacyVehicleMpg } from "./vehicle-energy-field-contract";

export const vehicleFieldAuthorityResolverVersion = "1.0.0" as const;

type EligibleFieldSpec = Readonly<{
  runtimeField: DecisionVehicleFieldName;
  canonicalFieldPath: CanonicalVehicleFieldPath;
  normalize: (value: unknown, unit: string, publication: PublishedVehicleIntelligenceRecord) => unknown;
}>;

const eligibleFieldSpecs: readonly EligibleFieldSpec[] = [
  spec("make", "identity.make", normalizeRequiredText),
  spec("model", "identity.model", normalizeRequiredText),
  spec("year", "identity.modelYear", normalizeYear),
  spec("bodyType", "identity.bodyStyle", normalizeBodyStyle),
  spec("drivetrain", "identity.drivetrain", normalizeDrivetrain),
  spec("transmission", "identity.transmission", normalizeTransmission),
  spec("fuelType", "identity.fuelType", normalizeFuelType),
  spec("mpg", "environment.fuelEconomy", normalizeMpg),
] as const;

const traceOnlyFields = [
  { runtimeField: "safetyScore", canonicalFieldPath: "safety.crashSafety" },
  { runtimeField: "reliabilityScore", canonicalFieldPath: "reliability.longTermReliability" },
] as const satisfies readonly Readonly<{
  runtimeField: DecisionVehicleFieldName;
  canonicalFieldPath: CanonicalVehicleFieldPath;
}>[];

export function resolveVehicleFieldAuthority(
  legacyVehicle: Vehicle,
  publications: readonly PublishedVehicleIntelligenceRecord[],
): ResolvedDecisionVehicleResult<Vehicle> {
  const activeMatches = publications.filter(
    (publication) => publication.publicationStatus === "active" && publication.vehicleId === legacyVehicle.id,
  );
  if (!activeMatches.length) return unavailableResult(legacyVehicle);
  if (activeMatches.length > 1) {
    return rejectedIdentityResult(legacyVehicle, "ambiguous", null, "Multiple active published CVRs match the same vehicle ID.");
  }

  const publication = activeMatches[0];
  const identity = verifyExactIdentity(legacyVehicle, publication);
  if (!identity.passed) {
    return rejectedIdentityResult(legacyVehicle, "conflict", publication, identity.reason);
  }

  const resolutions = [
    ...eligibleFieldSpecs.map((fieldSpec) => resolveEligibleField(legacyVehicle, publication, fieldSpec)),
    ...traceOnlyFields.map((fieldSpec) => resolveTraceOnlyField(legacyVehicle, publication, fieldSpec)),
  ];
  const changedFields = resolutions.filter((resolution) => resolution.authority === "published_cvr" && !valuesEqual(resolution.legacyValue, resolution.selectedValue));
  const resolvedVehicle = changedFields.length
    ? resolutions.reduce<Vehicle>((vehicle, resolution) => {
        if (resolution.authority !== "published_cvr") return vehicle;
        return { ...vehicle, [resolution.field]: resolution.selectedValue } as Vehicle;
      }, { ...legacyVehicle })
    : { ...legacyVehicle };
  const trace = {
    resolverVersion: vehicleFieldAuthorityResolverVersion,
    vehicleId: legacyVehicle.id,
    identityMatchStatus: "exact" as const,
    publicationId: publication.publicationId,
    publishedRecordVersion: publication.recordVersion,
    fields: resolutions,
    diagnostics: changedFields.length
      ? [`${changedFields.length} published field${changedFields.length === 1 ? "" : "s"} superseded legacy values.`]
      : ["The published CVR matched exactly, but no eligible field changed the legacy value."],
  };
  return { vehicle: { ...resolvedVehicle, fieldAuthority: trace }, trace };
}

export function resolveVehicleCatalogAuthority(
  legacyVehicles: readonly Vehicle[],
  publications: readonly PublishedVehicleIntelligenceRecord[],
): Vehicle[] {
  return legacyVehicles.map((vehicle) => resolveVehicleFieldAuthority(vehicle, publications).vehicle);
}

export function compareVehicleFieldAuthorityShadow(
  legacyVehicles: readonly Vehicle[],
  publications: readonly PublishedVehicleIntelligenceRecord[],
): VehicleFieldAuthorityShadowReport<Vehicle> {
  const results = legacyVehicles.map((vehicle) => resolveVehicleFieldAuthority(vehicle, publications));
  const fields = results.flatMap((result) => result.trace.fields);
  const changedVehicleCount = results.filter((result) => !vehicleDecisionValuesEqual(
    legacyVehicles.find((vehicle) => vehicle.id === result.vehicle.id)!,
    result.vehicle,
  )).length;
  const count = (status: VehicleFieldAuthorityResolution["status"]) => fields.filter((field) => field.status === status).length;
  return {
    resolverVersion: vehicleFieldAuthorityResolverVersion,
    results,
    summary: {
      catalogCount: legacyVehicles.length,
      publishedVehicleCount: results.filter((result) => result.trace.publicationId !== null).length,
      unchangedVehicleCount: legacyVehicles.length - changedVehicleCount,
      changedVehicleCount,
      identicalFieldCount: count("identical"),
      eligibleOverrideCount: count("cvr_override_eligible"),
      unavailableFieldCount: count("cvr_unavailable"),
      identityRejectedFieldCount: count("cvr_rejected_due_to_identity"),
      evidenceRejectedFieldCount: count("cvr_rejected_due_to_evidence_or_confidence"),
      legacyFallbackCount: count("legacy_fallback"),
    },
  };
}

function resolveEligibleField(
  legacyVehicle: Vehicle,
  publication: PublishedVehicleIntelligenceRecord,
  fieldSpec: EligibleFieldSpec,
): VehicleFieldAuthorityResolution {
  const datum = getDatum(publication, fieldSpec.canonicalFieldPath);
  const legacyValue = legacyVehicle[fieldSpec.runtimeField as keyof Vehicle];
  const base = resolutionBase(fieldSpec.runtimeField, fieldSpec.canonicalFieldPath, legacyValue, datum, publication);
  const evaluation = evaluateCanonicalVehicleDecisionField(publication.canonicalRecord, fieldSpec.canonicalFieldPath);
  const policy = getCanonicalVehicleFieldPolicy(fieldSpec.canonicalFieldPath);
  if (!evaluation.decisionEligible || !policy.recommendationRoles.some((role) => role === "QUALIFICATION" || role === "SCORING")) {
    return fallback(base, "cvr_rejected_due_to_evidence_or_confidence", evaluation.reason);
  }

  const normalized = fieldSpec.normalize(datum.value, datum.unit, publication);
  if (normalized === null || normalized === undefined) {
    return fallback(base, "legacy_fallback", `The canonical value or unit cannot be represented safely by Vehicle.${fieldSpec.runtimeField}.`);
  }
  if (valuesEqual(legacyValue, normalized)) {
    return { ...base, selectedValue: legacyValue, authority: "published_cvr", status: "identical", fallbackUsed: false, reason: "The trusted published value agrees with the legacy value." };
  }
  return { ...base, selectedValue: normalized, authority: "published_cvr", status: "cvr_override_eligible", fallbackUsed: false, reason: "An exact published CVR supplies trusted, decision-eligible evidence for this field." };
}

function resolveTraceOnlyField(
  legacyVehicle: Vehicle,
  publication: PublishedVehicleIntelligenceRecord,
  fieldSpec: (typeof traceOnlyFields)[number],
): VehicleFieldAuthorityResolution {
  const datum = getDatum(publication, fieldSpec.canonicalFieldPath);
  const legacyValue = legacyVehicle[fieldSpec.runtimeField];
  const base = resolutionBase(fieldSpec.runtimeField, fieldSpec.canonicalFieldPath, legacyValue, datum, publication);
  if (datum.value === null || datum.status === "missing") {
    return fallback(base, "cvr_unavailable", `Published intelligence does not provide ${fieldSpec.canonicalFieldPath}.`);
  }
  const reason = fieldSpec.runtimeField === "safetyScore"
    ? "NHTSA crash evidence is preserved, but crashSafety is not substituted for the legacy aggregate safetyScore."
    : "Reliability evidence is not recommendation-scoring eligible and cannot replace the legacy reliabilityScore.";
  return fallback(base, "legacy_fallback", reason);
}

function verifyExactIdentity(legacyVehicle: Vehicle, publication: PublishedVehicleIntelligenceRecord) {
  const cvr = publication.canonicalRecord;
  const required = [
    evaluateCanonicalVehicleDecisionField(cvr, "identity.make"),
    evaluateCanonicalVehicleDecisionField(cvr, "identity.model"),
    evaluateCanonicalVehicleDecisionField(cvr, "identity.modelYear"),
  ];
  if (required.some((field) => !field.decisionEligible)) {
    return { passed: false, reason: "Published make, model, and model year must all contain trusted evidence." };
  }
  if (!textEqual(legacyVehicle.make, cvr.identity.make.value)) return { passed: false, reason: "Published make conflicts with the legacy vehicle." };
  if (legacyVehicle.year !== cvr.identity.modelYear.value) return { passed: false, reason: "Published model year conflicts with the legacy vehicle." };
  if (!modelsCompatible(legacyVehicle.model, cvr.identity.model.value)) return { passed: false, reason: "Published model conflicts with the legacy vehicle." };
  return { passed: true, reason: "Vehicle ID, make, model, and model year match exactly or by an approved configuration suffix." };
}

function unavailableResult(legacyVehicle: Vehicle): ResolvedDecisionVehicleResult<Vehicle> {
  return {
    vehicle: legacyVehicle,
    trace: {
      resolverVersion: vehicleFieldAuthorityResolverVersion,
      vehicleId: legacyVehicle.id,
      identityMatchStatus: "not_found",
      publicationId: null,
      publishedRecordVersion: null,
      fields: [...eligibleFieldSpecs, ...traceOnlyFields].map((fieldSpec) => ({
        field: fieldSpec.runtimeField,
        canonicalFieldPath: fieldSpec.canonicalFieldPath,
        legacyValue: legacyVehicle[fieldSpec.runtimeField],
        canonicalValue: null,
        selectedValue: legacyVehicle[fieldSpec.runtimeField],
        authority: "legacy",
        status: "cvr_unavailable",
        fallbackUsed: true,
        reason: "No active published CVR exists for this exact vehicle ID.",
        publicationId: null,
        canonicalStatus: null,
        confidenceScore: null,
        confidenceLevel: null,
        evidenceIds: [],
      })),
      diagnostics: ["No active published CVR exists; the legacy vehicle remains unchanged."],
    },
  };
}

function rejectedIdentityResult(
  legacyVehicle: Vehicle,
  identityMatchStatus: "ambiguous" | "conflict",
  publication: PublishedVehicleIntelligenceRecord | null,
  reason: string,
): ResolvedDecisionVehicleResult<Vehicle> {
  return {
    vehicle: legacyVehicle,
    trace: {
      resolverVersion: vehicleFieldAuthorityResolverVersion,
      vehicleId: legacyVehicle.id,
      identityMatchStatus,
      publicationId: publication?.publicationId ?? null,
      publishedRecordVersion: publication?.recordVersion ?? null,
      fields: [...eligibleFieldSpecs, ...traceOnlyFields].map((fieldSpec) => {
        const datum = publication ? getDatum(publication, fieldSpec.canonicalFieldPath) : null;
        return {
          field: fieldSpec.runtimeField,
          canonicalFieldPath: fieldSpec.canonicalFieldPath,
          legacyValue: legacyVehicle[fieldSpec.runtimeField],
          canonicalValue: datum?.value ?? null,
          selectedValue: legacyVehicle[fieldSpec.runtimeField],
          authority: "legacy" as const,
          status: "cvr_rejected_due_to_identity" as const,
          fallbackUsed: true,
          reason,
          publicationId: publication?.publicationId ?? null,
          canonicalStatus: datum?.status ?? null,
          confidenceScore: datum?.confidence.score ?? null,
          confidenceLevel: datum?.confidence.level ?? null,
          evidenceIds: datum?.evidenceIds ?? [],
        };
      }),
      diagnostics: [reason],
    },
  };
}

function resolutionBase(
  field: DecisionVehicleFieldName,
  canonicalFieldPath: CanonicalVehicleFieldPath,
  legacyValue: unknown,
  datum: CanonicalDatum<unknown>,
  publication: PublishedVehicleIntelligenceRecord,
) {
  return {
    field,
    canonicalFieldPath,
    legacyValue,
    canonicalValue: datum.value,
    selectedValue: legacyValue,
    authority: "legacy" as const,
    status: "legacy_fallback" as const,
    fallbackUsed: true,
    reason: "Legacy fallback retained.",
    publicationId: publication.publicationId,
    canonicalStatus: datum.status,
    confidenceScore: datum.confidence.score,
    confidenceLevel: datum.confidence.level,
    evidenceIds: datum.evidenceIds,
  };
}

function fallback(
  base: ReturnType<typeof resolutionBase>,
  status: VehicleFieldAuthorityResolution["status"],
  reason: string,
): VehicleFieldAuthorityResolution {
  return { ...base, status, reason };
}

function getDatum(publication: PublishedVehicleIntelligenceRecord, path: CanonicalVehicleFieldPath) {
  const [section, field] = path.split(".");
  return (publication.canonicalRecord as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field];
}

function spec(
  runtimeField: DecisionVehicleFieldName,
  canonicalFieldPath: CanonicalVehicleFieldPath,
  normalize: EligibleFieldSpec["normalize"],
): EligibleFieldSpec {
  return { runtimeField, canonicalFieldPath, normalize };
}

function normalizeRequiredText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeYear(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeBodyStyle(value: unknown) {
  return typeof value === "string" && ["sedan", "suv", "hatchback", "truck", "coupe", "convertible", "wagon", "minivan"].includes(value) ? value : null;
}

function normalizeDrivetrain(value: unknown) {
  return typeof value === "string" && ["FWD", "RWD", "AWD", "4WD"].includes(value) ? value : null;
}

function normalizeTransmission(value: unknown) {
  if (value === "cvt") return "CVT";
  return value === "automatic" || value === "manual" ? value : null;
}

function normalizeFuelType(value: unknown) {
  return typeof value === "string" && ["gas", "hybrid", "electric", "diesel"].includes(value) ? value : null;
}

function normalizeMpg(value: unknown, unit: string, publication: PublishedVehicleIntelligenceRecord) {
  const fuelType = getDatum(publication, "identity.fuelType").value;
  if (fuelType !== "gas" && fuelType !== "hybrid" && fuelType !== "electric") return null;
  return toLegacyVehicleMpg(parseVehicleEnergyAuthority({ fuelType, value, unit, field: "efficiency" }));
}

function textEqual(left: unknown, right: unknown) {
  return normalizeText(left) === normalizeText(right);
}

function modelsCompatible(left: unknown, right: unknown) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  return hasOnlyConfigurationSuffix(normalizedLeft, normalizedRight) || hasOnlyConfigurationSuffix(normalizedRight, normalizedLeft);
}

function hasOnlyConfigurationSuffix(base: string, extended: string) {
  if (!extended.startsWith(`${base} `)) return false;
  const suffix = extended.slice(base.length + 1).split(" ").filter(Boolean);
  return suffix.length > 0 && suffix.every((token) => /^(awd|fwd|rwd|2wd|4wd|4x4|pickup|hybrid|hev|phev|electric|ev|diesel|automatic|manual|cvt|[0-9]+(?:\.[0-9]+)?l?)$/.test(token));
}

function normalizeText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function valuesEqual(left: unknown, right: unknown) {
  return typeof left === "string" || typeof right === "string"
    ? normalizeText(left) === normalizeText(right)
    : left === right;
}

function vehicleDecisionValuesEqual(left: Vehicle, right: Vehicle) {
  return ["make", "model", "year", "bodyType", "drivetrain", "transmission", "fuelType", "mpg", "safetyScore", "reliabilityScore"]
    .every((field) => valuesEqual(left[field as keyof Vehicle], right[field as keyof Vehicle]));
}
