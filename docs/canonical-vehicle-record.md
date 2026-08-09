# Canonical Vehicle Record

Status: Phase 3.2B authoritative normalization contract

Schema version: `1.0.0`

Date: July 28, 2026

## Purpose

The Canonical Vehicle Record (CVR) is the source-independent description of one vehicle identity, configuration, listing, or VIN-level record. Every future ingestion adapter must normalize its source into this contract before the data may reach recommendation code.

The target architecture is:

```text
Source-specific record
        |
        v
Source adapter
        |
        v
Canonical Vehicle Record
        |
        v
Validation and evidence resolution
        |
        v
Recommendation engine
```

Recommendation code must not import NHTSA, EPA, listing, insurance, repair, survey, or CSV-specific types. Phase 3.2B defines this boundary but does not migrate the current legacy `Vehicle` consumer, change scoring, import data, or connect an API.

The TypeScript contract is in `types/canonicalVehicle.ts`. Compile-time examples are in `data/canonicalVehicleExamples.ts`.

## Record Envelope

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `schemaVersion` | `"1.0.0"` | Yes | Identifies the exact CVR contract. |
| `recordId` | `string` | Yes | Stable canonical identifier; never derived from array position. |
| `recordScope` | `model_year \| configuration \| listing \| vin` | Yes | States how specifically the record applies. |
| `recordStatus` | `example \| draft \| validated \| recommendation_ready` | Yes | Declares lifecycle state without implying recommendation quality. |
| `createdAt` | ISO 8601 string | Yes | First canonical creation time. |
| `updatedAt` | ISO 8601 string | Yes | Last canonical mutation time. |
| `evidence` | `CanonicalEvidence[]` | Yes | Record-level evidence registry referenced by each field. |
| Twelve ontology sections | Typed section objects | Yes | Every section and every field is structurally present, even when its value is missing. |

`recordStatus = recommendation_ready` does not mean the vehicle is a good match. It means the record has passed the approved structural and data-readiness checks for the concepts a consumer intends to use.

## Canonical Datum

Every ontology field uses:

```ts
type CanonicalDatum<T, Unit extends CanonicalUnit> = {
  value: T | null;
  unit: Unit;
  status: "verified" | "sourced" | "estimated" | "derived" | "missing";
  confidence: CanonicalConfidence;
  evidenceIds: string[];
  estimated: boolean;
  estimationMethod: string | null;
  asOfDate: string | null;
  measurementContext: Record<string, string | number | boolean> | null;
  missingReason: CanonicalMissingReason | null;
};
```

This wrapper prevents a plain number from losing its units, provenance, date, estimation status, or uncertainty.

Table abbreviations:

- **Y:** supported directly.
- **P:** supported only through a coarse aggregate, proxy, or future consumer rule.
- **N:** not currently permitted.
- **Draft:** the value may be null in draft records but is required before a validated identity may be treated as recommendation-ready.
- **Field:** confidence is stored in the field's `CanonicalConfidence`.
- **Evidence:** source is one or more IDs from the record's `evidence` registry.

## 1. Identity

Consumers:

- **BuyerProfile:** make, body style, category, drivetrain, transmission, fuel type, minimum year, maximum mileage, and future model or trim requirements.
- **Recommendation categories:** practicality, driving preference fit, reliability, safety, fuel and energy cost, affordability.
- **Explanation categories:** vehicle identity, hard requirements, preference satisfaction, age, mileage, and condition.
- **Expected datasets:** OEM specifications, NHTSA vPIC, EPA identity data, licensed listings, vehicle-history and inspection sources.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `make` | `string` | none | Draft | Field: direct identity | Evidence | No | P | Y | Y | OEM, NHTSA, listings |
| `model` | `string` | none | Draft | Field: direct identity | Evidence | No | N | N | Y | OEM, NHTSA, listings |
| `generation` | `string` | none | Yes | Field: configuration specificity | Evidence | No | N | N | N | OEM, platform databases |
| `trim` | `string` | none | Yes | Field: configuration specificity | Evidence | No | N | N | N | OEM build data, listings |
| `modelYear` | `number` | year | Draft | Field: direct identity | Evidence | No | P | Y | Y | OEM, NHTSA, listings |
| `bodyStyle` | `CanonicalBodyStyle` | none | Yes | Field: direct or normalized | Evidence | Only when normalization is documented | Y | Y | Y | OEM, NHTSA, listings |
| `vehicleCategory` | `CanonicalVehicleCategory` | none | Yes | Field: direct or proxy | Evidence | Yes | P | P | P | EPA, OEM, NHTSA |
| `drivetrain` | `CanonicalDrivetrain` | none | Yes | Field: configuration-specific | Evidence | No | Y | Y | Y | OEM, EPA, listings |
| `transmission` | `CanonicalTransmission` | none | Yes | Field: configuration-specific | Evidence | No | Y | Y | Y | OEM, EPA, listings |
| `fuelType` | `CanonicalFuelType` | none | Yes | Field: configuration-specific | Evidence | No | Y | Y | Y | EPA, OEM, listings |
| `odometerMileage` | `number` | miles | Yes | Field: listing or vehicle-specific | Evidence | No | Y | Y | Y | listings, inspections, history |
| `condition` | `number` | score 0-100 | Yes | Field: inspection methodology | Evidence | Yes | P | N | P | inspections, condition reports |

## 2. Financial

Consumers:

- **BuyerProfile:** purchase budget, monthly budget, financing terms, insurance budget, annual mileage, fuel price, maintenance tolerance, and resale priority.
- **Recommendation categories:** affordability, insurance cost, maintenance risk, fuel and energy cost, resale value.
- **Explanation categories:** price, payment, monthly ownership, first-year ownership, headroom, and estimate disclosure.
- **Expected datasets:** licensed listings and transactions, insurer or claims data, repair and warranty data, fuel and electricity prices, auction and resale histories.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `purchasePrice` | `number` | USD | Yes | Field: listing/transaction date | Evidence | No for observed value | Y | Y | Y | listings, transactions |
| `monthlyPayment` | `number` | USD/month | Yes | Field: complete finance inputs | Evidence | Yes, derived | Y | Y | Y | derived from price and user terms |
| `totalOwnershipCost` | `number` | USD/month | Yes | Field: component completeness | Evidence | Yes, derived | Y | N | Y | ownership components, derived |
| `maintenanceCost` | `number` | USD/month | Yes | Field: population and configuration fit | Evidence | Yes | Y | N | Y | repair, warranty, service data |
| `insuranceCost` | `number` | USD/month | Yes | Field: driver and market specificity | Evidence | Yes | Y | N | Y | licensed insurance data |
| `depreciation` | `number` | USD/year | Yes | Field: time horizon and market | Evidence | Yes | Y | N | Y | transactions, auctions, listings |
| `resaleValue` | `number` | score 0-100 | Yes | Field: retention methodology | Evidence | Yes | Y | N | Y | transaction and auction histories |
| `fuelEnergyCost` | `number` | USD/month | Yes | Field: mileage, efficiency, and price inputs | Evidence | Yes, derived | Y | N | Y | EPA, fuel prices, charging tariffs |

## 3. Safety

Consumers:

- **BuyerProfile:** safety priority, safety minimum, advanced-feature preference, and future safety sub-priorities.
- **Recommendation categories:** safety.
- **Explanation categories:** crash protection, avoidance capability, equipment availability, missing test evidence, and safety confidence.
- **Expected datasets:** NHTSA NCAP, IIHS, OEM equipment, recalls, crash-avoidance tests, and licensed claims data.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `crashSafety` | `number` | score 0-100 | Yes | Field: test coverage and configuration | Evidence | Yes, normalized | P | P | P | NHTSA, IIHS, claims |
| `activeSafety` | `number` | score 0-100 | Yes | Field: avoidance-test coverage | Evidence | Yes, normalized | N | N | N | IIHS, NHTSA, OEM |
| `passiveSafety` | `number` | score 0-100 | Yes | Field: restraint/structure evidence | Evidence | Yes, normalized | N | N | N | NHTSA, IIHS, OEM |
| `driverAssistanceSafety` | `number` | score 0-100 | Yes | Field: verified equipment and test result | Evidence | Yes, normalized | P | N | P | IIHS, NHTSA, OEM |

