# Controlled Catalog Enrichment

## Purpose

Phase 3.2D stages auditable Canonical Vehicle Records for a small, deterministic catalog subset. It does not rewrite `data/processed/vehicleCatalog.json`, modify the `Vehicle` type, create a recommendation overlay, or change recommendation behavior.

The orchestration path is:

```text
immutable catalog snapshot
  -> NHTSA and EPA source discovery/matching
  -> per-source EnrichmentDecision
  -> approved contribution adapters
  -> canonical contribution merger
  -> integrity audit
  -> runtime-only staged result
```

## Catalog Boundary

The production catalog contains 320 flat `Vehicle` records. `Vehicle.id` is the stable application identifier. Every record supplies year, make, model, body type, fuel type, drivetrain, transmission, mileage, price, recommendation scores, and ownership estimates. It does not supply trim, engine displacement, cylinders, VIN, or external source IDs.

Year, make, model, body type, fuel type, drivetrain, and transmission are useful matching claims, not verified facts. The existing validator identifies malformed models, implausible drivetrains, body-style conflicts, and other suspicious values. The orchestrator preserves those findings as `CatalogDataIssue` objects and never silently repairs them.

The existing `/api/vehicle-data/enrich` overlay remains a separate legacy path. Controlled enrichment does not import or call it.

## Public API

```ts
selectControlledEnrichmentGoldenSet(catalog)
runControlledCatalogEnrichment(vehicle, options?)
runControlledCatalogEnrichmentBatch(vehicles, options?)
analyzeCatalogDataIssues(vehicle, catalogUniverse)
```

The default source provider uses the official NHTSA model menu, the existing NHTSA matcher, and the existing EPA discovery/matching workflow. Tests inject match providers while keeping the policy, adapters, and merger non-replaceable.

## Golden Set

Selection is deterministic. Each named criterion has a documented configuration predicate, target year, and stable ID tie-breaker. No random sampling occurs.

| Criterion | Selected catalog vehicle | Rationale |
| --- | --- | --- |
| gasoline_sedan | 2015 Toyota Camry FWD gas automatic | Common sedan and likely multiple EPA engine options |
| hybrid | 2016 Toyota Prius FWD hybrid automatic | Common hybrid with EPA efficiency coverage |
| battery_electric | 2018 Nissan Leaf FWD electric automatic | Common EV with EPA range/efficiency coverage |
| awd_crossover | 2016 Honda CR-V AWD gas automatic | Configuration discrimination for a common crossover |
| pickup_truck | 2019 Ford F-150 4WD gas automatic | Common pickup and likely multiple engine options |
| compact_economy | 2017 Toyota Yaris FWD gas automatic | Simple economy-car configuration |
| compact_sedan | 2015 Toyota Corolla FWD gas automatic | Common compact distinct from the Camry case |
| family_suv | 2016 Toyota RAV4 FWD gas automatic | Common family SUV configuration |
| hybrid_crossover | 2017 Kia Niro FWD hybrid automatic | Hybrid crossover coverage |
| powertrain_anomaly | 2017 Chevrolet Volt labeled electric | Tests source contradiction handling |
| drivetrain_anomaly | 2017 Toyota Tacoma labeled FWD | Tests impossible pickup drivetrain handling |
| identity_anomaly | 2017 Toyota Yari | Tests truncated identity and not-found behavior |

## Staged Result

`CatalogEnrichmentResult` retains:

- an immutable catalog snapshot;
- NHTSA and EPA match results;
- independent enrichment decisions;
- accepted and withheld/rejected contribution dispositions;
- an optional draft CVR;
- matcher, adapter, merger, and integrity issues;
- structured catalog anomalies;
- field and evidence counts;
- source and confidence summaries;
- a deterministic orchestration trace;
- an explicit `runtime_only` staging boundary and `productionCatalogMutated: false` marker.

Statuses are `enriched`, `review_required`, `deferred`, `skipped`, or `failed`. A partial CVR never erases a review, ambiguity, or source failure. Status precedence is failed, deferred, review required, enriched, then skipped.

## Enrichment Decisions

### AUTO_ENRICH

Only the selected candidate is passed to its existing contribution adapter. The adapter result must then pass the canonical merger with `targetDataUse: "production"`. AUTO_ENRICH authorizes a staged contribution only; it never authorizes a catalog write.

### REVIEW_REQUIRED

The candidate, confidence, missing comparison fields, rationale, and review notes remain in the result. No contribution from that source is adapted or merged. A separate AUTO_ENRICH source may create a partial CVR, but final status remains `review_required`.

### DEFER

No candidate is selected or adapted. Every plausible candidate remains in the match result, including the missing fields needed to resolve configuration ambiguity. A separate approved source may create a partial CVR, but final status remains `deferred`.

### SKIP

No contribution is created. Source absence or incompatibility remains auditable, and the catalog snapshot is returned unchanged.

## Source Retrieval

