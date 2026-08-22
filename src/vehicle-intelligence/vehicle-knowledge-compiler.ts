import {
  canonicalBodyStyles,
  canonicalDrivetrains,
  canonicalFuelTypes,
  canonicalTransmissions,
  isCanonicalVehicleFieldUnitAllowed,
  canonicalVehicleCategories,
  canonicalVehicleFieldNames,
  canonicalVehicleFieldPaths,
  canonicalVehicleFieldUnits,
  canonicalVehicleSchemaVersion,
  canonicalVehicleSectionNames,
  type CanonicalConfidence,
  type CanonicalDatum,
  type CanonicalEvidence,
  type CanonicalEvidenceDataUse,
  type CanonicalEvidenceSourceValue,
  type CanonicalMissingReason,
  type CanonicalRecordScope,
  type CanonicalUnit,
  type CanonicalValueStatus,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
} from "../../types/canonicalVehicle";
import type {
  VehicleKnowledgeClaim,
  VehicleKnowledgeSnapshot,
} from "../../types/vehicleKnowledge";
import type {
  KnowledgeCompilationResult,
  VehicleKnowledgeCompilationLineage,
  VehicleKnowledgeCompilerDiagnostic,
  VehicleKnowledgeCompilerOptions,
} from "../../types/vehicleKnowledgeCompiler";

export const vehicleKnowledgeCompilerVersion = "1.0.0" as const;

const confidencePaths = new Set<CanonicalVehicleFieldPath>([
  "confidence.dataQuality",
  "confidence.evidenceQuality",
  "confidence.sourceAgreement",
]);

const enumValues: Partial<Record<CanonicalVehicleFieldPath, readonly string[]>> = {
  "identity.bodyStyle": canonicalBodyStyles,
  "identity.vehicleCategory": canonicalVehicleCategories,
  "identity.drivetrain": canonicalDrivetrains,
  "identity.transmission": canonicalTransmissions,
  "identity.fuelType": canonicalFuelTypes,
};

