import type { CanonicalIngestionContext } from "../../types/canonicalVehicle";
import type { CanonicalContributionDataUse, CanonicalVehicleContribution } from "../../types/canonicalVehicleContribution";
import type { CatalogEnrichmentResult } from "../../types/catalogEnrichment";
import type {
  CatalogCorrectionField,
  CatalogEnrichmentReviewCandidate,
  CatalogEnrichmentReviewComparison,
  CatalogEnrichmentReviewDecision,
  CatalogEnrichmentReviewDecisionInput,
  CatalogEnrichmentReviewExecutionResult,
  CatalogEnrichmentReviewItem,
  CatalogEnrichmentReviewManifest,
  CatalogEnrichmentReviewPriority,
  CatalogEnrichmentReviewQueue,
  CatalogEnrichmentReviewQueueSummary,
  CatalogMetadataCorrection,
  CatalogReviewComparisonSnapshot,
  CatalogReviewVehicleSnapshot,
  EpaCatalogEnrichmentReviewItem,
  NhtsaCatalogEnrichmentReviewItem,
} from "../../types/catalogEnrichmentReview";
import type { EpaVehicleRecord } from "./sources/epa/epa-client";
import { epaContributionAdapter } from "./sources/epa/epa-contribution-adapter";
import type { NhtsaSourceRecord } from "./sources/nhtsa/nhtsa-contribution-adapter";
import { nhtsaContributionAdapter } from "./sources/nhtsa/nhtsa-contribution-adapter";
import { mergeCanonicalVehicleContributions } from "./canonical-vehicle-merger";
import { decideEnrichment } from "./enrichment-decision-policy";
import { matchEpaCandidates, matchNhtsaCandidates } from "./vehicle-source-matching";
import type {
  CatalogVehicleMatchInput,
  NhtsaCatalogMatchCandidate,
  SourceMatchCandidateAssessment,
  SourceMatchDimension,
  SourceMatchResult,
  VehicleSourceMatchName,
} from "../../types/vehicleSourceMatch";

export const catalogEnrichmentReviewManifestSchemaVersion = "1.0.0" as const;
export const defaultCatalogEnrichmentReviewer = Object.freeze({ reviewerId: "project_owner" });

export type ReviewQueueOptions = {
  generatedAt?: string;
  dataUse?: "production" | "fixture";
  manifest?: CatalogEnrichmentReviewManifest;
  includeCatalogAnomalySkips?: boolean;
};

export type ExecuteReviewDecisionOptions = {
  retrievedAt?: string;
  market?: string | null;
};

export function generateCatalogEnrichmentReviewQueue(
  results: readonly CatalogEnrichmentResult[],
  options: ReviewQueueOptions = {},
): CatalogEnrichmentReviewQueue {
  const generatedAt = requireDate(options.generatedAt ?? new Date().toISOString(), "generatedAt");
  const dataUse = options.dataUse ?? "production";
  const items = [...results]
    .sort((left, right) => left.catalogVehicleId.localeCompare(right.catalogVehicleId))
    .flatMap((result) => (["nhtsa", "epa"] as const).flatMap((source) => {
      const decision = result.enrichmentDecisions[source];
      const matchResult = result.sourceMatches[source];
      const anomalyReview = options.includeCatalogAnomalySkips
        && decision?.action === "SKIP"
        && (
          result.catalogDataIssues.some((issue) => issue.severity === "error")
          || Boolean(matchResult?.conflicts.length)
        );
      if (!decision || !matchResult || (!anomalyReview && decision.action !== "REVIEW_REQUIRED" && decision.action !== "DEFER")) return [];
      const reviewId = `${result.catalogVehicleId}:${source}`;
      const activeDecision = options.manifest ? getActiveCatalogEnrichmentReviewDecision(options.manifest, reviewId) : null;
      return [source === "nhtsa"
        ? buildNhtsaReviewItem(
          result,
          matchResult as SourceMatchResult<NhtsaCatalogMatchCandidate>,
          decision,
          reviewId,
          generatedAt,
          dataUse,
          activeDecision,
        )
        : buildEpaReviewItem(
          result,
          matchResult as SourceMatchResult<EpaVehicleRecord>,
          decision,
          reviewId,
          generatedAt,
          dataUse,
          activeDecision,
        )];
    }))
    .sort(compareReviewItems);

  return {
    items,
    sourceResultCount: results.length * 2,
    queuedResultCount: items.length,
    generatedAt,
  };
}

