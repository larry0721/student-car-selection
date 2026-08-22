# Reliability Evidence Interpretation Policy

## Purpose

This policy converts an immutable `VehicleReliabilityEvidenceSnapshot` into a structured `ReliabilityInterpretation`. It describes the strength and limits of observed defect evidence. It does not determine whether a vehicle is reliable, create a 0-100 score, compare vehicles, or affect recommendations.

```text
NHTSA source records
  -> VehicleReliabilityEvidenceSnapshot
  -> Reliability Evidence Interpretation Policy
  -> ReliabilityInterpretation
  -> future reviewed assessment/scoring boundary
```

The policy never rewrites the source snapshot. Every cluster and severity signal retains the original NHTSA evidence IDs and canonical lineage.

## What the evidence means

- A recall is an official NHTSA campaign record for the queried model-year identity.
- A complaint is an allegation received by NHTSA, not a verified mechanical failure.
- Repeated complaints indicate repeated allegations in a component category; they do not establish a shared root cause.
- A complaint pattern and recall in the same specific component category provide stronger corroboration than complaint repetition alone.
- Raw counts remain exposure-unadjusted and cannot be used as comparative reliability rankings.

## Interpretation contract

`ReliabilityInterpretation` contains:

- vehicle and source-snapshot identity;
- model-year applicability;
- evidence availability;
- component issue clusters;
- explicit severity signals;
- corroboration state;
- exposure context;
- applicability confidence;
- interpretation confidence;
- assessment state;
- limitations;
- `reliabilityScore: null`;
- `comparativeRank: null`;
- `productionRecommendationConnected: false`.

## Issue clustering

Events are grouped by the normalized component categories created in Phase 3.3B-2. A record may contribute to more than one component when the source explicitly names multiple systems.

Each cluster retains:

- complaint, recall, investigation, and manufacturer-communication counts;
- explicit serious-signal count;
- evidence IDs and evidence types;
- first and last usable source dates;
- corroboration and confidence;
- `sameDefectConfirmed: false`.

Clusters only establish component-level relatedness. The policy does not claim that two engine complaints, for example, describe the same engine defect.

`unknown_other` can show repeated allegations or an official record, but overlap within that ambiguous category cannot establish complaint/recall corroboration.

## Severity rules

Severity is classified without numerical weights.

| State | Deterministic requirement |
|---|---|
| `CRITICAL_SIGNAL` | Explicit reported death, or official stop-driving/park-it instruction |
| `SERIOUS_SIGNAL` | Explicit injury, fire, crash, or official park-outside instruction |
| `MATERIAL_SIGNAL` | Official recall without a critical or serious structured indicator |
| `LIMITED_SIGNAL` | Complaint allegation without a structured critical or serious indicator |
| `UNKNOWN` | No supported deterministic indicator |

Recall consequence text is preserved but not classified through keyword sentiment. Mechanical-loss claims such as loss of braking or propulsion will require a future reviewed text-evidence policy or structured source field before they affect severity.

## Corroboration rules

| State | Requirement |
|---|---|
| `NONE` | No relevant evidence |
| `ISOLATED_ALLEGATION` | One complaint without another evidence type |
| `REPEATED_ALLEGATIONS` | At least two complaints in a component category |
| `OFFICIAL_RECORD_ONLY` | Recall, investigation, or communication without a complaint pattern |
| `COMPLAINT_PATTERN_WITH_RECALL` | At least two complaints plus a recall in the same non-ambiguous component |
| `COMPLAINT_PATTERN_WITH_INVESTIGATION` | At least two complaints plus an investigation in the same component |
| `MULTIPLE_AUTHORITATIVE_EVIDENCE_TYPES` | At least two of recall, investigation, or manufacturer communication in a component |

Repetition alone is not proof. Complaint records keep `allegation: true` after corroboration.

## Exposure boundary

Every interpretation exposes:

