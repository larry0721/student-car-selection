# NHTSA + EPA Multi-Source Vehicle Validation

## Purpose

This validation proves that caller-selected NHTSA vPIC and FuelEconomy.gov records can pass through their independent adapters and the existing deterministic merger to produce one evidence-backed, 73-field `CanonicalVehicleRecord` (CVR). It does not perform source discovery, fuzzy matching, catalog enrichment, or recommendations.

```text
caller-selected NHTSA record -> NHTSA contribution --\
                                                     -> canonical merger -> complete CVR
caller-selected EPA record   -> EPA contribution ----/
```

## Source Responsibilities

| Source | Primary responsibility in this validation |
| --- | --- |
| NHTSA vPIC | VIN linkage; make, model, model year, body style, drivetrain, transmission, fuel type, and safely mappable vehicle category |
| FuelEconomy.gov / EPA | Configuration ID; make, model, model year, class, drivetrain, transmission, fuel type, fuel economy, EV range, emissions, and derived monthly fuel/energy cost |

Neither source receives universal priority. The merger applies its existing field-domain authority, normalization-method, scope, status, and confidence policy to each claim.

## Controlled Vehicles

The permanent suite uses constructed, non-production records shaped like the official clients' typed outputs. The pair is selected explicitly; the harness never searches for or chooses an EPA option.

| Vehicle | NHTSA test VIN | EPA record ID | Configuration assumption and linkage rationale |
| --- | --- | --- | --- |
| 2024 Toyota Camry | `4T1C11AK0RU000001` | `47085` | Gasoline, FWD, automatic. Exact normalized year/make/model and matching configuration claims. |
| 2024 Toyota Prius | `JTDACAAU0R3000001` | `47110` | Conventional hybrid, FWD, CVT. Exact identity and matching powertrain claims. |
| 2024 Nissan Leaf | `1N4AZ1BV0RC000001` | `46956` | Battery electric, FWD, automatic, 212-mile source range. Exact identity and matching powertrain claims. |
| 2024 Honda CR-V | `2HKRS4H50RH000001` | `47125` | Gasoline, AWD, CVT SUV. Exact identity; EPA class safely supplies the category. |
| 2024 Ford Maverick | `3FTTW8H30RRA00001` | `47508` | Gasoline, FWD, automatic pickup. Exact identity; EPA class safely supplies pickup category. |

Only EPA ID `47085` is used by the optional live check. The remaining IDs and all five VINs are controlled test identifiers, not claims that those exact identifiers exist in the live services. This keeps offline tests deterministic and prevents fixture evidence from being mistaken for production evidence.

## Contribution Results

| Vehicle | NHTSA contribution | EPA contribution |
| --- | --- | --- |
| Camry | 7 values, 1 explicit missing category, 1 reduced-specificity issue, confidence `0.96` | 10 values, 1 missing body style, 1 ambiguity issue, confidence `0.89` |
| Prius | 7 values, 1 explicit missing category, 1 reduced-specificity issue, confidence `0.96` | 10 values, 1 missing body style, body-style and hybrid-specificity issues, confidence `0.87` |
| Leaf | 7 values, 1 explicit missing category, 1 reduced-specificity issue, confidence `0.96` | 11 values, 1 missing body style, 1 ambiguity issue, confidence `0.89` |
| CR-V | 7 values, 1 explicit missing category, 1 MPV ambiguity issue, confidence `0.96` | 11 values, no missing emitted fields, 1 reduced-specificity issue, confidence `0.91` |
| Maverick | 7 values, 1 explicit missing category, 1 truck-category ambiguity issue, confidence `0.96` | 11 values, no missing emitted fields, no mapping issue, confidence `0.93` |

Each NHTSA contribution retains its VIN external ID, VIN decode URL, retrieval metadata, direct and mapped source claims, and VIN scope. Each EPA contribution retains its EPA configuration ID, FuelEconomy.gov URL, creation/modification dates, source units, cost assumptions, and direct, mapped, and derived evidence.

## Linkage Policy

The existing linkage gate compares normalized VIN, make, model, model year, trim, configuration ID, canonical ID, and external IDs. This validation adds configuration-safety checks when at least two contributions are VIN or configuration scoped:

- conflicting drivetrain blocks the merge;
- manual versus automatic/CVT blocks the merge;
- automatic and CVT may coexist because one source may report the broader automatic family;
- battery electric, diesel, hydrogen, or otherwise incompatible fuel claims block the merge;
- gasoline may coexist with hybrid or plug-in hybrid because a primary-fuel source can be less specific;
- missing claims do not count as disagreement.

