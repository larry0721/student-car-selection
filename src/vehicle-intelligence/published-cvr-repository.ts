import {
  canonicalVehicleFieldNames,
  canonicalVehicleFieldPaths,
  canonicalVehicleSectionNames,
  type CanonicalDatum,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
} from "../../types/canonicalVehicle";
import type {
  PublishCanonicalVehicleInput,
  PublishedCVRDiff,
  PublishedCVREvent,
  PublishedCVRRepository,
  PublishedCVRRepositoryDataUse,
  PublishedCVRRepositoryState,
  PublishedCVRRollbackPlan,
  PublishedCVRTransitionInput,
  PublishedVehicleIntelligenceRecord,
} from "../../types/publishedVehicleIntelligence";

export const publishedCVRRepositorySchemaVersion = "1.0.0" as const;

type RepositoryOptions = {
  repositoryId: string;
  dataUse: PublishedCVRRepositoryDataUse;
  createdAt: string;
  initialState?: PublishedCVRRepositoryState;
};

export class InMemoryPublishedCVRRepository implements PublishedCVRRepository {
  private readonly repositoryId: string;
  private readonly dataUse: PublishedCVRRepositoryDataUse;
  private readonly createdAt: string;
  private updatedAt: string;
  private publications: PublishedVehicleIntelligenceRecord[] = [];
  private events: PublishedCVREvent[] = [];

  constructor(options: RepositoryOptions) {
    this.repositoryId = requireText(options.repositoryId, "repositoryId");
    this.dataUse = options.dataUse;
    this.createdAt = requireDate(options.createdAt, "createdAt");
    this.updatedAt = this.createdAt;
    if (options.initialState) this.restore(options.initialState);
  }

  publish(input: PublishCanonicalVehicleInput): PublishedVehicleIntelligenceRecord {
    validatePublishInput(input, this.dataUse);
    validateRetainedEvidence(input.canonicalRecord, this.publications);
    const fingerprint = fingerprintPublishedCVR(input);
    const existingActive = this.getActivePublicationForVehicle(input.vehicleId);
    if (existingActive?.fingerprint === fingerprint) return existingActive;
    const recordVersion = 1 + Math.max(0, ...this.publications
      .filter((publication) => publication.vehicleId === input.vehicleId)
      .map((publication) => publication.recordVersion));
    const publicationId = `published-cvr:${stableHash(input.vehicleId)}:v${recordVersion}:${fingerprint}`;
    const publication: PublishedVehicleIntelligenceRecord = deepFreeze({
      publicationId,
      vehicleId: input.vehicleId,
      canonicalRecord: clone(input.canonicalRecord),
      recordVersion,
      publicationStatus: "active",
      publishingDecisionId: input.publishingDecision.auditRecord.auditId,
      publishingAuditRecord: clone(input.publishingDecision.auditRecord),
      sourceKnowledgeSnapshotId: input.sourceKnowledgeSnapshotId ?? null,
      sourceKnowledgeSnapshotVersion: input.sourceKnowledgeSnapshotVersion ?? null,
      compilerVersion: requireText(input.compilerVersion, "compilerVersion"),
      trustPolicyVersion: requireText(input.trustPolicyVersion, "trustPolicyVersion"),
      publishingPolicyVersion: requireText(input.publishingPolicyVersion, "publishingPolicyVersion"),
      publishedAt: requireDate(input.publishedAt, "publishedAt"),
      supersedesPublicationId: existingActive?.publicationId ?? null,
      supersededByPublicationId: null,
      dataClassification: input.dataClassification,
      fingerprint,
    });
    this.publications.push(publication);
    this.publications.sort(comparePublications);
    this.appendEvent({
      eventType: "publication_created",
      publicationId,
      relatedPublicationIds: existingActive ? [existingActive.publicationId] : [],
      occurredAt: input.publishedAt,
      reason: "A CVR with a PUBLISH decision entered the shadow publication repository.",
    });
    if (existingActive) {
      this.supersedePublication(existingActive.publicationId, publicationId, {
        occurredAt: input.publishedAt,
        reason: "A newer publishable CVR version became active.",
      });
    }
    return clone(this.requirePublication(publicationId));
  }

  getPublication(publicationId: string) {
    const publication = this.publications.find((item) => item.publicationId === publicationId);
    return publication ? clone(publication) : null;
  }