export function compileVehicleKnowledge(
  snapshot: VehicleKnowledgeSnapshot,
  options: VehicleKnowledgeCompilerOptions = {},
): KnowledgeCompilationResult {
  const inputSnapshot = clone(snapshot);
  validateSnapshotHeader(snapshot);
  const diagnostics: VehicleKnowledgeCompilerDiagnostic[] = [];
  const lineage: VehicleKnowledgeCompilationLineage[] = [];
  const unresolvedFields: KnowledgeCompilationResult["unresolvedFields"] = [];
  const claimLineage: KnowledgeCompilationResult["claimLineage"] = {};
  const evidenceLineage: KnowledgeCompilationResult["evidenceLineage"] = {};
  const evidenceById = new Map(snapshot.evidence.map((evidence) => [evidence.evidenceId, evidence]));
  const usedEvidenceIds = new Set<string>();
  const trustedClaimIds = new Set<string>();
  const recordScope = options.recordScope ?? deriveRecordScope(snapshot.activeClaims);
  const sections: Record<string, Record<string, CanonicalDatum<unknown>>> = {};
  let sourcePopulatedFields = 0;

  for (const sectionName of canonicalVehicleSectionNames) {
    if (sectionName === "confidence") continue;
    const section: Record<string, CanonicalDatum<unknown>> = {};
    for (const fieldName of canonicalVehicleFieldNames[sectionName]) {
      const fieldPath = `${sectionName}.${fieldName}` as CanonicalVehicleFieldPath;
      const compilation = compileField({
        fieldPath,
        snapshot,
        recordScope,
        evidenceById,
        diagnostics,
        lineage,
        claimLineage,
        evidenceLineage,
        usedEvidenceIds,
        trustedClaimIds,
      });
      section[fieldName] = compilation.datum;
      if (compilation.datum.value !== null) sourcePopulatedFields += 1;
      if (compilation.unresolved) unresolvedFields.push(compilation.unresolved);
    }
    sections[sectionName] = section;
  }

  const nonConfidenceFieldCount = canonicalVehicleFieldPaths.length - confidencePaths.size;
  const conflictedFields = new Set(snapshot.unresolvedConflicts.map((conflict) => conflict.canonicalFieldPath));
  const staleFields = new Set(unresolvedFields
    .filter((field) => field.missingReason === "stale")
    .map((field) => field.fieldPath));
  const usedClaims = Object.values(claimLineage).filter((claim) => trustedClaimIds.has(claim.claimId));
  const dataQualityScore = round((sourcePopulatedFields / nonConfidenceFieldCount) * 100);
  const evidenceQualityScore = usedClaims.length
    ? round(usedClaims.reduce((sum, claim) => sum + claim.trustAssessment.evidenceQuality, 0) / usedClaims.length)
    : 0;
  const rawAgreement = usedClaims.length
    ? usedClaims.reduce((sum, claim) => sum + claim.trustAssessment.sourceAgreement, 0) / usedClaims.length
    : 0;
  const sourceAgreementScore = round(rawAgreement * Math.max(0, 1 - conflictedFields.size / nonConfidenceFieldCount));
  const recordId = `knowledge:${stableHash(snapshot.vehicleId)}`;
  const compilerEvidence = createCompilerEvidence({
    snapshot,
    recordId,
    recordScope,
    dataQualityScore,
    evidenceQualityScore,
    sourceAgreementScore,
  });
  const confidenceSection = {
    dataQuality: compilerConfidenceDatum(dataQualityScore, compilerEvidence.evidenceId, snapshot.generatedAt, "Meaningful trusted field coverage across the 70 non-confidence CVR fields."),
    evidenceQuality: compilerConfidenceDatum(evidenceQualityScore, compilerEvidence.evidenceId, snapshot.generatedAt, "Average repository evidence quality for claims actually compiled."),
    sourceAgreement: compilerConfidenceDatum(sourceAgreementScore, compilerEvidence.evidenceId, snapshot.generatedAt, "Repository source agreement for used claims, reduced by blocking conflicts."),
  };
  sections.confidence = confidenceSection;
  usedEvidenceIds.add(compilerEvidence.evidenceId);
  evidenceLineage[compilerEvidence.evidenceId] = clone(compilerEvidence);
  for (const path of confidencePaths) {
    lineage.push({
      canonicalFieldPath: path,
      activeClaimIds: [],
      evidenceIds: [compilerEvidence.evidenceId],
      trust: [],
      sources: [{ sourceType: "derived", providerName: "Vehicle Knowledge Compiler", sourceRecordId: recordId }],
      compilationRule: "compiler_confidence_summary",
    });
  }

  const recordEvidence = [...usedEvidenceIds]
    .map((evidenceId) => evidenceId === compilerEvidence.evidenceId ? compilerEvidence : evidenceById.get(evidenceId))
    .filter((evidence): evidence is CanonicalEvidence => Boolean(evidence))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
    .map(clone);
  const meaningfulDates = usedClaims.flatMap((claim) => [claim.createdAt, claim.retrievedAt]).filter(validDate).sort();
  const record = {
    schemaVersion: canonicalVehicleSchemaVersion,
    recordId,
    recordScope,
    recordStatus: options.recordStatus ?? inferRecordStatus(recordEvidence),
    createdAt: meaningfulDates[0] ?? snapshot.generatedAt,
    updatedAt: meaningfulDates.at(-1) ?? snapshot.generatedAt,
    evidence: recordEvidence,
    ...sections,
  } as CanonicalVehicleRecord;

  auditCompiledRecord(record, diagnostics, lineage);
  if (stableValue(snapshot) !== stableValue(inputSnapshot)) {
    throw new Error("Vehicle Knowledge Compiler mutated its input snapshot.");
  }
  const populatedFields = sourcePopulatedFields + confidencePaths.size;
  return {
    record: deepFreeze(record),
    diagnostics: diagnostics.sort(compareDiagnostics).map(deepFreeze),
    lineage: lineage.sort((left, right) => left.canonicalFieldPath.localeCompare(right.canonicalFieldPath)).map(deepFreeze),
    claimLineage: deepFreeze(sortRecord(claimLineage)),
    evidenceLineage: deepFreeze(sortRecord(evidenceLineage)),
    unresolvedFields: unresolvedFields.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath)).map(deepFreeze),
    summary: {
      populatedFields,
      missingFields: canonicalVehicleFieldPaths.length - populatedFields,
      staleFields: staleFields.size,
      conflictedFields: conflictedFields.size,
      trustedClaimsUsed: trustedClaimIds.size,
      evidenceRecordsUsed: recordEvidence.length,
      coverage: round((sourcePopulatedFields / nonConfidenceFieldCount) * 100),
    },
  };
}

