import {
  canonicalVehicleFieldPaths,
  canonicalVehicleSchemaVersion,
  type CanonicalDatum,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
} from "../../types/canonicalVehicle";
import type {
  CVRPublishingAction,
  CVRPublishingCheck,
  CVRPublishingDecision,
  CVRPublishingDiagnostic,
  CVRPublishingDiagnosticCode,
  CVRPublishingMetrics,
  CVRPublishingThresholds,
  PublishedCanonicalVehicleRecord,
} from "../../types/cvrPublishing";
import type { KnowledgeCompilationResult } from "../../types/vehicleKnowledgeCompiler";
import {
  isPublicationBlockingStaleField,
  requiredPublicationIdentityFields,
} from "./vehicle-field-criticality-policy";

export const cvrPublishingPolicyVersion = "1.1.0" as const;

export const cvrPublishingPolicy: Readonly<CVRPublishingThresholds> = Object.freeze({
  requiredIdentityFields: requiredPublicationIdentityFields,
  minimumTrustedClaims: 8,
  minimumDataQualityCoverage: 10,
  minimumEvidenceQuality: 80,
  minimumSourceAgreement: 50,
  minimumRepositoryTrust: 75,
  minimumPublishabilityScore: 80,
  maximumBlockingStaleFields: 0,
  maximumConflictedFields: 0,
});

const rejectingCompilerCodes = new Set([
  "invalid_active_claim",
  "evidence_reference_missing",
  "unsupported_value",
  "unit_mismatch",
  "claim_scope_mismatch",
  "repository_invariant_violation",
]);

