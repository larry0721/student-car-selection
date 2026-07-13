# Recommendation Object Contract

Status: Foundation Release 3 contract

Date: July 12, 2026

The recommendation engine returns structured data. It does not write user-facing advice. The AI advisor layer can later transform this object into readable guidance, but it must not invent scores, constraints, costs, confidence, or missing-data status.

## Object Fields

### `vehicleId`

Stable vehicle identifier from the catalog or provider overlay.

Acceptance rule: must match `vehicle.id`.

### `vehicle`

The source vehicle record used for scoring.

Acceptance rule: must include the fields needed to reproduce scoring, including year, make, model, price, mileage, MPG, drivetrain, body style, reliability score, and safety score.

### `qualified`

Boolean showing whether the vehicle passed all selected hard constraints without compromise.

Acceptance rule: `qualified` is true only when `qualificationStatus` is `qualified`.

### `qualificationStatus`

Formal decision status from the qualification stage.

Allowed values:

- `qualified`: passed every selected hard constraint.
- `compromise`: failed only constraints that the user marked flexible.
- `excluded`: failed at least one true hard constraint.

Acceptance rule: excluded vehicles must not appear in the primary recommendation ranking.

### `qualificationSummary`

Structured summary of qualification status.

Fields:

- `status`: `qualified`, `compromise`, or `excluded`.
- `passedCount`: number of hard constraints passed.
- `failedCount`: number of hard constraints failed.
- `compromiseCount`: number of failed constraints that were marked flexible.

Acceptance rule: `status` must equal `qualificationStatus`.

### `hardConstraintResults`

Array of every selected hard or flexible constraint checked for the vehicle.

Each item includes:

- `code`: machine-readable constraint key.
- `label`: human-readable short label.
- `passed`: whether the vehicle satisfied the constraint.
- `actual`: vehicle value.
- `limit`: user-required value.
- `flexible`: whether the user allowed this failed constraint to become a compromise.
- `exclusionReason`: present when the constraint failed.

Acceptance rule: this array is the source of truth for qualification status.

### `hardConstraintsPassed`

Array of hard constraints that passed.

Each item includes:

- `code`: machine-readable constraint key.
- `label`: human-readable short label.
- `passed`: must be `true` in this array.
- `actual`: optional vehicle value.
- `limit`: optional user requirement.

Acceptance rule: a failed hard constraint must not appear in `hardConstraintsPassed`.

### `softPreferenceScore`

0-100 score summarizing non-hard preference fit after penalties.

Acceptance rule: this score must be derived from category scores and penalties, not AI text.

### `overallMatchScore`

0-100 deterministic final match score.

Acceptance rule: this must match the ranked vehicle score.

### `recommendationConfidence`

Confidence in the recommendation as a decision.

Fields:

- `score`: 0-100.
- `level`: `high`, `medium`, or `low`.
- `factors`: structured contributors such as match score, soft preference score, data confidence, penalty total, and qualification status.

Acceptance rule: recommendation confidence may be lower than match score when penalties or data concerns exist.

### `dataQualityConfidence`

Confidence in the underlying data.

Fields:

- `score`: 0-100.
- `level`: `high`, `medium`, or `low`.
- `factors`: structured contributors such as assumption count, missing-information count, and live listing availability.

Acceptance rule: data quality confidence is separate from recommendation confidence.

### `reasonsForRecommendation`

Structured positive signals that explain why the vehicle ranked well.

Each item includes:

- `code`: machine-readable signal key.
- `category`: scoring category.
- `field`: vehicle or score field.
- `vehicleValue`: value used by the scorer.
- `userPreference`: optional user preference value.
- `score`: optional category score.
- `weight`: optional category weight.
- `contribution`: optional points contributed to the final score.

Acceptance rule: these are structured records, not natural-language advice.

### `tradeoffs`

Structured weaknesses or penalties.

Each item includes:

- `code`: machine-readable tradeoff key.
- `category`: affected score category.
- `field`: vehicle field involved.
- `vehicleValue`: value used by the scorer.
- `userPreference`: optional user preference value.
- `severity`: `low`, `medium`, or `high`.
- `penaltyPoints`: points deducted.

Acceptance rule: every penalty should be visible as a tradeoff.

### `assumptionsUsed`

Structured assumptions used during scoring.

Each item includes:

- `code`: machine-readable assumption key.
- `field`: affected field.
- `method`: estimation or fallback method.
- `value`: optional value.