type CompileFieldInput = {
  fieldPath: CanonicalVehicleFieldPath;
  snapshot: VehicleKnowledgeSnapshot;
  recordScope: CanonicalRecordScope;
  evidenceById: Map<string, CanonicalEvidence>;
  diagnostics: VehicleKnowledgeCompilerDiagnostic[];
  lineage: VehicleKnowledgeCompilationLineage[];
  claimLineage: KnowledgeCompilationResult["claimLineage"];
  evidenceLineage: KnowledgeCompilationResult["evidenceLineage"];
  usedEvidenceIds: Set<string>;
  trustedClaimIds: Set<string>;
};

function compileField(input: CompileFieldInput): {
  datum: CanonicalDatum<unknown>;
  unresolved: KnowledgeCompilationResult["unresolvedFields"][number] | null;
} {
  const expectedUnit = getExpectedUnit(input.fieldPath);
  const claims = input.snapshot.activeClaims.filter((claim) => claim.canonicalFieldPath === input.fieldPath);
  const staleClaims = input.snapshot.staleClaims.filter((claim) => claim.canonicalFieldPath === input.fieldPath);
  const conflictingClaims = input.snapshot.conflictedClaims.filter((claim) => claim.canonicalFieldPath === input.fieldPath);
  const conflict = input.snapshot.unresolvedConflicts.find((item) => item.canonicalFieldPath === input.fieldPath && item.blocking);
  if (conflict) {
    const relevant = uniqueClaims([...conflictingClaims, ...input.snapshot.inactiveClaims.filter((claim) => conflict.claimIds.includes(claim.claimId))]);
    retainDiagnosticLineage(relevant, input.claimLineage, input.evidenceLineage, input.evidenceById);
    input.diagnostics.push(diagnostic("unresolved_conflict", input.fieldPath, "error", "Blocking repository conflict prevents compilation.", relevant));
    return unresolvedField(input.fieldPath, expectedUnit, "source_conflict", staleClaims, relevant);
  }

  const validClaims: VehicleKnowledgeClaim[] = [];
  const invalidActiveDiagnostics: VehicleKnowledgeCompilerDiagnostic[] = [];
  for (const claim of claims) {
    const validation = validateActiveClaim(claim, input, expectedUnit);
    if (validation) {
      input.diagnostics.push(validation);
      invalidActiveDiagnostics.push(validation);
      retainDiagnosticLineage([claim], input.claimLineage, input.evidenceLineage, input.evidenceById);
    }
    else validClaims.push(claim);
  }
  const values = uniqueValues(validClaims.map((claim) => claim.canonicalValue));
  const units = uniqueSorted(validClaims.map((claim) => claim.unit));
  if (values.length > 1 || units.length > 1) {
    retainDiagnosticLineage(validClaims, input.claimLineage, input.evidenceLineage, input.evidenceById);
    input.diagnostics.push(diagnostic("repository_invariant_violation", input.fieldPath, "error", "Snapshot exposes incompatible active values for one field.", validClaims));
    return unresolvedField(input.fieldPath, expectedUnit, "source_conflict", staleClaims, validClaims);
  }

  if (validClaims.length) {
    const evidenceIds = uniqueSorted(validClaims.flatMap((claim) => claim.evidenceIds));
    for (const claim of validClaims) {
      input.claimLineage[claim.claimId] = clone(claim);
      input.trustedClaimIds.add(claim.claimId);
    }
    for (const evidenceId of evidenceIds) {
      const evidence = input.evidenceById.get(evidenceId) as CanonicalEvidence;
      input.evidenceLineage[evidenceId] = clone(evidence);
      input.usedEvidenceIds.add(evidenceId);
    }
    const status = resolveStatus(validClaims);
    const confidence = translateConfidence(validClaims);
    const asOfDate = validClaims.flatMap((claim) => [claim.effectiveFrom, claim.observedAt, claim.retrievedAt]).filter(validDate).sort().at(-1) ?? input.snapshot.generatedAt;
    const estimationMethods = uniqueSorted(validClaims.flatMap((claim) => claim.estimationMethod ? [claim.estimationMethod] : []));
    const sources = uniqueSources(validClaims);
    input.lineage.push({
      canonicalFieldPath: input.fieldPath,
      activeClaimIds: validClaims.map((claim) => claim.claimId).sort(),
      evidenceIds,
      trust: validClaims.map((claim) => ({ claimId: claim.claimId, trustScore: claim.trustAssessment.trustScore, trustState: claim.trustAssessment.trustState })).sort((left, right) => left.claimId.localeCompare(right.claimId)),
      sources,
      compilationRule: validClaims.length === 1 ? "single_active_trusted_claim" : "compatible_active_trusted_claims",
    });
    return {
      datum: {
        value: clone(values[0]),
        unit: validClaims[0].unit,
        status,
        confidence,
        evidenceIds,
        estimated: status === "estimated",
        estimationMethod: status === "derived" || status === "estimated"
          ? estimationMethods.join("; ") || `Preserved ${status} knowledge claim.`
          : null,
        asOfDate,
        measurementContext: mergeMeasurementContext(validClaims),
        missingReason: null,
      },
      unresolved: null,
    };
  }

  if (invalidActiveDiagnostics.length) {
    const missingReason: CanonicalMissingReason = invalidActiveDiagnostics.some((item) => item.code === "unsupported_value")
      ? "unsupported"
      : "invalid";
    return unresolvedField(input.fieldPath, expectedUnit, missingReason, staleClaims, conflictingClaims);
  }

  const inactive = input.snapshot.inactiveClaims.filter((claim) => claim.canonicalFieldPath === input.fieldPath);
  retainDiagnosticLineage([...staleClaims, ...inactive], input.claimLineage, input.evidenceLineage, input.evidenceById);
  if (staleClaims.length) {
    input.diagnostics.push(diagnostic("stale_claim_available", input.fieldPath, "warning", "Stale repository knowledge exists but cannot populate an active CVR value.", staleClaims));
    return unresolvedField(input.fieldPath, expectedUnit, "stale", staleClaims, conflictingClaims);
  }
  const invalidClaims = inactive.filter((claim) => claim.claimStatus === "rejected" || claim.trustAssessment.trustState === "REJECTED");
  if (invalidClaims.length) {
    input.diagnostics.push(diagnostic("missing_trusted_claim", input.fieldPath, "warning", "Only rejected or invalid knowledge exists for this field.", invalidClaims));
    return unresolvedField(input.fieldPath, expectedUnit, "invalid", [], conflictingClaims);
  }
  const unresolvedClaims = inactive.filter((claim) => claim.claimStatus === "proposed" || claim.trustAssessment.trustState === "REVIEW_REQUIRED");
  if (unresolvedClaims.length) {
    input.diagnostics.push(diagnostic("missing_trusted_claim", input.fieldPath, "warning", "Knowledge exists but has not reached active trusted status.", unresolvedClaims));
    return unresolvedField(input.fieldPath, expectedUnit, "insufficient_specificity", [], conflictingClaims);
  }
  input.diagnostics.push(diagnostic("missing_trusted_claim", input.fieldPath, "warning", "No active trusted repository claim is available.", []));
  return unresolvedField(input.fieldPath, expectedUnit, "not_collected", [], conflictingClaims);
}

