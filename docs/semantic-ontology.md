# Semantic Ontology and Mapping Contract

## Purpose

This contract controls how semantic understanding becomes advisor state and,
after confirmation, a `BuyerProfile`. It does not select, score, or rank
vehicles.

The authoritative path is:

1. `UnderstandingDraft` records provider interpretations and evidence.
2. Runtime validation rejects unknown fields and unsupported concepts.
3. `semanticMapping.ts` converts interpretations into canonical mapped
   concepts.
4. `semanticPreferenceAdapter.ts` projects those concepts into the existing
   advisor-state presentation model.
5. Confirmation displays and edits canonical intent.
6. `confirmedProfileConversion.ts` applies confirmed destinations to
   `BuyerProfile`.

Display labels are not inputs to semantic mapping.

## Separate Properties

Each canonical mapped concept keeps these properties separate:

- `conceptType`: the normalized vehicle-domain concept.
- `value`: the normalized entity or value.
- `intent`: `required`, `preferred`, `allowed`, `excluded`, or `uncertain`.
- `strength`: how strongly the user cares, represented independently of intent.
- `confirmationStatus`: whether the interpretation is confirmed.
- `confidence`: confidence in the interpretation.
- `source`: user, model, fallback, prior context, or correction.
- `supportStatus`: whether the current product can use the concept.
- `destination`: the existing advisor-state or `BuyerProfile` field, when one
  exists.
- `clarificationRule`: what to ask when the mapping is ambiguous.
- `preservationRule`: how to retain meaning that the engine cannot use.

## Ontology Layers

### Decision Ontology

`goal`, `hard_constraint`, `preference`, `allowed_fallback`, `exclusion`,
`tradeoff`, `aversion`, `uncertainty`, `conflict`, `assumption`,
`unresolved_concept`, and `preserved_context`.

### Vehicle-Domain Ontology

The registry covers the supported decision dimensions: make, model, body
style, vehicle category, fuel type, drivetrain, transmission, seating,
purchase and ownership budgets, model year, mileage, reliability, safety,
fuel economy, performance, and resale value.

Recognized but currently unscored concepts include premium appearance,
comfort, quietness, camping use, and status or image. These remain advisor
context and do not create synthetic vehicle scores.

### Conversation Ontology

`direct_request`, `preference`, `exclusion`, `uncertainty`,
`discovery_request`, `correction`, `comparison`, `compromise_permission`,
`conflict_between_people`, and `request_for_explanation`.

### Support Status

- `supported_and_used`
- `supported_but_needs_confirmation`
- `understood_but_not_scored`
- `recognized_out_of_scope`
- `unresolved`

## Mapping Matrix

| Concept | Required | Preferred | Allowed | Excluded | Uncertain |
| --- | --- | --- | --- | --- | --- |
| Vehicle make | `requiredMake` | `preferredMake` | `allowedMakes` | `excludedMakes` | Clarify |
| Body style | `bodyStyle` hard | `bodyStyle` flexible | Preserve | Preserve | Clarify |
| Fuel type | `requiredFuelType` | Preserve | Preserve | Preserve | Clarify |
| Drivetrain | `drivetrainPreference` hard | `drivetrainPreference` flexible | Preserve | Preserve | Clarify |
| Transmission | `transmissionPreference` hard | `transmissionPreference` flexible | Preserve | Preserve | Clarify |
| Seating capacity | `familySize` hard | `familySize` preferred | Preserve | Preserve | Clarify |
| Maximum purchase budget | `maxPurchaseBudget` | Preserve target | Not applicable | Not applicable | Clarify |
| Monthly ownership limit | `monthlyBudget` | Preserve sensitivity | Not applicable | Not applicable | Clarify |
| Model year | `minYear` | Preserve | Not applicable | Not applicable | Clarify |
| Mileage | `maxMileage` when explicit | Preserve ambiguity | Not applicable | Not applicable | Clarify |
| Reliability | Existing importance field | Existing importance field | Not applicable | Not applicable | Clarify |
| Safety | Existing priority field | Existing priority field | Not applicable | Not applicable | Clarify |
| Fuel economy | Existing importance field | Existing importance field | Not applicable | Not applicable | Clarify |
| Performance | Existing importance field | Existing importance field | Not applicable | Not applicable | Clarify |
| Resale value | Existing importance field | Existing importance field | Not applicable | Not applicable | Clarify |

No new `BuyerProfile` field is created when the current profile lacks a valid
destination.

## Make-Intent Policy

- A bare make such as `Toyota` is uncertain and requires clarification.
- `I want Toyota` follows the current product policy and is required.
- `Only`, `must`, and `need` are required.
- `Maybe` and `prefer` are preferred.
- `Okay`, `fine`, and `acceptable` are allowed.
- `No`, `avoid`, and `except` are excluded.
- A plain `Toyota or Honda` relation becomes an allowed set.

These rules are deterministic safeguards for normalized, objective make
entities. General emotional and contextual understanding remains provider
driven.

## Revision Rules

Canonical concepts are merged by normalized concept and value.

1. A later message replaces an earlier state for the same concept and value.
2. Within the same message, exclusion wins over required, preferred, allowed,
   and uncertain duplicates.
3. A later exclusion removes the same make from required, preferred, and
   allowed profile state.
4. A required make removes the same preferred make state.
5. Body style, fuel type, drivetrain, and transmission clear stale mapped state
   before a newer canonical mapping is applied.
6. Unsupported concepts are retained rather than appended to unrelated profile
   fields.

## Out-of-Scope Categories

Motorcycles, RVs, camper vans, ATVs, electric scooters, scooters, and boats are
marked `recognized_out_of_scope`. They do not create a passenger-car
`BuyerProfile` update and cannot authorize a generic car recommendation.

## Guardrails

- Inferred interpretations cannot become required without confirmation.
- Unknown model fields are rejected by strict structured-output validation.
- The model cannot construct `BuyerProfile`, select a vehicle, or rank cars.
- Unknown destinations are not applied.
- Original source text and message references remain attached.
- Recommendation scoring, qualification, and ranking remain deterministic and
  unchanged by this contract.

## Decision Participation

Semantic intent does not determine whether an entire decision dimension is
enforced, active, deprioritized, disabled, or unresolved. That independent
contract is documented in
[`decision-participation-policy.md`](./decision-participation-policy.md).
`UnderstandingDraft.decisionPolicyInstructions` carries model-independent
policy evidence into the authoritative resolver before confirmation and
`BuyerProfile` conversion.
