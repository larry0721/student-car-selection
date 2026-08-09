# Deterministic Vehicle Source Matching

## Purpose

Source matching answers one narrow question: which caller-visible NHTSA or FuelEconomy.gov record plausibly describes an existing catalog vehicle? It runs before contribution creation and merging. It does not enrich the catalog, create a CVR, score a buyer, rank a vehicle, or choose a recommendation.

```text
catalog vehicle + source candidates
  -> deterministic normalization
  -> hard contradiction gate
  -> candidate assessments
  -> exact | probable | ambiguous | not_found
```

Every result retains all evaluated candidates, original source values, confidence, matched dimensions, conflicts, missing comparisons, and rationale. Ambiguous results have no selected candidate.

## Catalog Matching Surface

The current 320-record catalog supplies year, make, model, body type, fuel type, drivetrain, and transmission for every record. It does not supply trim, engine displacement, cylinders, VIN, or external source IDs. The reusable input contract supports those future fields without adding them to the catalog today.

Trust assessment:

| Catalog field | Matching use |
| --- | --- |
| ID | Diagnostics only; it is not an external source ID |
| Year | Strong identity evidence, subject to source verification |
| Make | Strong identity evidence after narrow normalization |
| Model | Strong identity evidence only when it passes exact/configuration-suffix comparison |
| Fuel type | Hard configuration comparison, but suspected catalog errors remain visible as conflicts |
| Drivetrain | Hard configuration comparison; known catalog errors mean a conflict blocks matching rather than rewriting either side |
| Transmission | Hard family comparison; automatic and CVT can be compatible broad/specific labels |
| Body type | Hard descriptive comparison when the source safely identifies it |
| Trim, engine, cylinders, VIN, external IDs | Not currently present; their absence is a major source of ambiguity |

The existing validator reports 52 of 320 records with at least one issue: 24 model issues, 23 drivetrain issues, seven body-type issues, and one price issue. There are also 15 duplicate year/make/model identities. Examples include truncated models, FWD Tacoma records, truck-labeled SUVs, a 4WD Camry, and a manual Nissan Leaf. Matching treats these as claims to compare, never as silent truth.

## Public API

```ts
matchNhtsaCandidates(catalogVehicle, candidates)
matchEpaCandidates(catalogVehicle, candidates)
matchCatalogVehicleSources(catalogVehicle, { nhtsa, epa })
discoverAndMatchEpaCandidates(catalogVehicle, client?)
```

`discoverAndMatchEpaCandidates` accepts an injectable `EpaCatalogSourceClient`. Production callers may use the official client; tests provide an offline implementation.

## Matching Dimensions

Weights are normalized over catalog dimensions that are actually present:

| Dimension | Weight | Role |
| --- | ---: | --- |
| VIN | 0.40 | Decisive physical identity when available |
| External ID | 0.25 | Decisive namespaced source identity when available |
| Model year | 0.18 | Core identity |
| Make | 0.18 | Core identity |
| Model | 0.24 | Core identity |
| Trim | 0.03 | Configuration discriminator |
| Fuel type | 0.11 | Important configuration |
| Drivetrain | 0.09 | Important configuration |
| Transmission | 0.08 | Important configuration |
| Body style | 0.05 | Descriptive/configuration evidence |
| Vehicle category | 0.025 | Descriptive evidence |
| Engine displacement | 0.025 | Configuration discriminator |
| Cylinders | 0.015 | Configuration discriminator |

A match earns full weight. A documented broad/specific compatibility earns 75%. Missing source data earns 35% because absence is uncertainty, not disagreement. A hard conflict makes the candidate ineligible with zero confidence. Missing fuel, drivetrain, or transmission caps candidate confidence at `0.84`.

## Hard Contradictions

Known disagreement on year, make, safely normalized model, fuel type, drivetrain, manual versus automatic/CVT, body style, category, engine displacement, cylinders, VIN, or external ID rejects that candidate. Soft scoring cannot recover it.

Automatic and CVT are compatible family descriptions but not identical. Model labels may differ only by a recognized configuration suffix such as AWD, FWD, 4WD, pickup, hybrid, electric, diesel, or a simple engine token. This allows `F-150` versus `F150 Pickup 4WD` while still rejecting `Corolla` versus `Corolla Cross` and `Prius` versus `Prius Prime`.

Make normalization handles punctuation, case, whitespace, and a small reviewed set of manufacturer-name expansions. It is not a fuzzy make dictionary.

## Result Status

### Exact