function validateActiveClaim(
  claim: VehicleKnowledgeClaim,
  input: CompileFieldInput,
  expectedUnit: CanonicalUnit,
) {
  if (claim.vehicleId !== input.snapshot.vehicleId || claim.claimStatus !== "approved" || claim.trustAssessment.trustState !== "TRUSTED") {
    return diagnostic("invalid_active_claim", input.fieldPath, "error", "Snapshot active claim violates repository active/trusted invariants.", [claim]);
  }
  if (!isCanonicalVehicleFieldUnitAllowed(input.fieldPath, claim.unit)) {
    return diagnostic("unit_mismatch", input.fieldPath, "error", `Claim unit ${claim.unit} is not allowed for ${input.fieldPath}.`, [claim]);
  }
  if (!isScopeCompatible(input.recordScope, claim.recordScope)) {
    return diagnostic("claim_scope_mismatch", input.fieldPath, "error", `Claim scope ${claim.recordScope} cannot populate ${input.recordScope} record scope.`, [claim]);
  }
  if (!isSupportedCanonicalValue(input.fieldPath, claim.canonicalValue, expectedUnit)) {
    return diagnostic("unsupported_value", input.fieldPath, "error", "Claim value is incompatible with the canonical field contract.", [claim]);
  }
  const missingEvidence = claim.evidenceIds.filter((evidenceId) => !input.evidenceById.has(evidenceId));
  if (!claim.evidenceIds.length || missingEvidence.length) {
    return {
      ...diagnostic("evidence_reference_missing", input.fieldPath, "error", "Active claim references missing canonical evidence.", [claim]),
      evidenceIds: uniqueSorted([...claim.evidenceIds, ...missingEvidence]),
    };
  }
  return null;
}