EPA must retrieve candidate configuration records to compare fuel, drivetrain, transmission, body, and engine claims. This discovery retrieval happens before policy evaluation because the policy depends on the match result. After policy evaluation, only an AUTO_ENRICH selected record may enter the adapter and merger. The first EPA option is never preferred by position.

NHTSA model-menu results normally establish model-year identity only and therefore remain probable. A VIN-specific NHTSA candidate can enter the existing VIN contribution adapter only when it is exact, AUTO_ENRICH, and includes a valid VIN.

## Staging Storage

Staged results are returned in memory. The optional live command prints a bounded audit report to standard output. It does not create files under `data/` or commit downloaded source payloads. An operator may redirect output to a temporary location outside the repository for review.

This avoids treating API responses or test fixtures as production evidence before licensing, retention, review, and approval workflows exist.

## Partial Enrichment

A staged CVR may contain one approved source while another source is withheld. `acceptedSources`, source dispositions, final status, and `partial` make this explicit. Probable and ambiguous candidates never become contributions. Fixture, test, and example evidence is rejected by the production merger.

## Integrity Safeguards

Every staged CVR is checked for:

- all 73 canonical datum fields at runtime;
- resolvable evidence IDs for every populated field;
- no fixture, test, or example evidence;
- contributions only from AUTO_ENRICH sources;
- unchanged catalog input;
- retained source record IDs and retrieval timestamps.

All source and merger issues survive in the staged result. Source failures produce no substitute data.

## Catalog Anomalies

The anomaly report keeps existing validation findings, duplicate year/make/model identities, and absent configuration identifiers separate from source matching. These findings are evidence for later catalog cleanup, not permission to rewrite the catalog during enrichment.

## Controlled Live Run

The official-source run completed on 2026-08-08 Pacific time for only the 12 golden-set records. It produced six partial EPA-backed CVRs, three deferred records, two review-required records without a CVR, and one skipped record. No source request failed.

| Catalog vehicle | NHTSA | EPA | Accepted source | CVR fields | DQ / EQ / agreement | Final status |
| --- | --- | --- | --- | ---: | --- | --- |
| 2015 Toyota Camry | probable 0.77 | ambiguous 0.69 | none | 0 | n/a | deferred |
| 2016 Toyota Prius | probable 0.77 | exact 0.94 | EPA `37163` | 13/73 | 43 / 92 / 45 | review_required |
| 2018 Nissan Leaf | probable 0.77 | exact 0.97 | EPA `39860` | 14/73 | 44 / 92 / 45 | review_required |
| 2016 Honda CR-V | probable 0.77 | exact 0.91 | EPA `37024` | 14/73 | 44 / 92 / 45 | review_required |
| 2019 Ford F-150 | probable 0.79 | ambiguous 0.69 | none | 0 | n/a | deferred |
| 2017 Toyota Yaris | probable 0.77 | exact 0.97 | EPA `37970` | 13/73 | 43 / 92 / 45 | review_required |
| 2015 Toyota Corolla | probable 0.77 | ambiguous 0.69 | none | 0 | n/a | deferred |
| 2016 Toyota RAV4 | probable 0.77 | exact 1.00 | EPA `37086` | 14/73 | 44 / 92 / 45 | review_required |
| 2017 Kia Niro | probable 0.77 | exact 0.97 | EPA `38486` | 13/73 | 43 / 92 / 45 | review_required |
| 2017 Chevrolet Volt | probable 0.77 | not_found | none | 0 | n/a | review_required |
| 2017 Toyota Tacoma FWD | probable 0.79 | not_found | none | 0 | n/a | review_required |
| 2017 Toyota Yari | not_found | not_found | none | 0 | n/a | skipped |

Every staged CVR contained all 73 datum fields, every populated field resolved to production evidence, source IDs and retrieval timestamps survived, and no fixture evidence entered a record. Review-required status remains because the broad NHTSA identity result was not approved. The Camry, F-150, and Corolla remain deferred because multiple EPA configurations fit the catalog claims.

The anomaly cases behaved as intended: the Volt's catalog `electric` claim conflicted with EPA `plug_in_hybrid`; the FWD Tacoma conflicted with EPA RWD/4WD configurations; and the truncated `Yari` model was not silently normalized to Yaris. Duplicate identities were also reported for the 2016 Prius and RAV4.

## Before Catalog-Wide Enrichment

Phase 3.2D still needs a review artifact and approval workflow for probable matches, explicit resolution of ambiguous configurations, rate limiting and retry policy, source response retention/licensing decisions, resumable batches, idempotent staging persistence, and operator audit history.

## Before Recommendation Integration

The team must define approved CVR-to-legacy overlay mappings, recommendation field precedence, freshness policy, confidence thresholds, rollback behavior, and regression benchmarks. Until then, recommendations continue using the unchanged production catalog.

## Exact Next Step

Phase 3.2D Step 2 should add a human-review manifest for `REVIEW_REQUIRED` and `DEFER` results. It should record an explicit reviewer decision and selected source ID without modifying production records, then rerun the existing adapter, merger, and integrity checks for approved resolutions.