export function evaluateCVRForPublishing(
  compilation: KnowledgeCompilationResult,
): CVRPublishingDecision {
  const inputBefore = stableValue(compilation);
  const diagnostics: CVRPublishingDiagnostic[] = [];
  const evidenceIds = new Set(compilation.record.evidence.map((evidence) => evidence.evidenceId));
  const sourceFieldPaths = canonicalVehicleFieldPaths.filter((path) => !path.startsWith("confidence."));
  const populatedSourcePaths = sourceFieldPaths.filter((path) => getDatum(compilation.record, path)?.value !== null);
  const requiredIdentityPresent = cvrPublishingPolicy.requiredIdentityFields.filter((path) => validRequiredIdentity(path, getDatum(compilation.record, path), diagnostics));
  const sourceLineage = compilation.lineage.filter((item) => !item.canonicalFieldPath.startsWith("confidence."));
  const trustedClaimIds = uniqueSorted(sourceLineage.flatMap((item) => item.activeClaimIds));

  auditRecordShape(compilation, diagnostics, evidenceIds, populatedSourcePaths, sourceLineage, trustedClaimIds);
  for (const diagnostic of compilation.diagnostics) {
    if (diagnostic.severity === "error" || rejectingCompilerCodes.has(diagnostic.code)) {
      diagnostics.push(publishingDiagnostic(
        "compiler_error_unresolved",
        "error",
        `Compiler diagnostic ${diagnostic.code} remains unresolved: ${diagnostic.message}`,
        diagnostic.fieldPath,
        diagnostic.claimIds,
        diagnostic.evidenceIds,
      ));
    }
  }

  const repositoryTrustScores = trustedClaimIds.flatMap((claimId) => {
    const claim = compilation.claimLineage[claimId];
    if (!claim) {
      diagnostics.push(publishingDiagnostic("claim_lineage_missing", "error", "A compiled active claim has no claim-lineage record.", "record", [claimId], []));
      return [];
    }
    if (claim.claimStatus !== "approved" || claim.trustAssessment.trustState !== "TRUSTED") {
      diagnostics.push(publishingDiagnostic("untrusted_claim_used", "error", "A populated field relies on a claim that is not approved and trusted.", claim.canonicalFieldPath, [claimId], claim.evidenceIds));
    }
    return [claim.trustAssessment.trustScore];
  });

  const evidenceCompleteness = populatedSourcePaths.length === 0
    ? 0
    : round(100 * populatedSourcePaths.filter((path) => {
      const datum = getDatum(compilation.record, path);
      return Boolean(datum?.evidenceIds.length && datum.evidenceIds.every((id) => evidenceIds.has(id)));
    }).length / populatedSourcePaths.length);
  const repositoryTrust = repositoryTrustScores.length
    ? round(repositoryTrustScores.reduce((sum, score) => sum + score, 0) / repositoryTrustScores.length)
    : 0;
  const staleFieldPaths = uniqueSorted(compilation.unresolvedFields
    .filter((field) => field.missingReason === "stale")
    .map((field) => field.fieldPath));
  const blockingStaleFieldPaths = staleFieldPaths.filter(isPublicationBlockingStaleField);
  const nonBlockingStaleFieldPaths = staleFieldPaths.filter((path) => !isPublicationBlockingStaleField(path));
  const unclassifiedStaleFields = Math.max(0, compilation.summary.staleFields - staleFieldPaths.length);
  const metrics: CVRPublishingMetrics = {
    requiredIdentityFieldsPresent: requiredIdentityPresent.length,
    requiredIdentityFieldsTotal: cvrPublishingPolicy.requiredIdentityFields.length,
    identityIntegrity: round(100 * requiredIdentityPresent.length / cvrPublishingPolicy.requiredIdentityFields.length),
    populatedSourceFields: populatedSourcePaths.length,
    trustedClaimsUsed: compilation.summary.trustedClaimsUsed,
    trustedClaimCoverage: populatedSourcePaths.length
      ? round(Math.min(1, compilation.summary.trustedClaimsUsed / populatedSourcePaths.length) * 100)
      : 0,
    sourceEvidenceRecords: compilation.record.evidence.filter((evidence) => evidence.sourceType !== "derived").length,
    evidenceCompleteness,
    dataQualityCoverage: compilation.summary.coverage,
    evidenceQuality: compilation.record.confidence.evidenceQuality.value ?? 0,
    sourceAgreement: compilation.record.confidence.sourceAgreement.value ?? 0,
    repositoryTrust,
    staleFields: compilation.summary.staleFields,
    blockingStaleFields: blockingStaleFieldPaths.length + unclassifiedStaleFields,
    nonBlockingStaleFields: nonBlockingStaleFieldPaths.length,
    blockingStaleFieldPaths,
    nonBlockingStaleFieldPaths,
    conflictedFields: compilation.summary.conflictedFields,
    compilerErrors: compilation.diagnostics.filter((item) => item.severity === "error").length,
  };

  addPolicyDiagnostics(compilation, metrics, diagnostics);
  const publishabilityScore = calculatePublishabilityScore(metrics, diagnostics);
  if (publishabilityScore < cvrPublishingPolicy.minimumPublishabilityScore) {
    diagnostics.push(publishingDiagnostic(
      "publishability_score_below_threshold",
      "warning",
      `Publishability score ${publishabilityScore} is below ${cvrPublishingPolicy.minimumPublishabilityScore}.`,
    ));
  }
  const checks = buildChecks(metrics, publishabilityScore, diagnostics);
  const action = chooseAction(compilation, metrics, diagnostics, publishabilityScore);
  const reason = decisionReason(action);
  const sortedDiagnostics = uniqueDiagnostics(diagnostics);
  const auditSeed = {
    policyVersion: cvrPublishingPolicyVersion,
    candidateRecordId: compilation.record.recordId,
    candidateFingerprint: stableHash(stableValue(compilation.record)),
    action,
    publishabilityScore,
    metrics,
    checks,
    diagnosticCodes: uniqueSorted(sortedDiagnostics.map((item) => item.code)),
    trustedClaimIds,
    evidenceIds: [...evidenceIds].sort(),
  };
  const auditRecord = {
    auditId: `cvr-publish:${stableHash(stableValue(auditSeed))}`,
    ...auditSeed,
    evaluatedAt: compilation.record.updatedAt,
    thresholds: cloneThresholds(),
  };
  const publishedRecord = action === "PUBLISH"
    ? createPublishedRecord(compilation.record, auditRecord.auditId)
    : null;
  const decision: CVRPublishingDecision = {
    action,
    publishable: action === "PUBLISH",
    publishabilityScore,
    reason,
    candidateRecordId: compilation.record.recordId,
    metrics,
    thresholds: cloneThresholds(),
    checks,
    diagnostics: sortedDiagnostics,
    reviewNotes: reviewNotes(action, diagnostics),
    auditRecord,
    publishedRecord,
  };
  if (stableValue(compilation) !== inputBefore) throw new Error("CVR Publishing Gate mutated its compilation input.");
  return deepFreeze(decision);
}

