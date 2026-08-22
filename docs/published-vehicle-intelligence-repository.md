# Published Vehicle Intelligence Repository

## Purpose

The Published Vehicle Intelligence Repository is a versioned shadow store for `CanonicalVehicleRecord` candidates that received `PUBLISH` from the deterministic CVR Publishing Gate. It is a production-candidate storage boundary, not a recommendation data source.

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
Candidate CVR
        |
        v
Publishing Gate
        |
        v
Published CVR Repository
        |
        v
Future Recommendation Engine
```

## System Boundaries

- **Original Catalog:** immutable current recommendation input.
- **Vehicle Knowledge Repository:** source observations, review decisions, trust, conflicts, and history.
- **Candidate CVR:** deterministic compilation of active trusted knowledge.
- **Publishing Gate:** decides whether the candidate is trustworthy enough to publish.
- **Published CVR Repository:** retains accepted, versioned production candidates and their audits.

The repository does not import the catalog, Knowledge Repository, compiler, network clients, UI, or recommendation modules.

## Publication Contract

Each `PublishedVehicleIntelligenceRecord` retains:

- publication and vehicle IDs;
- the complete canonical record;
- monotonically increasing vehicle-specific version;
- lifecycle status;
- publishing decision/audit identity and full audit record;
- optional source snapshot identity/version;
- compiler, trust-policy, and publishing-policy versions;
- publication timestamp and supersession links;
- data classification;
- deterministic meaningful-content fingerprint.

Statuses are `active`, `superseded`, `withdrawn`, and `rollback_candidate`.

## Repository API

The repository supports `publish`, publication lookup, active lookup, complete history, explicit supersession, withdrawal, rollback-candidate marking/planning, active vehicle listing, deterministic CVR comparison, and state export. Serialization and reload helpers preserve a stable JSON representation.

Only a valid `PUBLISH` decision creates an active publication. `REVIEW_REQUIRED`, `HOLD`, and `REJECT` decisions fail before repository state changes.

## Versioning And Supersession

The first publication for a vehicle is version 1. Publishing meaningfully different accepted content creates the next version, makes it active, marks the previous active version `superseded`, and retains bidirectional links. No publication is deleted.

Republishing identical meaningful content is idempotent and returns the existing active publication. Processing timestamp differences do not create new versions.

## Fingerprinting

The FNV-1a fingerprint covers:

- the candidate canonical record;
- publishing audit identity and candidate fingerprint;
- compiler version;
- trust-policy version;
- publishing-policy version.

`publishedAt` is deliberately excluded. The publishing gate's candidate fingerprint is independently recomputed before acceptance.

## Integrity Rules

Before publication, the repository verifies:

- decision is exactly `PUBLISH`, publishable, and includes its published-record proof;
- publishing audit exists and matches record identity/fingerprint;
- publishing policy version matches the audit;
- explicit vehicle ID matches deterministic compiler record linkage;
- all 73 canonical fields exist;
- evidence IDs are unique and every populated field has valid evidence;
- no blocking/error publishing diagnostic exists;
- repository and record data classifications are compatible;
- fixture/test evidence cannot enter production repositories.

## Diff And Rollback

CVR comparison reports fields added or removed, value/status/confidence/evidence changes, record evidence additions/removals, and stale/source-conflict transitions.

Rollback planning identifies the newest retained prior version and returns its diff from the current active version. Marking a `rollback_candidate` does not promote it or change the active version. Actual rollback promotion belongs to a future reviewed operation.

## Persistence

Serialized repository state lives under `data/published-vehicle-intelligence/repositories/`, separate from catalog and raw knowledge. Local repository payloads are ignored; only the directory contract and fixture-only tests are versioned. State includes schema metadata, immutable-boundary flags, publications, and append-only lifecycle events. The JSON contract maps directly to future database publication and event tables.

No live golden-set or production publication is persisted in this step.

## Future Golden Dataset

The next task should build the first reviewed golden production dataset in a production-classified shadow repository. Start with a small set whose identities and source records have already passed review, compile them, evaluate them through the gate, retain all decisions, and persist only `PUBLISH` records. Recommendation integration remains a later migration with explicit parity, fallback, rollout, and rollback tests.