export function createCatalogEnrichmentReviewDecision(
  item: CatalogEnrichmentReviewItem,
  input: CatalogEnrichmentReviewDecisionInput,
  history: readonly CatalogEnrichmentReviewDecision[] = [],
): CatalogEnrichmentReviewDecision {
  const reason = requireText(input.reason, "Reviewer reason");
  const decidedAt = requireDate(input.decidedAt, "decidedAt");
  const reviewer = input.reviewer ?? defaultCatalogEnrichmentReviewer;
  requireText(reviewer.reviewerId, "reviewerId");
  const itemHistory = history.filter((decision) => decision.reviewId === item.reviewId);
  const active = getActiveDecisionFromHistory(itemHistory);
  const reviewVersion = (active?.reviewVersion ?? 0) + 1;
  const selected = input.selectedSourceRecordId
    ? item.candidates.find((candidate) => candidate.sourceRecordId === input.selectedSourceRecordId)
    : undefined;
  const corrections = validateCorrections(item.catalogSnapshot, input.catalogCorrections ?? []);
  const reviewedCandidateIds = uniqueSorted(input.reviewedCandidateIds ?? (selected ? [selected.sourceRecordId] : []));
  const unresolvedFields = uniqueDimensions(input.unresolvedFields ?? item.requestedReviewFields);
  let automaticallyResolvedConflicts: string[] = [];

  if (input.action === "APPROVE_SOURCE") {
    if (!selected) throw new Error("APPROVE_SOURCE requires a candidate that exists in the review item.");
    if (item.source === "nhtsa" && !hasValidVin(selected.sourceRecord as NhtsaCatalogMatchCandidate)) {
      throw new Error("APPROVE_SOURCE for NHTSA requires a VIN-backed candidate so the existing VIN adapter can validate it.");
    }
    const reassessed = rematchCandidate(item, selected.sourceRecordId, corrections);
    if (!reassessed?.eligible || reassessed.conflicts.length) {
      throw new Error("APPROVE_SOURCE cannot approve a candidate with an unresolved hard contradiction.");
    }
    automaticallyResolvedConflicts = selected.conflicts.filter((conflict) => !reassessed.conflicts.includes(conflict));
  }
  if (input.action === "REJECT_SOURCE" && !selected) {
    throw new Error("REJECT_SOURCE requires a candidate that exists in the review item.");
  }
  if (input.action === "DEFER" && unresolvedFields.length === 0) {
    throw new Error("DEFER requires at least one unresolved field or requested evidence item.");
  }
  if (input.action === "CORRECT_CATALOG_METADATA" && corrections.length === 0) {
    throw new Error("CORRECT_CATALOG_METADATA requires at least one structured correction.");
  }
  if (input.action === "MARK_NOT_FOUND" && reviewedCandidateIds.length === 0 && item.candidates.length > 0) {
    throw new Error("MARK_NOT_FOUND must retain the candidate IDs that were reviewed.");
  }

  const decision: CatalogEnrichmentReviewDecision = {
    decisionId: `${item.reviewId}:v${reviewVersion}`,
    reviewId: item.reviewId,
    catalogVehicleId: item.catalogVehicleId,
    source: item.source,
    action: input.action,
    selectedSourceRecordId: selected?.sourceRecordId ?? null,
    selectedCandidateSnapshot: selected ? clone(selected.sourceRecord) : null,
    reason,
    evidence: clone(input.evidence ?? []),
    catalogCorrections: clone(corrections),
    resolvedConflicts: uniqueSorted([...(input.resolvedConflicts ?? []), ...automaticallyResolvedConflicts]),
    unresolvedFields,
    reviewedCandidateIds,
    reviewer: clone(reviewer),
    decidedAt,
    reviewVersion,
    supersedesDecisionId: active?.decisionId ?? null,
    dataUse: item.dataUse,
  };
  return deepFreeze(decision);
}

export function createCatalogEnrichmentReviewManifest(input: {
  manifestId: string;
  dataUse: "production" | "fixture";
  createdAt: string;
}): CatalogEnrichmentReviewManifest {
  const createdAt = requireDate(input.createdAt, "createdAt");
  return deepFreeze({
    schemaVersion: catalogEnrichmentReviewManifestSchemaVersion,
    manifestId: requireText(input.manifestId, "manifestId"),
    dataUse: input.dataUse,
    storageBoundary: "local_staging_only" as const,
    productionCatalogMutated: false as const,
    createdAt,
    updatedAt: createdAt,
    decisions: [],
  });
}

