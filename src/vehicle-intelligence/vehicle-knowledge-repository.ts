import {
  canonicalVehicleFieldPaths,
  getCanonicalVehicleFieldAllowedUnits,
  isCanonicalVehicleFieldUnitAllowed,
  type CanonicalConfidence,
  type CanonicalEvidence,
  type CanonicalEvidenceNormalizationMethod,
  type CanonicalEvidenceSourceValue,
  type CanonicalUnit,
  type CanonicalVehicleFieldPath,
} from "../../types/canonicalVehicle";
import type { CanonicalVehicleContribution } from "../../types/canonicalVehicleContribution";
import type { CatalogEnrichmentReviewDecision } from "../../types/catalogEnrichmentReview";
import type {
  VehicleKnowledgeClaim,
  VehicleKnowledgeConflict,
  VehicleKnowledgeDataClassification,
  VehicleKnowledgeEvent,
  VehicleKnowledgeProposal,
  VehicleKnowledgeRepository,
  VehicleKnowledgeRepositoryDataUse,
  VehicleKnowledgeRepositoryState,
  VehicleKnowledgeReviewContext,
  VehicleKnowledgeSnapshot,
  VehicleKnowledgeTransitionInput,
} from "../../types/vehicleKnowledge";
import {
  evaluateVehicleKnowledgeTrust,
  getVehicleKnowledgeSourceAuthority,
  isTimeSensitiveKnowledgeField,
} from "./vehicle-knowledge-trust-policy";

export const vehicleKnowledgeRepositorySchemaVersion = "1.0.0" as const;

type RepositoryOptions = {
  repositoryId: string;
  dataUse: VehicleKnowledgeRepositoryDataUse;
  createdAt: string;
  initialState?: VehicleKnowledgeRepositoryState;
};

export type ContributionProposalOptions = {
  createdAt: string;
  reviewDecision?: CatalogEnrichmentReviewDecision | null;
  dataClassification?: VehicleKnowledgeDataClassification;
};

export class InMemoryVehicleKnowledgeRepository implements VehicleKnowledgeRepository {
  private readonly repositoryId: string;
  private readonly dataUse: VehicleKnowledgeRepositoryDataUse;
  private readonly createdAt: string;
  private updatedAt: string;
  private claims: VehicleKnowledgeClaim[];
  private evidence: CanonicalEvidence[];
  private events: VehicleKnowledgeEvent[];

  constructor(options: RepositoryOptions) {
    this.repositoryId = requireText(options.repositoryId, "repositoryId");
    this.dataUse = options.dataUse;
    this.createdAt = requireDate(options.createdAt, "createdAt");
    this.updatedAt = this.createdAt;
    this.claims = [];
    this.evidence = [];
    this.events = [];
    if (options.initialState) this.restore(options.initialState);
  }

