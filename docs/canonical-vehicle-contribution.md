# Canonical Vehicle Contribution

## Purpose

The Canonical Vehicle Contribution (CVC) is the source-independent, sparse input to the future vehicle evidence merger. It prevents an individual source from pretending to know all 73 fields in a Canonical Vehicle Record (CVR).

```text
raw source
  -> source client
  -> source normalizer
  -> CanonicalVehicleContribution
  -> future contribution merger
  -> CanonicalVehicleRecord
```

A contribution is not recommendation-ready. It cannot select a vehicle, update a buyer profile, or bypass CVR validation.

## Contribution Versus CVR

| Concern | Contribution | Canonical Vehicle Record |
| --- | --- | --- |
| Purpose | Preserve one source's canonical claims | Describe one resolved vehicle record |
| Shape | Sparse sections and fields | All 12 sections and all 73 fields |
| Conflicts | Reports source-local ambiguity only | Contains the future merger's deterministic resolution |
| Linkage | VIN, external IDs, and tentative identity | Stable internal `recordId` and record scope |
| Readiness | Never recommendation-ready | May become `recommendation_ready` after validation |
| Missing data | Only present when the source attempted the field | Every unknown field is explicitly missing |

The contribution contract is defined in `types/canonicalVehicleContribution.ts`. It reuses canonical field types, enums, datums, confidence, evidence, missing reasons, validation issues, source types, and record scope from `types/canonicalVehicle.ts`.

## Contract

`CanonicalVehicleContribution` contains:

- `schemaVersion`: contribution-contract version;
- `contributionId`: stable ID for this normalized source contribution;
- `dataUse`: `production`, `fixture`, or `test`;
- `normalizationVersion`: version of the source-to-canonical mapping;
- `recordScope`: reused CVR scope;
- `source`: provider, source record ID, dates, market, methodology, and license;
- `linkage`: keys used by the future identity resolver;
- `sourceConfidence`: confidence in the contribution as a source artifact;
- `sourceMetadata`: typed JSON metadata retained outside canonical fields;
- `evidence`: shared evidence objects referenced by field datums;
- `data`: partial typed content across all 12 CVR sections;
- `issues`: source-local normalization and validation issues.

`CanonicalVehicleContributionData` maps every CVR section to an optional section and every field in that section to an optional `CanonicalContributionDatum`. Unknown section names and unknown canonical fields are rejected by TypeScript and the structural validator.

## Omitted, Missing, And Claimed

The contract preserves three different states:

1. **Omitted field:** the source made no claim and did not report an attempt. The field key does not exist in the contribution.
2. **Explicitly missing field:** the source exposed or attempted the field but supplied no usable value. The field is present with `value: null`, `status: "missing"`, a canonical `missingReason`, no claim `evidenceIds`, and one or more `attemptEvidenceIds`.
3. **Claimed value:** the source supplied a canonical value. The field is present with a non-missing status and references supporting contribution evidence through `evidenceIds`.

`CanonicalContributionDatum` extends the complete `CanonicalDatum` wrapper with `attemptEvidenceIds`. This dedicated addition is necessary because CVR missing-data rules correctly require missing datums to have no claim evidence. Attempt evidence proves that the source tried to populate the field without presenting missingness as a factual vehicle value.

Omission and explicit missingness must never be converted into one another.

## Evidence And Normalization

Evidence lives once in the contribution's `evidence` array. Field datums reference it by ID, so an identity response does not need to duplicate a full evidence object for make, model, and year.

`CanonicalContributionEvidence` extends `CanonicalEvidence` with:

- `dataUse`: prevents fixture or test evidence from entering production;
- `sourceClaims`: preserves each `sourceField` and its JSON-safe `originalSourceValue`;
- `normalizationMethod`: `direct`, `mapped`, `derived`, or `estimated`;
- `normalizationNotes`: explains mappings or transformations.

Normalization methods mean:

- `direct`: value is projected without semantic conversion, apart from safe formatting;
- `mapped`: source vocabulary is deterministically mapped to a canonical enum or unit;
- `derived`: value is calculated deterministically from source claims;
- `estimated`: value is inferred statistically or heuristically and must remain labeled estimated.

Source methodology and license remain on both source metadata and evidence because evidence may have narrower scope or a different method than the overall response.

Non-production contributions must have matching non-production evidence. The future merger must reject every contribution whose `dataUse` is not `production` when building production CVRs.

## Identity And Linkage

`CanonicalVehicleLinkage` preserves:

- optional canonical record ID;
- VIN;
- make, model, model year, generation, and trim;
- configuration ID;
- namespaced external IDs.

VIN remains a contribution linkage key. It is not added to CVR identity in this phase. A VIN-scoped contribution uses `recordScope: "vin"`, can use the VIN as the source record ID, and retains it in `linkage.vin`. The future merger decides the stable CVR `recordId` after identity resolution.

Linkage values are not canonical field claims by themselves. If a source also claims make, model, or year, those values must separately appear as evidence-backed datums under `data.identity`.

## Issues

`CanonicalContributionIssue` reuses the CVR validation issue fields and adds `kind` plus the original `sourceField` when applicable.

Kinds are:

- `source_fetch_error`;
- `normalization_warning`;
- `invalid_canonical_value`;
- `ambiguous_mapping`;
- `reduced_specificity`;
- `explicit_source_missing`.

Fetch errors describe a failed source operation. Normalization warnings describe a usable result with caveats. Invalid values cannot become canonical claims. Ambiguous mappings retain competing interpretation context. Reduced specificity records cases where a source fact can only support a broader scope. Explicit source missingness documents a source field that was attempted without a usable value.

Cross-source conflict is intentionally absent. No source normalizer has enough context to declare it. The future merger will compare evidence and emit `source_conflict` only after deterministic resolution fails.

## Adapter Contract

The existing `CanonicalVehicleIngestionAdapter<SourceRecord>` remains unchanged. It represents the later boundary that returns merged, complete CVRs.

New source normalizers implement:

```ts
interface CanonicalVehicleContributionAdapter<SourceRecord> {
  readonly sourceType: CanonicalSourceType;
  normalize(
    sourceRecords: readonly SourceRecord[],
    context: CanonicalIngestionContext,
  ): Promise<CanonicalContributionIngestionResult>;
}
```

`CanonicalContributionIngestionResult` returns sparse contributions, rejected source record IDs, and contribution issues. A future merger will accept those contributions, resolve identity and evidence, create complete CVRs with explicit missing fields, and return the existing `CanonicalIngestionResult`.

This parallel contract avoids breaking the CVR API before the merger exists.

## Fixture Examples

`data/canonicalVehicleContributionExamples.ts` contains three non-production examples:

1. **NHTSA VIN fixture:** VIN-scoped identity and configuration facts only. It makes no financial, safety, reliability, comfort, or experience claims.
2. **EPA fixture:** configuration-scoped fuel type, fuel economy, emissions, and electric range only.
3. **Marketplace fixture:** listing price, mileage, identity, VIN linkage, and photo URL metadata. Its absent trim is explicitly missing because the source attempted that field.

Every example and evidence entry is marked `fixture`. No live network request is used by its tests.

## Structural Validation

`validateCanonicalVehicleContribution` checks:

- supported schema version and top-level shape;
- known CVR sections and field paths;
- canonical identity enum values;
- datum status, null, missing-reason, and estimate consistency;
- claim and attempt evidence references;
- evidence ID uniqueness;
- source-claim shape and normalization method;
- source metadata, confidence, and linkage presence;
- fixture/test evidence isolation.

It does not resolve identity, merge evidence, decide source precedence, or assess recommendation readiness.

## Future Merger Responsibilities

The contribution merger must:

1. reject fixture and test contributions from production processing;
2. resolve linkage into a stable canonical identity;
3. compare evidence authority, scope, freshness, and specificity;
4. preserve winning and losing evidence;
5. resolve or expose cross-source conflicts;
6. create all 12 CVR sections and all 73 fields;
7. convert unclaimed fields to explicit CVR missing datums;
8. calculate record-level confidence without changing match score;
9. emit `CanonicalIngestionResult`;
10. remain independent of BuyerProfile, ranking, and recommendation logic.

## Prohibited Behavior

A source normalizer must not:

- emit a complete CVR merely to fill unknown fields;
- invent defaults for omitted fields;
- place VIN or provider-only metadata into unrelated canonical fields;
- emit unknown canonical paths;
- mark mapped or estimated data as direct;
- use fixture/test evidence as production evidence;
- detect cross-source conflicts without other contributions;
- select, score, rank, or recommend vehicles.

## Legacy Migration

`VehicleDataOverlay` remains the current application's legacy sparse merge input. It lacks field-level confidence, status, evidence, explicit missingness, and source-claim preservation. New vehicle-intelligence adapters should return `CanonicalVehicleContribution`, not extend `VehicleDataOverlay`.

The recommendation engine remains on the legacy catalog until a separately approved migration consumes validated CVRs.

