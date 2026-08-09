import {
  canonicalBodyStyles,
  canonicalDrivetrains,
  canonicalFuelTypes,
  canonicalMissingReasons,
  canonicalTransmissions,
  canonicalValueStatuses,
  canonicalVehicleCategories,
  canonicalVehicleFieldNames,
  canonicalVehicleSectionNames,
  type CanonicalVehicleFieldPath,
} from "../../types/canonicalVehicle";
import {
  canonicalContributionSchemaVersion,
  type CanonicalContributionIssue,
  type CanonicalVehicleContribution,
} from "../../types/canonicalVehicleContribution";

export type CanonicalContributionValidationResult = {
  valid: boolean;
  issues: CanonicalContributionIssue[];
};

const topLevelKeys = new Set([
  "schemaVersion",
  "contributionId",
  "dataUse",
  "normalizationVersion",
  "recordScope",
  "source",
  "linkage",
  "sourceConfidence",
  "sourceMetadata",
  "evidence",
  "data",
  "issues",
]);

const datumKeys = new Set([
  "value",
  "unit",
  "status",
  "confidence",
  "evidenceIds",
  "attemptEvidenceIds",
  "estimated",
  "estimationMethod",
  "asOfDate",
  "measurementContext",
  "missingReason",
]);

const canonicalEnumValues: Partial<Record<CanonicalVehicleFieldPath, readonly string[]>> = {
  "identity.bodyStyle": canonicalBodyStyles,
  "identity.vehicleCategory": canonicalVehicleCategories,
  "identity.drivetrain": canonicalDrivetrains,
  "identity.transmission": canonicalTransmissions,
  "identity.fuelType": canonicalFuelTypes,
};

export function validateCanonicalVehicleContribution(
  input: unknown,
): CanonicalContributionValidationResult {
  const issues: CanonicalContributionIssue[] = [];
  if (!isObject(input)) {
    addIssue(issues, "invalid_contribution", "Contribution must be an object.");
    return { valid: false, issues };
  }

  for (const key of Object.keys(input)) {
    if (!topLevelKeys.has(key)) addIssue(issues, "unknown_top_level_field", `Unknown contribution field: ${key}.`);
  }

  requireString(input, "contributionId", issues);
  requireString(input, "normalizationVersion", issues);
  if (input.schemaVersion !== canonicalContributionSchemaVersion) {
    addIssue(issues, "invalid_schema_version", "Contribution schema version is not supported.");
  }

  const dataUse = input.dataUse;
  if (!isOneOf(dataUse, ["production", "fixture", "test"])) {
    addIssue(issues, "invalid_data_use", "Contribution dataUse must be production, fixture, or test.");
  }

  if (!isOneOf(input.recordScope, ["model_year", "configuration", "listing", "vin"])) {
    addIssue(issues, "invalid_record_scope", "Contribution recordScope is invalid.");
  }

  validateSource(input.source, issues);
  validateLinkage(input.linkage, issues);
  validateConfidence(input.sourceConfidence, "sourceConfidence", issues);
  if (!isObject(input.sourceMetadata)) {
    addIssue(issues, "invalid_source_metadata", "sourceMetadata must be a JSON object.");
  }

  const evidenceIds = validateEvidence(input.evidence, dataUse, issues);
  validateData(input.data, evidenceIds, issues);
  validateDeclaredIssues(input.issues, issues);

  return { valid: issues.length === 0, issues };
}

export function assertCanonicalVehicleContribution(
  input: unknown,
): asserts input is CanonicalVehicleContribution {
  const result = validateCanonicalVehicleContribution(input);
  if (!result.valid) {
    throw new Error(`Invalid canonical vehicle contribution: ${result.issues.map((issue) => issue.code).join(", ")}`);
  }
}

function validateSource(value: unknown, issues: CanonicalContributionIssue[]) {
  if (!isObject(value)) {
    addIssue(issues, "invalid_source", "Contribution source metadata must be an object.");
    return;
  }

  for (const field of ["sourceType", "providerName", "sourceRecordId", "retrievedAt"] as const) {
    requireString(value, field, issues);
  }
}

function validateLinkage(value: unknown, issues: CanonicalContributionIssue[]) {
  if (!isObject(value)) {
    addIssue(issues, "invalid_linkage", "Contribution linkage must be an object.");
    return;
  }

  if (!Array.isArray(value.externalIds)) {
    addIssue(issues, "invalid_external_ids", "linkage.externalIds must be an array.");
  }

  const hasLinkage = [
    value.canonicalRecordId,
    value.vin,
    value.make,
    value.model,
    value.configurationId,
  ].some((item) => typeof item === "string" && item.trim().length > 0)
    || typeof value.modelYear === "number"
    || (Array.isArray(value.externalIds) && value.externalIds.length > 0);

  if (!hasLinkage) addIssue(issues, "missing_linkage", "Contribution must include at least one stable linkage key.");
}