function unresolvedField(
  fieldPath: CanonicalVehicleFieldPath,
  unit: CanonicalUnit,
  missingReason: CanonicalMissingReason,
  staleClaims: VehicleKnowledgeClaim[],
  conflictingClaims: VehicleKnowledgeClaim[],
) {
  return {
    datum: missingDatum(unit, missingReason),
    unresolved: {
      fieldPath,
      missingReason,
      staleClaimIds: staleClaims.map((claim) => claim.claimId).sort(),
      conflictingClaimIds: conflictingClaims.map((claim) => claim.claimId).sort(),
    },
  };
}

function missingDatum(unit: CanonicalUnit, missingReason: CanonicalMissingReason): CanonicalDatum<unknown> {
  return {
    value: null,
    unit,
    status: "missing",
    confidence: {
      score: null,
      level: "unknown",
      sourceAgreement: missingReason === "source_conflict" ? "conflicts" : "not_applicable",
      basis: [`No active trusted claim compiled; canonical missing reason: ${missingReason}.`],
    },
    evidenceIds: [],
    estimated: false,
    estimationMethod: null,
    asOfDate: null,
    measurementContext: null,
    missingReason,
  };
}

function compilerConfidenceDatum(value: number, evidenceId: string, asOfDate: string, method: string): CanonicalDatum<number, "score_0_100"> {
  return {
    value,
    unit: "score_0_100",
    status: "derived",
    confidence: {
      score: 1,
      level: "high",
      sourceAgreement: "not_applicable",
      basis: ["Deterministically computed from the read-only Vehicle Knowledge Snapshot."],
    },
    evidenceIds: [evidenceId],
    estimated: false,
    estimationMethod: method,
    asOfDate,
    measurementContext: { compilerVersion: vehicleKnowledgeCompilerVersion },
    missingReason: null,
  };
}

function createCompilerEvidence(input: {
  snapshot: VehicleKnowledgeSnapshot;
  recordId: string;
  recordScope: CanonicalRecordScope;
  dataQualityScore: number;
  evidenceQualityScore: number;
  sourceAgreementScore: number;
}): CanonicalEvidence {
  return {
    evidenceId: `${input.recordId}:compiler-confidence:${stableHash(input.snapshot.activeClaims.map((claim) => claim.claimId).sort().join("|"))}`,
    sourceType: "derived",
    providerName: "Vehicle Knowledge Compiler",
    sourceRecordId: input.recordId,
    sourceUrl: null,
    scope: input.recordScope,
    observedAt: input.snapshot.generatedAt,
    retrievedAt: input.snapshot.generatedAt,
    market: null,
    methodology: `Deterministic confidence aggregation policy ${vehicleKnowledgeCompilerVersion}.`,
    license: null,
    dataUse: inferEvidenceDataUse(input.snapshot.evidence),
    sourceClaims: [
      { sourceField: "confidence.dataQuality", originalSourceValue: input.dataQualityScore },
      { sourceField: "confidence.evidenceQuality", originalSourceValue: input.evidenceQualityScore },
      { sourceField: "confidence.sourceAgreement", originalSourceValue: input.sourceAgreementScore },
    ],
    normalizationMethod: "derived",
    normalizationNotes: ["Compiler metadata only; not a source vehicle fact."],
  };
}