export function appendCatalogEnrichmentReviewDecision(
  manifest: CatalogEnrichmentReviewManifest,
  decision: CatalogEnrichmentReviewDecision,
): CatalogEnrichmentReviewManifest {
  if (manifest.dataUse !== decision.dataUse) {
    throw new Error("Review decision data use must match the manifest; fixture decisions cannot enter a production manifest.");
  }
  if (manifest.decisions.some((item) => item.decisionId === decision.decisionId)) {
    throw new Error(`Review decision ${decision.decisionId} already exists.`);
  }
  const expectedVersion = 1 + Math.max(0, ...manifest.decisions
    .filter((item) => item.reviewId === decision.reviewId)
    .map((item) => item.reviewVersion));
  if (decision.reviewVersion !== expectedVersion) {
    throw new Error(`Review decision version must be ${expectedVersion} for ${decision.reviewId}.`);
  }
  const previous = getActiveCatalogEnrichmentReviewDecision(manifest, decision.reviewId);
  if ((previous?.decisionId ?? null) !== decision.supersedesDecisionId) {
    throw new Error("Review decision supersession metadata does not match the current active decision.");
  }
  const decisions = [...manifest.decisions, clone(decision)].sort(compareDecisions);
  return deepFreeze({ ...clone(manifest), updatedAt: decision.decidedAt, decisions });
}

export function getActiveCatalogEnrichmentReviewDecision(
  manifest: CatalogEnrichmentReviewManifest,
  reviewId: string,
) {
  return getActiveDecisionFromHistory(manifest.decisions.filter((decision) => decision.reviewId === reviewId));
}

export function serializeCatalogEnrichmentReviewManifest(manifest: CatalogEnrichmentReviewManifest) {
  return `${JSON.stringify({ ...manifest, decisions: [...manifest.decisions].sort(compareDecisions) }, null, 2)}\n`;
}

export function parseCatalogEnrichmentReviewManifest(serialized: string): CatalogEnrichmentReviewManifest {
  const parsed = JSON.parse(serialized) as Partial<CatalogEnrichmentReviewManifest>;
  const allowed = new Set(["schemaVersion", "manifestId", "dataUse", "storageBoundary", "productionCatalogMutated", "createdAt", "updatedAt", "decisions"]);
  if (!parsed || typeof parsed !== "object" || Object.keys(parsed).some((key) => !allowed.has(key))) {
    throw new Error("Review manifest contains unsupported top-level fields.");
  }
  if (
    parsed.schemaVersion !== catalogEnrichmentReviewManifestSchemaVersion
    || (parsed.dataUse !== "production" && parsed.dataUse !== "fixture")
    || parsed.storageBoundary !== "local_staging_only"
    || parsed.productionCatalogMutated !== false
    || !Array.isArray(parsed.decisions)
  ) {
    throw new Error("Review manifest does not match schema version 1.0.0.");
  }
  requireText(parsed.manifestId, "manifestId");
  requireDate(parsed.createdAt, "createdAt");
  requireDate(parsed.updatedAt, "updatedAt");
  const decisionIds = new Set<string>();
  for (const decision of parsed.decisions) {
    if (!decision || typeof decision !== "object" || !decision.decisionId || decisionIds.has(decision.decisionId)) {
      throw new Error("Review manifest contains an invalid or duplicate decision.");
    }
    if (decision.dataUse !== parsed.dataUse) throw new Error("Review manifest contains a decision with incompatible data use.");
    decisionIds.add(decision.decisionId);
  }
  return deepFreeze(clone(parsed as CatalogEnrichmentReviewManifest));
}