Acceptance rule: heuristic maintenance, depreciation, missing listing URL, unverified photo, and seed-catalog fallback should be represented here when applicable.

### `estimatedFields`

Fields that are estimated or derived.

Each item includes:

- `field`: estimated field name.
- `value`: estimated value.
- `unit`: `usd`, `usd_per_month`, `usd_per_year`, `score`, or `text`.
- `method`: deterministic method used.

Acceptance rule: ownership costs and match score must be listed as estimated or derived fields.

### `missingInformation`

Important data not available for the recommendation.

Each item includes:

- `field`: missing field or overlay.
- `expectedSource`: expected data source.
- `impact`: `low`, `medium`, or `high`.

Acceptance rule: missing live listing, FuelEconomy.gov, NHTSA, or CSV overlays must be visible here.

### `fieldProvenance`

Field-level data provenance for important vehicle and ownership fields.

Each item includes:

- `field`: field name.
- `status`: `verified`, `sourced`, `estimated`, `derived`, or `missing`.
- `source`: data source or engine.
- `method`: deterministic lookup or calculation method.

Status assignment:

- `verified`: the value came from a provider source suited to that field, such as listing API for price/mileage, NHTSA for body/safety, or FuelEconomy.gov for MPG.
- `sourced`: the value came from the seed catalog or uploaded CSV overlay but is not live-provider verified.
- `estimated`: the value was estimated by a deterministic rule, such as insurance, maintenance, depreciation, or fallback reliability.
- `derived`: the value was calculated from other fields, such as fuel monthly cost, ownership monthly cost, or overall match score.
- `missing`: the field is unavailable, such as absent listing URL or absent image URL.

Acceptance rule: every `estimatedFields` item must have matching provenance with status `estimated` or `derived`.

### `ownershipSummary`

Monthly ownership estimate.

Fields:

- `estimatedMonthlyTotal`
- `insuranceMonthly`
- `maintenanceMonthly`
- `fuelMonthly`
- `depreciationMonthly`

Acceptance rule: `estimatedMonthlyTotal` must equal the component sum.

### `firstYearOwnershipEstimate`

First-year ownership estimate.

Fields:

- `insurance`
- `maintenance`
- `fuel`
- `depreciation`
- `total`

Acceptance rule: `total` must equal the component sum.

### `betterAlternativesIfConstraintsChange`

Higher-scoring alternatives that failed one or more hard constraints.

Each item includes:

- `vehicleId`
- `year`
- `make`
- `model`
- `overallMatchScore`
- `requiredConstraintChanges`

Acceptance rule: every listed alternative must include at least one failed hard constraint that would need to change.

## No-Match Result

`RecommendationDecisionSet.noMatch` summarizes search outcomes when no primary vehicle qualifies.

Fields:

- `noMatch`: true when zero qualified recommendations exist.
- `totalEvaluated`: number of validated catalog records evaluated.
- `qualifiedCount`
- `compromiseCount`
- `excludedCount`
- `topConstraintBlockers`: constraints that removed the most candidates.
- `compromiseOptions`: up to three compact compromise options, only from flexible constraints.

Acceptance rule: no-match output must never fabricate vehicles absent from the dataset.

## Pipeline Debug Result

`RecommendationDecisionSet.pipelineDebug` exposes the deterministic decision path for benchmarks and QA.

Fields:

- `catalogCount`: full catalog size supplied to the engine.
- `candidateCount`: validated records that entered the recommendation pipeline.
- `filteredCount`: candidates that were not excluded by mandatory constraints.
- `excludedCount`: candidates removed from the primary ranking by mandatory constraints.
- `qualifiedCount`: candidates that passed all hard constraints.
- `compromiseCount`: candidates that failed only flexible constraints.
- `stages`: ordered summaries for load catalog, candidate generation, constraint filtering, suitability evaluation, ranking, Recommendation Object creation, and advisor layer.
- `topFive`: compact structured view of the top five qualified vehicles, or top compromise vehicles when no qualified vehicles exist.
- `runnerUpLossReasons`: structured explanation of why each displayed runner-up lost to the top result.
- `advisorLayerSource`: must be `recommendation_object`.

Acceptance rule: benchmark reports must be able to explain candidate count, filtered count, excluded count, qualified count, top five, and runner-up loss reasons without recalculating scores outside the engine.

## Engine Boundary

The recommendation engine may return labels and machine-readable codes, but it should not produce final natural-language advice. The AI advisor layer should use this object as source material for user-facing explanations.