  getActivePublicationForVehicle(vehicleId: string) {
    const publication = this.publications.find((item) => item.vehicleId === vehicleId && item.publicationStatus === "active");
    return publication ? clone(publication) : null;
  }

  getPublicationHistory(vehicleId: string) {
    return this.publications.filter((item) => item.vehicleId === vehicleId).sort(comparePublications).map(clone);
  }

  supersedePublication(
    publicationId: string,
    replacementPublicationId: string,
    input: PublishedCVRTransitionInput,
  ) {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Supersession reason");
    const current = this.requirePublication(publicationId);
    const replacement = this.requirePublication(replacementPublicationId);
    if (current.vehicleId !== replacement.vehicleId) throw new Error("A replacement publication must belong to the same vehicle.");
    if (current.publicationStatus === "superseded" && current.supersededByPublicationId === replacementPublicationId) return clone(current);
    if (current.publicationStatus !== "active") throw new Error(`Only an active publication can be superseded; ${publicationId} is ${current.publicationStatus}.`);
    if (replacement.publicationStatus !== "active") throw new Error("The replacement publication must already be active.");
    this.replacePublication(publicationId, {
      ...current,
      publicationStatus: "superseded",
      supersededByPublicationId: replacementPublicationId,
    });
    if (replacement.supersedesPublicationId !== publicationId) {
      this.replacePublication(replacementPublicationId, { ...replacement, supersedesPublicationId: publicationId });
    }
    this.appendEvent({
      eventType: "publication_superseded",
      publicationId,
      relatedPublicationIds: [replacementPublicationId],
      occurredAt,
      reason,
    });
    return clone(this.requirePublication(publicationId));
  }

  withdrawPublication(publicationId: string, input: PublishedCVRTransitionInput) {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Withdrawal reason");
    const publication = this.requirePublication(publicationId);
    if (publication.publicationStatus === "withdrawn") return clone(publication);
    if (publication.publicationStatus !== "active" && publication.publicationStatus !== "rollback_candidate") {
      throw new Error(`Publication ${publicationId} cannot be withdrawn from ${publication.publicationStatus}.`);
    }
    const withdrawn = this.replacePublication(publicationId, { ...publication, publicationStatus: "withdrawn" });
    this.appendEvent({ eventType: "publication_withdrawn", publicationId, relatedPublicationIds: [], occurredAt, reason });
    return clone(withdrawn);
  }

  markRollbackCandidate(publicationId: string, input: PublishedCVRTransitionInput) {
    const occurredAt = requireDate(input.occurredAt, "occurredAt");
    const reason = requireText(input.reason, "Rollback-candidate reason");
    const publication = this.requirePublication(publicationId);
    if (publication.publicationStatus === "rollback_candidate") return clone(publication);
    if (publication.publicationStatus !== "superseded") throw new Error("Only a superseded publication can become a rollback candidate.");
    const candidate = this.replacePublication(publicationId, { ...publication, publicationStatus: "rollback_candidate" });
    this.appendEvent({ eventType: "rollback_candidate_marked", publicationId, relatedPublicationIds: publication.supersededByPublicationId ? [publication.supersededByPublicationId] : [], occurredAt, reason });
    return clone(candidate);
  }

  getRollbackPlan(vehicleId: string): PublishedCVRRollbackPlan {
    const current = this.getActivePublicationForVehicle(vehicleId);
    if (!current) return { vehicleId, currentPublicationId: null, rollbackCandidatePublicationId: null, eligible: false, reason: "No active publication exists.", diff: null };
    const history = this.getPublicationHistory(vehicleId);
    const candidate = [...history]
      .filter((item) => item.recordVersion < current.recordVersion && (item.publicationStatus === "superseded" || item.publicationStatus === "rollback_candidate"))
      .sort((left, right) => right.recordVersion - left.recordVersion)[0] ?? null;
    if (!candidate) return { vehicleId, currentPublicationId: current.publicationId, rollbackCandidatePublicationId: null, eligible: false, reason: "No prior retained publication is eligible for rollback planning.", diff: null };
    return {
      vehicleId,
      currentPublicationId: current.publicationId,
      rollbackCandidatePublicationId: candidate.publicationId,
      eligible: true,
      reason: "A prior retained version is available for a future reviewed rollback operation.",
      diff: comparePublishedCVRs(current, candidate),
    };
  }