export async function executeCatalogEnrichmentReviewDecision(
  result: CatalogEnrichmentResult,
  item: CatalogEnrichmentReviewItem,
  decision: CatalogEnrichmentReviewDecision,
  options: ExecuteReviewDecisionOptions = {},
): Promise<CatalogEnrichmentReviewExecutionResult> {
  validateExecutionIdentity(result, item, decision);
  const originalCatalog = clone(result.catalogSnapshot);
  const correctedCatalogSnapshot = applyCatalogCorrections(item.catalogSnapshot, decision.catalogCorrections);
  const refreshedMatchResult = decision.catalogCorrections.length ? rematchItem(item, correctedCatalogSnapshot) : null;
  const refreshedEnrichmentDecision = refreshedMatchResult
    ? decideEnrichment<NhtsaCatalogMatchCandidate | EpaVehicleRecord>(
      refreshedMatchResult as SourceMatchResult<NhtsaCatalogMatchCandidate | EpaVehicleRecord>,
    )
    : null;
  const issues: string[] = [];
  let contributions: CanonicalVehicleContribution[] = [];

  if (decision.action === "APPROVE_SOURCE") {
    const context = reviewIngestionContext(item, decision, options);
    const adapterResult = item.source === "nhtsa"
      ? await nhtsaContributionAdapter.normalize([toNhtsaSourceRecord(decision)], context)
      : await epaContributionAdapter.normalize([clone(decision.selectedCandidateSnapshot as EpaVehicleRecord)], context);
    contributions = adapterResult.contributions;
    issues.push(...adapterResult.issues.map((issue) => `${issue.code}: ${issue.message}`));
  }

  const baseline = result.contributions.accepted.filter((contribution) => {
    return contribution.source.sourceType !== item.source && contribution.dataUse === item.dataUse;
  });
  const mergeInputs = decision.action === "APPROVE_SOURCE" ? [...baseline, ...contributions] : [];
  const mergeResult = mergeInputs.length
    ? mergeCanonicalVehicleContributions(mergeInputs, { targetDataUse: item.dataUse as CanonicalContributionDataUse })
    : { records: [], rejectedSourceRecordIds: [], issues: [] };
  issues.push(...mergeResult.issues.map((issue) => `${issue.code}: ${issue.message}`));
  if (decision.action === "APPROVE_SOURCE" && !mergeResult.records.length) {
    issues.push("Approved source did not produce a staged canonical record through the existing adapter and merger.");
  }
  if (JSON.stringify(result.catalogSnapshot) !== JSON.stringify(originalCatalog)) {
    throw new Error("Review execution mutated the production catalog snapshot.");
  }

  return {
    reviewItem: clone(item),
    decision: clone(decision),
    correctedCatalogSnapshot,
    refreshedMatchResult,
    refreshedEnrichmentDecision,
    contributions,
    canonicalRecord: mergeResult.records[0] ?? null,
    issues,
    auditMetadata: {
      reviewId: decision.reviewId,
      decisionId: decision.decisionId,
      reviewVersion: decision.reviewVersion,
      sourceRecordId: decision.selectedSourceRecordId,
    },
    stagingBoundary: "runtime_only",
    productionCatalogMutated: false,
  };
}

export function applyCatalogCorrections(
  snapshot: CatalogReviewVehicleSnapshot,
  corrections: readonly CatalogMetadataCorrection[],
): CatalogReviewVehicleSnapshot {
  const corrected = clone(snapshot);
  for (const correction of validateCorrections(snapshot, corrections)) {
    (corrected as unknown as Record<string, unknown>)[correction.field] = correction.correctedValue;
  }
  return corrected;
}

export function summarizeCatalogEnrichmentReviewQueue(
  items: readonly CatalogEnrichmentReviewItem[],
  manifest?: CatalogEnrichmentReviewManifest,
): CatalogEnrichmentReviewQueueSummary {
  const active = new Map<string, CatalogEnrichmentReviewDecision>();
  if (manifest) {
    for (const item of items) {
      const decision = getActiveCatalogEnrichmentReviewDecision(manifest, item.reviewId);
      if (decision) active.set(item.reviewId, decision);
    }
  }
  const pending = items.filter((item) => !active.has(item.reviewId));
  const needsCatalogCorrection = pending.filter(hasBlockingCatalogIssue);
  const correctionIds = new Set(needsCatalogCorrection.map((item) => item.reviewId));
  const readyForApproval = pending.filter((item) => !correctionIds.has(item.reviewId) && isReadyForApproval(item));
  const readyIds = new Set(readyForApproval.map((item) => item.reviewId));
  return {
    totalPending: pending.length,
    readyForApproval: readyForApproval.length,
    needsCatalogCorrection: needsCatalogCorrection.length,
    needsAdditionalData: pending.filter((item) => !correctionIds.has(item.reviewId) && !readyIds.has(item.reviewId)).length,
    rejectedOrNotFound: [...active.values()].filter((decision) => decision.action === "REJECT_SOURCE" || decision.action === "MARK_NOT_FOUND").length,
  };
}

