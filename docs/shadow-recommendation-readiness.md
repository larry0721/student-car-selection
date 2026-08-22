# Shadow Recommendation Readiness

## Purpose

Shadow readiness asks whether a published Canonical Vehicle Record (CVR) has enough trusted, buyer-relevant evidence to support a decision. It does not score, rank, qualify, or recommend a vehicle in production.

This evaluation precedes CVR scoring integration because publication proves that a record is structurally and evidentially acceptable; it does not prove that every field needed by a particular buyer is present. Missing, stale, conflicted, and irrelevant knowledge must remain distinguishable before the recommendation engine can consume CVRs safely.

## Current Legacy Boundary

The current production path remains:

```text
BuyerProfile
  -> load immutable Vehicle catalog
  -> generate valid candidates
  -> apply mandatory and flexible constraints
  -> resolve effective scoring policy
  -> evaluate suitability categories
  -> rank qualified vehicles
  -> RecommendationObject
  -> DecisionReport
```

The legacy `Vehicle` record supplies price, mileage, MPG, insurance, maintenance estimate, reliability, safety, performance, cargo, resale, body style, drivetrain, transmission, fuel type, and related seed-catalog fields. Production code does not import the shadow evaluator or Published CVR Repository.

The future flow is conceptual only:

```text
BuyerProfile + Published CVR
  -> DecisionRelevance
  -> requirement evidence check
  -> supported decision dimensions
  -> future evidence-aware scoring
```

This phase implements only the first three steps and does not implement future evidence-aware scoring.

## Shadow API

`evaluateShadowRecommendationReadiness` accepts a profile ID, `BuyerProfile`, legacy catalog, and already-loaded active publications. It returns `ShadowRecommendationReadinessComparison` with:

- an unchanged legacy recommendation snapshot;
- one readiness comparison per published CVR;
- existing `VehicleDecisionReadiness` coverage and disclosures;
- required-dimension evidence outcomes;
- legacy-versus-CVR evidence classifications;
- dimensions used by legacy but unsupported by the CVR;
- trusted CVR dimensions unavailable to legacy;
- explicit `rankingProduced: false` and `productionRecommendationMutated: false` invariants.

The evaluator performs no file access, network access, source discovery, persistence, scoring, or shadow ranking.

## Evidence Coverage

Decision coverage comes exclusively from `evaluateVehicleDecisionReadiness`. Each relevant dimension retains the existing participation weight, field requirements, trusted/estimated eligibility, and stale/conflict handling. No default value replaces missing knowledge.

Evidence comparisons use these classifications:

- `LEGACY_SUPPORTED_BY_CVR`: trusted CVR evidence supports a dimension used by legacy.
- `LEGACY_NOT_YET_VERIFIED`: legacy uses a dimension that the CVR cannot yet support.
- `CVR_MORE_SPECIFIC`: the CVR provides trusted detail or capability beyond legacy.
- `CVR_MISSING`: neither a usable CVR value nor a legacy-supported comparison is available.
- `CVR_STALE`: relevant CVR evidence is stale.
- `CVR_CONFLICTED`: relevant CVR evidence conflicts.
- `DIFFERENT_SEMANTICS`: fields use materially different meanings or units, such as Leaf MPGe seed data versus canonical kWh/100 miles.
- `NOT_RELEVANT_TO_BUYER`: the dimension does not participate for the profile.

## Requirement Support

Every `enforced` relevant dimension receives one of three outcomes:

- `PASSED`: trusted CVR evidence exists and satisfies the requirement.
- `FAILED`: trusted CVR evidence exists and disproves compatibility.
- `EVIDENCE_UNAVAILABLE`: the CVR lacks decision-eligible evidence, so qualification cannot responsibly be established.

`EVIDENCE_UNAVAILABLE` is not treated as a failed vehicle requirement and does not borrow a value from the original catalog. Both unavailable evidence and a confirmed requirement failure produce evaluation-only `BLOCKED` readiness, with different diagnostics.

## Readiness Classification

- `BLOCKED`: at least one enforced dimension has unavailable evidence or trusted evidence fails the requirement.
- `READY`: no required dimension is blocked, weighted decision coverage is at least 85%, and no important dimension is unsupported.
- `PARTIALLY_READY`: no required dimension is blocked and weighted coverage is at least 50%, but material gaps remain.
- `INSUFFICIENT`: no hard requirement is blocked, but weighted coverage is below 50%.

Readiness is a capability classification, not a match score. It cannot determine a winner.

## Controlled Profiles

- **A Safety/reliability:** reliability and safety are top priorities; affordability is deprioritized.
- **B Ownership cost:** affordability, fuel/energy cost, insurance, and maintenance are equally important.
- **C Performance:** performance is the only active scoring priority; fuel/energy cost is disabled.
- **D EV buyer:** electric is required, EV range participates, and practical usability is important.
- **E SUV requirement:** SUV body style is enforced; no scoring preference is introduced.
- **F Budget disabled:** purchase budget and affordability are disabled; a minimum 2010 model year keeps the controlled decision non-empty.

## Golden Matrix

Cell format: `readiness / coverage / material gap`. An asterisk means a structured disclosure is required.