  addProposal(proposal: VehicleKnowledgeProposal): VehicleKnowledgeClaim {
    this.validateProposal(proposal);
    this.registerEvidence(proposal.evidence);
    const reviewContext = toReviewContext(proposal.reviewDecision ?? null, proposal.source.sourceRecordId);
    const version = 1 + Math.max(0, ...this.claims
      .filter((claim) => claim.vehicleId === proposal.vehicleId
        && claim.canonicalFieldPath === proposal.canonicalFieldPath
        && claim.source.sourceType === proposal.source.sourceType
        && claim.source.providerName === proposal.source.providerName)
      .map((claim) => claim.version));
    const conflictState = this.getConflictStateForProposal(proposal);
    const agreeingIndependentSourceCount = this.countAgreeingIndependentSources(proposal);
    const trustAssessment = evaluateVehicleKnowledgeTrust({
      canonicalFieldPath: proposal.canonicalFieldPath,
      sourceType: proposal.source.sourceType,
      evidence: proposal.evidence,
      confidence: proposal.confidence,
      recordScope: proposal.recordScope,
      normalizationMethod: proposal.normalizationMethod,
      observedAt: proposal.source.observedAt,
      retrievedAt: proposal.source.retrievedAt,
      reviewContext,
      conflictState,
      agreeingIndependentSourceCount,
      asOf: proposal.createdAt,
    });
    const lineage = `${proposal.vehicleId}:${proposal.canonicalFieldPath}:${proposal.source.sourceType}:${proposal.source.providerName}`;
    const claimId = `knowledge:${stableHash(lineage)}:v${version}:${stableHash(stableValue(proposal.canonicalValue))}`;
    if (this.claims.some((claim) => claim.claimId === claimId)) {
      throw new Error(`Knowledge claim ${claimId} already exists.`);
    }
    const claim: VehicleKnowledgeClaim = deepFreeze({
      claimId,
      vehicleId: requireText(proposal.vehicleId, "vehicleId"),
      canonicalFieldPath: proposal.canonicalFieldPath,
      canonicalValue: clone(proposal.canonicalValue),
      unit: proposal.unit,
      valueStatus: proposal.valueStatus,
      estimationMethod: proposal.estimationMethod,
      measurementContext: clone(proposal.measurementContext),
      claimStatus: trustAssessment.trustState === "REJECTED" ? "rejected" : "proposed",
      source: clone(proposal.source),
      evidenceIds: uniqueSorted(proposal.evidence.map((item) => item.evidenceId)),
      confidence: clone(proposal.confidence),
      recordScope: proposal.recordScope,
      sourceRecordId: proposal.source.sourceRecordId,
      normalizationMethod: proposal.normalizationMethod,
      observedAt: proposal.source.observedAt,
      retrievedAt: proposal.source.retrievedAt,
      effectiveFrom: proposal.effectiveFrom ?? proposal.source.observedAt,
      effectiveTo: proposal.effectiveTo ?? null,
      createdAt: proposal.createdAt,
      supersedesClaimId: null,
      supersededByClaimId: null,
      reviewDecisionId: reviewContext?.reviewDecisionId ?? null,
      reviewContext,
      trustAssessment,
      version,
      dataClassification: proposal.dataClassification,
    });
    this.claims.push(claim);
    this.claims.sort(compareClaims);
    this.appendEvent({
      eventType: "proposal_added",
      claimId,
      relatedClaimIds: [],
      occurredAt: proposal.createdAt,
      reason: "A normalized, evidence-backed one-field knowledge proposal was added.",
      reviewDecisionId: claim.reviewDecisionId,
    });
    return clone(claim);
  }

  approveClaim(claimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Approval reason");
    let claim = this.requireClaim(claimId);
    if (claim.claimStatus !== "proposed" && claim.claimStatus !== "conflicted") {
      throw new Error(`Only proposed or conflicted claims can be approved; ${claimId} is ${claim.claimStatus}.`);
    }
    const reviewContext = input.reviewDecision
      ? toReviewContext(input.reviewDecision, claim.sourceRecordId)
      : claim.reviewContext;
    claim = this.reassess(claim, occurredAt, "none", reviewContext);
    if (claim.trustAssessment.trustState === "REJECTED") {
      throw new Error("A rejected trust assessment cannot be approved.");
    }
    if (claim.trustAssessment.trustState === "REVIEW_REQUIRED" && !reviewContext) {
      throw new Error("A review-required claim needs an APPROVE_SOURCE decision before approval.");
    }
    claim = this.replaceClaim(claimId, { ...claim, claimStatus: "approved", reviewContext, reviewDecisionId: reviewContext?.reviewDecisionId ?? null });
    this.appendEvent({
      eventType: "claim_approved",
      claimId,
      relatedClaimIds: [],
      occurredAt,
      reason,
      reviewDecisionId: claim.reviewDecisionId,
    });
    this.resolveApprovedField(claim, occurredAt);
    return clone(this.requireClaim(claimId));
  }

  rejectClaim(claimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Rejection reason");
    const claim = this.requireClaim(claimId);
    if (claim.claimStatus === "superseded" || claim.claimStatus === "withdrawn") {
      throw new Error(`Claim ${claimId} cannot be rejected from ${claim.claimStatus}.`);
    }
    const rejected = this.replaceClaim(claimId, {
      ...claim,
      claimStatus: "rejected",
      trustAssessment: {
        ...claim.trustAssessment,
        trustState: "REJECTED",
        conflictState: "none",
        basis: [...claim.trustAssessment.basis, reason],
        assessedAt: occurredAt,
      },
    });
    this.appendEvent({ eventType: "claim_rejected", claimId, relatedClaimIds: [], occurredAt, reason, reviewDecisionId: input.reviewDecision?.decisionId ?? claim.reviewDecisionId });
    return clone(rejected);
  }