  comparePublications(fromPublicationId: string, toPublicationId: string) {
    return comparePublishedCVRs(this.requirePublication(fromPublicationId), this.requirePublication(toPublicationId));
  }

  listPublishedVehicles() {
    return this.publications.filter((item) => item.publicationStatus === "active").sort(comparePublications).map(clone);
  }

  exportState(): PublishedCVRRepositoryState {
    return deepFreeze({
      schemaVersion: publishedCVRRepositorySchemaVersion,
      repositoryId: this.repositoryId,
      dataUse: this.dataUse,
      storageBoundary: "shadow_published_cvr_only",
      originalCatalogMutated: false,
      knowledgeRepositoryMutated: false,
      recommendationRuntimeConnected: false,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publications: [...this.publications].sort(comparePublications).map(clone),
      events: [...this.events].sort(compareEvents).map(clone),
    });
  }

  private restore(state: PublishedCVRRepositoryState) {
    validateRepositoryState(state, this.repositoryId, this.dataUse);
    this.updatedAt = state.updatedAt;
    this.publications = clone(state.publications).sort(comparePublications);
    this.events = clone(state.events).sort(compareEvents);
  }

  private requirePublication(publicationId: string) {
    const publication = this.publications.find((item) => item.publicationId === publicationId);
    if (!publication) throw new Error(`Published CVR ${publicationId} was not found.`);
    return publication;
  }

  private replacePublication(publicationId: string, replacement: PublishedVehicleIntelligenceRecord) {
    const index = this.publications.findIndex((item) => item.publicationId === publicationId);
    if (index < 0) throw new Error(`Published CVR ${publicationId} was not found.`);
    const frozen = deepFreeze(clone(replacement));
    this.publications[index] = frozen;
    this.publications.sort(comparePublications);
    return frozen;
  }

  private appendEvent(input: Omit<PublishedCVREvent, "eventId">) {
    const version = 1 + this.events.filter((event) => event.publicationId === input.publicationId && event.eventType === input.eventType).length;
    const event = deepFreeze({ eventId: `published-cvr-event:${input.publicationId}:${input.eventType}:v${version}`, ...clone(input) });
    this.events.push(event);
    this.events.sort(compareEvents);
    this.updatedAt = input.occurredAt;
  }
}

export function createPublishedCVRRepository(options: Omit<RepositoryOptions, "initialState">) {
  return new InMemoryPublishedCVRRepository(options);
}

export function loadPublishedCVRRepository(serialized: string) {
  const state = parsePublishedCVRRepositoryState(serialized);
  return new InMemoryPublishedCVRRepository({ repositoryId: state.repositoryId, dataUse: state.dataUse, createdAt: state.createdAt, initialState: state });
}

export function serializePublishedCVRRepository(repository: PublishedCVRRepository) {
  return `${JSON.stringify(repository.exportState(), null, 2)}\n`;
}

export function parsePublishedCVRRepositoryState(serialized: string): PublishedCVRRepositoryState {
  const parsed = JSON.parse(serialized) as PublishedCVRRepositoryState;
  validateRepositoryState(parsed, parsed?.repositoryId, parsed?.dataUse);
  return deepFreeze(clone(parsed));
}

export function fingerprintCanonicalVehicleRecord(record: CanonicalVehicleRecord) {
  return stableHash(stableValue(record));
}

export function fingerprintPublishedCVR(input: Pick<PublishCanonicalVehicleInput,
  "canonicalRecord" | "publishingDecision" | "compilerVersion" | "trustPolicyVersion" | "publishingPolicyVersion"
>) {
  return stableHash(stableValue({
    canonicalRecord: input.canonicalRecord,
    publishingDecisionId: input.publishingDecision.auditRecord.auditId,
    publishingAuditFingerprint: input.publishingDecision.auditRecord.candidateFingerprint,
    compilerVersion: input.compilerVersion,
    trustPolicyVersion: input.trustPolicyVersion,
    publishingPolicyVersion: input.publishingPolicyVersion,
  }));
}