## 4. Reliability

Consumers:

- **BuyerProfile:** reliability importance, reliability minimum, maintenance tolerance, long-term ownership, and repair aversion.
- **Recommendation categories:** reliability and maintenance risk.
- **Explanation categories:** expected dependability, repair exposure, known issues, and uncertainty.
- **Expected datasets:** warranty claims, repair orders, maintenance networks, NHTSA complaints and recalls, service bulletins, inspections, and documented owner surveys.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `longTermReliability` | `number` | score 0-100 | Yes | Field: sample and model-year specificity | Evidence | Yes, normalized | Y | Y | Y | warranty, repairs, surveys |
| `repairFrequency` | `number` | repairs/10k miles | Yes | Field: population size and exposure | Evidence | Yes | N | N | N | repair orders, warranty claims |
| `repairSeverity` | `number` | USD/repair | Yes | Field: labor market and issue mix | Evidence | Yes | N | N | N | repair and claims data |
| `knownIssues` | `CanonicalKnownIssue[]` | none | Yes | Field: affected scope and evidence quality | Evidence per issue | No for sourced issue | N | N | Y | recalls, complaints, bulletins, repairs |

## 5. Driving

Consumers:

- **BuyerProfile:** performance importance, performance minimum, drivetrain and transmission preferences, and future handling, towing, or terrain needs.
- **Recommendation categories:** driving preference fit and, where approved later, safety or practicality.
- **Explanation categories:** acceleration, control, braking, terrain capability, towing, and driving tradeoffs.
- **Expected datasets:** OEM specifications and tow guides, instrumented professional testing, tire and chassis data, and configuration-level reviews.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `acceleration` | `number` | score 0-100 | Yes | Field: test condition and configuration | Evidence | Yes, normalized | P | P | P | OEM, instrumented reviews |
| `handling` | `number` | score 0-100 | Yes | Field: test methodology | Evidence | Yes, normalized | P | P | P | instrumented reviews |
| `steering` | `number` | score 0-100 | Yes | Field: structured review methodology | Evidence | Yes, normalized | N | N | N | reviews, instrumented tests |
| `rideControl` | `number` | score 0-100 | Yes | Field: structured review methodology | Evidence | Yes, normalized | N | N | N | reviews, instrumented tests |
| `braking` | `number` | score 0-100 | Yes | Field: stopping-test condition | Evidence | Yes, normalized | N | N | N | instrumented tests, safety tests |
| `offRoadCapability` | `number` | score 0-100 | Yes | Field: terrain and equipment specificity | Evidence | Yes, normalized | P | N | P | OEM, terrain tests, reviews |
| `towingCapacity` | `number` | pounds | Yes | Field: exact configuration | Evidence | No for rated value | N | N | N | OEM tow guides, VIN build data |

## 6. Comfort

Consumers:

- **BuyerProfile:** currently preserved comfort and quietness context; future seat, ride, noise, and climate preferences.
- **Recommendation categories:** none today; future comfort category or approved driving/practicality sub-contributions.
- **Explanation categories:** daily comfort, highway comfort, noise, ride, and climate equipment.
- **Expected datasets:** structured professional reviews, instrumented noise and ride testing, OEM seating/HVAC equipment, and documented surveys.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `seatComfort` | `number` | score 0-100 | Yes | Field: occupant and duration context | Evidence | Yes, normalized | N | N | N | reviews, surveys, OEM |
| `suspensionComfort` | `number` | score 0-100 | Yes | Field: road and test methodology | Evidence | Yes, normalized | N | N | N | reviews, instrumented tests |
| `cabinNoise` | `number` | dBA | Yes | Field: speed, surface, and measurement method | Evidence | No for measured value | N | N | N | instrumented reviews |
| `rideSmoothness` | `number` | score 0-100 | Yes | Field: structured methodology | Evidence | Yes, normalized | N | N | N | reviews, surveys |
| `climateComfort` | `number` | score 0-100 | Yes | Field: equipment and climate test | Evidence | Yes, normalized | N | N | N | OEM, reviews, climate tests |

