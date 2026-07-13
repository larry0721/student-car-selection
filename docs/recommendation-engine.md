# Recommendation Engine

Status: Foundation Release 1 implementation notes

Date: July 12, 2026

This document describes the deterministic scoring system used by the advisor. Numerical rankings come from structured vehicle data and user preferences. AI may help interpret written requirements or explain a result, but it must not invent or override the numerical ranking.

Foundation Release 2 adds a first-class Recommendation Object contract. Foundation Release 3 makes that object the authoritative decision output. See `docs/recommendation-object.md` for the field-by-field output schema used by future advisor layers.

## Candidate Pipeline

Foundation Task 3.5 makes recommendation flow staged and inspectable. The engine does not start with "budget to score to winner." It now follows this deterministic pipeline:

1. `loadCatalog`: load the vehicle catalog supplied to the engine.
2. `candidateGeneration`: keep records that pass vehicle-data validation and can be considered for recommendations.
3. `constraintFiltering`: evaluate mandatory and flexible constraints before ranking.
4. `suitabilityEvaluation`: calculate affordability, reliability, safety, practicality, ownership cost, and priority-fit category values.
5. `ranking`: rank only after constraints and suitability are known. Qualified vehicles form the primary ranking; compromise vehicles are separate fallback guidance.
6. `recommendationObject`: convert ranked vehicles into structured Recommendation Objects.
7. `advisorLayer`: current UI wording is derived from Recommendation Object fields. Future AI advisor wording must use the same object as its source of truth.

Each pipeline run returns debug data:

- `catalogCount`
- `candidateCount`
- `filteredCount`
- `excludedCount`
- `qualifiedCount`
- `compromiseCount`
- ordered stage summaries
- top five ranked vehicles
- reason each top-five runner-up lost to the top result
- advisor source marker showing explanations are based on Recommendation Objects

Acceptance rule: excluded vehicles may be scored for diagnostics, but they must not appear in the primary recommendation ranking.

## 1. Recommendation Contract

For each vehicle that reaches the recommendation list, the engine returns:

- `score`: final match score from 0 to 100.
- `scoreBreakdown`: category scores from 0 to 100.
- `categoryWeights`: normalized category weights that sum to 100.
- `positiveContributions`: weighted category contributions that increased the final score.
- `penalties`: soft-preference warnings that reduced the final score.
- `hardConstraintStatus`: whether the vehicle passed every selected hard constraint.
- `assumptions`: estimates or fallback rules used for the vehicle.
- `missingDataWarnings`: important source data that was unavailable.
- `confidence`: separate data-confidence score from 0 to 100 with `high`, `medium`, or `low`.

Acceptance rule: a high match score is not the same thing as high confidence.

## 2. Hard Constraints

Hard constraints are selected requirements that a vehicle must satisfy before it can be recommended. Each evaluated vehicle receives a qualification status before ranking:

- `qualified`: passes every selected hard constraint.
- `compromise`: fails only constraints the user explicitly marked flexible.
- `excluded`: fails at least one true hard constraint.

A vehicle that violates a true hard constraint is excluded from the primary ranked recommendation list.

Current hard constraints:

- Maximum total purchase budget.
- Maximum monthly payment, when financing information is available.
- Required body style.
- Maximum mileage.
- Required drivetrain.
- New versus used requirement.
- Transmission requirement.
- Make requirement.
- Seating requirement.
- Fuel-type requirement.
- Explicit reliability, safety, or performance minimum thresholds.

Reliability, safety, performance, and appearance preferences are not automatically hard constraints. They become constraints only when the profile includes an explicit minimum threshold or required value.

The no-match path uses these same checks to explain why the catalog could not satisfy a profile. The engine must not silently award a high score to a vehicle that violates a selected hard constraint.

## 3. Soft Preferences

Soft preferences influence ranking but do not automatically exclude a vehicle. They include:

- Reliability importance.
- Safety priority.
- Fuel economy importance and minimum MPG.
- Insurance budget.
- Maintenance risk.
- Practicality needs such as seats, family size, cargo, climate, and body-style fit.
- Resale value importance.
- Performance, transmission feel, and modification interest.
- Advanced feature interest.

Soft preferences may add penalties when a vehicle is a weak fit, but the vehicle can remain visible if it passed all hard constraints.

## 4. Score Categories

The final score is calculated from these categories:

- `affordability`: purchase price, monthly payment fit, and monthly budget room.
- `reliability`: reliability score, mileage, age, and user reliability importance.
- `safety`: safety score, safety priority, year, and available safety features.
- `fuelEnergyCost`: MPG, annual mileage, fuel price, and fuel-economy importance.
- `insuranceCost`: estimated monthly insurance compared with the user budget and vehicle risk.
- `maintenanceRisk`: monthly maintenance estimate, reliability, mileage, age, and risk profile.
- `practicality`: seats, body style, cargo need, climate, drivetrain, and family size.
- `resaleValue`: depreciation estimate, age, brand strength, and resale-value importance.
- `drivingPreferenceFit`: performance, transmission, drivetrain, body style, features, and modification plans.