function buildNhtsaReviewItem(
  result: CatalogEnrichmentResult,
  matchResult: SourceMatchResult<NhtsaCatalogMatchCandidate>,
  decision: NonNullable<CatalogEnrichmentResult["enrichmentDecisions"]["nhtsa"]>,
  reviewId: string,
  generatedAt: string,
  dataUse: "production" | "fixture",
  active: CatalogEnrichmentReviewDecision | null,
): NhtsaCatalogEnrichmentReviewItem {
  const candidates = matchResult.candidates.map((assessment) => reviewCandidate("nhtsa", assessment));
  const adapterFields: SourceMatchDimension[] = candidates.some((candidate) => hasValidVin(candidate.sourceRecord)) ? [] : ["vin"];
  const reviewFields = uniqueDimensions([...requestedFields(matchResult), ...adapterFields]);
  return {
    reviewId,
    catalogVehicleId: result.catalogVehicleId,
    catalogSnapshot: clone(result.catalogSnapshot),
    source: "nhtsa",
    matchResult: clone(matchResult),
    enrichmentDecision: clone(decision),
    candidates,
    detectedCatalogIssues: clone(result.catalogDataIssues),
    requestedReviewFields: reviewFields,
    comparison: buildComparison(result.catalogSnapshot, matchResult, candidates, adapterFields),
    priority: reviewPriority(matchResult, result.catalogDataIssues, reviewFields),
    status: active ? statusFromAction(active.action) : "pending",
    dataUse,
    createdAt: generatedAt,
    updatedAt: active?.decidedAt ?? generatedAt,
  };
}

function buildEpaReviewItem(
  result: CatalogEnrichmentResult,
  matchResult: SourceMatchResult<EpaVehicleRecord>,
  decision: NonNullable<CatalogEnrichmentResult["enrichmentDecisions"]["epa"]>,
  reviewId: string,
  generatedAt: string,
  dataUse: "production" | "fixture",
  active: CatalogEnrichmentReviewDecision | null,
): EpaCatalogEnrichmentReviewItem {
  const candidates = matchResult.candidates.map((assessment) => reviewCandidate("epa", assessment));
  return {
    reviewId,
    catalogVehicleId: result.catalogVehicleId,
    catalogSnapshot: clone(result.catalogSnapshot),
    source: "epa",
    matchResult: clone(matchResult),
    enrichmentDecision: clone(decision),
    candidates,
    detectedCatalogIssues: clone(result.catalogDataIssues),
    requestedReviewFields: requestedFields(matchResult),
    comparison: buildComparison(result.catalogSnapshot, matchResult, candidates),
    priority: reviewPriority(matchResult, result.catalogDataIssues),
    status: active ? statusFromAction(active.action) : "pending",
    dataUse,
    createdAt: generatedAt,
    updatedAt: active?.decidedAt ?? generatedAt,
  };
}

function reviewCandidate<SourceRecord>(
  source: VehicleSourceMatchName,
  assessment: SourceMatchCandidateAssessment<SourceRecord>,
): CatalogEnrichmentReviewCandidate<SourceRecord> {
  return {
    sourceRecordId: assessment.sourceRecordId,
    sourceRecord: clone(assessment.candidate),
    comparisonSnapshot: source === "nhtsa"
      ? nhtsaSnapshot(assessment.candidate as NhtsaCatalogMatchCandidate)
      : epaSnapshot(assessment.candidate as EpaVehicleRecord),
    eligible: assessment.eligible,
    confidence: assessment.confidence,
    matchedOn: [...assessment.matchedOn],
    conflicts: [...assessment.conflicts],
    missingComparisonFields: [...assessment.missingComparisonFields],
    rationale: [...assessment.rationale],
  };
}

