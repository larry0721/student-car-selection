import {
  canonicalVehicleFieldNames,
  canonicalVehicleFieldUnits,
  canonicalVehicleSchemaVersion,
  canonicalVehicleSectionNames,
  type CanonicalConfidence,
  type CanonicalDatum,
  type CanonicalEvidenceScope,
  type CanonicalIngestionResult,
  type CanonicalMissingReason,
  type CanonicalRecordScope,
  type CanonicalSourceType,
  type CanonicalUnit,
  type CanonicalValidationIssue,
  type CanonicalValueStatus,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
  type CanonicalVehicleSectionName,
} from "../../types/canonicalVehicle";
import type {
  CanonicalContributionDataUse,
  CanonicalContributionDatum,
  CanonicalContributionEvidence,
  CanonicalVehicleContribution,
} from "../../types/canonicalVehicleContribution";
import { validateCanonicalVehicleContribution } from "./canonical-vehicle-contribution";

export type CanonicalContributionMergeOptions = {
  targetDataUse?: CanonicalContributionDataUse;
  authorityMargin?: number;
};

type AuthorityDomain = "identity" | "market" | "environment" | "safety" | "reliability" | "general";

type EvidenceRegistry = {
  evidence: CanonicalContributionEvidence[];
  referenceIds: Map<string, string>;
};

type FieldClaim = {
  contribution: CanonicalVehicleContribution;
  datum: CanonicalContributionDatum<unknown>;
  fieldPath: CanonicalVehicleFieldPath;
  evidenceIds: string[];
  attemptEvidenceIds: string[];
  evidence: CanonicalContributionEvidence[];
};

type ResolutionStats = {
  resolvedFields: number;
  agreeingFields: number;
  comparableFields: number;
  conflictFields: number;
  fieldConfidenceScores: number[];
};

type LinkageResult = {
  compatible: boolean;
  issue: CanonicalValidationIssue | null;
};

const defaultAuthorityMargin = 12;
const nonConfidenceFieldCount = canonicalVehicleSectionNames
  .filter((section) => section !== "confidence")
  .reduce((total, section) => total + canonicalVehicleFieldNames[section].length, 0);

const sourceAuthority: Record<AuthorityDomain, Partial<Record<CanonicalSourceType, number>>> = {
  identity: {
    oem: 98,
    nhtsa: 96,
    inspection: 94,
    epa: 78,
    listing: 58,
    transaction: 55,
    legacy_catalog: 45,
    derived: 35,
  },
  market: {
    transaction: 98,
    listing: 94,
    inspection: 82,
    oem: 62,
    csv_import: 58,
    derived: 45,
    legacy_catalog: 40,
  },
  environment: {
    epa: 98,
    oem: 88,
    nhtsa: 68,
    professional_review: 64,
    listing: 48,
    derived: 45,
  },
  safety: {
    iihs: 98,
    nhtsa: 96,
    inspection: 82,
    oem: 72,
    professional_review: 62,
    listing: 38,
    derived: 42,
  },
  reliability: {
    repair: 98,
    warranty: 95,
    survey: 84,
    inspection: 80,
    professional_review: 66,
    oem: 55,
    listing: 35,
    derived: 44,
  },
  general: {
    inspection: 92,
    oem: 88,
    professional_review: 76,
    survey: 72,
    nhtsa: 70,
    epa: 70,
    listing: 58,
    csv_import: 52,
    derived: 45,
    legacy_catalog: 40,
  },
};

const statusAuthority: Record<Exclude<CanonicalValueStatus, "missing">, number> = {
  verified: 100,
  sourced: 82,
  derived: 58,
  estimated: 38,
};

const normalizationAuthority = {
  direct: 100,
  mapped: 88,
  derived: 62,
  estimated: 38,
} as const;

const missingReasonPriority: Record<CanonicalMissingReason, number> = {
  source_conflict: 8,
  invalid: 7,
  unsupported: 6,
  stale: 5,
  not_available: 4,
  insufficient_specificity: 3,
  not_applicable: 2,
  not_collected: 1,
};