function validateEvidence(
  value: unknown,
  dataUse: unknown,
  issues: CanonicalContributionIssue[],
) {
  const evidenceIds = new Set<string>();
  if (!Array.isArray(value)) {
    addIssue(issues, "invalid_evidence", "Contribution evidence must be an array.");
    return evidenceIds;
  }

  for (const evidence of value) {
    if (!isObject(evidence)) {
      addIssue(issues, "invalid_evidence", "Each evidence entry must be an object.");
      continue;
    }

    if (typeof evidence.evidenceId !== "string" || !evidence.evidenceId.trim()) {
      addIssue(issues, "invalid_evidence_id", "Every evidence entry requires an evidenceId.");
    } else if (evidenceIds.has(evidence.evidenceId)) {
      addIssue(issues, "duplicate_evidence_id", `Duplicate evidence ID: ${evidence.evidenceId}.`);
    } else {
      evidenceIds.add(evidence.evidenceId);
    }

    if (evidence.dataUse !== dataUse) {
      addIssue(issues, "evidence_data_use_mismatch", "Evidence dataUse must match its contribution.");
    }
    if (dataUse !== "production" && evidence.dataUse === "production") {
      addIssue(issues, "non_production_evidence_promoted", "Fixture or test evidence cannot be marked production.");
    }
    if (!Array.isArray(evidence.sourceClaims)) {
      addIssue(issues, "invalid_source_claims", "Evidence sourceClaims must be an array.");
    } else {
      for (const claim of evidence.sourceClaims) {
        if (!isObject(claim) || typeof claim.sourceField !== "string" || !("originalSourceValue" in claim)) {
          addIssue(issues, "invalid_source_claim", "Each source claim requires sourceField and originalSourceValue.");
        }
      }
    }
    if (!isOneOf(evidence.normalizationMethod, ["direct", "mapped", "derived", "estimated"])) {
      addIssue(issues, "invalid_normalization_method", "Evidence normalization method is invalid.");
    }
  }

  return evidenceIds;
}

function validateData(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  issues: CanonicalContributionIssue[],
) {
  if (!isObject(value)) {
    addIssue(issues, "invalid_data", "Contribution data must be an object.");
    return;
  }

  const sections = new Set<string>(canonicalVehicleSectionNames);
  for (const [sectionName, sectionValue] of Object.entries(value)) {
    if (!sections.has(sectionName)) {
      addIssue(issues, "unknown_canonical_section", `Unknown canonical section: ${sectionName}.`);
      continue;
    }
    if (!isObject(sectionValue)) {
      addIssue(issues, "invalid_canonical_section", `${sectionName} must be an object.`);
      continue;
    }

    const knownFields = new Set<string>(
      canonicalVehicleFieldNames[sectionName as keyof typeof canonicalVehicleFieldNames],
    );
    for (const [fieldName, datum] of Object.entries(sectionValue)) {
      if (!knownFields.has(fieldName)) {
        addIssue(issues, "unknown_canonical_path", `Unknown canonical path: ${sectionName}.${fieldName}.`);
        continue;
      }
      validateDatum(
        datum,
        `${sectionName}.${fieldName}` as CanonicalVehicleFieldPath,
        evidenceIds,
        issues,
      );
    }
  }
}

