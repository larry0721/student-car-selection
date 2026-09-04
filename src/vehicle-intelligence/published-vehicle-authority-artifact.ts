import type { CanonicalDatum } from "../../types/canonicalVehicle";
import type { PublishedVehicleAuthorityArtifact } from "../../types/publishedVehicleAuthorityArtifact";
import type { PublishedCVRRepositoryState, PublishedVehicleIntelligenceRecord } from "../../types/publishedVehicleIntelligence";
import { loadPublishedCVRRepository } from "./published-cvr-repository";

export const publishedVehicleAuthorityArtifactSchemaVersion = "1.0.0" as const;
export const publishedVehicleAuthorityArtifactVersion = "golden-set-v1.0.0" as const;

export const publishedVehicleAuthorityFields = Object.freeze([
  { runtimeField: "make", canonicalFieldPath: "identity.make" },
  { runtimeField: "model", canonicalFieldPath: "identity.model" },
  { runtimeField: "year", canonicalFieldPath: "identity.modelYear" },
  { runtimeField: "bodyType", canonicalFieldPath: "identity.bodyStyle" },
  { runtimeField: "drivetrain", canonicalFieldPath: "identity.drivetrain" },
  { runtimeField: "transmission", canonicalFieldPath: "identity.transmission" },
  { runtimeField: "fuelType", canonicalFieldPath: "identity.fuelType" },
  { runtimeField: "mpg", canonicalFieldPath: "environment.fuelEconomy" },
] as const);

export function createPublishedVehicleAuthorityArtifact(state: PublishedCVRRepositoryState): PublishedVehicleAuthorityArtifact {
  const validatedState = loadPublishedCVRRepository(JSON.stringify(state)).exportState();
  if (validatedState.dataUse !== "production") {
    throw new Error("Only a validated production publication repository can produce a runtime authority artifact.");
  }
  const publications = validatedState.publications
    .filter((item) => item.publicationStatus === "active")
    .sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  const publicationTimestamp = publications.map((item) => item.publishedAt).sort().at(-1);
  if (!publicationTimestamp) throw new Error("Published authority artifact requires active publications.");
  const publicationPolicyVersions = [...new Set(publications.map((item) => item.publishingPolicyVersion))].sort();
  const fingerprintInput = {
    schemaVersion: publishedVehicleAuthorityArtifactSchemaVersion,
    artifactVersion: publishedVehicleAuthorityArtifactVersion,
    sourceRepositoryId: validatedState.repositoryId,
    sourceRepositoryUpdatedAt: validatedState.updatedAt,
    sourceRepositoryVersion: `${validatedState.schemaVersion}:${validatedState.updatedAt}`,
    publicationTimestamp,
    publishedVehicleCount: publications.length,
    recommendationRuntimeEligible: true,
    resolverContractVersion: "1.0.0",
    canonicalIdentityContractVersion: "1.0.0",
    publicationPolicyVersions,
    authorityFields: publishedVehicleAuthorityFields,
    explicitlyNonScoreableFields: ["safetyScore", "reliabilityScore"],
    publications,
  };
  const generationFingerprint = stableHash(stableValue(fingerprintInput));
  return deepFreeze({
    schemaVersion: publishedVehicleAuthorityArtifactSchemaVersion,
    artifactVersion: publishedVehicleAuthorityArtifactVersion,
    artifactId: `published-vehicle-authority:${generationFingerprint}`,
    sourceRepositoryId: validatedState.repositoryId,
    sourceRepositoryUpdatedAt: validatedState.updatedAt,
    sourceRepositoryVersion: `${validatedState.schemaVersion}:${validatedState.updatedAt}`,
    generationFingerprint,
    publicationTimestamp,
    publishedVehicleCount: publications.length,
    recommendationRuntimeEligible: true,
    resolverContractVersion: "1.0.0",
    canonicalIdentityContractVersion: "1.0.0",
    publicationPolicyVersions,
    authorityFields: publishedVehicleAuthorityFields,
    explicitlyNonScoreableFields: ["safetyScore", "reliabilityScore"],
    publications,
  });
}