export function mergeCanonicalVehicleContributions(
  inputContributions: readonly CanonicalVehicleContribution[],
  options: CanonicalContributionMergeOptions = {},
): CanonicalIngestionResult {
  const targetDataUse = options.targetDataUse || "production";
  const authorityMargin = options.authorityMargin ?? defaultAuthorityMargin;
  const contributions = [...inputContributions].sort((left, right) => left.contributionId.localeCompare(right.contributionId));
  const accepted: CanonicalVehicleContribution[] = [];
  const rejectedSourceRecordIds: string[] = [];
  const issues: CanonicalValidationIssue[] = [];

  for (const contribution of contributions) {
    const validation = validateCanonicalVehicleContribution(contribution);
    if (!validation.valid) {
      rejectedSourceRecordIds.push(contribution.source.sourceRecordId);
      issues.push(...validation.issues.map(toValidationIssue));
      continue;
    }
    const containsExampleSource = contribution.source.sourceType === "example_fixture"
      || contribution.evidence.some((evidence) => evidence.sourceType === "example_fixture");
    if (
      contribution.dataUse !== targetDataUse
      || contribution.evidence.some((evidence) => evidence.dataUse !== targetDataUse)
      || (targetDataUse === "production" && containsExampleSource)
    ) {
      rejectedSourceRecordIds.push(contribution.source.sourceRecordId);
      issues.push({
        code: "canonical_merge_data_use_rejected",
        fieldPath: "record",
        severity: "error",
        message: `Contribution ${contribution.contributionId} has non-${targetDataUse} data or example-source evidence and cannot enter a ${targetDataUse} record.`,
        evidenceIds: [],
      });
      continue;
    }
    accepted.push(contribution);
  }

  if (!accepted.length) {
    return finalizeResult([], rejectedSourceRecordIds, issues);
  }

  const linkage = validateLinkage(accepted);
  if (!linkage.compatible) {
    rejectedSourceRecordIds.push(...accepted.map((contribution) => contribution.source.sourceRecordId));
    if (linkage.issue) issues.push(linkage.issue);
    return finalizeResult([], rejectedSourceRecordIds, issues);
  }

  const evidenceRegistry = createEvidenceRegistry(accepted);
  issues.push(...accepted.flatMap((contribution) => contribution.issues.map((issue) => remapIssue(issue, contribution, evidenceRegistry))));

  const recordSections: Record<string, Record<string, CanonicalDatum<unknown>>> = {};
  const stats: ResolutionStats = {
    resolvedFields: 0,
    agreeingFields: 0,
    comparableFields: 0,
    conflictFields: 0,
    fieldConfidenceScores: [],
  };

  for (const sectionName of canonicalVehicleSectionNames) {
    if (sectionName === "confidence") continue;
    const section: Record<string, CanonicalDatum<unknown>> = {};
    for (const fieldName of canonicalVehicleFieldNames[sectionName]) {
      const fieldPath = `${sectionName}.${fieldName}` as CanonicalVehicleFieldPath;
      const unit = getFieldUnit(sectionName, fieldName);
      const claims = collectFieldClaims(accepted, sectionName, fieldName, fieldPath, evidenceRegistry, issues);
      section[fieldName] = resolveField(fieldPath, unit, claims, authorityMargin, issues, stats);
    }
    recordSections[sectionName] = section;
  }

  const createdAt = earliestDate(accepted.map((contribution) => contribution.source.retrievedAt));
  const updatedAt = latestDate(accepted.map((contribution) => contribution.source.retrievedAt));
  recordSections.confidence = buildRecordConfidence(
    stats,
    evidenceRegistry.evidence,
    accepted,
    issues,
    updatedAt,
  );

  const record = {
    schemaVersion: canonicalVehicleSchemaVersion,
    recordId: createStableRecordId(accepted),
    recordScope: resolveRecordScope(accepted),
    recordStatus: targetDataUse === "fixture" ? "example" : "draft",
    createdAt,
    updatedAt,
    evidence: evidenceRegistry.evidence,
    ...recordSections,
  } as CanonicalVehicleRecord;

  return finalizeResult([record], rejectedSourceRecordIds, issues);
}

function validateLinkage(contributions: readonly CanonicalVehicleContribution[]): LinkageResult {
  const vinValues = uniqueNormalized(contributions.map((item) => item.linkage.vin));
  if (vinValues.length > 1) return failedLinkage("canonical_linkage_vin_conflict", "Contributions contain conflicting VINs.");

  const makeValues = uniqueNormalized(contributions.map((item) => item.linkage.make));
  if (makeValues.length > 1) return failedLinkage("canonical_linkage_make_conflict", "Contributions contain conflicting makes.");

  const modelValues = uniqueNormalized(contributions.map((item) => item.linkage.model));
  if (modelValues.length > 1) return failedLinkage("canonical_linkage_model_conflict", "Contributions contain conflicting models.");

  const yearValues = uniqueNumbers(contributions.map((item) => item.linkage.modelYear));
  if (yearValues.length > 1) return failedLinkage("canonical_linkage_model_year_conflict", "Contributions contain conflicting model years.");

  const scopedTrimValues = uniqueNormalized(
    contributions
      .filter((item) => item.recordScope === "configuration" || item.recordScope === "vin")
      .map((item) => item.linkage.trim),
  );
  if (scopedTrimValues.length > 1) return failedLinkage("canonical_linkage_trim_conflict", "Configuration-specific contributions contain conflicting trims.");

  const configurationValues = uniqueNormalized(contributions.map((item) => item.linkage.configurationId));
  if (configurationValues.length > 1 && !vinValues.length) {
    return failedLinkage("canonical_linkage_configuration_conflict", "Contributions contain conflicting configuration IDs without shared VIN linkage.");
  }

  const canonicalIds = uniqueNormalized(contributions.map((item) => item.linkage.canonicalRecordId));
  if (canonicalIds.length > 1) return failedLinkage("canonical_linkage_record_id_conflict", "Contributions contain conflicting canonical record IDs.");

  const configurationConflict = findConfigurationLinkageConflict(contributions);
  if (configurationConflict) return configurationConflict;

  if (contributions.length > 1 && !allContributionsConnected(contributions)) {
    return failedLinkage(
      "canonical_linkage_ambiguous",
      "Contributions do not form one connected vehicle identity through a shared VIN, canonical/external ID, configuration, or complete make/model/year identity.",
    );
  }

  return { compatible: true, issue: null };
}

