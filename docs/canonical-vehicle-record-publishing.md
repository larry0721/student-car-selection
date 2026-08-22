# Canonical Vehicle Record Publishing Boundary

## Purpose

The publishing boundary decides whether a candidate `CanonicalVehicleRecord` produced by the deterministic Knowledge Compiler is trustworthy enough to become active published vehicle intelligence.

```text
Original Catalog
        |
        v
Vehicle Knowledge Repository
        |
        v
Knowledge Compiler
        |
        v
Candidate CanonicalVehicleRecord
        |
        v
CVR Publishing Gate
        |
        v
Published CanonicalVehicleRecord
```

The gate is policy only. It does not modify compiler output, repository history, the original catalog, or recommendation behavior. It does not persist records; a `PUBLISH` decision returns an immutable publication candidate and audit record for a future storage boundary.

## Public API

```ts
evaluateCVRForPublishing(
  compilation: KnowledgeCompilationResult,
): CVRPublishingDecision
```

Possible actions are `PUBLISH`, `REVIEW_REQUIRED`, `HOLD`, and `REJECT`.

## Policy Version 1.0.0

Required identity fields:

- `identity.make`
- `identity.model`
- `identity.modelYear`
- `identity.bodyStyle`

Unattended publishing thresholds:

| Measure | Threshold |
| --- | ---: |
| Active trusted claims used | 8 |
| Non-confidence canonical coverage | 10% |
| Evidence quality | 80/100 |
| Source agreement | 50/100 |
| Average repository trust | 75/100 |
| Publishability score | 80/100 |
| Stale fields | 0 |
| Blocking conflicts | 0 |

Meeting the numerical score cannot override a failed integrity rule.

## Decision Rules

### PUBLISH

All required identity fields are valid, every source-backed field has trusted claim and evidence lineage, no compiler error remains, no blocking conflict or stale field remains, and every unattended-publishing threshold passes. The returned record is a clone marked `recordStatus: "validated"`; the candidate record is not mutated.

### REVIEW_REQUIRED

Required identity is complete and there is no rejecting defect or blocking conflict, but coverage, evidence quality, source agreement, repository trust, freshness, trusted-claim count, or publishability score is below the unattended threshold.

### HOLD

Required identity is missing, no trusted knowledge exists, a blocking conflict remains, or required identity is stale/conflicted. More knowledge or conflict resolution is required before review can be meaningful.

### REJECT

Structural or provenance integrity is broken. Examples include unresolved compiler errors, unsupported or invalid compiled claims, dangling evidence, missing claim lineage, untrusted claims supporting populated values, inconsistent summaries, or invalid identity values. The candidate must be rebuilt rather than manually approved.

## Publishability Score

The bounded 0–100 score is deterministic:

| Component | Weight |
| --- | ---: |
| Required identity integrity | 30% |
| Coverage readiness relative to the 10% floor | 20% |
| Evidence quality | 15% |
| Source agreement | 15% |
| Repository trust | 10% |
| Evidence completeness | 5% |
| Diagnostic health | 5% |

The score is an explanatory summary. Rule-based blockers always take precedence.

## Diagnostics And Audit

Publishing diagnostics identify required identity gaps, compiler defects, conflicts, stale knowledge, threshold failures, evidence gaps, missing claim lineage, untrusted claims, and record-integrity violations. Each diagnostic carries field, claim, and evidence references where applicable.

Every decision includes a deterministic `CVRPublishAuditRecord` containing:

- policy version and stable audit ID;
- candidate record ID and fingerprint;
- action and publishability score;
- thresholds, metrics, and pass/fail checks;
- diagnostic codes;
- trusted claim IDs and evidence IDs;
- deterministic evaluation date from the candidate record.

## Production Enrichment Recommendation

Begin with a small, versioned shadow publication repository. Compile and evaluate a reviewed golden set, persist only `PUBLISH` outputs alongside their audit records, and keep `REVIEW_REQUIRED`, `HOLD`, and `REJECT` candidates in separate queues. Compare published identity and EPA/NHTSA fields against the immutable catalog, but do not replace catalog or recommendation inputs until coverage, rollback, versioning, and recommendation-regression gates are approved.