  supersedeClaim(
    claimId: string,
    replacementClaimId: string,
    input: VehicleKnowledgeTransitionInput,
  ): VehicleKnowledgeClaim {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Supersession reason");
    const current = this.requireClaim(claimId);
    const replacement = this.requireClaim(replacementClaimId);
    if (current.vehicleId !== replacement.vehicleId || current.canonicalFieldPath !== replacement.canonicalFieldPath) {
      throw new Error("A replacement claim must address the same vehicle and canonical field.");
    }
    if (replacement.claimStatus !== "approved" || replacement.trustAssessment.trustState !== "TRUSTED") {
      throw new Error("A replacement claim must already be approved and trusted.");
    }
    this.supersedeInternal(current, replacement, occurredAt, reason, input.reviewDecision?.decisionId ?? null);
    return clone(this.requireClaim(claimId));
  }

  withdrawClaim(claimId: string, input: VehicleKnowledgeTransitionInput): VehicleKnowledgeClaim {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Withdrawal reason");
    const claim = this.requireClaim(claimId);
    const withdrawn = this.replaceClaim(claimId, { ...claim, claimStatus: "withdrawn", effectiveTo: occurredAt });
    this.appendEvent({ eventType: "claim_withdrawn", claimId, relatedClaimIds: [], occurredAt, reason, reviewDecisionId: input.reviewDecision?.decisionId ?? claim.reviewDecisionId });
    return clone(withdrawn);
  }

  getClaim(claimId: string) {
    const claim = this.claims.find((item) => item.claimId === claimId);
    return claim ? clone(claim) : null;
  }

  getClaimsForVehicle(vehicleId: string) {
    return this.claims.filter((claim) => claim.vehicleId === vehicleId).sort(compareClaims).map(clone);
  }

  getClaimsForField(vehicleId: string, canonicalFieldPath: CanonicalVehicleFieldPath) {
    return this.claims
      .filter((claim) => claim.vehicleId === vehicleId && claim.canonicalFieldPath === canonicalFieldPath)
      .sort(compareClaims)
      .map(clone);
  }

  getActiveClaimsForVehicle(vehicleId: string, asOf: string) {
    requireDate(asOf, "asOf");
    const byField = new Map<CanonicalVehicleFieldPath, VehicleKnowledgeClaim[]>();
    for (const claim of this.claims.filter((item) => item.vehicleId === vehicleId && item.claimStatus === "approved" && !item.supersededByClaimId)) {
      const assessed = this.reassessForRead(claim, asOf);
      if (assessed.trustAssessment.trustState !== "TRUSTED") continue;
      const group = byField.get(claim.canonicalFieldPath) ?? [];
      group.push(assessed);
      byField.set(claim.canonicalFieldPath, group);
    }
    return [...byField.values()].flatMap((claims) => {
      const values = uniqueValues(claims.map((claim) => claim.canonicalValue));
      if (values.length !== 1) return [];
      return [[...claims].sort(compareActiveClaims)[0]];
    }).sort(compareClaims).map(clone);
  }

  getKnowledgeHistory(vehicleId: string) {
    const claimIds = new Set(this.claims.filter((claim) => claim.vehicleId === vehicleId).map((claim) => claim.claimId));
    return this.events.filter((event) => claimIds.has(event.claimId)).sort(compareEvents).map(clone);
  }

  getConflictsForVehicle(vehicleId: string): VehicleKnowledgeConflict[] {
    const fields = uniqueSorted(this.claims.filter((claim) => claim.vehicleId === vehicleId && claim.claimStatus === "conflicted").map((claim) => claim.canonicalFieldPath)) as CanonicalVehicleFieldPath[];
    return fields.map((field) => {
      const claims = this.claims.filter((claim) => claim.vehicleId === vehicleId
        && claim.canonicalFieldPath === field
        && (claim.claimStatus === "conflicted" || claim.claimStatus === "approved")
        && !claim.supersededByClaimId);
      const blocking = claims.filter((claim) => claim.claimStatus === "conflicted").length > 1;
      return {
        vehicleId,
        canonicalFieldPath: field,
        claimIds: claims.map((claim) => claim.claimId).sort(),
        values: uniqueValues(claims.map((claim) => claim.canonicalValue)),
        reason: blocking
          ? "Comparable evidence-backed claims disagree and no safe active claim can be selected."
          : "A lower-authority claim disagrees with the retained stronger active claim.",
        blocking,
      };
    });
  }