function validateDatum(
  value: unknown,
  fieldPath: CanonicalVehicleFieldPath,
  knownEvidenceIds: ReadonlySet<string>,
  issues: CanonicalContributionIssue[],
) {
  if (!isObject(value)) {
    addIssue(issues, "invalid_datum", `${fieldPath} must be a canonical contribution datum.`, fieldPath);
    return;
  }

  for (const key of Object.keys(value)) {
    if (!datumKeys.has(key)) addIssue(issues, "unknown_datum_field", `Unknown datum field ${fieldPath}.${key}.`, fieldPath);
  }

  if (!isOneOf(value.status, canonicalValueStatuses)) {
    addIssue(issues, "invalid_datum_status", `${fieldPath} has an invalid status.`, fieldPath);
  }
  validateConfidence(value.confidence, `${fieldPath}.confidence`, issues, fieldPath);

  const claimEvidenceIds = validateStringArray(value.evidenceIds, `${fieldPath}.evidenceIds`, issues, fieldPath);
  const attemptEvidenceIds = validateStringArray(
    value.attemptEvidenceIds,
    `${fieldPath}.attemptEvidenceIds`,
    issues,
    fieldPath,
  );
  for (const evidenceId of [...claimEvidenceIds, ...attemptEvidenceIds]) {
    if (!knownEvidenceIds.has(evidenceId)) {
      addIssue(issues, "unknown_evidence_reference", `${fieldPath} references unknown evidence ${evidenceId}.`, fieldPath);
    }
  }

  if (value.value === null) {
    if (value.status !== "missing") addIssue(issues, "missing_status_mismatch", `${fieldPath} has a null value without missing status.`, fieldPath);
    if (claimEvidenceIds.length) addIssue(issues, "missing_value_has_claim_evidence", `${fieldPath} is missing but has claim evidence.`, fieldPath);
    if (!attemptEvidenceIds.length) addIssue(issues, "missing_attempt_evidence", `${fieldPath} explicitly reports missing data without attempt evidence.`, fieldPath);
    if (!isOneOf(value.missingReason, canonicalMissingReasons)) {
      addIssue(issues, "missing_reason_required", `${fieldPath} requires a canonical missing reason.`, fieldPath);
    }
  } else {
    if (value.status === "missing") addIssue(issues, "value_status_mismatch", `${fieldPath} has a value with missing status.`, fieldPath);
    if (!claimEvidenceIds.length) addIssue(issues, "claim_evidence_required", `${fieldPath} has a value without evidence.`, fieldPath);
    if (value.missingReason !== null) addIssue(issues, "unexpected_missing_reason", `${fieldPath} has a value and a missing reason.`, fieldPath);
  }

  const allowedValues = canonicalEnumValues[fieldPath];
  if (allowedValues && value.value !== null && !allowedValues.includes(String(value.value))) {
    addIssue(issues, "invalid_canonical_enum", `${fieldPath} has a non-canonical value.`, fieldPath);
  }

  if (typeof value.estimated !== "boolean") addIssue(issues, "invalid_estimated_flag", `${fieldPath}.estimated must be boolean.`, fieldPath);
  if (value.estimated !== (value.status === "estimated")) {
    addIssue(issues, "estimated_status_mismatch", `${fieldPath} estimated flag does not match status.`, fieldPath);
  }
  if ((value.status === "estimated" || value.status === "derived") && typeof value.estimationMethod !== "string") {
    addIssue(issues, "estimation_method_required", `${fieldPath} requires an estimation method.`, fieldPath);
  }
}

function validateConfidence(
  value: unknown,
  label: string,
  issues: CanonicalContributionIssue[],
  fieldPath: CanonicalVehicleFieldPath | "record" = "record",
) {
  if (!isObject(value)) {
    addIssue(issues, "invalid_confidence", `${label} must be a confidence object.`, fieldPath);
    return;
  }
  if (value.score !== null && (typeof value.score !== "number" || value.score < 0 || value.score > 1)) {
    addIssue(issues, "invalid_confidence_score", `${label}.score must be null or between 0 and 1.`, fieldPath);
  }
  if (!Array.isArray(value.basis) || !value.basis.length) {
    addIssue(issues, "missing_confidence_basis", `${label}.basis must explain the confidence.`, fieldPath);
  }
}

function validateDeclaredIssues(value: unknown, issues: CanonicalContributionIssue[]) {
  if (!Array.isArray(value)) addIssue(issues, "invalid_issues", "Contribution issues must be an array.");
}

function validateStringArray(
  value: unknown,
  label: string,
  issues: CanonicalContributionIssue[],
  fieldPath: CanonicalVehicleFieldPath,
) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    addIssue(issues, "invalid_evidence_references", `${label} must be a string array.`, fieldPath);
    return [];
  }
  return value as string[];
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  issues: CanonicalContributionIssue[],
) {
  if (typeof value[field] !== "string" || !(value[field] as string).trim()) {
    addIssue(issues, "required_string_missing", `${field} must be a non-empty string.`);
  }
}

function addIssue(
  issues: CanonicalContributionIssue[],
  code: string,
  message: string,
  fieldPath: CanonicalVehicleFieldPath | "record" = "record",
) {
  issues.push({
    code,
    kind: "invalid_canonical_value",
    fieldPath,
    severity: "error",
    message,
    evidenceIds: [],
    sourceField: null,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}