Identity comparison normalizes case, punctuation, and whitespace only. It does not infer aliases or silently select a source option.

## Agreement And Conflict Behavior

Agreeing NHTSA and EPA claims produce one canonical value with evidence from both sources and `sourceAgreement: "agrees"`. Strong independent agreement can add a bounded field-confidence bonus but never changes a sourced value into verified data.

Make, model, model-year, drivetrain, incompatible fuel, and incompatible transmission test conflicts reject the pair before field merging. Body/category conflicts remain field claims: the normal authority policy may resolve a safe winner with `mixed` agreement and a confidence penalty. With no safe authority margin, the value becomes `missing/source_conflict`; both sources' evidence remains attached to the error. Input array order never selects the result.

## Missing And Value Behavior

- NHTSA drivetrain missing + EPA FWD -> FWD survives.
- NHTSA category too broad + EPA midsize category -> EPA category survives.
- EPA emissions attempted but missing + no NHTSA emissions claim -> missing `not_available` plus an explicit-source-missing issue.
- A missing claim never defeats a usable value.
- A field no accepted source attempted remains `not_collected`.

## Merged CVR Results

| Vehicle | Populated / 73 | Missing | Confirmed by both | NHTSA only | EPA only | Conflicts | Evidence | Data quality | Evidence quality | Source agreement |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Camry | 14 | 59 | identity, drivetrain, transmission, fuel | body style | category, fuel cost, MPG, emissions | 0 | 5 | 44 | 94 | 100 |
| Prius | 14 | 59 | identity, drivetrain, transmission, fuel | body style | category, fuel cost, MPG, emissions | 0 | 5 | 44 | 94 | 100 |
| Leaf | 15 | 58 | identity, drivetrain, transmission, fuel | body style | category, fuel cost, energy use, range, emissions | 0 | 5 | 45 | 94 | 100 |
| CR-V | 14 | 59 | identity, body style, drivetrain, transmission, fuel | none | category, fuel cost, MPG, emissions | 0 | 5 | 44 | 94 | 100 |
| Maverick | 14 | 59 | identity, body style, drivetrain, transmission, fuel | none | category, fuel cost, MPG, emissions | 0 | 5 | 45 | 94 | 100 |

`Data quality` remains modest because 58–59 fields are honestly unknown. `Evidence quality` is high because both sources are authoritative in their respective domains. `Source agreement` is 100 only because every comparable claim in these deliberately compatible pairs agrees; it is not a completeness score.

## Evidence And Safety Invariants

The suite verifies that every populated source-backed field references existing evidence, every issue reference is valid, provider source IDs and URLs survive, EPA dates survive, NHTSA retrieval metadata survives, original source field/value claims survive, normalization methods survive, evidence IDs remain unique, and the merger does not mutate either contribution.

Reversing `[NHTSA, EPA]` to `[EPA, NHTSA]` produces a deeply equal ingestion result for all five pairs. Test contributions and evidence are also rejected by the default production merge, preventing fixture/test evidence from entering production CVRs.

## Known Source Quirks And Limitations

- vPIC vehicle type may be broader than the canonical body/category taxonomy.
- EPA size classes often establish category without establishing body style.
- NHTSA may describe CVT as an automatic family while EPA is more specific.
- A primary-fuel decode may say gasoline for a hybrid configuration.
- Exact source model labels can differ by trim, drivetrain suffix, punctuation, or marketing name.
- The controlled suite proves merging after a caller has selected compatible records; it does not prove automatic matching.
- The CVR is not consumed by the catalog, UI, scoring, routes, or recommendation engine.

## Controlled Live Verification

One read-only live check used NHTSA VIN `4T1C11AK9RU000001` and caller-selected EPA vehicle ID `47085`. Both official services returned 2024 Toyota Camry identity. NHTSA supplied gasoline, automatic, sedan, and the ambiguous drivetrain label `4x2`; EPA supplied gasoline, automatic, FWD, midsize class, 26 MPG, 338 g CO2/mile, and $2,350 annual fuel cost.

The production-data merge produced `cvr:vin:4T1C11AK9RU000001` with FWD from EPA because NHTSA's ambiguous drivetrain became an explicit missing claim rather than a conflicting value. The record contained 14 populated and 59 missing fields, five evidence records, data quality 44, evidence quality 94, and source agreement 100. The live check did not perform option discovery or matching: both identifiers were selected by the caller before retrieval.

## Next Step

The exact next step is **deterministic source matching for catalog vehicles**. That work must produce explicit match candidates and confidence, handle harmless naming differences without fuzzy guessing, expose ambiguity rather than silently choosing an EPA option, and feed only confirmed compatible contributions into this merger.