  getKnowledgeSnapshot(vehicleId: string, asOf: string): VehicleKnowledgeSnapshot {
    const generatedAt = requireDate(asOf, "asOf");
    const claims = this.getClaimsForVehicle(vehicleId);
    const activeClaims = this.getActiveClaimsForVehicle(vehicleId, generatedAt);
    const assessedClaims = claims.map((claim) => this.reassessForRead(claim, generatedAt));
    const activeClaimIds = new Set(activeClaims.map((claim) => claim.claimId));
    const activeFieldPaths = new Set(activeClaims.map((claim) => claim.canonicalFieldPath));
    const allStaleClaims = assessedClaims.filter((claim) => claim.trustAssessment.trustState === "STALE");
    const historicalStaleClaims = allStaleClaims.filter((claim) =>
      activeFieldPaths.has(claim.canonicalFieldPath)
      || claim.claimStatus === "superseded"
      || claim.claimStatus === "withdrawn"
      || claim.claimStatus === "rejected");
    const historicalStaleClaimIds = new Set(historicalStaleClaims.map((claim) => claim.claimId));
    const staleClaims = allStaleClaims.filter((claim) => !historicalStaleClaimIds.has(claim.claimId));
    const inactiveClaims = assessedClaims.filter((claim) => !activeClaimIds.has(claim.claimId));
    const conflictedClaims = assessedClaims.filter((claim) => claim.claimStatus === "conflicted" || claim.trustAssessment.trustState === "CONFLICTED");
    const evidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
    const evidence = this.evidence.filter((item) => evidenceIds.has(item.evidenceId));
    const scores = assessedClaims.map((claim) => claim.trustAssessment.trustScore);
    return deepFreeze({
      vehicleId,
      generatedAt,
      activeClaims,
      inactiveClaims,
      conflictedClaims,
      unresolvedConflicts: this.getConflictsForVehicle(vehicleId).filter((conflict) => conflict.blocking),
      staleClaims,
      historicalStaleClaims,
      evidence: evidence.map(clone),
      rejectedHistoryCount: claims.filter((claim) => claim.claimStatus === "rejected").length,
      supersededHistoryCount: claims.filter((claim) => claim.claimStatus === "superseded").length,
      evidenceSummary: {
        evidenceCount: evidence.length,
        sourceTypes: uniqueSorted(evidence.map((item) => item.sourceType)) as CanonicalEvidence["sourceType"][],
        providerNames: uniqueSorted(evidence.map((item) => item.providerName)),
        sourceRecordIds: uniqueSorted(evidence.flatMap((item) => item.sourceRecordId ? [item.sourceRecordId] : [])),
      },
      trustSummary: {
        trustedCount: assessedClaims.filter((claim) => claim.trustAssessment.trustState === "TRUSTED").length,
        reviewRequiredCount: assessedClaims.filter((claim) => claim.trustAssessment.trustState === "REVIEW_REQUIRED").length,
        conflictedCount: assessedClaims.filter((claim) => claim.trustAssessment.trustState === "CONFLICTED").length,
        staleCount: staleClaims.length,
        historicalStaleCount: historicalStaleClaims.length,
        unresolvedStaleFieldCount: new Set(staleClaims.map((claim) => claim.canonicalFieldPath)).size,
        averageTrustScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      },
      coverageSummary: {
        activeFieldCount: activeClaims.length,
        proposedFieldCount: new Set(claims.filter((claim) => claim.claimStatus === "proposed").map((claim) => claim.canonicalFieldPath)).size,
        conflictedFieldCount: this.getConflictsForVehicle(vehicleId).filter((conflict) => conflict.blocking).length,
        canonicalFieldPaths: uniqueSorted(claims.map((claim) => claim.canonicalFieldPath)) as CanonicalVehicleFieldPath[],
      },
    });
  }