## 7. Technology

Consumers:

- **BuyerProfile:** advanced-feature importance and future required or preferred equipment.
- **Recommendation categories:** coarse driving-preference fit today; future technology category.
- **Explanation categories:** verified features, missing equipment, usability, software support, and charging compatibility.
- **Expected datasets:** OEM equipment lists and build sheets, trim data, IIHS/NHTSA assistance data, professional reviews, software release histories, and charging standards.

`CanonicalTechnologyAssessment` stores a normalized score plus explicit verified, unavailable, and unknown feature lists. A score never proves that a named feature exists.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `infotainment` | `CanonicalTechnologyAssessment` | none | Yes | Field: trim-specific equipment and review | Evidence | Score may be normalized | P | N | P | OEM, trim data, reviews |
| `smartphoneIntegration` | `CanonicalTechnologyAssessment` | none | Yes | Field: trim-specific equipment | Evidence | Score may be normalized | N | N | N | OEM, trim data |
| `navigation` | `CanonicalTechnologyAssessment` | none | Yes | Field: trim-specific equipment | Evidence | Score may be normalized | N | N | N | OEM, trim data |
| `driverAssistanceTechnology` | `CanonicalTechnologyAssessment` | none | Yes | Field: trim-specific verified features | Evidence | Score may be normalized | P | N | P | OEM, IIHS, NHTSA |
| `softwareExperience` | `CanonicalTechnologyAssessment` | none | Yes | Field: version and support period | Evidence | Score may be normalized | N | N | N | OEM releases, reviews |
| `chargingTechnology` | `CanonicalTechnologyAssessment` | none | Yes | Field: exact powertrain/configuration | Evidence | Score may be normalized | N | N | N | OEM, EPA, charging networks |

## 8. Practicality

Consumers:

- **BuyerProfile:** cargo need, family size, body style, climate, and future parking, visibility, or flexibility preferences.
- **Recommendation categories:** practicality.
- **Explanation categories:** cargo, seating, passenger space, parking, visibility, storage, and configuration flexibility.
- **Expected datasets:** OEM dimensions and seating configurations, measured reviews, cargo tests, turning-circle and footprint specifications, and visibility evaluations.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cargoCapacity` | `number` | cubic feet | Yes | Field: seat configuration and method | Evidence | No for measured/rated value | Y | N | Y | OEM dimensions, measured reviews |
| `passengerRoom` | `number` | score 0-100 | Yes | Field: row and occupant context | Evidence | Yes, normalized | Y | Y through seating data | Y | OEM dimensions, reviews |
| `parkingEase` | `number` | score 0-100 | Yes | Field: dimensions, turning circle, visibility | Evidence | Yes, derived | N | N | N | OEM dimensions, reviews |
| `outwardVisibility` | `number` | score 0-100 | Yes | Field: structured visibility method | Evidence | Yes, normalized | N | N | N | visibility evaluations, reviews |
| `storageUtility` | `number` | score 0-100 | Yes | Field: structured interior review | Evidence | Yes, normalized | P | N | P | OEM, reviews |
| `interiorFlexibility` | `number` | score 0-100 | Yes | Field: verified seat/configuration data | Evidence | Yes, normalized | P | N | P | OEM, reviews |

## 9. Environment

Consumers:

- **BuyerProfile:** fuel type, minimum efficiency, fuel-economy importance, annual mileage, energy-price sensitivity, and future range or charging needs.
- **Recommendation categories:** fuel and energy cost.
- **Explanation categories:** efficiency, operating energy cost, emissions boundary, EV range, and charging.
- **Expected datasets:** EPA/FuelEconomy.gov, OEM specifications, instrumented range/charging tests, charging-network data, and regional energy prices.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fuelEconomy` | `number` | MPG, MPGe, or kWh/100 mi | Yes | Field: cycle and energy mode | Evidence | No for official value | Y | P | Y | EPA, OEM |
| `emissions` | `number` | gCO2e/mile | Yes | Field: lifecycle boundary and energy mix | Evidence | Yes, derived | N | N | N | EPA, lifecycle data |
| `evRange` | `number` | miles | Yes | Field: test cycle and battery/configuration | Evidence | No for rated value | N | N | N | EPA, OEM, range tests |
| `chargingSpeed` | `number` | kW | Yes | Field: AC/DC mode and charge window | Evidence | No for measured/rated value | N | N | N | OEM, charging tests/networks |

