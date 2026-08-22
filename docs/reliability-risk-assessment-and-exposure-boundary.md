# Reliability Risk Assessment and Exposure Boundary

## Purpose

The reliability risk assessment answers one limited question: **what reliability concerns does the available defect evidence support for this model year?** It does not grade overall reliability and does not compare one vehicle with another.

The current flow is:

```text
NHTSA recalls and complaints
  -> ReliabilityInterpretation
  -> ReliabilityRiskAssessment
  -> future buyer-specific reasoning (not connected)
```

The assessment is deterministic. The same interpretation, vehicle identity, and exposure-provider result produce the same structured assessment ID, concern level, primary concerns, limitations, and explanation facts.

## Defect Evidence Is Not Comparative Reliability

NHTSA complaint and recall records are useful negative evidence, but raw record counts are not failure rates. Counts vary with vehicle population, age, mileage, geography, reporting behavior, and source coverage. A model with more complaints may simply have more vehicles on the road.

For that reason, every current assessment sets:

- `comparativeReliabilitySupported: false`
- `recommendationScoringEligible: false`
- `reliabilityScore: null`
- `comparativeRank: null`
- `productionRecommendationConnected: false`

The assessment preserves raw evidence and identifies concern themes without claiming that a vehicle is more or less reliable than another.

## Concern Levels

| Level | Deterministic rule | Meaning |
| --- | --- | --- |
| `INSUFFICIENT_EVIDENCE` | No defect evidence, or the interpretation is insufficient | There is not enough evidence to characterize a concern. |
| `NO_MEANINGFUL_SIGNAL` | Evidence exists, but no decision-relevant component cluster meets the recurrence, official-record, or serious-signal criteria | The evidence set does not support a meaningful concern. This does not mean perfect reliability. |
| `LIMITED_CONCERN` | A decision-relevant cluster exists without corroboration and without the combination of recurrence and serious signals | A limited negative signal exists, but evidence strength is restricted. |
| `MEANINGFUL_CONCERN` | A component pattern is corroborated, or a repeated decision-relevant cluster includes serious signals | Evidence supports a meaningful concern at model-year scope. |
| `ELEVATED_CONCERN` | The prior interpretation contains a corroborated critical signal and is `STRONG_NEGATIVE_SIGNAL` | Strong negative evidence warrants elevated concern. |

Complaint count alone never creates `ELEVATED_CONCERN`. The policy considers component recurrence, independent corroboration, severity, applicability, and interpretation confidence.

## Primary Concern Selection

The assessment retains every issue cluster but surfaces at most three primary concerns. `unknown_other` is not eligible as a primary concern because it is not decision-specific.

Selection order is deterministic:

1. corroborated component clusters
2. clusters with stronger preserved severity signals
3. fixed decision relevance of the component
4. canonical component name as a stable tie-breaker

The fixed component order prioritizes engine, transmission, powertrain, brakes, steering, fuel system, EV battery system, electrical, suspension, airbags, structure, and climate. Raw complaint count is deliberately not a sorting input after the minimum recurrence test.

## Corroboration, Severity, and Applicability

Corroboration comes directly from `ReliabilityInterpretation`. Complaint recurrence plus a recall or investigation is stronger than repeated allegations alone. Component overlap does not prove a shared mechanical root cause.

Severity facts preserve explicit source indicators: crash, fire, injury, death, park-it, and park-outside. They do not infer severity from narrative sentiment.

Current evidence applies at `model_year` scope. It does not establish trim, engine, drivetrain, configuration, VIN, or individual used-vehicle condition. Assessment applicability remains configuration-specific `false` and VIN-specific `false`.

## Structured Explanation Facts

`ReliabilityRiskAssessment.explanationFacts` contains traceable facts rather than user-interface prose:

- recurring component pattern
- complaint pattern corroborated by recall evidence
- serious signal present
- model-year applicability
- exposure rate unavailable
- complaints remain allegations
- no meaningful signal is not perfect reliability

Facts retain source evidence IDs whenever a source record supports the fact. A future advisor may translate these facts, but this phase does not connect them to production responses.

## Vehicle Exposure Provider Contract

`VehicleExposureProvider` is a vendor-independent asynchronous boundary. A future provider can return:

- registered vehicle count
- estimated vehicles in operation
- annual mileage mean and median
- lifetime mileage distribution
- sales volume
- geography and observation date
- source identity and retrieval date
- confidence and scope

The contract currently has two implementations:

- **unsupported provider**: the production default; returns unavailable exposure and prohibits rate claims
- **fixture provider**: synthetic test data only; requires `dataUse: "test"` and explicit `allowTestExposureProvider: true`

No commercial or live population provider is implemented.

## Exposure Semantics

Without a trusted denominator, raw complaint records remain visible but the system produces no complaint rate, per-1,000-vehicle rate, score, or comparison.

When a controlled fixture supplies an estimated vehicles-in-operation or registered-vehicle denominator, `ExposureNormalizedReliabilityEvidence` can calculate a descriptive complaint-record count per 1,000 vehicles. This calculation remains separate from raw evidence and still sets comparative support to `false` and reliability score to `null`. Methodology, cohort matching, mileage adjustment, reporting-bias adjustment, and source-quality review are required before cross-vehicle use.

## Golden Vehicle Examples

The golden-five evaluation covers:

- 2017 Hyundai Accent
- 2016 Toyota Prius
- 2016 Toyota RAV4
- 2016 Honda CR-V
- 2018 Nissan Leaf

The runner evaluates each vehicle independently and does not sort or rank them. Output includes primary concerns, corroboration, preserved severity counts, concern level, evidence confidence, applicability, exposure availability, and a key limitation. The retained report is development evidence, not production knowledge.

Observed results from the retained NHTSA evidence snapshot are:

| Vehicle | Primary concerns | Corroborated concerns | Preserved critical / serious signals | Concern | Confidence | Exposure |
| --- | --- | --- | --- | --- | --- | --- |
| 2017 Hyundai Accent | engine, brakes, electrical | none | 0 / 13 | `MEANINGFUL_CONCERN` | low | unavailable |
| 2016 Toyota Prius | brakes, electrical, airbags | brakes, electrical, airbags, EV battery system | 0 / 14 | `MEANINGFUL_CONCERN` | medium | unavailable |
| 2016 Toyota RAV4 | brakes, electrical, engine | brakes, electrical | 0 / 44 | `MEANINGFUL_CONCERN` | medium | unavailable |
| 2016 Honda CR-V | engine, fuel system, airbags | engine, fuel system, airbags | 0 / 50 | `MEANINGFUL_CONCERN` | medium | unavailable |
| 2018 Nissan Leaf | engine, powertrain, brakes | none | 0 / 12 | `MEANINGFUL_CONCERN` | low | unavailable |

These rows are not ordered by reliability and cannot be compared as rates. For every row, the key limitation is that the observed complaint records lack a trusted model-year population denominator.

## Future Recommendation Boundary

No application, recommendation, qualification, ranking, or advisor module imports this policy. Before recommendation integration, the project needs a trusted exposure source, cohort/configuration matching, mileage and age normalization, reporting-bias methodology, validation against independent reliability outcomes, and an approved buyer-specific policy.

The exact next step is to evaluate a trustworthy model-year vehicle-population or vehicles-in-operation provider behind `VehicleExposureProvider`, while keeping normalized evidence in shadow mode and validating methodology before creating any comparative score.