function buildComparison<SourceRecord>(
  catalog: CatalogReviewVehicleSnapshot,
  matchResult: SourceMatchResult<SourceRecord>,
  candidates: CatalogEnrichmentReviewCandidate<SourceRecord>[],
  additionalUnresolvedFields: SourceMatchDimension[] = [],
): CatalogEnrichmentReviewComparison {
  const leadingId = matchResult.selectedCandidate?.sourceRecordId
    ?? candidates.find((candidate) => candidate.eligible)?.sourceRecordId
    ?? null;
  const candidate = candidates.find((item) => item.sourceRecordId === leadingId)?.comparisonSnapshot ?? null;
  const catalogComparison = catalogSnapshot(catalog);
  const differences = candidate ? comparisonKeys.flatMap((field) => {
    const catalogValue = catalogComparison[field];
    const candidateValue = candidate[field];
    if (catalogValue === null || candidateValue === null || normalizedEqual(catalogValue, candidateValue)) return [];
    return [{ field, catalogValue, candidateValue }];
  }) : [];
  const unresolvedFields = uniqueDimensions([...requestedFields(matchResult), ...additionalUnresolvedFields]);
  return {
    catalog: catalogComparison,
    leadingCandidateSourceRecordId: leadingId,
    candidate,
    differences,
    unresolvedFields,
    suggestedNextEvidence: unresolvedFields.map(suggestedEvidence),
  };
}

function reviewPriority<SourceRecord>(
  matchResult: SourceMatchResult<SourceRecord>,
  catalogIssues: CatalogEnrichmentResult["catalogDataIssues"],
  requestedReviewFieldsOverride?: SourceMatchDimension[],
): CatalogEnrichmentReviewPriority {
  const unlockFields = requestedReviewFieldsOverride ?? requestedFields(matchResult);
  if (matchResult.status === "probable" && unlockFields.length <= 1) {
    return { tier: 1, score: 400 + Math.round(matchResult.confidence * 100), reason: "One missing distinguishing field could unlock a probable source match.", unlockFields };
  }
  if (matchResult.status === "ambiguous") {
    return { tier: 2, score: 300 - Math.min(99, matchResult.candidates.length), reason: "Multiple close source candidates require a reviewer-selected configuration.", unlockFields };
  }
  if (catalogIssues.some((issue) => issue.severity === "error") || matchResult.conflicts.length > 0) {
    return { tier: 3, score: 200 + catalogIssues.filter((issue) => issue.severity === "error").length, reason: "A catalog anomaly blocks an otherwise useful match.", unlockFields };
  }
  return { tier: 4, score: 100 + Math.round(matchResult.confidence * 100), reason: "The source remains unresolved and needs additional evidence.", unlockFields };
}

function compareReviewItems(left: CatalogEnrichmentReviewItem, right: CatalogEnrichmentReviewItem) {
  return left.priority.tier - right.priority.tier
    || right.priority.score - left.priority.score
    || left.catalogVehicleId.localeCompare(right.catalogVehicleId)
    || left.source.localeCompare(right.source);
}

function compareDecisions(left: CatalogEnrichmentReviewDecision, right: CatalogEnrichmentReviewDecision) {
  return left.reviewId.localeCompare(right.reviewId)
    || left.reviewVersion - right.reviewVersion
    || left.decisionId.localeCompare(right.decisionId);
}

function getActiveDecisionFromHistory(history: readonly CatalogEnrichmentReviewDecision[]) {
  return [...history].sort((left, right) => right.reviewVersion - left.reviewVersion || right.decisionId.localeCompare(left.decisionId))[0] ?? null;
}

function rematchCandidate(
  item: CatalogEnrichmentReviewItem,
  sourceRecordId: string,
  corrections: readonly CatalogMetadataCorrection[],
) {
  const corrected = applyCatalogCorrections(item.catalogSnapshot, corrections);
  return rematchItem(item, corrected).candidates.find((candidate) => candidate.sourceRecordId === sourceRecordId) ?? null;
}

function rematchItem(item: CatalogEnrichmentReviewItem, snapshot: CatalogReviewVehicleSnapshot) {
  const input = toMatchInput(snapshot);
  return item.source === "nhtsa"
    ? matchNhtsaCandidates(input, item.candidates.map((candidate) => clone(candidate.sourceRecord)))
    : matchEpaCandidates(input, item.candidates.map((candidate) => clone(candidate.sourceRecord)));
}

