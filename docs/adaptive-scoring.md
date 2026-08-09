# Adaptive Qualification and Scoring

## Purpose

The recommendation engine remains deterministic. Semantic understanding may
describe a user's participation policy, but it cannot select a vehicle or
provide a vehicle score. `resolveEffectiveScoringPolicy` is the single boundary
that converts a `BuyerProfile`, its participation policies, the existing base
weights, and catalog capabilities into qualification and ranking instructions.

## Current scoring audit

| Category | Base weight | Formula and range | Missing-data behavior | Hard filter | Ranking and explanation |
| --- | ---: | --- | --- | --- | --- |
| Affordability | 25 | 55% purchase-price fit and 45% payment fit, each bounded 0-100 | Validated price is required; payment is derived. A disabled purchase target cannot be replaced by a payment default. | Purchase and payment limits are separate constraints | Weighted only when active; purchase/payment components are not separately weighted |
| Reliability | 15 | Vehicle reliability adjusted for annual-mileage risk, 0-100 | Catalog fallback is marked estimated; missing required data fails catalog validation | Only an explicit numerical minimum filters | Weighted and eligible for reasons |
| Safety | 15 | Vehicle safety with the selected safety priority, 0-100 | Catalog safety is sourced; NHTSA raises provenance quality | Only an explicit numerical minimum filters | Weighted and eligible for reasons |
| Fuel and energy cost | 10 | 62% MPG fit and 38% monthly fuel-cost fit, 0-100 | Catalog fallback is marked estimated; FuelEconomy.gov is preferred | Fuel type is filtered separately | Weighted once; MPG and monthly fuel are not separate categories |
| Insurance cost | 10 | Monthly insurance against the user's target, 0-100 | Current catalog value is treated as estimated | No | Weighted once |
| Maintenance risk | 10 | 58% maintenance-cost fit, 18% condition, 24% reliability, 0-100 | Engine estimate is conservative and marked estimated when no imported estimate exists | No | Weighted once; the legacy composite ownership penalty is disabled for policy-aware profiles |
| Practicality | 7 | Seating, cargo, body style, climate, and daily-use fit, 0-100 | Required vehicle fields must pass catalog validation | Body style, drivetrain, and seating constraints filter separately | Weighted using the existing category; no unsupported policy dimension was invented |
| Resale value | 5 | Vehicle resale score adjusted by the user's resale priority, 0-100 | Catalog fallback is marked estimated when depreciation has no imported estimate | No | Weighted once |
| Driving preference fit | 3 | Performance, transmission, make, modifications, and feature fit, 0-100 | Required vehicle fields must pass catalog validation | Make and transmission are filtered separately | Performance participation controls this category |

Purchase price, monthly payment, model year, mileage, make, body style, fuel
type, drivetrain, transmission, seating, and explicit score minimums are
qualification dimensions. They do not receive independent ranking weights.

The previous fixed-weight bypass was the handoff in `runCandidatePipeline`,
which called `getDynamicScoreWeights` without consulting `decisionPolicies`.
Penalties, runner-up explanations, soft-preference scores, and data-confidence
calculations also used all legacy categories even when one was disabled.

## Effective scoring policy

`lib/effectiveScoringPolicy.ts` returns:

- the ranking mode: `weighted`, `constraint_only`, or `needs_clarification`;
- one record per existing score category;
- base, raw effective, and normalized effective weights;
- participation, importance, source, and data availability;
- effective hard-constraint metadata;
- disabled and unresolved categories.

Profiles with no `decisionPolicies` use the legacy-default rule. Their existing
priority multipliers, winners, and match scores are preserved.

## Participation rules

- `enforced`: applies a supported hard filter. Score-only categories remain
  strongly active but do not gain an invented threshold.
- `active`: participates in ranking without creating a new constraint.
- `deprioritized`: uses a `0.42` participation multiplier after importance is
  resolved.
- `disabled`: receives zero raw weight, zero normalized weight, no penalty, and
  no recommendation or runner-up reason.
- `unresolved`: receives zero weight until clarification.