export function comparePublishedCVRs(
  from: PublishedVehicleIntelligenceRecord,
  to: PublishedVehicleIntelligenceRecord,
): PublishedCVRDiff {
  if (from.vehicleId !== to.vehicleId) throw new Error("Published CVR comparison requires the same vehicleId.");
  const diff: PublishedCVRDiff = {
    vehicleId: from.vehicleId,
    fromPublicationId: from.publicationId,
    toPublicationId: to.publicationId,
    fieldsAdded: [],
    fieldsRemoved: [],
    valuesChanged: [],
    statusesChanged: [],
    confidenceChanged: [],
    evidenceChanged: [],
    recordEvidenceAdded: [],
    recordEvidenceRemoved: [],
    staleConflictStateChanged: [],
    hasMeaningfulChanges: false,
  };
  for (const fieldPath of canonicalVehicleFieldPaths) {
    const previous = getDatum(from.canonicalRecord, fieldPath);
    const next = getDatum(to.canonicalRecord, fieldPath);
    if (previous.value === null && next.value !== null) diff.fieldsAdded.push(fieldPath);
    if (previous.value !== null && next.value === null) diff.fieldsRemoved.push(fieldPath);
    if (stableValue(previous.value) !== stableValue(next.value)) diff.valuesChanged.push({ fieldPath, previousValue: clone(previous.value), nextValue: clone(next.value) });
    if (previous.status !== next.status) diff.statusesChanged.push({ fieldPath, previousStatus: previous.status, nextStatus: next.status });
    if (stableValue(previous.confidence) !== stableValue(next.confidence)) diff.confidenceChanged.push({ fieldPath, previousConfidence: clone(previous.confidence), nextConfidence: clone(next.confidence) });
    if (stableValue([...previous.evidenceIds].sort()) !== stableValue([...next.evidenceIds].sort())) diff.evidenceChanged.push({ fieldPath, previousEvidenceIds: [...previous.evidenceIds].sort(), nextEvidenceIds: [...next.evidenceIds].sort() });
    const trackedReasons = new Set(["stale", "source_conflict"]);
    if (previous.missingReason !== next.missingReason && (trackedReasons.has(previous.missingReason ?? "") || trackedReasons.has(next.missingReason ?? ""))) {
      diff.staleConflictStateChanged.push({ fieldPath, previousMissingReason: previous.missingReason, nextMissingReason: next.missingReason });
    }
  }
  const previousEvidence = new Map(from.canonicalRecord.evidence.map((item) => [item.evidenceId, item]));
  const nextEvidence = new Map(to.canonicalRecord.evidence.map((item) => [item.evidenceId, item]));
  diff.recordEvidenceAdded = [...nextEvidence.values()].filter((item) => !previousEvidence.has(item.evidenceId)).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)).map(clone);
  diff.recordEvidenceRemoved = [...previousEvidence.values()].filter((item) => !nextEvidence.has(item.evidenceId)).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)).map(clone);
  diff.hasMeaningfulChanges = [diff.fieldsAdded, diff.fieldsRemoved, diff.valuesChanged, diff.statusesChanged, diff.confidenceChanged, diff.evidenceChanged, diff.recordEvidenceAdded, diff.recordEvidenceRemoved, diff.staleConflictStateChanged].some((items) => items.length > 0);
  return deepFreeze(diff);
}