function findConfigurationLinkageConflict(
  contributions: readonly CanonicalVehicleContribution[],
): LinkageResult | null {
  const configurationContributions = contributions.filter((contribution) => {
    return contribution.recordScope === "configuration" || contribution.recordScope === "vin";
  });
  if (configurationContributions.length < 2) return null;

  const drivetrains = uniqueClaimValues(configurationContributions, "drivetrain");
  if (drivetrains.length > 1) {
    return failedLinkage(
      "canonical_linkage_drivetrain_conflict",
      "VIN/configuration contributions contain conflicting drivetrains.",
    );
  }

  const transmissions = uniqueClaimValues(configurationContributions, "transmission");
  if (transmissions.length > 1 && !isCompatibleTransmissionSet(transmissions)) {
    return failedLinkage(
      "canonical_linkage_transmission_conflict",
      "VIN/configuration contributions contain incompatible transmission families.",
    );
  }

  const fuelTypes = uniqueClaimValues(configurationContributions, "fuelType");
  if (fuelTypes.length > 1 && !isCompatibleFuelTypeSet(fuelTypes)) {
    return failedLinkage(
      "canonical_linkage_fuel_type_conflict",
      "VIN/configuration contributions contain incompatible fuel or powertrain types.",
    );
  }

  return null;
}

function uniqueClaimValues(
  contributions: readonly CanonicalVehicleContribution[],
  fieldName: "drivetrain" | "transmission" | "fuelType",
) {
  return uniqueSorted(contributions.flatMap((contribution) => {
    const value = contribution.data.identity?.[fieldName]?.value;
    return typeof value === "string" && value.trim() ? [normalizeIdentity(value)] : [];
  }));
}

function isCompatibleTransmissionSet(values: readonly string[]) {
  return values.length === 2 && values.includes("automatic") && values.includes("cvt");
}

function isCompatibleFuelTypeSet(values: readonly string[]) {
  return values.length === 2
    && values.includes("gas")
    && (values.includes("hybrid") || values.includes("plug in hybrid"));
}

function allContributionsConnected(contributions: readonly CanonicalVehicleContribution[]) {
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift() as number;
    for (let index = 0; index < contributions.length; index += 1) {
      if (visited.has(index) || !contributionsShareIdentity(contributions[current], contributions[index])) continue;
      visited.add(index);
      queue.push(index);
    }
  }
  return visited.size === contributions.length;
}

function contributionsShareIdentity(
  left: CanonicalVehicleContribution,
  right: CanonicalVehicleContribution,
) {
  if (sameNonEmpty(left.linkage.vin, right.linkage.vin)) return true;
  if (sameNonEmpty(left.linkage.canonicalRecordId, right.linkage.canonicalRecordId)) return true;
  if (sameNonEmpty(left.linkage.configurationId, right.linkage.configurationId)) return true;

  const leftExternalIds = new Set(left.linkage.externalIds.map(normalizedExternalId));
  if (right.linkage.externalIds.some((id) => leftExternalIds.has(normalizedExternalId(id)))) return true;

  return completeIdentityKey(left) !== null && completeIdentityKey(left) === completeIdentityKey(right);
}

function completeIdentityKey(contribution: CanonicalVehicleContribution) {
  const { make, model, modelYear } = contribution.linkage;
  if (!make?.trim() || !model?.trim() || typeof modelYear !== "number") return null;
  return `${modelYear}:${normalizeIdentity(make)}:${normalizeIdentity(model)}`;
}

function sameNonEmpty(left: string | null, right: string | null) {
  return Boolean(left?.trim() && right?.trim() && normalizeIdentity(left) === normalizeIdentity(right));
}

function normalizedExternalId(id: { namespace: string; value: string }) {
  return `${normalizeIdentity(id.namespace)}:${normalizeIdentity(id.value)}`;
}

