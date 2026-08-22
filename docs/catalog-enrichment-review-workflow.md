# Catalog Enrichment Review Workflow

## Purpose

Phase 3.2D Step 2 adds an auditable human decision layer to controlled catalog enrichment. It does not write the production catalog, expose a public review UI, or change recommendations. A reviewer can resolve a source match, but cannot author canonical vehicle facts.

The only path from an approved source to a staged record is:

```text
CatalogEnrichmentResult
  -> source-specific review item
  -> immutable reviewer decision
  -> existing source contribution adapter
  -> CanonicalVehicleContribution
  -> existing canonical merger
  -> runtime-only staged CVR
```

## Review Queue

`generateCatalogEnrichmentReviewQueue` converts `REVIEW_REQUIRED` and `DEFER` source decisions into source-specific items. A controlled option can also include `SKIP` cases that have catalog errors, so a known metadata anomaly can be reviewed without making every ordinary not-found result noisy.

Each item retains:

- a stable review ID composed from catalog vehicle ID and source;
- a cloned catalog snapshot;
- the original match result and enrichment decision;
- bounded candidate snapshots and source record IDs;
- matched, conflicting, and unavailable comparison fields;
- catalog validation/anomaly findings;
- a concise catalog-versus-candidate comparison;
- suggested evidence for unresolved fields;
- deterministic priority metadata;
- review data use (`production` or `fixture`) and timestamps.

Queue ordering is deterministic: priority tier, descending priority score, catalog vehicle ID, then source. Tier 1 is a probable match with at most one missing distinguishing field. Tier 2 is an ambiguous match. Tier 3 is a catalog anomaly. Tier 4 is other unresolved work.

## Reviewer Identity

The workflow accepts a typed `{ reviewerId, displayName? }` identity. The local default is `project_owner`. This is audit metadata only; authentication and user accounts are intentionally out of scope.

## Decisions

Every decision requires a non-blank reason and valid timestamp. The decision stores its selected candidate snapshot so later API changes cannot erase what the reviewer saw.

### APPROVE_SOURCE

The selected source record must exist in the review item and remain free of hard contradictions after any attached metadata corrections. NHTSA approval additionally requires a VIN-backed candidate because the existing NHTSA adapter is a VIN decoder adapter. Broad NHTSA model-menu matches therefore remain pending until VIN evidence exists.

Approval does not create canonical fields. The retained candidate is passed to the matching source adapter. Its contribution is passed to the existing canonical merger. Adapter and merger issues remain visible, and a failed adapter or merge produces no staged CVR.

### REJECT_SOURCE

The rejected source record ID, candidate snapshot, and reviewer reason remain in history. No contribution is created. Another candidate can be reviewed in a later decision version.

### DEFER

Deferral records why evidence is insufficient and which fields remain unresolved. It is distinct from `SKIP` and does not create a contribution.

### CORRECT_CATALOG_METADATA

A correction is a structured patch limited to model, body type, fuel type, drivetrain, transmission, trim, engine displacement, and cylinders. Every patch stores original value, corrected value, reason, and supporting evidence.

The patch is applied to a cloned in-memory snapshot. Source candidates are then rerun through the existing deterministic matcher and enrichment policy. A correction does not select a candidate, bypass matching, or modify `data/processed/vehicleCatalog.json`.

### MARK_NOT_FOUND

This action records that no reviewed source record responsibly describes the catalog vehicle. It retains the source, reviewed candidate IDs, and reason. It neither deletes nor rewrites the catalog vehicle.

## Decision History

Decisions are append-only. Revision creates `reviewVersion + 1`, records `supersedesDecisionId`, and leaves the earlier decision intact. The active decision is the highest version, with decision ID as a deterministic tie-breaker. Duplicate IDs, skipped versions, and incorrect supersession metadata are rejected.

## Review Manifest

`CatalogEnrichmentReviewManifest` schema version `1.0.0` stores:

- manifest identity and data use;
- `local_staging_only` storage boundary;
- explicit `productionCatalogMutated: false` marker;
- creation and update timestamps;
- deterministic, append-only decisions.

Serialization is stable JSON. Parsing rejects unsupported top-level fields, incompatible schema/data-use markers, and duplicate decision IDs. A fixture decision cannot enter a production manifest.

Local manifests belong under `data/enrichment-review/manifests/`, which is gitignored. The repository retains only its format documentation and placeholder. This avoids committing reviewer/source snapshots before licensing, data retention, access-control, and identity policies are approved. Raw source responses and secrets are never part of the manifest.

## Review Summary

Each review item exposes the same comparison surface for catalog and candidate:

- year, make, and model;
- body type;
- fuel type;
- drivetrain;
- transmission;
- trim;
- engine displacement;
- cylinders;
- source record ID and confidence;
- matched fields, conflicts, and unavailable fields.

Differences and suggested next evidence are calculated deterministically. Reviewer-facing UI can later simplify presentation without changing these records.

## Golden Review Simulation

Permanent offline tests cover the Step 1 cases for Prius, Leaf, CR-V, RAV4, Camry, F-150, Volt, Tacoma, truncated Yari, and a separate not-found record. The fixture models the Step 1 pattern: broad NHTSA model matches are probable, several EPA configurations are exact, Camry/F-150 EPA configurations are ambiguous, and Volt/Tacoma/Yari expose metadata or identity anomalies.

The controlled simulation creates review items but makes no final human approvals. A candidate-ready item means only that a reviewer has enough retained source information to inspect it. NHTSA model-level items still ask for a VIN. Ambiguous EPA items ask for trim/engine configuration. Volt and Tacoma call for catalog correction evidence. Yari remains a not-found/truncated-identity case.

## Audit and Safety Boundaries

- Review input has no canonical-field or CVR patch property.
- Approved records always use the existing adapters and merger.
- Fixture and production decisions cannot share a manifest.
- Correction execution uses cloned catalog state.
- No review function imports recommendation code or invokes the recommendation engine.
- Permanent tests replace `fetch` and fail on any network call.
- Staged CVRs remain runtime-only.

## Relationship to Automatic Enrichment

AUTO_ENRICH remains governed by the existing enrichment policy. Human approval is a separate auditable authorization for a retained candidate; it does not weaken automatic thresholds. Both paths converge at the same source adapters and canonical merger.

## Before Production Catalog Writes

The project still needs reviewed CVR persistence, transactional write proposals, dry-run diffs against legacy catalog fields, reviewer authentication/authorization, source retention and licensing policy, idempotency keys, rollback, batch resume/rate limiting, and recommendation regression gates. Until those exist, no approved review decision may rewrite the catalog.

## Phase 3.2D Step 3

Build a staging repository and catalog-update proposal layer. It should persist approved staged CVRs and append-only review manifests, produce field-level diffs against immutable catalog snapshots, enforce idempotency and optimistic version checks, and require a separate publish authorization. It must still stop before recommendation integration or direct production catalog mutation.