| Profile | Honda CR-V | Hyundai Accent | Nissan Leaf | Toyota Prius | Toyota RAV4 |
|---|---|---|---|---|---|
| A Safety/reliability | INSUFFICIENT / 12% / reliability, partial safety* | INSUFFICIENT / 12% / reliability, partial safety* | INSUFFICIENT / 0% / reliability, safety* | INSUFFICIENT / 12% / reliability, partial safety* | INSUFFICIENT / 12% / reliability, partial safety* |
| B Ownership cost | INSUFFICIENT / 0% / affordability, fuel cost, insurance, maintenance* | INSUFFICIENT / 0% / affordability, fuel cost, insurance, maintenance* | INSUFFICIENT / 0% / affordability, fuel cost, insurance, maintenance* | INSUFFICIENT / 0% / affordability, fuel cost, insurance, maintenance* | INSUFFICIENT / 0% / affordability, fuel cost, insurance, maintenance* |
| C Performance | INSUFFICIENT / 0% / performance* | INSUFFICIENT / 0% / performance* | INSUFFICIENT / 0% / performance* | INSUFFICIENT / 0% / performance* | INSUFFICIENT / 0% / performance* |
| D EV buyer | BLOCKED / 43% / fuel type failed; range, practicality* | BLOCKED / 43% / fuel type failed; range, practicality* | PARTIALLY_READY / 68% / practicality* | BLOCKED / 43% / fuel type failed; range, practicality* | BLOCKED / 43% / fuel type failed; range, practicality* |
| E SUV requirement | READY / 100% / none | BLOCKED / 0% / body-style evidence unavailable* | BLOCKED / 0% / body-style evidence unavailable* | BLOCKED / 0% / body-style evidence unavailable* | READY / 100% / none |
| F Budget disabled | READY / 100% / none | READY / 100% / none | READY / 100% / none | READY / 100% / none | READY / 100% / none |

### Average coverage by profile

| Profile | Average coverage |
|---|---:|
| A Safety/reliability | 10% |
| B Ownership cost | 0% |
| C Performance | 0% |
| D EV buyer | 48% |
| E SUV requirement | 40% |
| F Budget disabled | 100% |

### Average coverage by vehicle

| Vehicle | Average coverage |
|---|---:|
| 2016 Honda CR-V 4WD | 43% |
| 2016 Toyota RAV4 | 43% |
| 2018 Nissan Leaf | 28% |
| 2017 Hyundai Accent | 26% |
| 2016 Toyota Prius | 26% |

## Disclosure Behavior

- Missing stale fuel cost is irrelevant and undisclosed for Profiles A, C, E, and F.
- Stale fuel cost is material and disclosed for every vehicle in Profile B.
- Missing performance support is disclosed for every vehicle in Profile C; disabled fuel economy is not disclosed.
- Leaf range is supported in Profile D, while missing practicality is disclosed.
- Non-electric vehicles fail Profile D using trusted fuel-type evidence. This differs from missing evidence.
- Accent, Leaf, and Prius cannot establish Profile E qualification because canonical body-style evidence is unavailable. Their legacy body styles are not borrowed.
- Disabled affordability and purchase-budget fields create no disclosure in Profile F.

## Knowledge Gaps Before CVR Scoring

Priority considers frequency, buyer importance, golden-vehicle coverage, and current legacy use.

1. **Reliability and remaining safety detail:** reliability is absent across all five CVRs. Four rated vehicles now have NHTSA overall crash evidence, but active, passive, and driver-assistance safety remain unsupported; Leaf is explicitly Not Rated.
2. **Purchase price and ownership cost:** affordability, insurance, maintenance, and current fuel/energy cost are unsupported across all five; legacy currently scores or estimates each.
3. **Performance/driving:** no acceleration, handling, braking, steering, or ride-control evidence exists across the set; legacy currently supplies a performance score.
4. **Practicality:** passenger/cargo/visibility/storage evidence is absent, limiting the Leaf EV use case and family decisions.
5. **Body style:** missing for Accent, Leaf, and Prius, preventing evidence-backed hard qualification.
6. **EV range breadth:** Leaf has trusted range, but non-EV records correctly lack it; future EV records need equivalent evidence.

Missing CVR evidence does not prove the legacy value is wrong. It means the value is not yet verified under the canonical evidence contract.

## Trusted CVR Advantages

- EPA-backed fuel economy with explicit canonical units.
- Leaf energy consumption represented as kWh/100 miles while source evidence retains 112 MPGe.
- Trusted Leaf 151-mile EV range and zero tailpipe emissions.
- EPA configuration IDs and evidence lineage for all five records.
- Explicit drivetrain and transmission specificity, including CR-V AWD and CVT and Prius CVT.
- Trusted SUV body-style/category evidence for CR-V and RAV4.
- Source-backed emissions and vehicle-category fields not available as equivalent legacy scoring dimensions.

## Legacy Isolation

The permanent test runs each legacy profile immediately before and after shadow evaluation and compares the complete `RecommendationDecisionSet`, all `RecommendationObject` values, and `DecisionReport` serialization. Qualified counts, winners, runners-up, and scores remain identical. The test also verifies no BuyerProfile or Published CVR mutation, no network use, and unchanged Golden Set fingerprints.

## Known Limitations

- Readiness proves evidence capability, not suitability or recommendation quality.
- The five-record golden set is intentionally too small for production ranking.
- A published CVR may be structurally publishable while having low buyer-specific coverage.
- Current requirement comparison covers existing BuyerProfile hard dimensions; it does not create new constraints.
- No score can be calculated from partially supported CVRs without an approved evidence-aware scoring policy.

## Criteria for Scoring Integration

Do not connect CVRs to production scoring until:

1. required-dimension evidence can establish qualification for the intended vehicle scope;
2. reliability, safety, affordability, insurance, maintenance, and practicality have trusted coverage or an explicit category-disable policy;
3. stale and conflicted fields remain scoring-ineligible;
4. unit/semantic bridges are approved, especially MPG, MPGe, and kWh/100 miles;
5. a larger reviewed CVR set covers realistic candidate competition;
6. a shadow score-parity plan is approved without replacing missing values with neutral defaults;
7. production RecommendationObject and DecisionReport provenance can identify CVR evidence directly.
