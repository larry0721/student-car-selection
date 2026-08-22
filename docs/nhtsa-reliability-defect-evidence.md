# NHTSA Defect and Reliability Evidence

## Purpose

This pipeline answers a limited question: which official recall campaigns and consumer-reported defect signals does NHTSA retain for a year, make, and model?

It does not calculate long-term reliability. Recall and complaint counts are not reliability scores, and this evidence is not connected to production recommendations.

## Schema audit

The Canonical Vehicle Record currently provides:

- `reliability.longTermReliability`: aggregate 0-100 judgment;
- `reliability.repairFrequency`: repairs per 10,000 miles;
- `reliability.repairSeverity`: monetary repair severity;
- `reliability.knownIssues`: reviewed structured issues.

Raw recalls and complaint allegations cannot safely populate the first three fields. `knownIssues` may eventually receive a reviewed, deduplicated problem conclusion, but one raw event is not automatically a known model defect. The field-oriented `VehicleKnowledgeClaim` contract also cannot retain many independent events on one field without creating false value conflicts.

Phase 3.3B-2 therefore adds the smallest lossless extension outside the CVR: an immutable `VehicleReliabilityEvidenceSnapshot`. It retains event-level `CanonicalEvidence`, original source claims, stable source IDs, scope, severity indicators, and source limitations. It creates no canonical reliability claim and requires no CVR schema change.

## Official source interfaces

### Recalls

`GET https://api.nhtsa.gov/recalls/recallsByVehicle?make={make}&model={model}&modelYear={year}`

The client retains campaign number, manufacturer, component, summary, consequence, remedy, notes, report date, vehicle identity, NHTSA action number, park instructions, source URL, and raw fields.

A valid empty response becomes `NO_RECALL_RECORD_FOUND`. This means only that no matching record was returned. It is not evidence of perfect reliability.

### Consumer complaints

`GET https://api.nhtsa.gov/complaints/complaintsByVehicle?make={make}&model={model}&modelYear={year}`

The client retains ODI number, incident and filing dates, component, summary, crash/fire flags, injuries, deaths, mileage and speed when returned, vehicle identity, source URL, and raw fields.

NHTSA authority establishes that a complaint record was received. It does not verify the consumer's mechanical allegation. Every complaint event therefore has:

- `assertionStatus: REPORTED_ALLEGATION`
- `allegationVerified: false`

### Investigations

NHTSA publishes investigation bulk files and web search access, but its current public documentation does not provide a stable year/make/model JSON API equivalent to recalls and complaints. This pipeline marks acquisition `UNSUPPORTED` and does not scrape HTML.

### Manufacturer communications

NHTSA publishes manufacturer-communication and TSB bulk downloads, but its current public documentation does not provide a stable year/make/model JSON API suitable for this client. The source is represented in the architecture and deferred without brittle scraping.

Official source catalog: `https://www.nhtsa.gov/nhtsa-datasets-and-apis`.

## Evidence taxonomy

The authoritative event types are:

- `RECALL`
- `COMPLAINT`
- `INVESTIGATION`
- `MANUFACTURER_COMMUNICATION`

The first-pass component categories are:

- engine, transmission, powertrain, electrical;
- brakes, steering, suspension, airbags;
- fuel system, battery/EV system, climate, structure;
- unknown/other.

Original NHTSA component text is always retained. A category is assigned only from explicit source component tokens. Unrecognized terminology remains `unknown_other`; no root cause is inferred.

## Scope and matching

The live clients query by year, make, and model. Every resulting event is therefore `model_year` evidence. It is not promoted to configuration or VIN scope even when the golden CVR has a known drivetrain or powertrain.

Stable NHTSA campaign numbers and ODI numbers provide deterministic deduplication. Repeated retrieval of the same source ID does not increase counts.

## Severity indicators

The snapshot preserves only explicit source indicators:

- complaint crash and fire flags;
- reported injuries and deaths;
- recall consequence text;
- NHTSA `parkIt` and `parkOutSide` flags;
- future investigation-opened status.

`seriousSignalRecordCount` counts unique records with an explicit crash, fire, injury, death, park-it, or park-outside indicator. It is descriptive only and is not a severity or reliability score. Recall consequence wording is retained but is not classified by text inference.

## Raw-count limitations

Counts are exposure-unadjusted. They vary with:

- sales volume and fleet size;
- vehicle age and accumulated mileage;
- owner reporting behavior;
- source coverage and time;
- campaign scope and duplicate issue reporting.

Therefore, 234 complaints do not automatically indicate worse reliability than 80 complaints. Zero complaints do not indicate perfect reliability.

## Trust semantics

No change was made to the aggregate Vehicle Knowledge trust policy.

- A recall event means NHTSA officially retains that campaign and its reported fields.
- A complaint event means NHTSA officially retains that consumer allegation.
- Complaint content is not promoted to verified mechanical fact.
- Event existence does not grant NHTSA authority to create long-term reliability, repair-frequency, repair-severity, maintenance-cost, or recommendation scores.

The snapshot is a structured pre-inference evidence boundary. A future inference model must define exposure adjustment, event applicability, source agreement, issue clustering, and uncertainty before producing any reviewed canonical reliability conclusion.

## Golden live run

Controlled retrieval: `2026-08-17T06:07:20.276Z`.

| Vehicle | Recalls | Complaints | Investigations | Communications | Top normalized components | Serious-signal records | Date range |
|---|---:|---:|---|---|---|---:|---|
| 2017 Hyundai Accent | 0 | 68 | Unsupported | Unsupported | engine 24; airbags 21; electrical 9 | 13 | 2017-01-15 to 2026-06-20 |
| 2016 Toyota Prius | 5 | 179 | Unsupported | Unsupported | unknown/other 88; electrical 27; brakes 25 | 14 | 2015-08-30 to 2026-05-26 |
| 2016 Toyota RAV4 | 3 | 234 | Unsupported | Unsupported | unknown/other 80; electrical 57; brakes 46 | 44 | 2016-01-01 to 2026-06-15 |
| 2016 Honda CR-V | 3 | 389 | Unsupported | Unsupported | engine 102; unknown/other 99; fuel system 73 | 50 | 2015-12-08 to 2026-07-30 |
| 2018 Nissan Leaf | 4 | 66 | Unsupported | Unsupported | unknown/other 21; brakes 19; electrical 18 | 12 | 2018-04-14 to 2026-07-28 |

The Accent's zero recall result means only `NO_RECALL_RECORD_FOUND` for this lookup. A CR-V complaint retained a `12/31/1969` source date; the raw claim remains in evidence, while deterministic plausibility rules exclude it from the summary date range.

### Explicit severity totals

| Vehicle | Crash reports | Fire reports | Injury records | Reported injuries | Death records | Reported deaths |
|---|---:|---:|---:|---:|---:|---:|
| Accent | 9 | 3 | 4 | 7 | 0 | 0 |
| Prius | 13 | 0 | 6 | 8 | 0 | 0 |
| RAV4 | 33 | 11 | 21 | 27 | 0 | 0 |
| CR-V | 40 | 4 | 28 | 36 | 0 | 0 |
| Leaf | 9 | 1 | 3 | 3 | 0 | 0 |

These are reported event indicators, not proven defect rates and not comparative rankings.

## Snapshot contract

Each `VehicleReliabilityEvidenceSnapshot` contains:

- immutable recall and complaint events;
- deferred investigation and communication sources;
- normalized and original component values;
- explicit severity summary;
- stable evidence IDs and complete `CanonicalEvidence` lineage;
- model-year scope summary;
- per-source acquisition state;
- limitations and exposure warning;
- `reliabilityScore: null`;
- `reliabilityScoreSupported: false`;
- `productionRecommendationConnected: false`.

The controlled full report is stored locally under the gitignored vehicle-knowledge repository boundary with mode `0600`.

## Shadow readiness

All five golden vehicles now have `reliabilityEvidenceAvailable: true`. Aggregate reliability decision support remains unavailable:

- reliability evidence coverage: available for 5 of 5 vehicles;
- reliability scoring coverage: 0%;
- Profile A reliability readiness: unchanged and unsupported.

This is the intended result. Evidence acquisition precedes reliability inference.

## Next step

Phase 3.3B-3 should define a Reliability Evidence Interpretation Policy before any score exists. It should specify event applicability, exposure denominators, recurring-issue clustering, recall/complaint relationship handling, source corroboration, age and mileage adjustment, confidence, and minimum evidence sufficiency. Its first output should be an auditable reliability assessment candidate, not a production ranking input.
