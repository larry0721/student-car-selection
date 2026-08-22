# Vehicle Knowledge Compiler

## Purpose

The Vehicle Knowledge Compiler deterministically turns one read-only `VehicleKnowledgeSnapshot` into a complete `CanonicalVehicleRecord` (CVR). It is a projection boundary, not a trust engine. The repository decides which claims are active and trusted; the compiler preserves that decision and materializes the canonical schema.

```text
Original Catalog
        |
        v
Knowledge Repository
        |
        v
Read-only Knowledge Snapshot
        |
        v
Knowledge Compiler
        |
        v
CanonicalVehicleRecord
        |
        v
Future Advisor
```

The compiler does not read the original catalog, call source APIs, write repository state, publish CVRs, or invoke recommendation logic.

## Public Contract

```ts
compileVehicleKnowledge(
  snapshot: VehicleKnowledgeSnapshot,
  options?: VehicleKnowledgeCompilerOptions,
): KnowledgeCompilationResult
```

`KnowledgeCompilationResult` contains the complete CVR, typed diagnostics, per-field compilation lineage, claim and evidence lookup maps, unresolved-field details, and a coverage summary.

## Responsibility Boundary

The repository owns proposal review, trust assessment, status transitions, source conflict detection, freshness, supersession, and active-claim selection. The compiler consumes those decisions. It never calls `addProposal`, `approveClaim`, `rejectClaim`, `supersedeClaim`, or `withdrawClaim`, and it does not independently re-score source authority.

Only claims exposed in `snapshot.activeClaims` with both `claimStatus: "approved"` and `trustState: "TRUSTED"` can populate source-backed CVR values. Proposed, rejected, superseded, withdrawn, conflicted, stale, or review-required claims remain history and diagnostics.

## Field Rules

All 73 canonical fields are emitted.

| Repository state | Compiled datum |
| --- | --- |
| One valid active trusted claim | Claim value and evidence |
| Compatible active trusted claims | One value with all claim/evidence lineage |
| Blocking unresolved conflict | `missing`, reason `source_conflict` |
| Stale knowledge only | `missing`, reason `stale`, plus diagnostic |
| Rejected/invalid knowledge only | `missing`, reason `invalid` |
| Proposed/review-required knowledge only | `missing`, reason `insufficient_specificity` |
| No claim | `missing`, reason `not_collected` |

The compiler does not invent defaults. Invalid units, unsupported canonical values, incompatible scopes, missing evidence references, or violated active-claim invariants are diagnosed and cannot populate the field.

## Status And Evidence

Claim value status is preserved. Direct trusted source knowledge remains `sourced` or `verified`; deterministic derived knowledge remains `derived`; estimates remain `estimated`. Repository trust never upgrades provenance status.

Every populated source-backed datum references canonical evidence already present in the snapshot. The result includes:

- field lineage: canonical path, active claim IDs, evidence IDs, trust values, sources, and compilation rule;
- claim lineage: complete claims used or retained for unresolved diagnostics;
- evidence lineage: complete evidence records referenced by those claims;
- record evidence: only evidence used by populated fields, plus one derived compiler-metadata record for record-level confidence.

The compiler audit reports dangling evidence references or populated fields without lineage.

## Stale And Conflict Handling

Stale claims remain in repository history and compiler lineage, but never populate the active CVR. A blocking repository conflict always produces a missing field with `source_conflict`; input ordering cannot select a winner. Conflicting claim and evidence IDs remain attached to diagnostics.

## Confidence Translation

Field confidence is translated from the trust assessments of claims actually used. Repository trust scores from 0–100 become canonical confidence from 0–1; the existing trust basis is retained.

Record-level confidence fields are deterministic derived metadata:

- `dataQuality`: populated source fields divided by the 70 non-confidence CVR fields;
- `evidenceQuality`: average repository evidence-quality score for used trusted claims;
- `sourceAgreement`: average repository agreement for used claims, reduced by blocking conflicts.

This prevents a sparse record with one high-trust fact from receiving high data-quality confidence.

## Stable Identity

`recordId` is `knowledge:` plus a deterministic FNV-1a hash of `snapshot.vehicleId`. The same vehicle linkage always produces the same record identity. Scope is derived from active claims in specificity order (`listing`, `vin`, `configuration`, `model_year`) unless the caller provides an explicit compatible scope. Record dates come from used claims, with the snapshot timestamp as the empty-record fallback.

The original catalog is not a seed source. Catalog values may enter a CVR only when they have first been represented as active repository claims under the repository policy.

## Diagnostics

The typed diagnostic contract supports:

- `missing_trusted_claim`
- `stale_claim_available`
- `unresolved_conflict`
- `invalid_active_claim`
- `evidence_reference_missing`
- `unsupported_value`
- `unit_mismatch`
- `claim_scope_mismatch`
- `repository_invariant_violation`

Each diagnostic identifies the canonical field and relevant claim/evidence IDs. Console output is not part of the compiler contract.

## Future Integration

This step creates candidate CVRs only. A later publishing boundary may validate, persist, and version approved compiled records. Recommendation integration must be a separate task with explicit migration and regression testing; the current catalog and recommendation engine remain unchanged.