- vehicle population: unavailable;
- sales volume: unavailable;
- mileage distribution: unavailable;
- reporting-behavior adjustment: unavailable;
- model-age proxy: derived from model year and snapshot year;
- complaint rate: unavailable.

Current exposure state is `PARTIAL`: model age is known, but no denominator exists. The policy can say, for example, “234 complaints observed; exposure-adjusted complaint rate unavailable.” It cannot say that 234 reports imply worse reliability than 68 reports.

## Applicability

The NHTSA clients query year, make, and model. Interpretation scope remains `model_year` with medium applicability confidence when evidence exists. It is never promoted to trim, engine, drivetrain, configuration, or VIN scope.

## Assessment-state rules

| State | Deterministic requirement |
|---|---|
| `INSUFFICIENT_EVIDENCE` | No defect events available |
| `EVIDENCE_AVAILABLE` | Events exist without a repeated specific-component pattern |
| `POTENTIAL_PATTERN` | Repeated complaint allegations exist in a non-ambiguous component |
| `CORROBORATED_PATTERN` | Complaint pattern has component-level recall, investigation, or multiple-authority corroboration |
| `STRONG_NEGATIVE_SIGNAL` | A critical explicit signal appears inside a corroborated component pattern |

A high complaint count alone can never create `STRONG_NEGATIVE_SIGNAL`. Missing evidence or unrelated `NOT_RATED` safety context remains `INSUFFICIENT_EVIDENCE`, not a negative reliability conclusion.

## Confidence semantics

Confidence describes confidence in the interpretation, not vehicle quality.

- `UNKNOWN`: no interpretable evidence.
- `LOW`: records or repeated allegations exist without corroboration.
- `MEDIUM`: a specific component pattern is corroborated and model-year applicability is established.
- `HIGH`: reserved for future interpretations with stronger applicability, exposure, and source completeness.

Current confidence also records source diversity, applicability, exposure state, corroboration, and evidence completeness. Unsupported investigation and manufacturer-communication acquisition prevents current golden interpretations from reaching `HIGH`.

## Golden experiment

The experiment used the retained NHTSA evidence snapshot collected at `2026-08-17T06:07:20.276Z`. Vehicles remain in fixed golden-set order; this table is not a ranking.

| Vehicle | Evidence | Main clusters | Serious signals | Corroboration | Exposure | Assessment | Confidence |
|---|---:|---|---:|---|---|---|---|
| 2017 Hyundai Accent | 68 | engine 24 complaints; airbags 21 | 13 | Repeated allegations | Partial | Potential pattern | Low |
| 2016 Toyota Prius | 184 | electrical 26 complaints + 1 recall; brakes 24 + 1 | 14 | Complaint pattern + recall | Partial | Corroborated pattern | Medium |
| 2016 Toyota RAV4 | 237 | electrical 56 complaints + 1 recall; brakes 45 + 1 | 44 | Complaint pattern + recall | Partial | Corroborated pattern | Medium |
| 2016 Honda CR-V | 392 | engine 101 complaints + 1 recall; fuel system 72 + 1 | 50 | Complaint pattern + recall | Partial | Corroborated pattern | Medium |
| 2018 Nissan Leaf | 70 | brakes 19 complaints; electrical 18 | 12 | Repeated allegations | Partial | Potential pattern | Low |

The Leaf has recalls and complaints in `unknown_other`, but ambiguous-category overlap is not accepted as corroboration.

## Limitations that must survive future integration

- Exposure denominator and complaint rate unavailable.
- Complaint allegations unverified.
- Configuration applicability uncertain.
- Investigation acquisition unavailable.
- Manufacturer-communication acquisition unavailable.
- Component clustering does not establish identical defects.
- Mileage is frequently unavailable.
- Source and reporting coverage are incomplete.

## Future boundary

The next phase may design a reviewed reliability assessment candidate using these interpretations plus exposure, repair, warranty, investigation, and manufacturer-communication evidence. It must define source sufficiency and buyer relevance before any numeric scoring or production recommendation integration occurs.