## 10. Image

Consumers:

- **BuyerProfile:** preserved luxury, styling, status, ruggedness, sportiness, and understated-image intent; no current score destination.
- **Recommendation categories:** none today.
- **Explanation categories:** future user-perception fit only; never objective capability.
- **Expected datasets:** transparent, market-specific surveys, documented expert labels, and validated image-analysis outputs.

Every image field requires `measurementContext` identifying market, population, date, and method. Make and price alone are forbidden estimation inputs.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `luxuryPerception` | `number` | score 0-100 | Yes | Field: perception sample and market | Evidence | Yes, normalized | N | N | N | surveys, expert labels |
| `sportyImage` | `number` | score 0-100 | Yes | Field: perception sample and market | Evidence | Yes, normalized | N | N | N | surveys, expert labels |
| `ruggedImage` | `number` | score 0-100 | Yes | Field: perception sample and market | Evidence | Yes, normalized | N | N | N | surveys, expert labels |
| `premiumImage` | `number` | score 0-100 | Yes | Field: perception sample and market | Evidence | Yes, normalized | N | N | N | surveys, expert labels |
| `understatedImage` | `number` | score 0-100 | Yes | Field: perception sample and market | Evidence | Yes, normalized | N | N | N | surveys, expert labels |

## 11. Lifestyle

Consumers:

- **BuyerProfile:** practical goals, emotional goals, climate, cargo, seating, mileage, budget, and future use-case preferences.
- **Recommendation categories:** only underlying current categories may participate today; lifestyle fields are not current scoring inputs.
- **Explanation categories:** transparent composite fit with named contributing evidence and missing concepts.
- **Expected datasets:** the underlying financial, safety, reliability, driving, comfort, practicality, environment, and image datasets.

Lifestyle values must be derived from ontology fields. They cannot be imported as unexplained universal labels.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `collegeStudentFit` | `number` | score 0-100 | Yes | Field: component coverage and user context | Evidence for components | Yes, derived | P | N | P | financial, reliability, practicality |
| `familyFit` | `number` | score 0-100 | Yes | Field: component coverage and family context | Evidence for components | Yes, derived | P | P | P | safety, dimensions, practicality |
| `campingFit` | `number` | score 0-100 | Yes | Field: clarified use and component coverage | Evidence for components | Yes, derived | N | N | N | cargo, off-road, towing, range |
| `petFit` | `number` | score 0-100 | Yes | Field: pet size/use and component coverage | Evidence for components | Yes, derived | N | N | N | dimensions, access, climate |
| `commutingFit` | `number` | score 0-100 | Yes | Field: user mileage and component coverage | Evidence for components | Yes, derived | P | N | P | efficiency, comfort, reliability |
| `snowFit` | `number` | score 0-100 | Yes | Field: climate, tires, traction, and range | Evidence for components | Yes, derived | P | P | P | OEM, tires, cold-weather tests |
| `roadTripFit` | `number` | score 0-100 | Yes | Field: trip context and component coverage | Evidence for components | Yes, derived | P | N | P | range, comfort, reliability, cargo |
| `cityFit` | `number` | score 0-100 | Yes | Field: city context and component coverage | Evidence for components | Yes, derived | P | N | P | dimensions, efficiency, visibility |
| `businessFit` | `number` | score 0-100 | Yes | Field: business context and component coverage | Evidence for components | Yes, derived | N | N | N | comfort, image, reliability, cost |

## 12. Confidence

Consumers:

- **BuyerProfile:** none. Confidence is evidence about the recommendation, not a user preference.
- **Recommendation categories:** none. Confidence must never raise match score.
- **Explanation categories:** recommendation confidence, data quality, missing information, evidence limitations, and source conflicts.
- **Expected datasets:** metadata from every ingested source, validation results, field completeness, methodology records, and multi-source resolution.

