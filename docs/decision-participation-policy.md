# Decision Participation Policy

The numerical implementation of this contract is documented in
[`docs/adaptive-scoring.md`](./adaptive-scoring.md). That layer turns the
participation state into effective hard constraints, normalized category
weights, contribution records, confidence inputs, and explanation eligibility.

## Why This Layer Exists

Semantic intent answers how a user relates to a value: required, preferred,
allowed, excluded, or uncertain. It does not answer whether the whole decision
dimension should filter candidates, affect ranking, trigger clarification, or
appear in explanations.

`BuyerProfile.decisionPolicies` is the authoritative profile-level policy map.
Each entry keeps the dimension, participation state, optional importance,
source, confidence, confirmation status, evidence, message reference, and an
audit explanation. The resolver in `lib/decisionParticipationPolicy.ts` is the
only place that resolves competing policy updates.

## Participation States

| State | Qualification | Scoring | Clarification | Readiness | Explanation |
| --- | --- | --- | --- | --- | --- |
| `enforced` | Hard rule when the dimension has a usable value | Existing scoring remains available | Only for unresolved value/conflict | A usable enforced value is actionable | May appear as a passed requirement and reason |
| `active` | Not automatically a hard rule | Participates normally | May clarify a material ambiguity | A usable supported value/priority is actionable | May appear as a reason |
| `deprioritized` | Not a hard rule | Adaptive weight behavior is deferred to 3.1C-B | Does not ask merely to raise importance | Not actionable by itself | Shown as lower priority, not as a winner strength |
| `disabled` | Never filters | Full score-weight removal is deferred to 3.1C-B | Never asks about the dimension | Does not count as missing or actionable | Never appears as a used reason or qualification pass |
| `unresolved` | Never filters until resolved | Does not authorize a new value | May ask when decision impact is material | Not actionable by itself | Shown as needing clarification |

Phase 3.1C-A does not change category-weight formulas. It suppresses disabled
dimensions from qualification, readiness, default disclosures, and visible
RecommendationObject reasons. Removing their numerical category contribution
from the final weighted score belongs to Phase 3.1C-B.

## Supported Dimensions

Financial:

- `purchaseBudget`
- `monthlyPayment`
- `totalOwnershipBudget`
- `affordability`
- `maintenanceRisk`
- `insuranceCost`
- `fuelEnergyCost`
- `resaleValue`

Risk and experience:

- `reliability`
- `safety`
- `performance`

Vehicle constraints:

- `make`
- `bodyStyle`
- `fuelType`
- `drivetrain`
- `transmission`
- `seating`
- `modelYear`
- `mileage`

Comfort, luxury, styling, quietness, camping, and similar understood concepts
remain preserved semantic context. The current engine does not claim policy or
score support for them.

## Existing Decision-Control Audit

The defaults below are the Advisor-page defaults in
`components/BuyerProfilePlanner.tsx`. “Legacy” means behavior when a profile has
no explicit policy entry, preserving existing questionnaire behavior.

| Dimension | BuyerProfile field/default | Qualification | Scoring | Readiness and clarification | Explanation | Disable/importance support and reactivation risk |
| --- | --- | --- | --- | --- | --- | --- |
| Purchase budget | `maxPurchaseBudget = 18000` | Legacy hard price limit; now hard only when policy is absent or `enforced` | Affordability price fit | Value is actionable; missing/unresolved may ask budget; disabled asks what should matter instead | Budget pass/reason when used | Can be disabled or active target; explicit policy suppresses the default |
| Monthly payment | `monthlyBudget = 650` | Legacy payment limit for non-cash buyers; now hard only when absent policy or `enforced` | Payment fit and ownership comparisons | Supported actionable field; no independent default question | Payment room and ownership language | Can be disabled; financing-default disclosure is suppressed |
| Total ownership budget | No dedicated numeric field; `monthlyBudget` is a proxy | No direct hard rule | Ownership-cost penalties and estimates | Not independently actionable today | Ownership estimates and tradeoffs | Policy supported; numeric scoring integration remains 3.1C-B |
| Affordability | `scoreWeights.affordability = 25` | Price/payment constraints above | Fixed category plus dynamic cash/low-budget multiplier | Not a standalone profile value | Common winner reason | Policy supported; disabled reason suppression exists, numerical weight removal is 3.1C-B |
| Maintenance risk | Reliability and vehicle estimates; weight `10` | No hard rule unless a separate reliability minimum applies | Maintenance estimate, condition, reliability | Semantic maintenance language is understood; some remains context | Cost/risk tradeoff | Can be disabled/deprioritized; adaptive weight behavior is 3.1C-B |
| Insurance cost | `insuranceBudget = 145`, weight `10` | Not a hard filter | Insurance fit and over-budget penalty | Explicit budget is actionable | Ownership and tradeoff evidence | Can be disabled; default disclosure suppression exists |
| Fuel/energy cost | `minMpg = 24`, importance `3`, weight `10` | `minMpg` is a soft penalty, not qualification | MPG and estimated fuel cost | Explicit priority/value is actionable | Fuel reason/tradeoff | Can be disabled; full score removal is 3.1C-B |
| Depreciation/resale | `resaleValueImportance = 3`, weight `5` | No hard rule | Resale/depreciation category | Explicit priority is actionable | Resale reason | Can be disabled/deprioritized; adaptive weight behavior is 3.1C-B |
| Reliability | `reliabilityImportance = 4`, optional minimum | Minimum is hard | Reliability and maintenance categories | Priority/minimum is actionable | Reliability reason and risk | Importance is already adjustable; policy separates lower priority/disabled from a missing value |
| Safety | `safetyPriority = not-sure`, optional minimum | Minimum is hard | Safety category and penalty | Priority/minimum is actionable | Safety reason and risk | Importance is adjustable; policy separates disabled/unresolved |
| Performance | `performanceImportance = 2`, optional minimum | Minimum is hard | Driving-preference category | Priority/minimum is actionable | Driving-fit reason | Importance is adjustable; policy separates disabled/unresolved |
| Model year | `minYear = 2014` | Legacy hard minimum | Practicality age fit | Explicit minimum is actionable | Requirement pass/tradeoff | Can be disabled; default form value cannot filter when disabled |
| Mileage | `maxMileage = 110000` | Legacy hard maximum | Reliability/practicality wear fit | Explicit maximum is actionable | Requirement pass/risk | Can be disabled; default form value cannot filter when disabled |
| Make | Canonical required/preferred/allowed/excluded arrays; no default | Required/excluded are hard | Preferred make can affect driving fit/tradeoff | Explicit make state is actionable; uncertain make clarifies | Requirement and relaxed-preference evidence | Policy can disable/re-enable; a fresh conversation clears prior policy |
| Body style/category | Canonical arrays; legacy `bodyStyle = any` | Required/excluded are hard | Practicality fit | Explicit state is actionable | Requirement and practicality evidence | “Any body style” disables restriction and suppresses questions |
| Fuel type | Canonical arrays; no default | Required/excluded are hard | Fuel fit | Explicit state is actionable | Requirement/fuel evidence | “Fuel type does not matter” disables restriction |
| Drivetrain | Canonical arrays; legacy `any` | Required/excluded are hard | Climate/practicality fit | Explicit state is actionable | Requirement/traction evidence | “No preference” disables restriction |
| Transmission | Canonical arrays; legacy `any` | Required/excluded are hard | Small practical/driver fit | Explicit state is actionable | Requirement evidence | “Either is fine” disables restriction; “no manual” remains enforced |
| Seating | `familySize = 1` | Above one becomes a hard minimum | Practicality | Explicit passenger count is actionable | Requirement/practicality evidence | Can be disabled/unresolved through policy |