function translateConfidence(claims: VehicleKnowledgeClaim[]): CanonicalConfidence {
  const score = claims.reduce((sum, claim) => sum + claim.trustAssessment.trustScore, 0) / claims.length / 100;
  const sourceTypes = new Set(claims.map((claim) => claim.source.sourceType));
  return {
    score: roundDecimal(score),
    level: score >= 0.85 ? "high" : score >= 0.7 ? "medium" : "low",
    sourceAgreement: claims.length > 1 || sourceTypes.size > 1 ? "agrees" : "single_source",
    basis: claims.map((claim) => `Repository claim ${claim.claimId} trust ${claim.trustAssessment.trustScore}/100.`).sort(),
  };
}

function resolveStatus(claims: VehicleKnowledgeClaim[]): Exclude<CanonicalValueStatus, "missing"> {
  const statuses = new Set(claims.map((claim) => claim.valueStatus));
  if (statuses.has("estimated")) return "estimated";
  if (statuses.has("derived")) return "derived";
  if (statuses.has("sourced")) return "sourced";
  return "verified";
}

function deriveRecordScope(claims: readonly VehicleKnowledgeClaim[]): CanonicalRecordScope {
  const scopes = new Set(claims.map((claim) => claim.recordScope));
  if (scopes.has("listing")) return "listing";
  if (scopes.has("vin")) return "vin";
  if (scopes.has("configuration")) return "configuration";
  return "model_year";
}

function isScopeCompatible(recordScope: CanonicalRecordScope, claimScope: CanonicalRecordScope) {
  if (recordScope === "listing") return true;
  if (recordScope === "vin") return claimScope === "vin" || claimScope === "configuration" || claimScope === "model_year";
  if (recordScope === "configuration") return claimScope === "configuration" || claimScope === "model_year";
  return claimScope === "model_year";
}

function getExpectedUnit(fieldPath: CanonicalVehicleFieldPath): CanonicalUnit {
  const [section, field] = fieldPath.split(".");
  return (canonicalVehicleFieldUnits as unknown as Record<string, Record<string, CanonicalUnit>>)[section][field];
}

function isSupportedCanonicalValue(fieldPath: CanonicalVehicleFieldPath, value: CanonicalEvidenceSourceValue, unit: CanonicalUnit) {
  if (value === null) return false;
  const allowed = enumValues[fieldPath];
  if (allowed) return typeof value === "string" && allowed.includes(value);
  if (unit !== "none") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || Array.isArray(value) || (typeof value === "object" && value !== null);
}

function mergeMeasurementContext(claims: VehicleKnowledgeClaim[]) {
  const contexts = claims.map((claim) => claim.measurementContext).filter((context): context is NonNullable<typeof context> => Boolean(context));
  if (!contexts.length) return null;
  return contexts.every((context) => stableValue(context) === stableValue(contexts[0])) ? clone(contexts[0]) : null;
}

