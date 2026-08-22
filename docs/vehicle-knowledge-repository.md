# Vehicle Knowledge Repository

## Architecture

```text
Original Catalog
  -> Knowledge Proposals
  -> Trust Evaluation
  -> Vehicle Knowledge Repository
  -> future Knowledge Compiler
  -> CanonicalVehicleRecord
  -> Advisor
```

This phase implements the proposal, trust, repository, and snapshot layers only. It does not implement the Knowledge Compiler, rewrite the catalog, build recommendation overlays, or change advisor behavior.

## Catalog Versus Knowledge

The 320-record catalog remains the immutable application identity and seed-data source. `Vehicle.id` is the stable link from repository claims back to that catalog. Repository operations never import or write `vehicleCatalog.json`.

Catalog values are not independently verified facts. If a future compiler needs them, it may import them as low-authority `legacy_catalog` claims classified `original_catalog`. Those claims must remain distinguishable from verified NHTSA, EPA, marketplace, repair, or inspection evidence.

## Claim Model

A `VehicleKnowledgeClaim` represents exactly one canonical field value for one catalog vehicle. It retains:

- stable claim and vehicle IDs;
- canonical field path, value, and unit;
- proposed/approved/rejected/superseded/conflicted/withdrawn status;
- canonical source and evidence IDs;
- canonical confidence, record scope, and normalization method;
- source record, observed, retrieved, and effective dates;
- supersession links and version;
- review decision, reviewer, reason, and review evidence when applicable;
- deterministic trust assessment;
- production, reviewed, original-catalog, fixture, or test classification.

Whole CVRs are not stored as claims. `createVehicleKnowledgeProposalsFromContribution` decomposes each populated `CanonicalVehicleContribution` datum into a separate proposal while retaining only the datum's referenced canonical evidence.

## Trust Assessment

`VehicleKnowledgeTrustAssessment` contains a 0-100 score and separate components for source authority, evidence quality, source agreement, freshness, scope specificity, normalization reliability, and reviewer confidence. It also records conflict state, trust state, basis, assessment time, and policy version.

The score is deterministic:

| Component | Weight |
| --- | ---: |
| Field-aware source authority | 30% |
| Evidence quality | 20% |
| Independent source agreement | 15% |
| Freshness | 10% |
| Scope specificity | 10% |
| Normalization reliability | 10% |
| Reviewer confidence | 5% |

An AI model cannot assign or alter trust.

## Field-Aware Authority

Authority is evaluated for the specific field, never as a global source ranking.

- NHTSA is strongest for VIN-scoped identity and safety, but weak for fuel economy and financial fields.
- EPA is strongest for fuel economy, emissions, EV range, charging/energy measurements, and published fuel-energy cost methodology. It has very low authority for safety or reliability.
- Listing sources are strong for current price and listing odometer values, but weak for safety and reliability.
- Repair and warranty sources are strong for reliability and maintenance, but not identity or driving attributes.
- IIHS is strong for safety. Transactions are strong for market financial values. Insurance sources are strong only for insurance cost.
- `legacy_catalog` remains low-authority seed knowledge.

Record scope modifies authority where appropriate. A VIN-scoped NHTSA identity claim is stronger than a model-menu claim.

## Trust States

- `TRUSTED`: score at least 75, field authority at least 70, evidence quality at least 70, valid evidence, no blocking conflict, and current enough for its field.
- `REVIEW_REQUIRED`: valid evidence exists, but authority, score, specificity, or normalization does not support unattended trust.
- `CONFLICTED`: comparable evidence-backed claims disagree without a safe winner.
- `REJECTED`: evidence or source confidence is invalid. Rejected claims remain in history and never become active.
- `STALE`: a time-sensitive field is beyond its deterministic freshness window. Stale claims are preserved but inactive.

Purchase price and payment use 30-day windows; insurance and ownership cost use 180-day windows; maintenance, depreciation, and fuel-energy cost use 365-day windows. Static identity has no freshness winner, so a newer make or drivetrain cannot replace authoritative identity merely because it is newer.

## Repository API