## NHTSA VIN Contribution Adapter

`src/vehicle-intelligence/sources/nhtsa/nhtsa-contribution-adapter.ts` implements the first source adapter. Fetching and normalization remain separate:

```text
decodeVin(vin)
  -> DecodedVin
  -> normalizeDecodedVinToContribution(sourceRecord, context)
  -> CanonicalVehicleContribution
```

`nhtsaContributionAdapter` implements `CanonicalVehicleContributionAdapter<NhtsaSourceRecord>`. `decodeVinToContribution` is a server-side convenience workflow that invokes the existing client and returns `CanonicalContributionIngestionResult`. Unit tests use only the pure normalizer.

### Mapping table

| vPIC field | Canonical field | Method | Policy |
| --- | --- | --- | --- |
| `Make` | `identity.make` | direct | Trim/collapse whitespace; normalize all-uppercase long words without a make registry |
| `Model` | `identity.model` | direct | Trim/collapse whitespace; preserve spelling and punctuation |
| `ModelYear` | `identity.modelYear` | direct | Accept integer years from 1886 through retrieval year + 1 |
| `BodyClass` | `identity.bodyStyle` | mapped | Map only named sedan, SUV, hatchback, pickup, coupe, convertible, wagon, and minivan forms |
| `VehicleType` | `identity.vehicleCategory` | mapped | Map only explicit pickup, minivan, SUV, crossover, and van forms |
| `DriveType` | `identity.drivetrain` | mapped | Map explicit FWD, RWD, AWD, and 4WD forms; `2WD`/`4x2` remains ambiguous |
| `FuelTypePrimary` | `identity.fuelType` | mapped | Map gasoline, diesel, hybrid, plug-in hybrid, battery electric, and hydrogen forms |
| `TransmissionStyle` | `identity.transmission` | mapped | Map automatic, manual, and CVT forms |

Generic NHTSA `PASSENGER CAR` cannot identify compact, midsize, large, sports, or luxury category, so it remains explicitly missing with `reduced_specificity`. Generic `TRUCK` does not prove pickup, and MPV does not distinguish SUV, crossover, or van; both remain explicitly missing rather than guessed.

### Direct and mapped evidence

The adapter creates two shared evidence entries per decoded VIN:

- direct evidence for make, model, and model year;
- mapped evidence for body class, vehicle type, drivetrain, fuel, and transmission.

Both preserve every original source field and value, VIN source record ID, vPIC URL, retrieval timestamp, market, methodology, license notice, record scope, and data-use classification. Populated datums reference claim evidence. Missing or unmappable datums reference the source attempt through `attemptEvidenceIds`.

### Confidence rules

- Direct make and model claims: `0.98`.
- Direct valid model year: `0.99`.
- Exact categorical mappings: `0.90` to `0.98`, depending on specificity.
- Missing, unsupported, or ambiguous mappings: unknown field confidence.
- Source-level confidence: deterministic `0.72 + 0.24 * populatedDecodedFields / 8`, capped by construction at `0.96`.

Confidence measures source usability, not recommendation fit. It cannot affect ranking in this phase.

### Missing and issue policy

All eight decoded fields are fields that vPIC attempted to provide. A null value therefore becomes an explicit missing contribution datum rather than an omitted field. Unsupported or ambiguous values also become explicit missing datums while preserving their raw evidence.

The adapter emits typed issues for:

- missing decoded values;
- unsupported source vocabulary;
- ambiguous mappings;
- overly broad/reduced-specificity categories;
- invalid model years;
- malformed `DecodedVin` runtime structures;
- invalid adapter ingestion context.

Source fields unrelated to the eight decoded values are omitted. No financial, safety, reliability, driving, comfort, technology, practicality, environment, image, lifestyle, or record-confidence section is created.

### vPIC limitations

vPIC describes manufacturer-reported and decoded identity/configuration attributes. Field population varies by VIN and model year. A decoded value is not a listing-condition inspection, ownership-cost estimate, crash-test result, reliability assessment, market price, or proof of installed trim equipment. Broad values such as `PASSENGER CAR`, `TRUCK`, `MPV`, `4x2`, and generic van classes may be less specific than the CVR taxonomy and are intentionally not guessed.

## Next Source Task

Implement the deterministic contribution merger boundary. It should group contributions by linkage, reject fixture/test data from production, resolve evidence scope and conflicts, and emit complete `CanonicalVehicleRecord` structures through the existing `CanonicalIngestionResult`. It must remain disconnected from recommendation behavior until separately approved.