function validatePublishInput(input: PublishCanonicalVehicleInput, repositoryDataUse: PublishedCVRRepositoryDataUse) {
  const vehicleId = requireText(input?.vehicleId, "vehicleId");
  requireDate(input?.publishedAt, "publishedAt");
  if (!input.publishingDecision?.auditRecord) throw new Error("A publishing audit record is required.");
  if (input.publishingDecision.action !== "PUBLISH" || !input.publishingDecision.publishable || !input.publishingDecision.publishedRecord) {
    throw new Error(`Only a PUBLISH decision can create an active published CVR; received ${input.publishingDecision.action ?? "invalid"}.`);
  }
  if (input.publishingDecision.auditRecord.action !== "PUBLISH"
    || input.publishingDecision.publishedRecord.publication.auditId !== input.publishingDecision.auditRecord.auditId
    || input.publishingDecision.publishedRecord.publication.sourceCompilationRecordId !== input.canonicalRecord.recordId) {
    throw new Error("Publishing decision proof and audit record are inconsistent.");
  }
  if (input.publishingDecision.diagnostics.some((item) => item.severity === "error" || item.code === "blocking_conflict")) {
    throw new Error("A publishing decision with blocking diagnostics cannot be persisted.");
  }
  if (input.publishingDecision.candidateRecordId !== input.canonicalRecord.recordId
    || input.publishingDecision.auditRecord.candidateRecordId !== input.canonicalRecord.recordId) {
    throw new Error("Publishing decision and CVR record identity do not match.");
  }
  if (fingerprintCanonicalVehicleRecord(input.canonicalRecord) !== input.publishingDecision.auditRecord.candidateFingerprint) {
    throw new Error("CVR fingerprint does not match the publishing audit record.");
  }
  if (input.publishingPolicyVersion !== input.publishingDecision.auditRecord.policyVersion) {
    throw new Error("Publishing policy version does not match the decision audit.");
  }
  if (input.canonicalRecord.recordId !== `knowledge:${stableHash(vehicleId)}`) {
    throw new Error("Publication vehicleId does not match the compiler record linkage.");
  }
  auditCanonicalRecord(input.canonicalRecord);
  validateClassification(repositoryDataUse, input.dataClassification, input.canonicalRecord);
}

function auditCanonicalRecord(record: CanonicalVehicleRecord) {
  if (!record || typeof record !== "object") throw new Error("A canonical vehicle record is required.");
  const evidenceIds = new Set(record.evidence.map((item) => item.evidenceId));
  if (evidenceIds.size !== record.evidence.length) throw new Error("Published CVR evidence IDs must be unique.");
  for (const section of canonicalVehicleSectionNames) {
    const fields = record[section] as unknown as Record<string, CanonicalDatum<unknown>>;
    if (!fields || stableValue(Object.keys(fields).sort()) !== stableValue([...canonicalVehicleFieldNames[section]].sort())) {
      throw new Error(`Published CVR section ${section} does not match the canonical field contract.`);
    }
    for (const field of canonicalVehicleFieldNames[section]) {
      const datum = fields[field];
      if (!datum || !datum.confidence || !Array.isArray(datum.evidenceIds)) throw new Error(`Published CVR field ${section}.${field} is malformed.`);
      if (datum.value !== null && (!datum.evidenceIds.length || datum.evidenceIds.some((id) => !evidenceIds.has(id)))) {
        throw new Error(`Published CVR field ${section}.${field} has invalid evidence references.`);
      }
    }
  }
}

function validateClassification(dataUse: PublishedCVRRepositoryDataUse, classification: PublishedCVRRepositoryDataUse, record: CanonicalVehicleRecord) {
  if (dataUse === "production" && classification !== "production") throw new Error("Fixture/test records cannot enter a production published-CVR repository.");
  if (dataUse !== "production" && classification === "production") throw new Error(`${dataUse} repositories cannot accept production publications.`);
  if (dataUse === "production" && record.evidence.some((item) => item.dataUse && item.dataUse !== "production")) {
    throw new Error("Non-production evidence cannot enter a production published-CVR repository.");
  }
}