export function loadPublishedVehicleAuthorityArtifact(serialized: string): PublishedVehicleAuthorityArtifact {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error("Published vehicle authority artifact is malformed JSON."); }
  const artifact = value as PublishedVehicleAuthorityArtifact;
  if (!artifact || artifact.schemaVersion !== publishedVehicleAuthorityArtifactSchemaVersion
    || artifact.artifactVersion !== publishedVehicleAuthorityArtifactVersion
    || artifact.resolverContractVersion !== "1.0.0"
    || artifact.canonicalIdentityContractVersion !== "1.0.0"
    || artifact.sourceRepositoryVersion !== `1.0.0:${artifact.sourceRepositoryUpdatedAt}`
    || !Array.isArray(artifact.publicationPolicyVersions)
    || !artifact.publicationPolicyVersions.length
    || artifact.recommendationRuntimeEligible !== true
    || artifact.publishedVehicleCount !== artifact.publications?.length
    || stableValue(artifact.authorityFields) !== stableValue(publishedVehicleAuthorityFields)
    || stableValue(artifact.explicitlyNonScoreableFields) !== stableValue(["safetyScore", "reliabilityScore"])) {
    throw new Error("Published vehicle authority artifact contract is incompatible.");
  }
  if (!artifact.publications.length || new Set(artifact.publications.map((item) => item.vehicleId)).size !== artifact.publications.length) {
    throw new Error("Published vehicle authority artifact contains duplicate or missing vehicle identity.");
  }
  validatePublications(artifact.publications);
  const policyVersions = [...new Set(artifact.publications.map((item) => item.publishingPolicyVersion))].sort();
  if (stableValue(artifact.publicationPolicyVersions) !== stableValue(policyVersions)) {
    throw new Error("Published vehicle authority artifact publication policy versions are inconsistent.");
  }
  const fingerprint = stableHash(stableValue({
    schemaVersion: artifact.schemaVersion,
    artifactVersion: artifact.artifactVersion,
    sourceRepositoryId: artifact.sourceRepositoryId,
    sourceRepositoryUpdatedAt: artifact.sourceRepositoryUpdatedAt,
    sourceRepositoryVersion: artifact.sourceRepositoryVersion,
    publicationTimestamp: artifact.publicationTimestamp,
    publishedVehicleCount: artifact.publishedVehicleCount,
    recommendationRuntimeEligible: artifact.recommendationRuntimeEligible,
    resolverContractVersion: artifact.resolverContractVersion,
    canonicalIdentityContractVersion: artifact.canonicalIdentityContractVersion,
    publicationPolicyVersions: artifact.publicationPolicyVersions,
    authorityFields: artifact.authorityFields,
    explicitlyNonScoreableFields: artifact.explicitlyNonScoreableFields,
    publications: artifact.publications,
  }));
  if (artifact.generationFingerprint !== fingerprint || artifact.artifactId !== `published-vehicle-authority:${fingerprint}`) {
    throw new Error("Published vehicle authority artifact is stale or has failed its generation fingerprint.");
  }
  return deepFreeze(clone(artifact));
}

export function serializePublishedVehicleAuthorityArtifact(artifact: PublishedVehicleAuthorityArtifact) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function validatePublications(publications: readonly PublishedVehicleIntelligenceRecord[]) {
  for (const publication of publications) {
    if (publication.publicationStatus !== "active" || publication.dataClassification !== "production") {
      throw new Error("Published vehicle authority artifact contains an ineligible publication.");
    }
    for (const path of ["identity.make", "identity.model", "identity.modelYear"] as const) {
      const datum = getDatum(publication, path);
      if (datum.status === "missing" || datum.value === null || !datum.evidenceIds.length) {
        throw new Error(`Published vehicle authority artifact lacks required exact identity ${path}.`);
      }
    }
    assertFiniteNumbers(publication);
    const evidenceIds = new Set(publication.canonicalRecord.evidence.map((item) => item.evidenceId));
    for (const field of publishedVehicleAuthorityFields) {
      const datum = getDatum(publication, field.canonicalFieldPath);
      if (datum.evidenceIds.some((id) => !evidenceIds.has(id))) {
        throw new Error(`Published authority evidence is missing for ${field.canonicalFieldPath}.`);
      }
    }
  }
}

function getDatum(publication: PublishedVehicleIntelligenceRecord, path: string): CanonicalDatum<unknown> {
  const [section, field] = path.split(".");
  return (publication.canonicalRecord as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field];
}

function assertFiniteNumbers(value: unknown, path = "artifact") {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
  if (Array.isArray(value)) return value.forEach((item, index) => assertFiniteNumbers(item, `${path}[${index}]`));
  if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => assertFiniteNumbers(item, `${path}.${key}`));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
}

function clone<Value>(value: Value): Value { return JSON.parse(JSON.stringify(value)) as Value; }
function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}