  exportState(): VehicleKnowledgeRepositoryState {
    return deepFreeze({
      schemaVersion: vehicleKnowledgeRepositorySchemaVersion,
      repositoryId: this.repositoryId,
      dataUse: this.dataUse,
      storageBoundary: "vehicle_knowledge_only",
      originalCatalogMutated: false,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      claims: [...this.claims].sort(compareClaims).map(clone),
      evidence: [...this.evidence].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)).map(clone),
      events: [...this.events].sort(compareEvents).map(clone),
    });
  }

  private restore(state: VehicleKnowledgeRepositoryState) {
    validateRepositoryState(state, this.repositoryId, this.dataUse);
    this.updatedAt = state.updatedAt;
    this.claims = clone(state.claims).sort(compareClaims);
    this.evidence = clone(state.evidence).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
    this.events = clone(state.events).sort(compareEvents);
  }

  private validateProposal(proposal: VehicleKnowledgeProposal) {
    requireText(proposal.vehicleId, "vehicleId");
    requireDate(proposal.createdAt, "createdAt");
    requireDate(proposal.source.retrievedAt, "source.retrievedAt");
    if (!canonicalVehicleFieldPaths.includes(proposal.canonicalFieldPath)) throw new Error("Proposal uses an unsupported canonical field path.");
    if (!isCanonicalVehicleFieldUnitAllowed(proposal.canonicalFieldPath, proposal.unit)) {
      const allowed = getCanonicalVehicleFieldAllowedUnits(proposal.canonicalFieldPath).join(", ");
      throw new Error(`${proposal.canonicalFieldPath} requires one of these units: ${allowed}.`);
    }
    if (proposal.canonicalValue === null || proposal.canonicalValue === undefined) throw new Error("Knowledge proposals require a canonical value.");
    if (!proposal.evidence.length) throw new Error("Knowledge proposals require canonical evidence.");
    if (proposal.source.sourceRecordId !== proposal.evidence[0]?.sourceRecordId) throw new Error("Proposal source record ID must match its canonical evidence.");
    validateDataClassification(this.dataUse, proposal.dataClassification, proposal.evidence);
    if (proposal.dataClassification === "original_catalog" && proposal.source.sourceType !== "legacy_catalog") {
      throw new Error("Original catalog claims must use legacy_catalog source classification.");
    }
    if (proposal.source.sourceType === "legacy_catalog" && proposal.dataClassification !== "original_catalog") {
      throw new Error("Legacy catalog evidence must remain classified as original_catalog.");
    }
    if (proposal.reviewDecision && proposal.reviewDecision.dataUse !== this.dataUse) {
      throw new Error("Review decision data use must match the knowledge repository.");
    }
  }

  private registerEvidence(evidence: readonly CanonicalEvidence[]) {
    for (const item of evidence) {
      const existing = this.evidence.find((candidate) => candidate.evidenceId === item.evidenceId);
      if (existing && stableValue(existing) !== stableValue(item)) throw new Error(`Evidence ${item.evidenceId} conflicts with retained evidence.`);
      if (!existing) this.evidence.push(deepFreeze(clone(item)));
    }
    this.evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  }

  private requireClaim(claimId: string) {
    const claim = this.claims.find((item) => item.claimId === claimId);
    if (!claim) throw new Error(`Knowledge claim ${claimId} was not found.`);
    return claim;
  }

  private replaceClaim(claimId: string, replacement: VehicleKnowledgeClaim) {
    const index = this.claims.findIndex((claim) => claim.claimId === claimId);
    if (index < 0) throw new Error(`Knowledge claim ${claimId} was not found.`);
    const frozen = deepFreeze(clone(replacement));
    this.claims[index] = frozen;
    this.claims.sort(compareClaims);
    return frozen;
  }

  private appendEvent(input: Omit<VehicleKnowledgeEvent, "eventId">) {
    const eventId = `knowledge-event:${input.claimId}:${input.eventType}:${this.events.filter((event) => event.claimId === input.claimId).length + 1}`;
    this.events.push(deepFreeze({ eventId, ...clone(input) }));
    this.events.sort(compareEvents);
    this.updatedAt = input.occurredAt;
  }

  private getConflictStateForProposal(proposal: VehicleKnowledgeProposal) {
    const existing = this.claims.filter((claim) => claim.vehicleId === proposal.vehicleId
      && claim.canonicalFieldPath === proposal.canonicalFieldPath
      && !["rejected", "withdrawn", "superseded"].includes(claim.claimStatus));
    const disagreeing = existing.filter((claim) => !valuesEqual(claim.canonicalValue, proposal.canonicalValue));
    if (!disagreeing.length) return existing.length ? "agrees" as const : "none" as const;
    const proposalAuthority = getVehicleKnowledgeSourceAuthority(proposal.canonicalFieldPath, proposal.source.sourceType, proposal.recordScope);
    const strongest = Math.max(...disagreeing.map((claim) => claim.trustAssessment.sourceAuthority));
    return Math.abs(proposalAuthority - strongest) >= 15 ? "resolvable" as const : "blocking" as const;
  }

  private countAgreeingIndependentSources(proposal: VehicleKnowledgeProposal) {
    return new Set(this.claims.filter((claim) => claim.vehicleId === proposal.vehicleId
      && claim.canonicalFieldPath === proposal.canonicalFieldPath
      && claim.source.sourceType !== proposal.source.sourceType
      && valuesEqual(claim.canonicalValue, proposal.canonicalValue)
      && !["rejected", "withdrawn", "superseded"].includes(claim.claimStatus))
      .map((claim) => claim.source.sourceType)).size;
  }

  private reassess(
    claim: VehicleKnowledgeClaim,
    asOf: string,
    conflictState: "none" | "agrees" | "resolvable" | "blocking",
    reviewContext: VehicleKnowledgeReviewContext | null,
  ) {
    const evidence = this.evidence.filter((item) => claim.evidenceIds.includes(item.evidenceId));
    const agreeingIndependentSourceCount = new Set(this.claims.filter((candidate) => candidate.claimId !== claim.claimId
      && candidate.vehicleId === claim.vehicleId
      && candidate.canonicalFieldPath === claim.canonicalFieldPath
      && candidate.source.sourceType !== claim.source.sourceType
      && valuesEqual(candidate.canonicalValue, claim.canonicalValue)
      && !["rejected", "withdrawn", "superseded"].includes(candidate.claimStatus))
      .map((candidate) => candidate.source.sourceType)).size;
    return deepFreeze({
      ...clone(claim),
      reviewContext,
      reviewDecisionId: reviewContext?.reviewDecisionId ?? claim.reviewDecisionId,
      trustAssessment: evaluateVehicleKnowledgeTrust({
        canonicalFieldPath: claim.canonicalFieldPath,
        sourceType: claim.source.sourceType,
        evidence,
        confidence: claim.confidence,
        recordScope: claim.recordScope,
        normalizationMethod: claim.normalizationMethod,
        observedAt: claim.observedAt,
        retrievedAt: claim.retrievedAt,
        reviewContext,
        conflictState,
        agreeingIndependentSourceCount,
        asOf,
      }),
    });
  }

  private reassessForRead(claim: VehicleKnowledgeClaim, asOf: string) {
    const conflictState = claim.claimStatus === "conflicted" ? "blocking" : claim.trustAssessment.conflictState;
    return this.reassess(claim, asOf, conflictState, claim.reviewContext);
  }

  private resolveApprovedField(claim: VehicleKnowledgeClaim, occurredAt: string) {
    const peers = this.claims.filter((peer) => peer.claimId !== claim.claimId
      && peer.vehicleId === claim.vehicleId
      && peer.canonicalFieldPath === claim.canonicalFieldPath
      && peer.claimStatus === "approved"
      && !peer.supersededByClaimId);
    for (const peer of peers) {
      if (valuesEqual(peer.canonicalValue, claim.canonicalValue)) {
        this.replaceClaim(peer.claimId, this.reassess(peer, occurredAt, "agrees", peer.reviewContext));
        this.replaceClaim(claim.claimId, this.reassess(this.requireClaim(claim.claimId), occurredAt, "agrees", claim.reviewContext));
        continue;
      }
      if (this.canSafelySupersede(peer, claim)) {
        this.supersedeInternal(peer, this.requireClaim(claim.claimId), occurredAt, "A fresher trusted claim from the same source lineage replaced an older time-sensitive value.", claim.reviewDecisionId);
        continue;
      }
      const newAuthority = claim.trustAssessment.sourceAuthority;
      const peerAuthority = peer.trustAssessment.sourceAuthority;
      if (newAuthority >= peerAuthority + 15) {
        this.markConflicted(peer, [claim.claimId], occurredAt, "A stronger field-specific source conflicts with this weaker claim.");
      } else if (peerAuthority >= newAuthority + 15) {
        this.markConflicted(this.requireClaim(claim.claimId), [peer.claimId], occurredAt, "A stronger field-specific source already supports a different value.");
      } else {
        this.markConflicted(peer, [claim.claimId], occurredAt, "Comparable trusted sources disagree.");
        this.markConflicted(this.requireClaim(claim.claimId), [peer.claimId], occurredAt, "Comparable trusted sources disagree.");
      }
    }
  }

  private canSafelySupersede(older: VehicleKnowledgeClaim, newer: VehicleKnowledgeClaim) {
    return isTimeSensitiveKnowledgeField(newer.canonicalFieldPath)
      && older.source.sourceType === newer.source.sourceType
      && older.source.providerName === newer.source.providerName
      && Date.parse(newer.retrievedAt) > Date.parse(older.retrievedAt)
      && newer.trustAssessment.sourceAuthority >= older.trustAssessment.sourceAuthority
      && newer.trustAssessment.trustState === "TRUSTED";
  }

  private supersedeInternal(
    older: VehicleKnowledgeClaim,
    newer: VehicleKnowledgeClaim,
    occurredAt: string,
    reason: string,
    reviewDecisionId: string | null,
  ) {
    this.replaceClaim(older.claimId, { ...older, claimStatus: "superseded", supersededByClaimId: newer.claimId, effectiveTo: occurredAt });
    this.replaceClaim(newer.claimId, { ...newer, supersedesClaimId: older.claimId });
    this.appendEvent({ eventType: "claim_superseded", claimId: older.claimId, relatedClaimIds: [newer.claimId], occurredAt, reason, reviewDecisionId });
  }

  private markConflicted(
    claim: VehicleKnowledgeClaim,
    relatedClaimIds: string[],
    occurredAt: string,
    reason: string,
  ) {
    const reassessed = this.reassess(claim, occurredAt, "blocking", claim.reviewContext);
    this.replaceClaim(claim.claimId, { ...reassessed, claimStatus: "conflicted" });
    this.appendEvent({ eventType: "conflict_detected", claimId: claim.claimId, relatedClaimIds: [...relatedClaimIds].sort(), occurredAt, reason, reviewDecisionId: claim.reviewDecisionId });
  }
}