function validateCorrections(
  snapshot: CatalogReviewVehicleSnapshot,
  corrections: readonly CatalogMetadataCorrection[],
) {
  const seen = new Set<CatalogCorrectionField>();
  return corrections.map((correction) => {
    if (seen.has(correction.field)) throw new Error(`Catalog correction field ${correction.field} is duplicated.`);
    seen.add(correction.field);
    if (!normalizedEqual(snapshotValue(snapshot, correction.field), correction.originalValue)) {
      throw new Error(`Catalog correction original value for ${correction.field} does not match the review snapshot.`);
    }
    if (correction.correctedValue === null || correction.correctedValue === "") {
      throw new Error(`Catalog correction ${correction.field} requires a corrected value.`);
    }
    requireText(correction.reason, `Catalog correction reason for ${correction.field}`);
    if (!correction.supportingEvidence.length) {
      throw new Error(`Catalog correction ${correction.field} requires supporting source evidence.`);
    }
    if ((correction.field === "engineDisplacementLiters" || correction.field === "cylinders") && typeof correction.correctedValue !== "number") {
      throw new Error(`Catalog correction ${correction.field} requires a numeric value.`);
    }
    if (!(correction.field === "engineDisplacementLiters" || correction.field === "cylinders") && typeof correction.correctedValue !== "string") {
      throw new Error(`Catalog correction ${correction.field} requires a string value.`);
    }
    return clone(correction);
  });
}

function validateExecutionIdentity(
  result: CatalogEnrichmentResult,
  item: CatalogEnrichmentReviewItem,
  decision: CatalogEnrichmentReviewDecision,
) {
  if (result.catalogVehicleId !== item.catalogVehicleId || decision.catalogVehicleId !== item.catalogVehicleId) {
    throw new Error("Review execution catalog identity does not match the controlled enrichment result.");
  }
  if (decision.reviewId !== item.reviewId || decision.source !== item.source || decision.dataUse !== item.dataUse) {
    throw new Error("Review execution decision does not match the review item.");
  }
  if (decision.action === "APPROVE_SOURCE" && !decision.selectedCandidateSnapshot) {
    throw new Error("Approved review decision has no retained source candidate snapshot.");
  }
}

function reviewIngestionContext(
  item: CatalogEnrichmentReviewItem,
  decision: CatalogEnrichmentReviewDecision,
  options: ExecuteReviewDecisionOptions,
): CanonicalIngestionContext {
  const retrievedAt = requireDate(options.retrievedAt ?? decision.decidedAt, "retrievedAt");
  return {
    ingestionId: `review-enrichment:${item.catalogVehicleId}:${item.source}:${decision.decisionId}`,
    retrievedAt,
    market: options.market ?? "US",
    sourceType: item.source,
  };
}

function toNhtsaSourceRecord(decision: CatalogEnrichmentReviewDecision): NhtsaSourceRecord {
  const candidate = clone(decision.selectedCandidateSnapshot as NhtsaCatalogMatchCandidate);
  if (!hasValidVin(candidate)) throw new Error("Approved NHTSA candidate is not VIN-backed.");
  return {
    vin: candidate.vin as string,
    decoded: {
      make: candidate.make,
      model: candidate.model,
      modelYear: candidate.modelYear,
      bodyClass: candidate.bodyClass ?? null,
      driveType: candidate.driveType ?? null,
      fuelTypePrimary: candidate.fuelTypePrimary ?? null,
      transmissionStyle: candidate.transmissionStyle ?? null,
      vehicleType: candidate.vehicleType ?? null,
    },
    dataUse: decision.dataUse,
    observedAt: null,
  };
}

function toMatchInput(snapshot: CatalogReviewVehicleSnapshot): CatalogVehicleMatchInput {
  return {
    id: snapshot.id,
    year: snapshot.year,
    make: snapshot.make,
    model: snapshot.model,
    bodyType: snapshot.bodyType,
    fuelType: snapshot.fuelType,
    drivetrain: snapshot.drivetrain,
    transmission: snapshot.transmission,
    trim: snapshot.trim,
    vehicleCategory: snapshot.vehicleCategory,
    engineDisplacementLiters: snapshot.engineDisplacementLiters,
    cylinders: snapshot.cylinders,
    vin: snapshot.vin,
    externalIds: snapshot.externalIds,
  };
}

function requestedFields<SourceRecord>(matchResult: SourceMatchResult<SourceRecord>) {
  return uniqueDimensions([
    ...matchResult.missingComparisonFields,
    ...matchResult.candidates.filter((candidate) => candidate.eligible).flatMap((candidate) => candidate.missingComparisonFields),
  ]);
}

function isReadyForApproval(item: CatalogEnrichmentReviewItem) {
  if (!item.matchResult.selectedCandidate || item.requestedReviewFields.length > 0) return false;
  const candidate = item.candidates.find((entry) => entry.eligible && entry.conflicts.length === 0);
  if (!candidate) return false;
  return item.source === "epa" || hasValidVin(candidate.sourceRecord as NhtsaCatalogMatchCandidate);
}

