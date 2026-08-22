# NHTSA Safety Intelligence

## Purpose and Boundary

Phase 3.3A adds official NHTSA Safety Ratings/NCAP evidence to the existing vehicle-knowledge architecture. It does not alter the immutable catalog, recommendation scoring, qualification, ranking, `RecommendationObject`, or `DecisionReport`.

```text
Published CVR identity
  -> NHTSA candidate discovery
  -> deterministic configuration match
  -> NHTSA VehicleId record
  -> CanonicalVehicleContribution
  -> VehicleKnowledgeClaim
  -> trust policy and repository
  -> compiler and publishing gate
  -> shadow CVR revision
  -> shadow readiness
```

Production recommendations remain disconnected from Published CVRs.

## Existing Safety Schema

The CVR currently has four aggregate 0-100 fields:

- `safety.crashSafety`
- `safety.activeSafety`
- `safety.passiveSafety`
- `safety.driverAssistanceSafety`

NHTSA's published `OverallRating` can map honestly to `crashSafety` through a documented `stars × 20` scale. The CVR has no lossless canonical destination for individual frontal, side, pole, barrier, and rollover components; rollover probability; equipment statuses; complaint/recall/investigation counts; or media.

No CVR schema field was added. Instead, all component details remain typed in `NhtsaSafetyRecord`, contribution `sourceMetadata`, evidence `sourceClaims`, and the crash claim's `measurementContext`. This preserves source meaning without pretending that component ratings are independent canonical scores. A future schema revision may promote these details after a scoring policy exists.

`activeSafety`, `passiveSafety`, and `driverAssistanceSafety` are deliberately not populated. Stability control, forward-collision warning, and lane-departure warning are equipment statuses, not normalized test scores.

## Official API Workflow

Candidate discovery:

```text
GET https://api.nhtsa.gov/SafetyRatings/modelyear/{year}/make/{make}/model/{model}?format=json
```

Detailed record:

```text
GET https://api.nhtsa.gov/SafetyRatings/VehicleId/{vehicleId}?format=json
```

Public client functions:

```ts
getSafetyRatingCandidates(year, make, model): Promise<NhtsaSafetyCandidate[]>
getSafetyRatingByVehicleId(vehicleId): Promise<NhtsaSafetyRecord>
```

The client validates inputs, enforces an eight-second timeout, distinguishes network/HTTP/JSON/shape failures, preserves zero values, and accepts the hyphenated component keys currently returned by the live API.

## Source States

- `RATED`: at least one usable NCAP star rating exists.
- `NOT_RATED`: an applicable vehicle exists and NHTSA explicitly reports Not Rated.
- `NO_MATCH`: no applicable candidate remains.
- `AMBIGUOUS_MATCH`: multiple candidates remain equally plausible.
- `SOURCE_FAILURE`: the official source could not be read or validated.

`NOT_RATED` creates evidence and a normalization warning, but no numeric claim. It never becomes zero, average, or poor safety. `AMBIGUOUS_MATCH` creates no contribution or trusted claim.

## Configuration Matching

Matching uses year, normalized make/model, drivetrain, electric powertrain markers, and body description where each is safely available. A conflicting known configuration is rejected. The remaining candidates are scored only by matching identity evidence; a unique best candidate may be selected. Equal candidates return `AMBIGUOUS_MATCH`.

The matcher does not select the first result. In the golden run it selected RAV4 FWD `10114` over AWD `10115`, and CR-V AWD `10170` over FWD `10171`.

Door tokens such as `4 DR` and `5 HB` are retained where unambiguous. Unknown description tokens are not interpreted.

## NCAP Components and Rollover

The typed record preserves overall, frontal overall, frontal driver/passenger, side overall, side driver/passenger, side pole, front/rear combined barrier-and-pole, overall side barrier, rollover rating, and rollover possibility.