export function createVehicleKnowledgeRepository(options: Omit<RepositoryOptions, "initialState">) {
  return new InMemoryVehicleKnowledgeRepository(options);
}

export function loadVehicleKnowledgeRepository(serialized: string) {
  const state = parseVehicleKnowledgeRepositoryState(serialized);
  return new InMemoryVehicleKnowledgeRepository({
    repositoryId: state.repositoryId,
    dataUse: state.dataUse,
    createdAt: state.createdAt,
    initialState: state,
  });
}

export function serializeVehicleKnowledgeRepository(repository: VehicleKnowledgeRepository) {
  return `${JSON.stringify(repository.exportState(), null, 2)}\n`;
}

export function parseVehicleKnowledgeRepositoryState(serialized: string): VehicleKnowledgeRepositoryState {
  const parsed = JSON.parse(serialized) as VehicleKnowledgeRepositoryState;
  validateRepositoryState(parsed, parsed?.repositoryId, parsed?.dataUse);
  return deepFreeze(clone(parsed));
}

export function createVehicleKnowledgeProposalsFromContribution(
  vehicleId: string,
  contribution: CanonicalVehicleContribution,
  options: ContributionProposalOptions,
): VehicleKnowledgeProposal[] {
  requireText(vehicleId, "vehicleId");
  requireDate(options.createdAt, "createdAt");
  const reviewDecision = options.reviewDecision ?? null;
  if (reviewDecision) toReviewContext(reviewDecision, contribution.source.sourceRecordId);
  const dataClassification = options.dataClassification
    ?? (contribution.dataUse === "production" ? (reviewDecision ? "reviewed_source" : "verified_source") : contribution.dataUse);
  const proposals: VehicleKnowledgeProposal[] = [];
  for (const [section, fields] of Object.entries(contribution.data)) {
    if (!fields) continue;
    for (const [field, datum] of Object.entries(fields)) {
      if (!datum || datum.value === null || datum.status === "missing") continue;
      const canonicalFieldPath = `${section}.${field}` as CanonicalVehicleFieldPath;
      if (!canonicalVehicleFieldPaths.includes(canonicalFieldPath)) continue;
      const evidence = contribution.evidence.filter((item) => datum.evidenceIds.includes(item.evidenceId));
      const normalizationMethod = resolveNormalizationMethod(evidence, datum.estimated);
      proposals.push({
        vehicleId,
        canonicalFieldPath,
        canonicalValue: clone(datum.value as CanonicalEvidenceSourceValue),
        unit: datum.unit,
        valueStatus: datum.status as Exclude<typeof datum.status, "missing">,
        estimationMethod: datum.estimationMethod,
        measurementContext: clone(datum.measurementContext),
        source: clone(contribution.source),
        evidence: clone(evidence),
        confidence: clone(datum.confidence),
        recordScope: contribution.recordScope,
        normalizationMethod,
        effectiveFrom: datum.asOfDate,
        effectiveTo: null,
        createdAt: options.createdAt,
        reviewDecision,
        dataClassification: dataClassification as VehicleKnowledgeDataClassification,
      });
    }
  }
  return proposals.sort((left, right) => left.canonicalFieldPath.localeCompare(right.canonicalFieldPath));
}

