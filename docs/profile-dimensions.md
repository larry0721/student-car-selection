# BuyerProfile Dimension Contract

Phase 3.1B makes six objective vehicle dimensions explicit throughout the semantic-to-recommendation path:

`UnderstandingDraft -> canonical mapping -> confirmation -> BuyerProfile -> candidate qualification`.

The recommendation score and ranking formula do not read or change these fields. Required, allowed-fallback, and excluded values affect qualification; preferred values remain visible and are only scored where a pre-existing scoring input supports them.

## Authoritative state

Each supported dimension has typed intent arrays:

| Dimension | Required | Preferred | Allowed | Excluded |
| --- | --- | --- | --- | --- |
| Make | `requiredMakes` | `preferredMakes` | `allowedMakes` | `excludedMakes` |
| Body style | `requiredBodyStyles` | `preferredBodyStyles` | `allowedBodyStyles` | `excludedBodyStyles` |
| Vehicle category | `requiredVehicleCategories` | `preferredVehicleCategories` | `allowedVehicleCategories` | `excludedVehicleCategories` |
| Fuel type | `requiredFuelTypes` | `preferredFuelTypes` | `allowedFuelTypes` | `excludedFuelTypes` |
| Drivetrain | `requiredDrivetrains` | `preferredDrivetrains` | `allowedDrivetrains` | `excludedDrivetrains` |
| Transmission | `requiredTransmissions` | `preferredTransmissions` | `allowedTransmissions` | `excludedTransmissions` |

The values are typed in [types/buyer.ts](/Users/tkcheung2023/Documents/student%20car%20selection/types/buyer.ts). `vehicleCategory` currently uses the same typed values as body style because the catalog exposes a normalized `bodyType`, not a separate category taxonomy.

## Intent policy

- **Required:** a matching vehicle qualifies. A non-matching vehicle is excluded unless it matches an explicitly allowed fallback.
- **Allowed:** paired with a required value, it is an explicit fallback and appears as a compromise. By itself, it does not silently exclude other vehicles. This is why “Manual is okay” does not discard automatic vehicles.
- **Excluded:** always removes the matching vehicle from qualified and compromise results.
- **Preferred:** never becomes a hard constraint. It remains available to the advisor and may use an existing score input only when that input already exists. There is no new subjective score for preferred body style, fuel, drivetrain, or transmission.

For an explicit required value plus an allowed fallback, the candidate stages are: required match -> qualified; allowed fallback -> compromise; unrelated value -> excluded. For example, required SUV plus allowed sedan does not permit a hatchback.

## Conflict and update rules

`lib/profileDimensions.ts` is the single deterministic resolver.

1. Excluded removes the same value from required, preferred, and allowed.
2. Required removes the same value from preferred and allowed.
3. Preferred removes the same value from allowed.
4. A later confirmed update first removes its values from every current intent bucket, then adds them to the new bucket. This lets `Manual is okay` followed by `No manual` become only `excludedTransmissions: ["manual"]`.
5. Uncertain semantic values do not produce a profile update.
6. When canonical arrays exist, they are authoritative over a contradictory legacy field. The legacy field is re-derived after confirmation.

## Legacy compatibility audit

| Legacy field | Type / intent | Writer(s) | Reader(s) | Candidate use | Migration status |
| --- | --- | --- | --- | --- | --- |
| `requiredMake` | single required make | older questionnaire and compatibility adapter | legacy candidate branch, existing make scoring | hard filter | derived from one canonical required make |
| `preferredMake` | single preferred make | older questionnaire and compatibility adapter | existing driving-preference scoring | soft score input | derived from one canonical preferred make |
| `allowedMakes` | multiple allowed makes | older questionnaire and canonical mapping | legacy candidate branch | existing hard permitted-set behavior | retained because it predates the new model |
| `excludedMakes` | multiple excluded makes | older questionnaire and canonical mapping | legacy candidate branch | hard exclusion | retained because it predates the new model |
| `bodyStyle` | single required body style | detailed questionnaire and compatibility adapter | legacy candidate branch | hard filter | derived only from one canonical required style |
| `requiredFuelType` | single required fuel type | detailed questionnaire and compatibility adapter | legacy candidate branch | hard filter | derived only from one canonical required fuel type |
| `drivetrainPreference` | single required drivetrain | detailed questionnaire and compatibility adapter | legacy candidate branch and existing practicality signals | hard filter | derived only from one canonical required drivetrain |
| `transmissionPreference` | single required automatic/manual value | detailed questionnaire and compatibility adapter | legacy candidate branch and existing driving signals | hard filter | derived only from one canonical required non-CVT transmission |

The compatibility adapter is `applyDimensionState` in [lib/profileDimensions.ts](/Users/tkcheung2023/Documents/student%20car%20selection/lib/profileDimensions.ts). It keeps current detailed-preference callers working while `getProfileDimensionState` gives candidate qualification a single resolved state. The compatibility fields can be removed only after the questionnaire and every legacy score/qualification consumer migrate to canonical arrays.

## Projection and confirmation

[lib/carDomainOntology.ts](/Users/tkcheung2023/Documents/student%20car%20selection/lib/carDomainOntology.ts) defines a destination for every intent. [lib/semanticMapping.ts](/Users/tkcheung2023/Documents/student%20car%20selection/lib/semanticMapping.ts) normalizes and projects the value. [lib/confirmedProfileConversion.ts](/Users/tkcheung2023/Documents/student%20car%20selection/lib/confirmedProfileConversion.ts) applies a confirmed update through the resolver rather than copying fields independently.

Examples:

- `No SUVs` -> `excludedBodyStyles: ["suv"]`
- `A sedan is okay` -> `allowedBodyStyles: ["sedan"]`
- `Hybrid or electric is okay` -> `allowedFuelTypes: ["hybrid", "electric"]`
- `Hybrid required, electric is acceptable` -> `requiredFuelTypes: ["hybrid"]`, `allowedFuelTypes: ["electric"]`
- `I only want AWD` -> `requiredDrivetrains: ["AWD"]`
- `No manual transmission` -> `excludedTransmissions: ["manual"]`

The confirmation layer displays labels such as “Required drivetrain” and “Excluded fuel type”; it does not read UI labels to make the profile decision. [lib/recommendationReadiness.ts](/Users/tkcheung2023/Documents/student%20car%20selection/lib/recommendationReadiness.ts) counts confirmed canonical fields as actionable, while defaults and preserved unsupported context remain insufficient.

## Candidate qualification

[lib/recommendations.ts](/Users/tkcheung2023/Documents/student%20car%20selection/lib/recommendations.ts) obtains a resolved state through `getProfileDimensionState` before the suitability and ranking stages. It records the constraint result in the `RecommendationObject`; it does not add a new score or rank bonus.

`AWD` accepts catalog `AWD` and equivalent `4WD` entries. Transmission values are normalized case-insensitively, including catalog `CVT` values.

## Catalog coverage

The current 320-record catalog contains all supported normalized body styles, 17 diesel records, 26 electric records, 20 hybrid records, AWD and 4WD records, 83 manual records, and 6 CVT records. Vehicle category is not independently populated, so category intent is currently evaluated through `bodyType` and should not be expanded without a separately sourced category field.

## Regression coverage

[scripts/test_profile_dimension_pipeline.ts](/Users/tkcheung2023/Documents/student%20car%20selection/scripts/test_profile_dimension_pipeline.ts) covers semantic projection, confirmation, profile state, and candidate behavior for exclusions, allowed values, required AWD, transmission handling, multi-fuel preservation, and the truck/SUV/sedan case. It is run with `pnpm test:profile-dimensions`.