function auditRecordShape(
  compilation: KnowledgeCompilationResult,
  diagnostics: CVRPublishingDiagnostic[],
  evidenceIds: Set<string>,
  populatedSourcePaths: CanonicalVehicleFieldPath[],
  sourceLineage: KnowledgeCompilationResult["lineage"],
  trustedClaimIds: string[],
) {
  if (compilation.record.schemaVersion !== canonicalVehicleSchemaVersion || !compilation.record.recordId.trim()) {
    diagnostics.push(publishingDiagnostic("record_integrity_violation", "error", "The candidate CVR has invalid schema or record identity metadata."));
  }
  if (evidenceIds.size !== compilation.record.evidence.length) {
    diagnostics.push(publishingDiagnostic("record_integrity_violation", "error", "The candidate CVR contains duplicate evidence IDs."));
  }
  const lineageByPath = new Map(sourceLineage.map((item) => [item.canonicalFieldPath, item]));
  for (const path of populatedSourcePaths) {
    const datum = getDatum(compilation.record, path)!;
    const dangling = datum.evidenceIds.filter((id) => !evidenceIds.has(id));
    if (!datum.evidenceIds.length || dangling.length) {
      diagnostics.push(publishingDiagnostic("evidence_reference_missing", "error", "A populated CVR field lacks complete canonical evidence.", path, [], dangling));
    }
    const fieldLineage = lineageByPath.get(path);
    if (!fieldLineage?.activeClaimIds.length) {
      diagnostics.push(publishingDiagnostic("claim_lineage_missing", "error", "A populated CVR field lacks active claim lineage.", path));
    }
  }
  const actualPopulatedFields = canonicalVehicleFieldPaths.filter((path) => getDatum(compilation.record, path)?.value !== null).length;
  if (actualPopulatedFields !== compilation.summary.populatedFields
    || canonicalVehicleFieldPaths.length - actualPopulatedFields !== compilation.summary.missingFields
    || trustedClaimIds.length !== compilation.summary.trustedClaimsUsed) {
    diagnostics.push(publishingDiagnostic("record_integrity_violation", "error", "Compilation summary does not match the candidate CVR and lineage."));
  }
}

function validRequiredIdentity(
  path: CanonicalVehicleFieldPath,
  datum: CanonicalDatum<unknown> | undefined,
  diagnostics: CVRPublishingDiagnostic[],
) {
  if (!datum || datum.value === null) {
    diagnostics.push(publishingDiagnostic("missing_required_identity", "warning", "A required publishing identity field is missing.", path));
    return false;
  }
  let valid = true;
  if (path === "identity.make" || path === "identity.model") valid = typeof datum.value === "string" && datum.value.trim().length > 0;
  if (path === "identity.modelYear") valid = typeof datum.value === "number" && Number.isInteger(datum.value) && datum.value >= 1886 && datum.value <= 2100;
  if (!valid) diagnostics.push(publishingDiagnostic("invalid_identity_value", "error", "A required identity value violates the canonical publishing contract.", path, [], datum.evidenceIds));
  return valid;
}

function addPolicyDiagnostics(
  compilation: KnowledgeCompilationResult,
  metrics: CVRPublishingMetrics,
  diagnostics: CVRPublishingDiagnostic[],
) {
  if (metrics.conflictedFields > cvrPublishingPolicy.maximumConflictedFields
    || compilation.unresolvedFields.some((field) => field.missingReason === "source_conflict")) {
    diagnostics.push(publishingDiagnostic("blocking_conflict", "warning", "Blocking source conflicts must be resolved before publication."));
  }
  for (const fieldPath of metrics.blockingStaleFieldPaths) {
    diagnostics.push(publishingDiagnostic("stale_knowledge_present", "warning", "A stale publication-critical identity field blocks publication but remains diagnosed.", fieldPath));
  }
  for (const fieldPath of metrics.nonBlockingStaleFieldPaths) {
    diagnostics.push(publishingDiagnostic("stale_knowledge_present", "warning", "Stale non-blocking knowledge remains unavailable for decision use but does not invalidate the stable vehicle record.", fieldPath));
  }
  if (metrics.blockingStaleFields > metrics.blockingStaleFieldPaths.length) {
    diagnostics.push(publishingDiagnostic("stale_knowledge_present", "warning", "One or more stale fields could not be mapped to the canonical field policy and are conservatively publication-blocking."));
  }
  if (metrics.trustedClaimsUsed < cvrPublishingPolicy.minimumTrustedClaims) {
    diagnostics.push(publishingDiagnostic("insufficient_trusted_claim_coverage", "warning", `Only ${metrics.trustedClaimsUsed} trusted claims were compiled; ${cvrPublishingPolicy.minimumTrustedClaims} are required for unattended publication.`));
  }
  if (metrics.dataQualityCoverage < cvrPublishingPolicy.minimumDataQualityCoverage) {
    diagnostics.push(publishingDiagnostic("data_quality_below_threshold", "warning", `Data-quality coverage ${metrics.dataQualityCoverage} is below ${cvrPublishingPolicy.minimumDataQualityCoverage}.`));
  }
  if (metrics.evidenceQuality < cvrPublishingPolicy.minimumEvidenceQuality) {
    diagnostics.push(publishingDiagnostic("evidence_quality_below_threshold", "warning", `Evidence quality ${metrics.evidenceQuality} is below ${cvrPublishingPolicy.minimumEvidenceQuality}.`));
  }
  if (metrics.sourceAgreement < cvrPublishingPolicy.minimumSourceAgreement) {
    diagnostics.push(publishingDiagnostic("source_agreement_below_threshold", "warning", `Source agreement ${metrics.sourceAgreement} is below ${cvrPublishingPolicy.minimumSourceAgreement}.`));
  }
  if (metrics.repositoryTrust < cvrPublishingPolicy.minimumRepositoryTrust) {
    diagnostics.push(publishingDiagnostic("repository_trust_below_threshold", "warning", `Average repository trust ${metrics.repositoryTrust} is below ${cvrPublishingPolicy.minimumRepositoryTrust}.`));
  }
}