The authoritative interface supports:

```text
addProposal
approveClaim
rejectClaim
supersedeClaim
withdrawClaim
getClaim
getClaimsForVehicle
getClaimsForField
getActiveClaimsForVehicle
getKnowledgeHistory
getConflictsForVehicle
getKnowledgeSnapshot
exportState
```

Operations are deterministic for the same initial state and ordered inputs. Returned objects and exported state are cloned/frozen to prevent outside mutation.

## Status Lifecycle

New evidence enters as `proposed` unless structural trust validation immediately rejects it. Trusted proposals can be approved automatically by a controlled process; review-required proposals need a retained `APPROVE_SOURCE` decision.

Rejection and withdrawal preserve the claim. Supersession preserves both the older and newer value and links them in both directions. Conflicts retain every participating value.

## Append-Only History

Knowledge values are never deleted or silently overwritten. Claim state transitions create immutable audit events. A newer claim is a distinct version with its own claim ID and evidence. When a safe time-sensitive source revision replaces an older value, the old claim becomes `superseded`, receives an effective end date and `supersededByClaimId`, and remains queryable.

Claim IDs are deterministic hashes of vehicle, field, source lineage, version, and canonical value. Repository ordering is vehicle, field, version, and claim ID. Event ordering is timestamp and stable event ID.

## Active Claims

An active field claim must be:

- approved;
- trusted at the requested snapshot time;
- not superseded or withdrawn;
- not stale;
- free of a blocking conflict.

The repository returns at most one active claim per field. Agreeing claims are retained, but the highest-trust/latest deterministic representative is returned. If trusted claims disagree and no safe winner exists, the field has no active claim.

## Conflict Handling

Different canonical values are compared using field authority, scope, evidence quality, freshness when applicable, and confidence.

- Same-source, fresher, trusted time-sensitive updates may safely supersede older values.
- A source at least 15 authority points stronger remains active; the weaker contradictory claim is preserved and exposed as a non-blocking conflict.
- Comparable sources become blocking conflicts, both claims are marked conflicted, and active lookup returns no value.
- Freshness never resolves static identity by itself.

## Human Review Integration

Only an `APPROVE_SOURCE` review decision can authorize source-backed claims. Its selected source record ID must match the contribution. The repository retains the decision ID, reviewer, reason, and review evidence.

`CORRECT_CATALOG_METADATA` remains a review proposal. It cannot fabricate repository knowledge from reviewer text alone. A correction can become knowledge only after an existing source adapter produces canonical evidence for the corrected value.

## Persistence

Repository schema `1.0.0` serializes deterministic JSON containing schema metadata, data-use boundary, claims, canonical evidence, and audit events. It explicitly records `originalCatalogMutated: false`.

Local files belong under `data/vehicle-knowledge/repositories/`, which is gitignored. Raw API payloads and secrets are excluded. The shape maps naturally to future relational tables for claims, evidence, and events.

## Fixture Separation

Only `data/vehicleKnowledgeFixtures.ts` seeds this phase. Fixtures cover EPA fuel economy, NHTSA identity, agreeing and conflicting drivetrain, superseded EPA fuel cost, stale listing price, rejected safety data, and reviewed source approval. Fixture/test claims and evidence are rejected by production repositories.

Live golden-set results are not persisted as production knowledge.

## Knowledge Snapshot

`getKnowledgeSnapshot` returns active claims, unresolved blocking conflicts, stale claims, rejected/superseded counts, evidence/source summary, trust summary, and field coverage. It is read-only and intentionally is not a `CanonicalVehicleRecord`.

## Future Knowledge Compiler

The next task is a deterministic Knowledge Compiler that accepts a read-only repository snapshot and produces a CVR candidate. It must map active claims to all canonical fields, preserve claim/evidence lineage, represent missing/conflicted/stale fields explicitly, validate record scope, and emit compiler diagnostics. It must not read source APIs or bypass repository trust decisions.

Recommendation integration remains a later task after compiler validation, catalog-wide coverage analysis, regression benchmarks, and explicit field-precedence approval.