Default weights:

- Affordability: 25%
- Reliability: 15%
- Safety: 15%
- Fuel and energy cost: 10%
- Insurance cost: 10%
- Maintenance risk: 10%
- Practicality: 7%
- Resale value: 5%
- Driving preference fit: 3%

Advanced options can change the weights. The engine normalizes any valid weight set so category weights sum to 100.

## Dynamic Priority Scaling

Foundation Task 4 makes user-selected priorities affect final category weights, not only raw category scores.

Priority levels map to deterministic multipliers:

- `low`: 0.72x
- `normal`: 1.00x
- `important`: 1.35x
- `very important`: 1.75x

Existing 1-5 UI importance values are interpreted as:

- 1-2: low
- 3: normal
- 4: important
- 5: very important

Safety priority is interpreted as:

- `standard`: normal
- `high`: important
- `maximum`: very important
- `not-sure`: normal

The engine also applies deterministic contextual scaling for practical needs:

- cash or very low budget increases affordability weight.
- high cargo, family size of four or more, required body style, and snow/rain climate increase practicality weight.
- preferred or required make increases driving-preference weight.
- high reliability importance modestly increases maintenance-risk weight.

After scaling, weights are normalized back to 100 so every category contribution remains interpretable.

Acceptance rule: priority importance is never the same as a hard constraint. A reliability priority of very important increases reliability weight. A reliability minimum of 85 is a separate qualification threshold.

## 5. Normalization And Score Curve

Raw category scores are calculated independently from vehicle data and the user profile. After hard filtering, the engine normalizes category scores across the eligible candidate pool.

Normalization exists to prevent score saturation. If most eligible vehicles have similar raw scores, the category stays close to its raw value. If a category has meaningful spread across the candidate pool, the engine stretches that spread so better and worse fits separate more clearly.

After weighting, soft penalties are subtracted from the weighted score. The final score is clamped between 0 and 100 and rounded to an integer.

Acceptance rule: a catalog update or profile change may change rankings, but the same catalog and same profile must always produce the same ranking.

## 6. Penalties

Penalties are deterministic and visible. Current penalties include:

- Insurance estimate above the user budget.
- Fuel economy below the requested MPG target.
- Snow-climate traction concern.
- Family-size seating concern.
- Safety score below the user's safety priority.
- Reliability below the user's reliability priority.
- Monthly ownership cost above the user's budget.

Penalties are not hidden. Each penalty returns a label, point value, and plain-English reason.

## 7. Confidence

Confidence measures data trust, not personal fit.

Confidence considers:

- Completeness of required vehicle fields.
- Whether the record passed validation.
- Source quality from listing APIs, NHTSA, FuelEconomy.gov, CSV overlays, and seed data.
- Number of assumptions used.
- Missing important source overlays.
- Estimated fields such as insurance, maintenance, depreciation, and fuel cost.

Confidence levels:

- `high`: strong source coverage and few assumptions.
- `medium`: usable recommendation with some estimated or missing fields.
- `low`: recommendation depends heavily on fallback data or assumptions.

The UI must display confidence separately from match score.

## 8. Explanation Rules

Recommendation explanations must be traceable to structured data. For each result, explanations may use:

- User profile values.
- Vehicle fields.
- Score category values.
- Category weights and contributions.
- Penalties.
- Assumptions and missing-data warnings.
- Source metadata and data dates.

AI-generated wording may summarize these facts, but it must not invent new numerical scores or claim a vehicle passed a hard constraint that it failed.

## 9. Test Profiles

The automated recommendation profile test covers these cases:

- Low-budget cash buyer.
- College commuter.
- Parent prioritizing safety.
- Snow-climate driver.
- High-mileage commuter.
- Performance-focused buyer.
- SUV-only family.
- Hybrid-focused buyer.
- User who wants a riskier luxury or feature-rich vehicle.
- User with strict insurance limits.
- User with incomplete answers.
- User with contradictory preferences.

The test verifies:

- Hard-constraint violations do not appear in ranked results.
- Every scored vehicle exposes the structured score contract.
- Scores vary within ranked lists where the profile gives enough signal.
- Top-five rankings change across very different profiles.
- Contradictory hard constraints produce a no-match result instead of a fake high score.
- Top recommendations no longer cluster near 94.
- Recommendation Objects expose internally consistent qualification status, hard-constraint checks, confidence, tradeoffs, and no-match guidance.

## 10. Current Assumptions

The current catalog still uses a cleaned seed dataset with optional overlays. Some ownership costs are estimates when verified listing or provider data is unavailable.

Assumptions currently exposed to users include:

- Monthly maintenance estimate is heuristic when no CSV/provider overlay is available.
- Depreciation estimate is heuristic when no provider overlay is available.
- Fuel cost is estimated from MPG, expected annual mileage, and fuel price.
- Listing URL and verified vehicle photo may be unavailable.
- Seed-only records have lower confidence than records enriched by live or uploaded data.

These assumptions should shrink as more verified provider and CSV data is added.
