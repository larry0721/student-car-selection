# Canonical Vehicle Contribution Merger

## Responsibility

The canonical merger is the single deterministic boundary between sparse, source-specific `CanonicalVehicleContribution` objects and a complete `CanonicalVehicleRecord` (CVR).

```text
source clients
  -> contribution adapters
  -> CanonicalVehicleContribution[]
  -> mergeCanonicalVehicleContributions
  -> CanonicalIngestionResult
```

The merger establishes vehicle linkage, validates production eligibility, resolves field claims, preserves evidence, completes all 73 CVR fields, and computes record-level confidence. It does not fetch data, score buyers, rank vehicles, or call recommendation code.

## Public API

```ts
type CanonicalContributionMergeOptions = {
  targetDataUse?: "production" | "fixture" | "test";
  authorityMargin?: number;
};

function mergeCanonicalVehicleContributions(
  contributions: readonly CanonicalVehicleContribution[],
  options?: CanonicalContributionMergeOptions,
): CanonicalIngestionResult;
```

`targetDataUse` defaults to `production`. `authorityMargin` defaults to 12 points and controls how much stronger one conflicting value group must be before it may win.

## Processing Order

1. Sort contributions by stable contribution ID.
2. Validate each contribution against the contribution contract.
3. Reject contributions whose data-use classification does not match the target.
4. Apply the vehicle-linkage gate to the remaining set.
5. Build and deduplicate the evidence registry.
6. Resolve each non-confidence canonical field once.
7. Complete unclaimed fields as explicitly missing.
8. Derive the three CVR confidence fields.
9. Assign deterministic record identity, scope, and dates.
10. Return records, rejected source record IDs, and typed issues.

Invalid contributions are rejected individually. A linkage failure rejects the accepted set because the merger cannot responsibly claim that the inputs describe one vehicle.

## Vehicle-Linkage Gate

Conflicting non-null VIN, make, model, model year, canonical record ID, configuration ID, or configuration-level trim values stop the merge. A configuration-ID conflict is tolerated only when a shared VIN establishes the physical vehicle.

For more than one contribution, every contribution must be connected to the same identity graph through at least one of:

- the same VIN;
- the same canonical record ID;
- the same configuration ID;
- the same namespaced external ID;
- the same complete normalized make, model, and model year.

Transitive linkage is allowed. Disconnected sparse values are rejected with `canonical_linkage_ambiguous`; the merger does not assemble a vehicle merely because separate records happen to provide one make, one model, and one year in aggregate. Identity comparison normalizes case, whitespace, and punctuation but performs no fuzzy guessing.

When two or more accepted contributions are VIN or configuration scoped, the linkage gate also rejects clearly incompatible configuration claims before field resolution. Drivetrain conflicts block the merge. Manual versus automatic/CVT blocks the merge, while automatic and CVT may coexist as broad and specific descriptions of the same family. Fuel conflicts block the merge except that a broader gasoline primary-fuel claim may coexist with hybrid or plug-in-hybrid configuration evidence. Missing configuration claims are neutral rather than disagreements.

## Production Safety

Production output accepts only contributions with `dataUse: "production"` whose evidence is also marked `production`. Fixture and test contributions are rejected with `canonical_merge_data_use_rejected`. A contribution or evidence entry with source type `example_fixture` is also rejected from production even if its data-use label is incorrect. The same data-use rule applies in reverse when an explicitly non-production merge target is used.

The CVR evidence fields retain their data-use classification, so production provenance remains auditable after merging.

## Evidence Registry

The registry preserves provider, source type, source record ID, source URL, original source field and value, observed and retrieval dates, market, methodology, license, normalization method and notes, scope, and data-use classification.

Logical evidence is deduplicated by all provenance content except `evidenceId`. Source claims and normalization notes are sorted for the signature because their array order is not meaningful. When different logical evidence requests the same ID, the later canonical ID receives a stable content-hash suffix. All contribution evidence references are remapped to the registry. Field and issue references are checked by permanent tests to prevent dangling IDs.

Explicit missing attempts remain in the registry and are referenced by a typed issue. CVR missing datums keep an empty `evidenceIds` array, as required by the CVR contract, because attempted collection is not evidence of a vehicle value.

## Field Resolution

Every canonical field uses the same resolver:

| Input state | Result |
| --- | --- |
| No claim | `missing`, `not_collected` |
| Explicit missing claims only | `missing` with the highest-priority accurate missing reason; preserve attempts in an issue |
| One value | Preserve the value, evidence, status, date, and confidence |
| Agreeing values | Preserve the value, combine evidence, record agreement, and apply a limited strong-source bonus |
| Conflicting values with safe winner | Preserve the winner, mark agreement `mixed`, reduce confidence, and emit a warning |
| Conflict without safe winner | `missing`, `source_conflict`, and an error containing every conflicting evidence ID |

Values are grouped by stable serialized value and unit. Input array order never chooses a winner. Incompatible units are excluded and reported as `canonical_merge_unit_mismatch`. Fuel economy is the only multi-unit field and accepts `mpg`, `mpge`, or `kwh_per_100_miles` without conversion; claims in different units conflict rather than being compared numerically.

## Field-Aware Source Authority

Authority is calculated independently for each claim:

```text
45% field-domain source authority
20% canonical value status
15% normalization method
15% field-aware scope specificity
 5% mean of field and contribution-source confidence
```

The source domains are identity, market, environment, safety, reliability, and general. Examples:

- OEM and NHTSA evidence are strong for vehicle identity.
- Transactions and current listings are strong for market values.
- EPA is strongest for environmental measurements.
- IIHS and NHTSA are strong for safety.
- Repair and warranty evidence are strong for reliability.

NHTSA is not globally preferred. A value group's strongest claim is its baseline authority; independent agreeing sources can add at most four points. A conflicting winner must exceed the runner-up by the configured authority margin.

## Scope And Freshness

Scope is field-aware rather than one universal ordering:

- identity favors VIN, then configuration/trim, then model year;
- market values favor listings and VIN-specific facts;
- environment favors configuration/trim and model-year measurement;
- safety favors model-year and configuration evidence;
- reliability favors population and model-year evidence.

This allows VIN-level drivetrain to refine a broader model-year claim while preventing a seller listing from automatically overruling a stronger identity decode.

Freshness participates only for time-sensitive financial, odometer, and condition conflicts. The newest claim receives up to a 14-point bonus; older claims lose one bonus point per 30 days of relative age. Freshness still must produce the normal safe authority margin. Static identity, safety, and other non-volatile fields do not receive this bonus.

## Status And Field Confidence

The strongest status among agreeing winning claims is retained. Agreement alone never upgrades a status. Two estimated sources therefore remain `estimated`, and derived or estimated values retain an estimation method.

Field confidence starts with the best winning claim's confidence. It gains four points per additional independent strong source, capped at 12 points. A source is strong only when it is sourced or verified, has at least 0.70 field confidence, and uses direct or mapped evidence. A safely resolved conflict subtracts 12 points. Scores remain in the 0 to 1 range and determine the existing high, medium, low, or unknown level.

Unresolved conflicts and missing values have unknown field confidence. A missing field never receives a made-up date; an undated resolved claim remains undated.

## Record Confidence

Only accepted evidence and resolved fields participate.

`confidence.dataQuality` is:

```text
65% resolved-field completeness
+ 35% mean resolved-field confidence
- 5 points per conflicting field, capped at 25 points
```

Completeness uses the 70 non-confidence CVR fields. `confidence.evidenceQuality` averages each deduplicated evidence item's source authority, normalization method, and scope using 50%, 30%, and 20% weights. `confidence.sourceAgreement` uses the ratio of independently agreeing comparable fields and applies the same conflict penalty. With multiple contributions but no comparable fields, it uses a neutral 50 baseline; a single source uses 45.

These scores describe the record, not buyer fit, and cannot affect recommendation ranking in this phase.

## Missing-Field Completion

The merger creates all 12 sections and all 73 canonical fields. It does not require every source adapter to emit explicit missing values.

- never mentioned: `not_collected`;
- attempted but unavailable: preserve the source's most accurate reason;
- too broad to map safely: `insufficient_specificity`;
- not represented by the ontology/source: `unsupported`;
- unresolved disagreement: `source_conflict`.

No value is invented to improve completeness.

## Stable Record Identity

The stable record ID uses the first available key in this order:

1. normalized VIN: `cvr:vin:{VIN}`;
2. supplied canonical record ID;
3. normalized configuration ID;
4. normalized model year, make, model, and optional trim.

Record scope resolves to VIN, then listing, then configuration, then model year. Creation and update dates come from the earliest and latest accepted retrieval timestamps. No random ID or processing-time timestamp is used.

## Order Independence

Contributions, evidence groups, evidence IDs, field claims, issue lists, and references are sorted by stable content or identity keys before resolution. Reversing the contribution array produces a deeply equal `CanonicalIngestionResult`, including the record ID and evidence registry. Inputs are cloned where needed and are never mutated.

## NHTSA Vertical Slice

The permanent offline test passes a mocked 2003 Honda Accord coupe contribution from the NHTSA adapter into the merger. The resulting VIN-scoped CVR preserves Honda, Accord, 2003, coupe, gasoline, and automatic transmission. Drivetrain remains `not_available`, vehicle category remains `insufficient_specificity`, and every unrelated field becomes `not_collected`. NHTSA evidence and original source claims remain attached. No network request is used.

## Legacy Boundary

`lib/data/mergeVehicleData.ts` and `VehicleDataOverlay` remain the current application's legacy runtime enrichment path. They do not model field-level provenance, explicit source attempts, authority, or conflict resolution and are intentionally not reused here. The canonical merger is also not imported by the catalog, UI, API routes, or recommendation engine in this phase.

## Future Sources

The EPA adapter emits configuration contributions. Its direct fuel-economy and emissions measurements enter the environment authority domain and can outrank marketplace estimates without EPA-specific merger code. Permanent NHTSA + EPA integration tests verify compatible configuration linkage, agreement, conflict rejection, missing-value handling, evidence preservation, and order independence.

A marketplace adapter should emit listing-scoped contributions for purchase price, mileage, condition, and listing identity. Current direct listing facts can outrank stale estimates for time-sensitive fields, but seller identity text cannot automatically override authoritative VIN evidence.

The next implementation step is deterministic source matching for catalog vehicles. Matching must expose ambiguity and require caller confirmation where necessary; no source should bypass this merger to write a CVR directly.