function calculatePublishabilityScore(metrics: CVRPublishingMetrics, diagnostics: CVRPublishingDiagnostic[]) {
  const coverageReadiness = Math.min(100, 100 * metrics.dataQualityCoverage / cvrPublishingPolicy.minimumDataQualityCoverage);
  const diagnosticHealth = diagnostics.some((item) => item.severity === "error")
    ? 0
    : metrics.conflictedFields > 0 ? 0 : metrics.blockingStaleFields > 0 ? 60 : 100;
  return round(
    metrics.identityIntegrity * 0.30
    + coverageReadiness * 0.20
    + metrics.evidenceQuality * 0.15
    + metrics.sourceAgreement * 0.15
    + metrics.repositoryTrust * 0.10
    + metrics.evidenceCompleteness * 0.05
    + diagnosticHealth * 0.05,
  );
}

function chooseAction(
  compilation: KnowledgeCompilationResult,
  metrics: CVRPublishingMetrics,
  diagnostics: CVRPublishingDiagnostic[],
  score: number,
): CVRPublishingAction {
  if (diagnostics.some((item) => item.severity === "error")) return "REJECT";
  const requiredIdentityBlocked = cvrPublishingPolicy.requiredIdentityFields.some((path) => {
    const unresolved = compilation.unresolvedFields.find((item) => item.fieldPath === path);
    return unresolved?.missingReason === "source_conflict" || unresolved?.missingReason === "stale";
  });
  if (metrics.conflictedFields > cvrPublishingPolicy.maximumConflictedFields
    || requiredIdentityBlocked
    || metrics.requiredIdentityFieldsPresent < metrics.requiredIdentityFieldsTotal
    || metrics.trustedClaimsUsed === 0) return "HOLD";
  const thresholdsPass = metrics.trustedClaimsUsed >= cvrPublishingPolicy.minimumTrustedClaims
    && metrics.dataQualityCoverage >= cvrPublishingPolicy.minimumDataQualityCoverage
    && metrics.evidenceQuality >= cvrPublishingPolicy.minimumEvidenceQuality
    && metrics.sourceAgreement >= cvrPublishingPolicy.minimumSourceAgreement
    && metrics.repositoryTrust >= cvrPublishingPolicy.minimumRepositoryTrust
    && metrics.blockingStaleFields <= cvrPublishingPolicy.maximumBlockingStaleFields
    && score >= cvrPublishingPolicy.minimumPublishabilityScore;
  return thresholdsPass ? "PUBLISH" : "REVIEW_REQUIRED";
}