`RolloverPossibility = 0.174` is retained as ratio `0.174` and measurement context `17.4%`. It is never interpreted as `0.174%`.

Only the source's overall star rating maps to `crashSafety`; no new aggregate is calculated from component ratings.

## Technology and Safety History

NHTSA technology values remain source terms such as `Standard`, `Optional`, and `No`. `Optional` is not treated as standard equipment, and no trim-level inference is made.

`ComplaintsCount`, `RecallsCount`, and `InvestigationCount` remain separate source metadata. They do not alter the crash rating, trust score, publication score, or recommendation score. Media URLs remain evidence metadata.

## Authority and Trust

The existing field-aware trust policy already assigns NHTSA authority `96` for canonical safety fields. NHTSA retains only `55` authority for reliability and `25` for financial/environmental fields, so NCAP evidence cannot cross those boundaries.

Each exact rated configuration produced one `safety.crashSafety` claim with direct official evidence and trust score `84` (`TRUSTED`). Claims were approved without fabricating a human review record; the deterministic exact-match and trust reason is retained in repository history.

## Golden Live Results

The controlled run occurred at `2026-08-17T05:37:17.889Z`.

| Vehicle | NHTSA ID | State | Overall/front/side/rollover | Rollover ratio | Claim | Baseline |
|---|---:|---|---|---:|---|---|
| 2017 Hyundai Accent | 11111 | RATED | 4 / 4 / 4 / 4 | 0.124 | crashSafety 80 | Exact |
| 2016 Toyota Prius | 10111 | RATED | 5 / 4 / 5 / 4 | 0.107 | crashSafety 100 | Exact |
| 2016 Toyota RAV4 FWD | 10114 | RATED | 5 / 4 / 5 / 4 | 0.174 | crashSafety 100 | Exact |
| 2016 Honda CR-V AWD | 10170 | RATED | 5 / 5 / 5 / 4 | 0.174 | crashSafety 100 | Exact |
| 2018 Nissan Leaf | 12789 | NOT_RATED | none | source returned 0 placeholder | none | Exact |

Every live value matched the supplied manual baseline. The retained live report includes all component, technology, history, media, contribution, evidence, claim, publication, and readiness details.

## CVR Revisions

| Vehicle | Previous | Active | Result |
|---|---|---|---|
| Accent | v1 `17cb0qz` | v2 `8vxpy6` | safety claim published |
| Prius | v1 `gw6fjs` | v2 `10ed0i` | safety claim published |
| RAV4 | v1 `1rqusio` | v2 `1aylaax` | safety claim published |
| CR-V | v1 `130uj4s` | v2 `fnlugm` | safety claim published |
| Leaf | v1 `4iksm1` | v1 `4iksm1` | no numeric change; v2 skipped |

All v1 records remain retained as history. The four meaningful revisions passed the existing publishing gate with score 90. Leaf's Not Rated evidence remains in the controlled report; it did not create a meaningless publication version.

## Shadow Readiness Impact

For Profile A, safety and reliability have equal weight.

| Vehicle group | Safety field coverage | Reliability coverage | Combined coverage | Readiness |
|---|---:|---:|---:|---|
| Accent, Prius, RAV4, CR-V before | 0% | 0% | 0% | INSUFFICIENT |
| Accent, Prius, RAV4, CR-V after | 25% | 0% | 12% | INSUFFICIENT |
| Leaf before and after | 0% | 0% | 0% | INSUFFICIENT |

Safety coverage is 25% because one of the four canonical safety fields is supported. Reliability remains completely unsupported. NHTSA NCAP therefore improves evidence coverage without making Profile A recommendation-ready.

## Future Integration

Do not create a production safety score yet. The next safety phase should define a reviewed canonical component schema and evidence-aware safety policy, potentially combining NCAP with IIHS while preserving program/version/configuration differences. Reliability should be acquired through a separate repair/warranty source pipeline rather than inferred from NHTSA ratings or complaint counts.