function toReviewContext(
  decision: CatalogEnrichmentReviewDecision | null,
  sourceRecordId: string,
): VehicleKnowledgeReviewContext | null {
  if (!decision) return null;
  if (decision.action !== "APPROVE_SOURCE") throw new Error("Only APPROVE_SOURCE decisions can authorize source-backed knowledge claims.");
  if (decision.selectedSourceRecordId !== sourceRecordId) throw new Error("Review decision source record does not match the knowledge source record.");
  return {
    reviewDecisionId: decision.decisionId,
    reviewer: clone(decision.reviewer),
    reason: decision.reason,
    evidence: clone(decision.evidence),
  };
}

function validateDataClassification(
  dataUse: VehicleKnowledgeRepositoryDataUse,
  classification: VehicleKnowledgeDataClassification,
  evidence: readonly CanonicalEvidence[],
) {
  const fixtureLike = classification === "fixture" || classification === "test";
  if (dataUse === "production" && fixtureLike) throw new Error("Fixture/test knowledge cannot enter a production repository.");
  if (dataUse !== "production" && !fixtureLike) throw new Error(`${dataUse} repositories accept only fixture/test knowledge.`);
  if (dataUse === "production" && evidence.some((item) => item.dataUse && item.dataUse !== "production")) {
    throw new Error("Non-production evidence cannot enter a production repository.");
  }
}