- year, make, and model agree;
- fuel, drivetrain, and transmission are present and compatible;
- no hard conflict exists;
- confidence is at least `0.90`;
- no runner-up is within the `0.10` ambiguity margin.

Exact does not require body, trim, or engine data when the source does not provide it.

### Probable

- year/make/model identity is complete;
- no hard conflict exists;
- confidence is at least `0.72`;
- the best candidate is at least `0.10` ahead of a runner-up, or is the only plausible candidate;
- at least one configuration discriminator remains unavailable, so exact is not claimed.

### Ambiguous

Two or more plausible candidates fall inside the `0.10` margin. `selectedCandidate` is `null`, overall confidence is capped at `0.69`, every candidate remains visible, and the rationale names the additional discriminator needed. Array order never resolves ambiguity.

### Not Found

No records exist, every record has a hard contradiction, source identity is insufficient, or the best confidence falls below `0.72`. No fallback vehicle or source record is fabricated.

## EPA Behavior

The live workflow is deterministic:

1. retrieve the year make menu;
2. retain only safely equivalent makes;
3. retrieve model menus for those makes;
4. retain exact or configuration-suffix-compatible models;
5. retrieve every option for every retained model;
6. deduplicate options by EPA ID;
7. retrieve every option record;
8. evaluate every successfully retrieved configuration together.

The first menu item is never privileged. A failed configuration request is disclosed and excluded. Multiple indistinguishable engines or trims remain ambiguous. EPA `atvType` is retained by the source client so hybrid identity does not depend on model-name guessing.

## NHTSA Behavior

The matcher accepts VIN-decoded or model-identity candidates. A matching VIN or external ID participates when the catalog eventually supplies one. Without a VIN, NHTSA can establish year/make/model identity but may return only a probable result when drivetrain, fuel, transmission, or body details are unavailable. Identical normalized records with the same source identity are deduplicated; materially different claims remain separate. The matcher does not claim that a broad NHTSA model result identifies one exact configuration.

## Why Missing Is Not Conflict

Missing data says the source cannot distinguish a field. A conflict says both sides made incompatible claims. Treating missing data as a conflict would discard useful EPA efficiency or NHTSA identity evidence; treating it as agreement would overstate certainty. The 35% missing contribution and important-field cap preserve this distinction.

## Optional Live Verification

`pnpm test:source-matching-live` reads five existing catalog records and queries the official NHTSA and FuelEconomy.gov endpoints. It is a manual integration check, not part of the permanent offline test suite and not required by normal tests or builds.

Observed on 2026-08-08:

| Catalog record | NHTSA result | EPA result | Interpretation |
| --- | --- | --- | --- |
| 2015 Toyota Camry FWD gas | Probable, 0.77, model ID `448:2469` | Ambiguous, 0.69, EPA IDs `35734` and `35735` | NHTSA lacks configuration data; two EPA engine configurations remain plausible. |
| 2016 Toyota Prius FWD hybrid | Probable, 0.77, model ID `448:2209` | Exact, 0.94, EPA ID `37163` | EPA configuration agrees on identity, hybrid fuel, drivetrain, and transmission. |
| 2018 Nissan Leaf FWD electric | Probable, 0.77, model ID `478:1905` | Exact, 0.97, EPA ID `39860` | EPA configuration agrees on identity, electric fuel, drivetrain, and transmission. |
| 2016 Honda CR-V AWD gas | Probable, 0.77, model ID `474:1865` | Exact, 0.91, EPA ID `37024` | The AWD EPA configuration agrees on every compared field; the FWD option is rejected. |
| 2019 Ford F-150 4WD gas | Probable, 0.79, model ID `460:1801` | Ambiguous, 0.69, EPA IDs `41028` and `41034` | Two EPA engine configurations remain plausible because the catalog has no engine discriminator. |

Candidate discovery evaluated 20/2, 21/1, 19/1, 69/2, and 42/6 NHTSA/EPA records respectively. No source candidate was selected merely because it appeared first.

## Isolation

Permanent tests replace network access and inject an EPA client fixture. The matching module imports neither the canonical merger nor recommendation code. It does not mutate catalog records or source candidates. Reversing candidate order produces a deeply equal result.

## Future Controlled Enrichment

The next step is controlled catalog enrichment. Only `exact` matches should be eligible for unattended staging. `probable` matches require explicit review policy. `ambiguous` results require more catalog data or user/operator selection. `not_found` remains unenriched. Any approved source record must still pass through its contribution adapter and the canonical merger; the matcher never writes CVR or catalog fields directly.