function uniqueSources(claims: VehicleKnowledgeClaim[]) {
  const seen = new Set<string>();
  return claims.flatMap((claim) => {
    const key = `${claim.source.sourceType}:${claim.source.providerName}:${claim.sourceRecordId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ sourceType: claim.source.sourceType, providerName: claim.source.providerName, sourceRecordId: claim.sourceRecordId }];
  }).sort((left, right) => `${left.sourceType}:${left.providerName}:${left.sourceRecordId}`.localeCompare(`${right.sourceType}:${right.providerName}:${right.sourceRecordId}`));
}

function diagnostic(
  code: VehicleKnowledgeCompilerDiagnostic["code"],
  fieldPath: CanonicalVehicleFieldPath,
  severity: VehicleKnowledgeCompilerDiagnostic["severity"],
  message: string,
  claims: VehicleKnowledgeClaim[],
): VehicleKnowledgeCompilerDiagnostic {
  return {
    code,
    fieldPath,
    severity,
    message,
    claimIds: claims.map((claim) => claim.claimId).sort(),
    evidenceIds: uniqueSorted(claims.flatMap((claim) => claim.evidenceIds)),
  };
}

function retainDiagnosticLineage(
  claims: VehicleKnowledgeClaim[],
  claimLineage: KnowledgeCompilationResult["claimLineage"],
  evidenceLineage: KnowledgeCompilationResult["evidenceLineage"],
  evidenceById: Map<string, CanonicalEvidence>,
) {
  for (const claim of uniqueClaims(claims)) {
    claimLineage[claim.claimId] = clone(claim);
    for (const evidenceId of claim.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) evidenceLineage[evidenceId] = clone(evidence);
    }
  }
}

function auditCompiledRecord(
  record: CanonicalVehicleRecord,
  diagnostics: VehicleKnowledgeCompilerDiagnostic[],
  lineage: VehicleKnowledgeCompilationLineage[],
) {
  const evidenceIds = new Set(record.evidence.map((evidence) => evidence.evidenceId));
  const lineagePaths = new Set(lineage.map((item) => item.canonicalFieldPath));
  for (const path of canonicalVehicleFieldPaths) {
    const [section, field] = path.split(".");
    const datum = (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section]?.[field];
    if (!datum) {
      diagnostics.push({ code: "repository_invariant_violation", fieldPath: path, severity: "error", message: "Compiler failed to materialize a canonical field.", claimIds: [], evidenceIds: [] });
      continue;
    }
    if (datum.value !== null && datum.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId))) {
      diagnostics.push({ code: "evidence_reference_missing", fieldPath: path, severity: "error", message: "Compiled datum contains a dangling evidence reference.", claimIds: [], evidenceIds: datum.evidenceIds.filter((id) => !evidenceIds.has(id)) });
    }
    if (datum.value !== null && !lineagePaths.has(path)) {
      diagnostics.push({ code: "repository_invariant_violation", fieldPath: path, severity: "error", message: "Populated field is missing compilation lineage.", claimIds: [], evidenceIds: datum.evidenceIds });
    }
  }
}

function validateSnapshotHeader(snapshot: VehicleKnowledgeSnapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.vehicleId.trim()) throw new Error("Knowledge snapshot requires a vehicleId.");
  if (!validDate(snapshot.generatedAt)) throw new Error("Knowledge snapshot requires a valid generatedAt timestamp.");
  if (!Array.isArray(snapshot.activeClaims) || !Array.isArray(snapshot.inactiveClaims) || !Array.isArray(snapshot.conflictedClaims) || !Array.isArray(snapshot.evidence)) {
    throw new Error("Knowledge snapshot is missing required claim or evidence collections.");
  }
}

function inferRecordStatus(evidence: CanonicalEvidence[]): CanonicalVehicleRecord["recordStatus"] {
  const sourceEvidence = evidence.filter((item) => item.sourceType !== "derived");
  return sourceEvidence.length && sourceEvidence.every((item) => item.dataUse && item.dataUse !== "production") ? "example" : "draft";
}

function inferEvidenceDataUse(evidence: CanonicalEvidence[]): CanonicalEvidenceDataUse {
  const uses = new Set(evidence.map((item) => item.dataUse).filter(Boolean));
  if (uses.size === 1) return [...uses][0] as CanonicalEvidenceDataUse;
  if (uses.has("production")) return "production";
  if (uses.has("fixture")) return "fixture";
  if (uses.has("test")) return "test";
  return "example";
}

function compareDiagnostics(left: VehicleKnowledgeCompilerDiagnostic, right: VehicleKnowledgeCompilerDiagnostic) {
  return left.fieldPath.localeCompare(right.fieldPath) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message);
}

function uniqueClaims(claims: VehicleKnowledgeClaim[]) {
  const byId = new Map(claims.map((claim) => [claim.claimId, claim]));
  return [...byId.values()].sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function uniqueValues(values: CanonicalEvidenceSourceValue[]) {
  const byValue = new Map(values.map((value) => [stableValue(value), value]));
  return [...byValue.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => clone(value));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sortRecord<Value>(record: Record<string, Value>) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
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

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function roundDecimal(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
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