function validateRepositoryState(state: PublishedCVRRepositoryState, expectedId: string, expectedDataUse: PublishedCVRRepositoryDataUse) {
  const allowed = new Set(["schemaVersion", "repositoryId", "dataUse", "storageBoundary", "originalCatalogMutated", "knowledgeRepositoryMutated", "recommendationRuntimeConnected", "createdAt", "updatedAt", "publications", "events"]);
  if (!state || typeof state !== "object" || Object.keys(state).some((key) => !allowed.has(key))) throw new Error("Published CVR repository contains unsupported fields.");
  if (state.schemaVersion !== publishedCVRRepositorySchemaVersion || state.repositoryId !== expectedId || state.dataUse !== expectedDataUse || state.storageBoundary !== "shadow_published_cvr_only" || state.originalCatalogMutated !== false || state.knowledgeRepositoryMutated !== false || state.recommendationRuntimeConnected !== false || !Array.isArray(state.publications) || !Array.isArray(state.events)) {
    throw new Error("Published CVR repository state is invalid.");
  }
  requireDate(state.createdAt, "createdAt");
  requireDate(state.updatedAt, "updatedAt");
  if (new Set(state.publications.map((item) => item.publicationId)).size !== state.publications.length) throw new Error("Published CVR repository contains duplicate publication IDs.");
  const activeVehicles = state.publications.filter((item) => item.publicationStatus === "active").map((item) => item.vehicleId);
  if (new Set(activeVehicles).size !== activeVehicles.length) throw new Error("Published CVR repository contains multiple active versions for one vehicle.");
  const byId = new Map(state.publications.map((item) => [item.publicationId, item]));
  const versionKeys = state.publications.map((item) => `${item.vehicleId}:v${item.recordVersion}`);
  if (new Set(versionKeys).size !== versionKeys.length) throw new Error("Published CVR repository contains duplicate vehicle versions.");
  for (const publication of state.publications) {
    auditCanonicalRecord(publication.canonicalRecord);
    validateClassification(state.dataUse, publication.dataClassification, publication.canonicalRecord);
    if (publication.publishingAuditRecord.action !== "PUBLISH"
      || publication.publishingAuditRecord.auditId !== publication.publishingDecisionId
      || publication.publishingAuditRecord.candidateRecordId !== publication.canonicalRecord.recordId
      || publication.publishingAuditRecord.candidateFingerprint !== fingerprintCanonicalVehicleRecord(publication.canonicalRecord)
      || publication.publishingPolicyVersion !== publication.publishingAuditRecord.policyVersion
      || publication.canonicalRecord.recordId !== `knowledge:${stableHash(publication.vehicleId)}`
      || publication.fingerprint !== fingerprintStoredPublication(publication)) {
      throw new Error(`Published CVR ${publication.publicationId} failed publication lineage validation.`);
    }
    if (publication.supersedesPublicationId && byId.get(publication.supersedesPublicationId)?.vehicleId !== publication.vehicleId) {
      throw new Error("Published CVR supersession linkage is invalid.");
    }
    if (publication.supersededByPublicationId && byId.get(publication.supersededByPublicationId)?.vehicleId !== publication.vehicleId) {
      throw new Error("Published CVR replacement linkage is invalid.");
    }
  }
  const allEvidence = new Map<string, string>();
  for (const publication of state.publications) {
    for (const evidence of publication.canonicalRecord.evidence) {
      const normalized = stableValue(evidence);
      const retained = allEvidence.get(evidence.evidenceId);
      if (retained && retained !== normalized) throw new Error(`Evidence ${evidence.evidenceId} changes meaning across publications.`);
      allEvidence.set(evidence.evidenceId, normalized);
    }
  }
}

function validateRetainedEvidence(record: CanonicalVehicleRecord, publications: PublishedVehicleIntelligenceRecord[]) {
  const retained = new Map(publications.flatMap((publication) => publication.canonicalRecord.evidence.map((evidence) => [evidence.evidenceId, stableValue(evidence)] as const)));
  for (const evidence of record.evidence) {
    const existing = retained.get(evidence.evidenceId);
    if (existing && existing !== stableValue(evidence)) throw new Error(`Evidence ${evidence.evidenceId} conflicts with retained publication evidence.`);
  }
}

function fingerprintStoredPublication(publication: PublishedVehicleIntelligenceRecord) {
  return stableHash(stableValue({
    canonicalRecord: publication.canonicalRecord,
    publishingDecisionId: publication.publishingDecisionId,
    publishingAuditFingerprint: publication.publishingAuditRecord.candidateFingerprint,
    compilerVersion: publication.compilerVersion,
    trustPolicyVersion: publication.trustPolicyVersion,
    publishingPolicyVersion: publication.publishingPolicyVersion,
  }));
}

function getDatum(record: CanonicalVehicleRecord, path: CanonicalVehicleFieldPath): CanonicalDatum<unknown> {
  const [section, field] = path.split(".");
  return (record as unknown as Record<string, Record<string, CanonicalDatum<unknown>>>)[section][field];
}

function comparePublications(left: PublishedVehicleIntelligenceRecord, right: PublishedVehicleIntelligenceRecord) {
  return left.vehicleId.localeCompare(right.vehicleId) || left.recordVersion - right.recordVersion || left.publicationId.localeCompare(right.publicationId);
}

function compareEvents(left: PublishedCVREvent, right: PublishedCVREvent) {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.eventId.localeCompare(right.eventId);
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