function hasBlockingCatalogIssue(item: CatalogEnrichmentReviewItem) {
  return item.detectedCatalogIssues.some((issue) => issue.severity === "error")
    || item.matchResult.conflicts.length > 0;
}

function hasValidVin(candidate: NhtsaCatalogMatchCandidate) {
  return typeof candidate.vin === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(candidate.vin.trim().toUpperCase());
}

function statusFromAction(action: CatalogEnrichmentReviewDecision["action"]) {
  return ({
    APPROVE_SOURCE: "approved",
    REJECT_SOURCE: "rejected",
    DEFER: "deferred",
    CORRECT_CATALOG_METADATA: "corrected",
    MARK_NOT_FOUND: "not_found",
  } as const)[action];
}

const comparisonKeys = [
  "modelYear", "make", "model", "bodyType", "fuelType", "drivetrain", "transmission", "trim", "engineDisplacementLiters", "cylinders",
] as const satisfies readonly (keyof CatalogReviewComparisonSnapshot)[];

function catalogSnapshot(vehicle: CatalogReviewVehicleSnapshot): CatalogReviewComparisonSnapshot {
  return {
    modelYear: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    bodyType: vehicle.bodyType,
    fuelType: vehicle.fuelType,
    drivetrain: vehicle.drivetrain,
    transmission: vehicle.transmission,
    trim: vehicle.trim ?? null,
    engineDisplacementLiters: vehicle.engineDisplacementLiters ?? null,
    cylinders: vehicle.cylinders ?? null,
  };
}

function nhtsaSnapshot(candidate: NhtsaCatalogMatchCandidate): CatalogReviewComparisonSnapshot {
  return {
    modelYear: candidate.modelYear,
    make: candidate.make,
    model: candidate.model,
    bodyType: candidate.bodyClass ?? null,
    fuelType: candidate.fuelTypePrimary ?? null,
    drivetrain: candidate.driveType ?? null,
    transmission: candidate.transmissionStyle ?? null,
    trim: candidate.trim ?? null,
    engineDisplacementLiters: candidate.engineDisplacementLiters ?? null,
    cylinders: candidate.cylinders ?? null,
  };
}

function epaSnapshot(candidate: EpaVehicleRecord): CatalogReviewComparisonSnapshot {
  return {
    modelYear: candidate.year,
    make: candidate.make,
    model: candidate.model,
    bodyType: candidate.VClass ?? null,
    fuelType: candidate.fuelType1 ?? candidate.fuelType ?? null,
    drivetrain: candidate.drive ?? null,
    transmission: candidate.trany ?? null,
    trim: null,
    engineDisplacementLiters: candidate.displ ?? null,
    cylinders: candidate.cylinders ?? null,
  };
}

function suggestedEvidence(field: SourceMatchDimension) {
  return ({
    vin: "VIN or official build record",
    trim: "trim badge, window sticker, or build sheet",
    engineDisplacement: "engine displacement from a build sheet or emissions label",
    cylinders: "engine/cylinder configuration from an official record",
    drivetrain: "drivetrain from VIN decode or build sheet",
    transmission: "transmission from VIN decode or build sheet",
    fuelType: "exact powertrain from EPA or manufacturer configuration data",
    bodyStyle: "manufacturer body classification",
    vehicleCategory: "manufacturer or regulatory vehicle classification",
    externalId: "stable official source identifier",
    modelYear: "model-year evidence",
    make: "manufacturer identity evidence",
    model: "complete model identity evidence",
  } as Record<SourceMatchDimension, string>)[field];
}

function snapshotValue(snapshot: CatalogReviewVehicleSnapshot, field: CatalogCorrectionField) {
  return (snapshot as unknown as Record<string, string | number | null | undefined>)[field] ?? null;
}

function normalizedEqual(left: unknown, right: unknown) {
  if (typeof left === "number" || typeof right === "number") return Number(left) === Number(right);
  return String(left ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    === String(right ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueDimensions(values: readonly SourceMatchDimension[]) {
  return [...new Set(values)].sort() as SourceMatchDimension[];
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function requireDate(value: unknown, field: string) {
  const text = requireText(value, field);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${field} must be a valid timestamp.`);
  return text;
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