| Field | Type | Unit | Null? | Confidence | Source | Estimated? | Score | Filter | Explain | Future sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dataQuality` | `number` | score 0-100 | Yes | Field: completeness, freshness, provenance | Evidence plus validation | Yes, derived | N | N | Y | every normalized source |
| `evidenceQuality` | `number` | score 0-100 | Yes | Field: authority, method, and specificity | Evidence metadata | Yes, derived | N | N | P | source methodology metadata |
| `sourceAgreement` | `number` | score 0-100 | Yes | Field: independent-source comparison | Evidence graph | Yes, derived | N | N | N | multi-source normalized evidence |

## Fully Populated Example

`fullyPopulatedPriusRecord` in `data/canonicalVehicleExamples.ts` is an illustrative 2021 Toyota Prius Prime LE configuration. It populates every CVR field to demonstrate:

- field-level units and confidence;
- direct, estimated, and derived statuses;
- evidence references;
- measurement context;
- technology feature evidence;
- known-issue structure;
- lifestyle composites;
- record-level confidence.

The example uses `sourceType = example_fixture`. Its values are not production facts, are not imported data, and must never enter the recommendation catalog.

## Partially Known Example

`partiallyKnownVehicleRecord` represents a sparse example listing with make, model, year, body style, fuel type, mileage, and price. Every other field remains structurally present with:

- `value: null`;
- `status: "missing"`;
- no evidence IDs;
- `estimated: false`;
- a typed `missingReason`.

The example proves that a sparse source does not inherit reliability, safety, drivetrain, ownership, feature, or image values from a default vehicle.

## Missing-Data Rules

1. Every field object must exist, even when `value` is `null`.
2. A null value must use `status = "missing"`.
3. A missing field must have an empty `evidenceIds` array.
4. A missing field must set `estimated = false` and `estimationMethod = null`.
5. A missing field must identify one reason:
   - `not_collected`
   - `not_available`
   - `not_applicable`
   - `source_conflict`
   - `insufficient_specificity`
   - `stale`
   - `invalid`
   - `unsupported`
6. Zero is a real value, not a missing-value sentinel.
7. An empty list is a known empty result only when evidence proves the list is complete. Otherwise the list is missing.
8. `not_applicable` must not be scored as zero. For example, charging speed for a gasoline vehicle is missing/not applicable, not poor charging performance.
9. Missing fields must not receive an average, neutral, brand-level, or model-family default.
10. Recommendation readiness must be evaluated by the consumer against the concepts it uses. The CVR does not fabricate readiness.
11. Missing high-impact fields must lower data-quality confidence and appear in explanation warnings.
12. A source conflict remains missing with `source_conflict` until a deterministic resolver selects evidence and records why.

## Confidence Rules

`CanonicalConfidence.score` ranges from 0 to 1 or is `null` when confidence cannot be assessed.

Levels:

- `high`: score at least `0.80`
- `medium`: score at least `0.55` and below `0.80`
- `low`: score below `0.55`
- `unknown`: score is `null`

Rules:

1. Confidence is field-specific. Record confidence cannot replace field confidence.
2. Confidence considers source authority, scope specificity, freshness, methodology, completeness, and agreement.
3. VIN or exact-configuration evidence may outrank model-year evidence only for configuration-sensitive fields.
4. A newer weak source does not automatically outrank an older authoritative source.
5. Estimated and derived fields must include the method and confidence of every material input.
6. Derived confidence cannot exceed the weakest indispensable input without a documented statistical reason.
7. Multiple copies of the same upstream source count as one independent source.
8. Conflicting sources lower agreement and must remain visible.
9. Subjective perception and lifestyle confidence must include population and context.
10. Data quality, evidence quality, and source agreement never increase match score.

## Normalization Rules

### Identity

- Preserve source evidence exactly, then normalize display values separately.
- Resolve make and model aliases through canonical registries.
- Validate make/model/year/generation/trim compatibility.
- Never infer trim from price, image, or marketing language.
- Keep body style and vehicle category separate.
- Normalize AWD and 4WD as distinct values; equivalence is a later qualification policy.
- Normalize plug-in hybrid separately from non-plug-in hybrid.

### Numbers and units

- Store money in USD with the period encoded in the unit.
- Store distance in miles and towing in pounds for schema version 1.0.
- Store confidence and normalized assessments on explicit 0-100 or 0-1 scales.
- Preserve raw source values in evidence or ingestion logs when conversion occurs.
- Record measurement conditions for values such as cabin noise, range, charging, and emissions.
- Reject NaN, infinity, negative mileage, negative price, and out-of-range normalized scores.

### Scope

- A listing-specific value must not overwrite a model-year fact globally.
- A trim-specific feature must not be promoted to every trim.
- A generation-level known issue must identify affected years and configurations.
- A population estimate must remain labeled as population evidence.
- Record identity resolution must occur before evidence merging.

### Status

- `verified`: independently checked against an authoritative or inspection-level source.
- `sourced`: directly reported by a source but not independently verified.
- `estimated`: inferred statistically or heuristically from evidence.
- `derived`: calculated deterministically from other canonical values.
- `missing`: no usable canonical value exists.

`estimated` must be true only when status is `estimated`. Derived values use status `derived`, keep their method, and set `estimated = false`.

## Future Ingestion Contract

All adapters implement:

```ts
interface CanonicalVehicleIngestionAdapter<SourceRecord> {
  readonly sourceType: CanonicalSourceType;
  normalize(
    sourceRecords: readonly SourceRecord[],
    context: CanonicalIngestionContext,
  ): Promise<CanonicalIngestionResult>;
}
```

An adapter must:

1. Accept its raw source type only inside the adapter boundary.
2. Create evidence entries before assigning field values.
3. Emit complete CVR structures with explicit missing data.
4. Normalize units, enums, dates, and identity.
5. Attach every non-missing field to at least one evidence ID.
6. Mark estimates and derivations with their methods.
7. Emit structured validation issues rather than silently dropping conflicts.
8. Reject source records that cannot establish a stable canonical identity.
9. Never select, rank, or recommend a vehicle.
10. Never assign BuyerProfile values.
11. Never invent a score for an ontology-only concept.
12. Preserve source licensing and methodology metadata.

`CanonicalIngestionResult` contains normalized records, rejected source IDs, and typed warning or error issues. Ingestion success does not imply recommendation readiness.

## Source Resolution Rules

When multiple sources populate one field:

1. Match evidence scope to record scope.
2. Prefer exact configuration or VIN evidence for configuration-sensitive facts.
3. Prefer authoritative measured data over inferred data.
4. Prefer direct transaction or listing evidence for date-specific price and mileage.
5. Compare dates only after authority and scope are considered.
6. Preserve losing evidence rather than deleting it.
7. Record agreement as `single_source`, `agrees`, `mixed`, or `conflicts`.
8. If conflict cannot be resolved deterministically, set the field to missing with `source_conflict`.

## Validation Requirements

A future runtime validator must check:

- schema version and complete section shape;
- all 73 canonical field paths;
- datum status/null consistency;
- unit compatibility by field;
- confidence range and level consistency;
- evidence-reference integrity;
- estimation method requirements;
- ISO dates and freshness;
- canonical enum values;
- realistic numeric ranges;
- identity and configuration compatibility;
- scope-safe evidence merging;
- duplicate record IDs;
- forbidden recommendation or BuyerProfile fields in source adapters.

Phase 3.2B supplies the types and examples. It does not add the future runtime validator or change current vehicle validation.

## Migration Boundary

The current application still has a legacy `Vehicle` type and catalog used by the recommendation engine. That behavior is intentionally unchanged in this phase.

The approved future migration sequence is:

1. Add source adapters that output CVR only.
2. Add CVR runtime validation and evidence resolution.
3. Create a tested migration for existing normalized records.
4. Update recommendation consumers to read approved CVR concepts.
5. Remove direct dependencies on source overlays and the legacy vehicle shape.
6. Change scoring only in a separately approved phase.

Until that migration is complete, the CVR is the authoritative future contract but is not yet a recommendation-engine input.