An explicit excluded value remains a hard filter even if the broader
preference dimension is disabled. An explicit numerical reliability, safety,
or performance minimum remains enforceable when that category is active.

## Importance

The validated levels and multipliers are:

| Level | Multiplier |
| --- | ---: |
| Low | 0.72 |
| Normal | 1.00 |
| High | 1.35 |
| Top | 1.75 |

These preserve the project's existing priority scale. Continuous semantic
importance maps deterministically: `0-.25` low, `>.25-.55` normal,
`>.55-.80` high, and `>.80-1` top. A deprioritized category also receives the
`0.42` participation factor, so even a contradictory high importance remains
below the equivalent active category. Disabled and unresolved always win over
importance and produce zero weight.

## Normalization

Each category starts with:

`base weight x importance multiplier x participation multiplier`

Unavailable, disabled, and unresolved categories receive zero. Remaining raw
weights are normalized to 100 with six-decimal deterministic rounding. The
last positive category receives the rounding remainder, keeping the total
exactly 100 within floating-point tolerance. Relative ratios between unaffected
categories are preserved.

## Financial overlap

Affordability contains purchase-price and payment fit only. Maintenance,
insurance, fuel, and resale remain separate categories:

- ignoring purchase price disables the purchase-price constraint and its
  affordability contribution;
- disabling the composite affordability policy also disables legacy
  purchase-price and monthly-payment qualification defaults;
- an explicitly active payment target may keep payment affordability active;
- ignoring budget does not silently disable ongoing costs;
- broad cost removal disables each named cost category;
- an explicit repair concern reactivates maintenance independently.

For policy-aware profiles, the legacy composite ownership-cost penalty is not
subtracted because its components are already represented by maintenance,
insurance, and fuel categories. Legacy profiles retain the old behavior for
backward compatibility.

## Contribution records

Every scored vehicle records:

- raw and normalized category scores;
- base, raw effective, and normalized effective weights;
- weighted contribution;
- participation, importance, and source;
- available, estimated, or missing evidence status;
- whether the contribution affected ranking.

`weightedScoreBeforePenalties` is the exact sum of category contributions.
`overallMatchScore` is the bounded rounded result after `penaltyTotal`.
Disabled categories remain visible in technical transparency with zero weight
and zero contribution.

## Missing data and confidence

Validated catalog fields remain mandatory. Imported or live-source gaps use the
existing conservative estimate and are marked `estimated`, never perfect.
Data-quality confidence is calculated only from categories with positive
effective weight. Missing evidence in a disabled category therefore does not
lower confidence. Estimated or missing evidence in a category carrying at
least 20% effective weight adds an explicit top-priority evidence penalty.

Recommendation confidence now exposes active-dimension count, winner/runner-up
score separation, unresolved dimensions, compromise usage, active evidence
coverage, and estimated or missing active-category counts. Legacy profiles keep
the previous confidence formula.

## Deterministic safeguards

- Negative and non-finite base weights are rejected.
- No model field can set a score or raw weight.
- Provider source metadata does not affect ranking.
- All-disabled profiles cannot receive a normal ranked recommendation.
- Constraint-only ranking is permitted only when explicit hard constraints
  intentionally define the candidate set.
- Excluded values cannot be restored by normalization.
- Ties use stable vehicle IDs for policy-aware profiles.
- Repeated profile/catalog evaluation produces identical output.

## Controlled results

The fixed-fixture tests demonstrate:

- affordability active selects the value vehicle; disabling it selects the
  stronger-evidence vehicle;
- top safety changes the winner from the performance vehicle to the safer one;
- deprioritizing reliability changes the winner to the performance vehicle;
- disabling fuel cost changes the winner from the efficient vehicle to the
  safer vehicle;
- disabling maintenance changes the winner from the low-maintenance vehicle to
  the safer vehicle.

## Known limitations

The engine does not yet have supported categories for comfort, styling,
quietness, luxury, camping, or emotional goals. Those remain understood but
not scored. Phase 3.1C-C should refine category evidence quality, add
catalog-level sensitivity reporting, expose constraint-only mode more clearly,
and decide whether purchase price and monthly payment merit separately visible
score categories without double-counting affordability.