function createEvidenceRegistry(contributions: readonly CanonicalVehicleContribution[]): EvidenceRegistry {
  const entries = contributions.flatMap((contribution) => contribution.evidence.map((evidence) => ({
    contributionId: contribution.contributionId,
    evidence,
    signature: stableStringify(withoutEvidenceId(evidence)),
  })));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) groups.set(entry.signature, [...(groups.get(entry.signature) || []), entry]);

  const evidence: CanonicalContributionEvidence[] = [];
  const referenceIds = new Map<string, string>();
  const usedIds = new Map<string, string>();
  for (const signature of [...groups.keys()].sort()) {
    const group = groups.get(signature) || [];
    const requestedId = group.map((entry) => entry.evidence.evidenceId).sort()[0];
    const collision = usedIds.get(requestedId);
    const mergedId = collision && collision !== signature ? `${requestedId}#${stableHash(signature)}` : requestedId;
    usedIds.set(mergedId, signature);
    const representative = [...group].sort((left, right) => {
      const idOrder = left.evidence.evidenceId.localeCompare(right.evidence.evidenceId);
      return idOrder || left.contributionId.localeCompare(right.contributionId);
    })[0];
    evidence.push({ ...clone(representative.evidence), evidenceId: mergedId });
    for (const entry of group) {
      referenceIds.set(evidenceReferenceKey(entry.contributionId, entry.evidence.evidenceId), mergedId);
    }
  }

  evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return { evidence, referenceIds };
}

function collectFieldClaims(
  contributions: readonly CanonicalVehicleContribution[],
  sectionName: Exclude<CanonicalVehicleSectionName, "confidence">,
  fieldName: string,
  fieldPath: CanonicalVehicleFieldPath,
  evidenceRegistry: EvidenceRegistry,
  issues: CanonicalValidationIssue[],
) {
  const claims: FieldClaim[] = [];
  for (const contribution of contributions) {
    const section = contribution.data[sectionName] as Record<string, CanonicalContributionDatum<unknown>> | undefined;
    const datum = section?.[fieldName];
    if (!datum) continue;
    const expectedUnit = getFieldUnit(sectionName, fieldName);
    if (!isCompatibleUnit(fieldPath, datum.unit, expectedUnit)) {
      issues.push({
        code: "canonical_merge_unit_mismatch",
        fieldPath,
        severity: "error",
        message: `${fieldPath} contribution uses incompatible unit ${datum.unit}; expected ${expectedUnit}.`,
        evidenceIds: remapEvidenceIds([...datum.evidenceIds, ...datum.attemptEvidenceIds], contribution, evidenceRegistry),
      });
      continue;
    }
    const evidenceIds = remapEvidenceIds(datum.evidenceIds, contribution, evidenceRegistry);
    const attemptEvidenceIds = remapEvidenceIds(datum.attemptEvidenceIds, contribution, evidenceRegistry);
    const evidenceById = new Map(evidenceRegistry.evidence.map((item) => [item.evidenceId, item]));
    claims.push({
      contribution,
      datum,
      fieldPath,
      evidenceIds,
      attemptEvidenceIds,
      evidence: evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean) as CanonicalContributionEvidence[],
    });
  }
  return claims;
}