### Previous Missing-Value Ambiguity

- Missing purchase budget was treated as the app default in confirmation.
- Missing purchase budget was also treated as unknown by intake clarification.
- `0` or falsy financial values sometimes triggered derived defaults in
  affordability calculations.
- `any` and `not-sure` mean no explicit restriction, but legacy score defaults
  still participate.
- Default profile values could authorize a recommendation even when the user
  had supplied only unsupported context.

The policy layer now distinguishes defaulted, disabled, and unresolved states.
Readiness still requires at least one positive supported criterion.

## Semantic Contract

`UnderstandingDraft.decisionPolicyInstructions` contains:

- typed `dimension`
- `participation`
- optional normalized `importance` from 0 to 1
- evidence and message reference
- explicit/inferred/uncertain status
- confidence and interpretation source
- confirmation requirement and explanation

The model schema is strict and disallows undeclared dimensions or properties.
The deterministic fallback emits the same instruction type for a small set of
clear objective phrases.

## Conflict Resolution

Current-state precedence is:

1. Newest explicit user instruction
2. Earlier explicit user instruction
3. Confirmed interpretation
4. Unconfirmed inference
5. Application default

Message sequence is compared first. At the same sequence, explicit and
confirmed sources outrank inferred and defaulted sources. An inferred
instruction cannot create an enforced rule.

Examples:

- `$20,000 maximum` then `ignore budget` ends disabled.
- `ignore budget` then `keep it under $40,000` ends enforced at `$40,000`.
- `no body-style preference` then `I want an SUV` reactivates the dimension.
- A new search starts without prior participation policies.

## Budget Semantics

- `Ignore budget`: disables purchase-price qualification, the default monthly
  payment ceiling, and affordability explanations. Ownership costs remain
  separate unless the user also removes them.
- `No budget limit`: disables purchase price and leaves ownership-cost scope
  open for clarification when material.
- `Money is no object`: disables purchase price, monthly payment,
  affordability, insurance, fuel, resale, and total ownership cost. An explicit
  repair concern keeps maintenance risk active.
- `Around $25,000` or `I can stretch`: stores an active preferred target, not a
  hard maximum.
- `Under $25,000`: stores an enforced maximum.
- `I do not know my budget`: stores unresolved, not disabled.

## Readiness and Confirmation

A disabled policy:

- is not missing
- never triggers its own clarification
- is not a positive actionable criterion
- suppresses its default confirmation item

`Ignore budget` alone therefore asks what should matter instead. `Ignore
budget; I want a reliable truck` can proceed because truck and reliability are
positive supported criteria.

Confirmation uses natural view-model values:

- disabled score dimension: `Not part of this recommendation`
- disabled restriction: `No restriction`
- deprioritized: `Lower priority`
- unresolved: `Needs clarification`
- enforced: `Required`
- active: `Active priority` or `Preferred`

The UI consumes this canonical state; it does not infer policy from labels.

## Phase 3.1C-B Implementation

Phase 3.1C-B is implemented by
`lib/effectiveScoringPolicy.ts` and documented in
`docs/adaptive-scoring.md`. The resolver:

1. Converts `disabled` score dimensions to zero contribution before
   normalization.
2. Applies deterministic `deprioritized` and importance multipliers.
3. Keeps purchase affordability separate from maintenance, insurance, fuel,
   and resale.
4. Makes supported ownership-cost dimensions independently controllable.
5. Produces per-vehicle contribution records and controlled ranking benchmarks.

Phase 3.1C-A remains the authoritative intent and participation contract.