function validateRepositoryState(
  state: VehicleKnowledgeRepositoryState,
  expectedId: string,
  expectedDataUse: VehicleKnowledgeRepositoryDataUse,
) {
  const allowed = new Set(["schemaVersion", "repositoryId", "dataUse", "storageBoundary", "originalCatalogMutated", "createdAt", "updatedAt", "claims", "evidence", "events"]);
  if (!state || typeof state !== "object" || Object.keys(state).some((key) => !allowed.has(key))) throw new Error("Vehicle knowledge repository contains unsupported fields.");
  if (state.schemaVersion !== vehicleKnowledgeRepositorySchemaVersion
    || state.repositoryId !== expectedId
    || state.dataUse !== expectedDataUse
    || state.storageBoundary !== "vehicle_knowledge_only"
    || state.originalCatalogMutated !== false
    || !Array.isArray(state.claims)
    || !Array.isArray(state.evidence)
    || !Array.isArray(state.events)) {
    throw new Error("Vehicle knowledge repository state is invalid.");
  }
  requireDate(state.createdAt, "createdAt");
  requireDate(state.updatedAt, "updatedAt");
  if (new Set(state.claims.map((claim) => claim.claimId)).size !== state.claims.length) throw new Error("Vehicle knowledge repository contains duplicate claim IDs.");
  if (new Set(state.evidence.map((item) => item.evidenceId)).size !== state.evidence.length) throw new Error("Vehicle knowledge repository contains duplicate evidence IDs.");
  if (state.dataUse === "production" && state.claims.some((claim) => claim.dataClassification === "fixture" || claim.dataClassification === "test")) {
    throw new Error("Fixture/test claims cannot enter a production repository.");
  }
}

function resolveNormalizationMethod(
  evidence: readonly CanonicalEvidence[],
  estimated: boolean,
): CanonicalEvidenceNormalizationMethod {
  if (estimated) return "estimated";
  const methods = evidence.map((item) => item.normalizationMethod).filter(Boolean) as CanonicalEvidenceNormalizationMethod[];
  if (methods.includes("direct")) return "direct";
  if (methods.includes("mapped")) return "mapped";
  if (methods.includes("derived")) return "derived";
  return "estimated";
}

function compareClaims(left: VehicleKnowledgeClaim, right: VehicleKnowledgeClaim) {
  return left.vehicleId.localeCompare(right.vehicleId)
    || left.canonicalFieldPath.localeCompare(right.canonicalFieldPath)
    || left.version - right.version
    || left.claimId.localeCompare(right.claimId);
}

function compareActiveClaims(left: VehicleKnowledgeClaim, right: VehicleKnowledgeClaim) {
  return right.trustAssessment.trustScore - left.trustAssessment.trustScore
    || Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt)
    || right.version - left.version
    || left.claimId.localeCompare(right.claimId);
}

function compareEvents(left: VehicleKnowledgeEvent, right: VehicleKnowledgeEvent) {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || left.eventId.localeCompare(right.eventId);
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
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left: unknown, right: unknown) {
  return stableValue(left) === stableValue(right);
}

function uniqueValues(values: CanonicalEvidenceSourceValue[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stableValue(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(clone);
}

function uniqueSorted<Value extends string>(values: readonly Value[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function requireText(value: string, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function requireDate(value: string, field: string) {
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