function resolveField(
  fieldPath: CanonicalVehicleFieldPath,
  unit: CanonicalUnit,
  claims: readonly FieldClaim[],
  authorityMargin: number,
  issues: CanonicalValidationIssue[],
  stats: ResolutionStats,
): CanonicalDatum<unknown> {
  if (!claims.length) return missingDatum(unit, "not_collected");
  const valueClaims = claims.filter((claim) => claim.datum.value !== null);
  if (!valueClaims.length) {
    const missingReason = [...claims]
      .map((claim) => claim.datum.missingReason || "not_available")
      .sort((left, right) => missingReasonPriority[right] - missingReasonPriority[left])[0];
    const attemptEvidenceIds = uniqueSorted(claims.flatMap((claim) => claim.attemptEvidenceIds));
    issues.push({
      code: "canonical_field_explicitly_missing",
      fieldPath,
      severity: "warning",
      message: `${fieldPath} was attempted by a source but no usable value was available.`,
      evidenceIds: attemptEvidenceIds,
    });
    return missingDatum(unit, missingReason);
  }

  const valueGroups = new Map<string, FieldClaim[]>();
  for (const claim of valueClaims) {
    const key = stableStringify({ unit: claim.datum.unit, value: claim.datum.value });
    valueGroups.set(key, [...(valueGroups.get(key) || []), claim]);
  }

  if (valueClaims.length > 1) stats.comparableFields += 1;
  if (valueGroups.size === 1) {
    if (independentSourceCount(valueClaims) > 1) stats.agreeingFields += 1;
    const resolved = resolveAgreeingClaims(valueClaims, "agrees");
    recordResolvedStats(resolved, stats);
    return resolved;
  }

  const newestClaimTime = latestClaimTime(valueClaims);
  const rankedGroups = [...valueGroups.entries()]
    .map(([key, group]) => ({
      key,
      group,
      score: groupAuthorityScore(fieldPath, group) + freshnessAuthorityBonus(fieldPath, group, newestClaimTime),
    }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  const winner = rankedGroups[0];
  const runnerUp = rankedGroups[1];
  const allEvidenceIds = uniqueSorted(valueClaims.flatMap((claim) => claim.evidenceIds));
  stats.conflictFields += 1;

  if (winner.score - runnerUp.score >= authorityMargin) {
    const resolved = resolveAgreeingClaims(winner.group, "mixed", 0.12);
    issues.push({
      code: "canonical_field_conflict_resolved",
      fieldPath,
      severity: "warning",
      message: `${fieldPath} conflict was resolved by field-aware source authority with a ${round(winner.score - runnerUp.score)} point margin.`,
      evidenceIds: allEvidenceIds,
    });
    recordResolvedStats(resolved, stats);
    return resolved;
  }

  issues.push({
    code: "canonical_field_conflict",
    fieldPath,
    severity: "error",
    message: `${fieldPath} has conflicting claims without a safe deterministic authority winner.`,
    evidenceIds: allEvidenceIds,
  });
  return missingDatum(unit, "source_conflict");
}

function resolveAgreeingClaims(
  claims: readonly FieldClaim[],
  agreement: CanonicalConfidence["sourceAgreement"],
  conflictPenalty = 0,
): CanonicalDatum<unknown> {
  const sorted = [...claims].sort((left, right) => {
    const authority = claimAuthorityScore(left.fieldPath, right) - claimAuthorityScore(left.fieldPath, left);
    return authority || left.contribution.contributionId.localeCompare(right.contribution.contributionId);
  });
  const selected = sorted[0];
  const independentStrongSources = new Set(
    claims
      .filter((claim) => isStrongClaim(claim))
      .map(independentSourceKey),
  ).size;
  const bestConfidence = Math.max(...claims.map((claim) => claim.datum.confidence.score ?? 0));
  const agreementBonus = independentStrongSources > 1 ? Math.min(0.12, (independentStrongSources - 1) * 0.04) : 0;
  const confidenceScore = clamp(roundConfidence(bestConfidence + agreementBonus - conflictPenalty), 0, 1);
  const evidenceIds = uniqueSorted(claims.flatMap((claim) => claim.evidenceIds));
  const selectedStatus = strongestStatus(claims.map((claim) => claim.datum.status));

  return {
    value: clone(selected.datum.value),
    unit: selected.datum.unit,
    status: selectedStatus,
    confidence: confidence(confidenceScore, agreement, [
      `${claims.length} canonical value claim${claims.length === 1 ? "" : "s"} resolved deterministically.`,
      independentStrongSources > 1
        ? `${independentStrongSources} independent strong sources agree.`
        : "No independent strong-source agreement bonus was applied.",
      conflictPenalty ? "Confidence was reduced because conflicting evidence exists." : "No unresolved value conflict remains.",
    ]),
    evidenceIds,
    estimated: selectedStatus === "estimated",
    estimationMethod: selectedStatus === "estimated" || selectedStatus === "derived"
      ? selected.datum.estimationMethod || "Merged canonical contribution resolution."
      : null,
    asOfDate: latestOptionalDate(claims.map((claim) => claim.datum.asOfDate)),
    measurementContext: selected.datum.measurementContext ? clone(selected.datum.measurementContext) : null,
    missingReason: null,
  };
}

function buildRecordConfidence(
  stats: ResolutionStats,
  evidence: readonly CanonicalContributionEvidence[],
  contributions: readonly CanonicalVehicleContribution[],
  issues: readonly CanonicalValidationIssue[],
  asOfDate: string,
) {
  const completeness = stats.resolvedFields / nonConfidenceFieldCount;
  const meanFieldConfidence = stats.fieldConfidenceScores.length
    ? average(stats.fieldConfidenceScores)
    : 0;
  const conflictPenalty = Math.min(25, stats.conflictFields * 5);
  const dataQuality = clamp(Math.round((completeness * 0.65 + meanFieldConfidence * 0.35) * 100 - conflictPenalty), 0, 100);

  const evidenceScores = evidence.map((item) => evidenceQualityScore(item));
  const evidenceQuality = evidenceScores.length ? Math.round(average(evidenceScores)) : 0;

  const agreementRatio = stats.comparableFields
    ? stats.agreeingFields / stats.comparableFields
    : contributions.length > 1 ? 0.5 : 0.45;
  const sourceAgreement = clamp(Math.round(agreementRatio * 100 - conflictPenalty), 0, 100);
  const sourceAgreementLabel: CanonicalConfidence["sourceAgreement"] = stats.conflictFields
    ? "mixed"
    : contributions.length > 1 && stats.agreeingFields
      ? "agrees"
      : "single_source";
  const evidenceIds = evidence.map((item) => item.evidenceId).sort();
  const confidenceScore = clamp(roundConfidence(0.65 + Math.min(0.25, evidence.length * 0.03) - Math.min(0.2, stats.conflictFields * 0.04)), 0, 1);
  const issueCount = issues.filter((issue) => issue.severity === "error").length;

  return {
    dataQuality: derivedConfidenceDatum(dataQuality, evidenceIds, asOfDate, confidenceScore, sourceAgreementLabel, [
      `${stats.resolvedFields} of ${nonConfidenceFieldCount} non-confidence fields contain resolved values.`,
      `Mean resolved field confidence is ${round(meanFieldConfidence * 100)}%.`,
      `${issueCount} error-level merge issue${issueCount === 1 ? "" : "s"} remain.`,
    ]),
    evidenceQuality: derivedConfidenceDatum(evidenceQuality, evidenceIds, asOfDate, confidenceScore, sourceAgreementLabel, [
      `${evidence.length} deduplicated evidence item${evidence.length === 1 ? "" : "s"} were evaluated.`,
      "Evidence quality uses source authority, normalization method, and scope specificity.",
    ]),
    sourceAgreement: derivedConfidenceDatum(sourceAgreement, evidenceIds, asOfDate, confidenceScore, sourceAgreementLabel, [
      `${stats.comparableFields} field${stats.comparableFields === 1 ? "" : "s"} had multiple value claims.`,
      `${stats.agreeingFields} comparable field${stats.agreeingFields === 1 ? "" : "s"} had independent agreement.`,
      `${stats.conflictFields} field conflict${stats.conflictFields === 1 ? "" : "s"} affected confidence.`,
    ]),
  };
}

function derivedConfidenceDatum(
  value: number,
  evidenceIds: string[],
  asOfDate: string,
  confidenceScore: number,
  sourceAgreement: CanonicalConfidence["sourceAgreement"],
  basis: string[],
): CanonicalDatum<number, "score_0_100"> {
  if (!evidenceIds.length) return missingDatum<number, "score_0_100">("score_0_100", "not_collected");
  return {
    value,
    unit: "score_0_100",
    status: "derived",
    confidence: confidence(confidenceScore, sourceAgreement, basis),
    evidenceIds,
    estimated: false,
    estimationMethod: "Canonical merger confidence policy v1.",
    asOfDate,
    measurementContext: null,
    missingReason: null,
  };
}

function claimAuthorityScore(fieldPath: CanonicalVehicleFieldPath, claim: FieldClaim) {
  const domain = fieldAuthorityDomain(fieldPath);
  const sourceScore = sourceAuthority[domain][claim.contribution.source.sourceType] ?? 50;
  const status = claim.datum.status === "missing" ? 0 : statusAuthority[claim.datum.status];
  const method = bestNormalizationScore(claim.evidence);
  const scope = scopeAuthorityScore(fieldPath, claim.evidence, claim.contribution.recordScope);
  const fieldConfidence = claim.datum.confidence.score ?? 0;
  const sourceConfidence = claim.contribution.sourceConfidence.score ?? 0;
  const confidenceValue = ((fieldConfidence + sourceConfidence) / 2) * 100;
  return sourceScore * 0.45 + status * 0.2 + method * 0.15 + scope * 0.15 + confidenceValue * 0.05;
}

function groupAuthorityScore(fieldPath: CanonicalVehicleFieldPath, claims: readonly FieldClaim[]) {
  const best = Math.max(...claims.map((claim) => claimAuthorityScore(fieldPath, claim)));
  const independentBonus = Math.min(4, Math.max(0, independentSourceCount(claims) - 1) * 2);
  return round(best + independentBonus);
}

function freshnessAuthorityBonus(
  fieldPath: CanonicalVehicleFieldPath,
  claims: readonly FieldClaim[],
  newestClaimTime: number | null,
) {
  if (!isTimeSensitiveField(fieldPath) || newestClaimTime === null) return 0;
  const groupTime = latestClaimTime(claims);
  if (groupTime === null) return 0;
  const ageDifferenceDays = Math.max(0, (newestClaimTime - groupTime) / 86_400_000);
  return round(Math.max(0, 14 - ageDifferenceDays / 30));
}

function isTimeSensitiveField(fieldPath: CanonicalVehicleFieldPath) {
  return fieldPath.startsWith("financial.")
    || fieldPath === "identity.odometerMileage"
    || fieldPath === "identity.condition";
}

function latestClaimTime(claims: readonly FieldClaim[]) {
  const times = claims.flatMap((claim) => claim.evidence.flatMap((evidence) => {
    const value = evidence.observedAt || evidence.retrievedAt;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? [parsed] : [];
  }));
  return times.length ? Math.max(...times) : null;
}

function fieldAuthorityDomain(fieldPath: CanonicalVehicleFieldPath): AuthorityDomain {
  if (fieldPath.startsWith("identity.")) {
    return fieldPath === "identity.odometerMileage" || fieldPath === "identity.condition" ? "market" : "identity";
  }
  if (fieldPath.startsWith("financial.")) return "market";
  if (fieldPath.startsWith("environment.")) return "environment";
  if (fieldPath.startsWith("safety.")) return "safety";
  if (fieldPath.startsWith("reliability.")) return "reliability";
  return "general";
}

function scopeAuthorityScore(
  fieldPath: CanonicalVehicleFieldPath,
  evidence: readonly CanonicalContributionEvidence[],
  fallbackScope: CanonicalRecordScope,
) {
  const scopes = evidence.length ? evidence.map((item) => item.scope) : [fallbackScope];
  return Math.max(...scopes.map((scope) => scoreScope(fieldPath, scope)));
}

function scoreScope(fieldPath: CanonicalVehicleFieldPath, scope: CanonicalEvidenceScope | CanonicalRecordScope) {
  const domain = fieldAuthorityDomain(fieldPath);
  if (domain === "market") {
    return scope === "listing" ? 100 : scope === "vin" ? 88 : scope === "configuration" || scope === "trim" ? 58 : 38;
  }
  if (domain === "identity") {
    return scope === "vin" ? 100 : scope === "configuration" || scope === "trim" ? 90 : scope === "model_year" ? 76 : scope === "listing" ? 62 : 55;
  }
  if (domain === "environment") {
    return scope === "configuration" || scope === "trim" ? 100 : scope === "model_year" ? 94 : scope === "vin" ? 88 : scope === "listing" ? 50 : 62;
  }
  if (domain === "safety") {
    return scope === "model_year" ? 100 : scope === "configuration" || scope === "trim" ? 94 : scope === "vin" ? 84 : scope === "listing" ? 45 : 72;
  }
  if (domain === "reliability") {
    return scope === "population" ? 100 : scope === "model_year" ? 92 : scope === "configuration" || scope === "trim" ? 86 : scope === "vin" ? 76 : 48;
  }
  return scope === "configuration" || scope === "trim" ? 92 : scope === "model_year" ? 86 : scope === "vin" ? 84 : scope === "listing" ? 66 : 72;
}

function bestNormalizationScore(evidence: readonly CanonicalContributionEvidence[]) {
  if (!evidence.length) return 0;
  return Math.max(...evidence.map((item) => normalizationAuthority[item.normalizationMethod]));
}

function evidenceQualityScore(evidence: CanonicalContributionEvidence) {
  const domainScores = Object.values(sourceAuthority)
    .map((policy) => policy[evidence.sourceType])
    .filter((score): score is number => typeof score === "number");
  const sourceScore = domainScores.length ? Math.max(...domainScores) : 50;
  const methodScore = normalizationAuthority[evidence.normalizationMethod];
  const scopeScore = scoreScope("identity.make", evidence.scope);
  return sourceScore * 0.5 + methodScore * 0.3 + scopeScore * 0.2;
}

function missingDatum<Value = unknown, Unit extends CanonicalUnit = CanonicalUnit>(
  unit: Unit,
  missingReason: CanonicalMissingReason,
): CanonicalDatum<Value, Unit> {
  return {
    value: null,
    unit,
    status: "missing",
    confidence: confidence(null, missingReason === "source_conflict" ? "conflicts" : "not_applicable", [
      missingReason === "not_collected"
        ? "No accepted contribution made a claim for this field."
        : `No resolved canonical value is available because the field is ${missingReason.replaceAll("_", " ")}.`,
    ]),
    evidenceIds: [],
    estimated: false,
    estimationMethod: null,
    asOfDate: null,
    measurementContext: null,
    missingReason,
  };
}

function confidence(
  score: number | null,
  sourceAgreement: CanonicalConfidence["sourceAgreement"],
  basis: string[],
): CanonicalConfidence {
  return {
    score,
    level: score === null ? "unknown" : score >= 0.8 ? "high" : score >= 0.55 ? "medium" : "low",
    sourceAgreement,
    basis,
  };
}

function createStableRecordId(contributions: readonly CanonicalVehicleContribution[]) {
  const vin = uniqueNormalized(contributions.map((item) => item.linkage.vin))[0];
  if (vin) return `cvr:vin:${vin.toUpperCase()}`;
  const canonicalId = uniqueNormalized(contributions.map((item) => item.linkage.canonicalRecordId))[0];
  if (canonicalId) return canonicalId;
  const configurationId = uniqueNormalized(contributions.map((item) => item.linkage.configurationId))[0];
  if (configurationId) return `cvr:configuration:${slug(configurationId)}`;
  const year = uniqueNumbers(contributions.map((item) => item.linkage.modelYear))[0];
  const make = uniqueNormalized(contributions.map((item) => item.linkage.make))[0] || "unknown-make";
  const model = uniqueNormalized(contributions.map((item) => item.linkage.model))[0] || "unknown-model";
  const trim = uniqueNormalized(contributions.map((item) => item.linkage.trim))[0];
  return `cvr:model:${year || "unknown-year"}:${slug(make)}:${slug(model)}${trim ? `:${slug(trim)}` : ""}`;
}

function resolveRecordScope(contributions: readonly CanonicalVehicleContribution[]): CanonicalRecordScope {
  if (contributions.some((item) => item.linkage.vin || item.recordScope === "vin")) return "vin";
  if (contributions.some((item) => item.recordScope === "listing")) return "listing";
  if (contributions.some((item) => item.recordScope === "configuration")) return "configuration";
  return "model_year";
}

function remapIssue(
  issue: CanonicalValidationIssue,
  contribution: CanonicalVehicleContribution,
  registry: EvidenceRegistry,
): CanonicalValidationIssue {
  return {
    code: issue.code,
    fieldPath: issue.fieldPath,
    severity: issue.severity,
    message: issue.message,
    evidenceIds: remapEvidenceIds(issue.evidenceIds, contribution, registry),
  };
}

function remapEvidenceIds(
  ids: readonly string[],
  contribution: CanonicalVehicleContribution,
  registry: EvidenceRegistry,
) {
  return uniqueSorted(ids.flatMap((id) => {
    const mapped = registry.referenceIds.get(evidenceReferenceKey(contribution.contributionId, id));
    return mapped ? [mapped] : [];
  }));
}

function isCompatibleUnit(fieldPath: CanonicalVehicleFieldPath, actual: CanonicalUnit, expected: CanonicalUnit) {
  if (fieldPath === "environment.fuelEconomy") {
    return actual === "mpg" || actual === "mpge" || actual === "kwh_per_100_miles";
  }
  return actual === expected;
}

function getFieldUnit(sectionName: CanonicalVehicleSectionName, fieldName: string) {
  return (canonicalVehicleFieldUnits[sectionName] as Record<string, CanonicalUnit>)[fieldName];
}

function strongestStatus(statuses: readonly CanonicalValueStatus[]) {
  const rank: Record<CanonicalValueStatus, number> = { verified: 4, sourced: 3, derived: 2, estimated: 1, missing: 0 };
  return [...statuses].sort((left, right) => rank[right] - rank[left])[0];
}

function isStrongClaim(claim: FieldClaim) {
  return (claim.datum.confidence.score ?? 0) >= 0.7
    && (claim.datum.status === "verified" || claim.datum.status === "sourced")
    && claim.evidence.some((item) => item.normalizationMethod === "direct" || item.normalizationMethod === "mapped");
}

function independentSourceCount(claims: readonly FieldClaim[]) {
  return new Set(claims.map(independentSourceKey)).size;
}

function independentSourceKey(claim: FieldClaim) {
  return `${claim.contribution.source.sourceType}:${normalizeIdentity(claim.contribution.source.providerName)}`;
}

function recordResolvedStats(datum: CanonicalDatum<unknown>, stats: ResolutionStats) {
  stats.resolvedFields += 1;
  if (datum.confidence.score !== null) stats.fieldConfidenceScores.push(datum.confidence.score);
}

function failedLinkage(code: string, message: string): LinkageResult {
  return {
    compatible: false,
    issue: { code, fieldPath: "record", severity: "error", message, evidenceIds: [] },
  };
}

function toValidationIssue(issue: CanonicalValidationIssue): CanonicalValidationIssue {
  return {
    code: issue.code,
    fieldPath: issue.fieldPath,
    severity: issue.severity,
    message: issue.message,
    evidenceIds: [...issue.evidenceIds],
  };
}

function finalizeResult(
  records: CanonicalVehicleRecord[],
  rejectedSourceRecordIds: string[],
  issues: CanonicalValidationIssue[],
): CanonicalIngestionResult {
  return {
    records,
    rejectedSourceRecordIds: uniqueSorted(rejectedSourceRecordIds),
    issues: deduplicateIssues(issues),
  };
}

function deduplicateIssues(issues: readonly CanonicalValidationIssue[]) {
  const bySignature = new Map<string, CanonicalValidationIssue>();
  for (const issue of issues) {
    const normalized = { ...issue, evidenceIds: uniqueSorted(issue.evidenceIds) };
    bySignature.set(stableStringify(normalized), normalized);
  }
  return [...bySignature.values()].sort((left, right) => {
    return left.fieldPath.localeCompare(right.fieldPath)
      || left.code.localeCompare(right.code)
      || left.message.localeCompare(right.message);
  });
}

function evidenceReferenceKey(contributionId: string, evidenceId: string) {
  return `${contributionId}\u0000${evidenceId}`;
}

function withoutEvidenceId(evidence: CanonicalContributionEvidence) {
  const { evidenceId: _evidenceId, ...rest } = evidence;
  return {
    ...rest,
    normalizationNotes: [...rest.normalizationNotes].sort(),
    sourceClaims: [...rest.sourceClaims].sort((left, right) => {
      return stableStringify(left).localeCompare(stableStringify(right));
    }),
  };
}

function uniqueNormalized(values: readonly (string | null)[]) {
  return uniqueSorted(values.flatMap((value) => value?.trim() ? [normalizeIdentity(value)] : []));
}

function uniqueNumbers(values: readonly (number | null)[]) {
  return [...new Set(values.filter((value): value is number => typeof value === "number"))].sort((left, right) => left - right);
}

function normalizeIdentity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value: string) {
  return normalizeIdentity(value).replaceAll(" ", "-") || "unknown";
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function earliestDate(values: readonly string[]) {
  return [...values].sort(compareDates)[0];
}

function latestDate(values: readonly string[]) {
  if (!values.length) return "1970-01-01T00:00:00.000Z";
  return [...values].sort(compareDates).at(-1) as string;
}

function latestOptionalDate(values: readonly (string | null)[]) {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.length ? latestDate(dates) : null;
}

function compareDates(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return left.localeCompare(right);
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number) {
  return Math.round(value * 1000) / 1000;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