function buildChecks(metrics: CVRPublishingMetrics, score: number, diagnostics: CVRPublishingDiagnostic[]): CVRPublishingCheck[] {
  return [
    check("required_identity", metrics.requiredIdentityFieldsPresent === metrics.requiredIdentityFieldsTotal, metrics.requiredIdentityFieldsPresent, metrics.requiredIdentityFieldsTotal),
    check("trusted_claims", metrics.trustedClaimsUsed >= cvrPublishingPolicy.minimumTrustedClaims, metrics.trustedClaimsUsed, cvrPublishingPolicy.minimumTrustedClaims),
    check("data_quality", metrics.dataQualityCoverage >= cvrPublishingPolicy.minimumDataQualityCoverage, metrics.dataQualityCoverage, cvrPublishingPolicy.minimumDataQualityCoverage),
    check("evidence_quality", metrics.evidenceQuality >= cvrPublishingPolicy.minimumEvidenceQuality, metrics.evidenceQuality, cvrPublishingPolicy.minimumEvidenceQuality),
    check("source_agreement", metrics.sourceAgreement >= cvrPublishingPolicy.minimumSourceAgreement, metrics.sourceAgreement, cvrPublishingPolicy.minimumSourceAgreement),
    check("repository_trust", metrics.repositoryTrust >= cvrPublishingPolicy.minimumRepositoryTrust, metrics.repositoryTrust, cvrPublishingPolicy.minimumRepositoryTrust),
    check("conflicts", metrics.conflictedFields <= cvrPublishingPolicy.maximumConflictedFields, metrics.conflictedFields, cvrPublishingPolicy.maximumConflictedFields),
    check("blocking_staleness", metrics.blockingStaleFields <= cvrPublishingPolicy.maximumBlockingStaleFields, metrics.blockingStaleFields, cvrPublishingPolicy.maximumBlockingStaleFields),
    check("structural_integrity", !diagnostics.some((item) => item.severity === "error"), !diagnostics.some((item) => item.severity === "error"), true),
    check("publishability_score", score >= cvrPublishingPolicy.minimumPublishabilityScore, score, cvrPublishingPolicy.minimumPublishabilityScore),
  ];
}

function createPublishedRecord(record: CanonicalVehicleRecord, auditId: string): PublishedCanonicalVehicleRecord {
  return {
    record: { ...clone(record), recordStatus: "validated" },
    publication: {
      status: "published",
      active: true,
      publishedAt: record.updatedAt,
      policyVersion: cvrPublishingPolicyVersion,
      auditId,
      sourceCompilationRecordId: record.recordId,
    },
  };
}

function decisionReason(action: CVRPublishingAction) {
  if (action === "PUBLISH") return "The candidate CVR has sufficient trusted identity and stable vehicle knowledge; any diagnosed non-blocking stale fields remain unavailable for buyer-specific decisions.";
  if (action === "REVIEW_REQUIRED") return "The candidate CVR has usable identity and no rejecting defect, but one or more unattended-publishing thresholds require human review.";
  if (action === "HOLD") return "Publication is blocked until required identity, trusted knowledge, freshness, or source conflicts are resolved.";
  return "The candidate CVR violates structural, provenance, or trusted-claim integrity and must be rebuilt before reconsideration.";
}

function reviewNotes(action: CVRPublishingAction, diagnostics: CVRPublishingDiagnostic[]) {
  if (action === "PUBLISH") return ["Persist through a separate versioned publication repository; do not replace catalog or recommendation data in place."];
  return uniqueSorted(diagnostics.map((item) => item.message));
}

function publishingDiagnostic(
  code: CVRPublishingDiagnosticCode,
  severity: CVRPublishingDiagnostic["severity"],
  message: string,
  fieldPath: CVRPublishingDiagnostic["fieldPath"] = "record",
  claimIds: string[] = [],
  evidenceIds: string[] = [],
): CVRPublishingDiagnostic {
  return { code, severity, message, fieldPath, claimIds: uniqueSorted(claimIds), evidenceIds: uniqueSorted(evidenceIds) };
}

function uniqueDiagnostics(diagnostics: CVRPublishingDiagnostic[]) {
  const byKey = new Map(diagnostics.map((item) => [`${item.code}:${item.fieldPath}:${item.message}`, item]));
  return [...byKey.values()].sort((left, right) => `${left.severity}:${left.code}:${left.fieldPath}:${left.message}`.localeCompare(`${right.severity}:${right.code}:${right.fieldPath}:${right.message}`));
}

function getDatum(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath): CanonicalDatum<unknown> | undefined {
  const [section, field] = path.split(".");
  return (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section]?.[field];
}

function check(checkName: string, passed: boolean, actual: CVRPublishingCheck["actual"], required: CVRPublishingCheck["required"]): CVRPublishingCheck {
  return { check: checkName, passed, actual, required };
}

function cloneThresholds(): CVRPublishingThresholds {
  return { ...cvrPublishingPolicy, requiredIdentityFields: [...cvrPublishingPolicy.requiredIdentityFields] };
}

function uniqueSorted<Value extends string>(values: Value[]): Value[] {
  return [...new Set(values.filter(Boolean))].sort();
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
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
