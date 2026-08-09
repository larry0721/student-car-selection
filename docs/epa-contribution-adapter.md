# EPA Canonical Vehicle Contribution Adapter

## Role

The EPA adapter is the pure normalization boundary between one caller-selected FuelEconomy.gov configuration and a sparse `CanonicalVehicleContribution`.

```text
getVehicleById(callerSelectedId)
  -> EpaVehicleRecord
  -> normalizeEpaVehicleToContribution
  -> CanonicalVehicleContribution
  -> canonical contribution merger
```

The adapter does not fetch records, search menus, select configurations, merge sources, create a complete CVR, or participate in recommendations.

## Public API

```ts
type EpaContributionNormalizationOptions = {
  dataUse?: "production" | "fixture" | "test";
};

type EpaContributionNormalizationResult = {
  contribution: CanonicalVehicleContribution | null;
  issues: CanonicalContributionIssue[];
};

normalizeEpaVehicleToContribution(
  sourceRecord: EpaVehicleRecord,
  context: CanonicalIngestionContext,
  options?: EpaContributionNormalizationOptions,
): EpaContributionNormalizationResult

epaContributionAdapter:
  CanonicalVehicleContributionAdapter<EpaVehicleRecord>
```

The pure normalizer performs no network I/O. The batch adapter applies the same normalizer to already selected source records.

## Scope And Linkage

Every accepted EPA record uses `recordScope: "configuration"`. FuelEconomy.gov vehicle IDs identify tested vehicle configurations, not physical vehicles, so the adapter never invents a VIN.

Linkage retains:

- normalized make, model, and model year;
- `configurationId: "fueleconomy:{id}"`;
- external ID namespace `fueleconomy_gov_vehicle_id`;
- EPA ID as `sourceRecordId` and source metadata.

The source URL is `https://www.fueleconomy.gov/ws/rest/vehicle/{id}`. The source observation date uses `modifiedOn`, then `createdOn`, then no source observation date. Canonical datum `asOfDate` falls back to the ingestion retrieval timestamp when source dates are absent.

## Mapping Table

| EPA source | Canonical destination | Rule | Unit/status |
| --- | --- | --- | --- |
| `make` | `identity.make` | whitespace normalization only | `none`, sourced |
| `model` | `identity.model` | whitespace normalization only | `none`, sourced |
| `year` | `identity.modelYear` | validated integer | `year`, sourced |
| `VClass` | `identity.vehicleCategory` | deterministic class mapping when safe | `none`, sourced or missing |
| `VClass` | `identity.bodyStyle` | only SUV, pickup, minivan, or wagon when explicit | `none`, sourced or missing |
| `drive` | `identity.drivetrain` | deterministic FWD/RWD/AWD/4WD mapping | `none`, sourced or missing |
| `trany` | `identity.transmission` | automatic/manual/CVT family | `none`, sourced or missing |
| `fuelType*` plus explicit configuration facts | `identity.fuelType` | deterministic powertrain mapping | `none`, sourced or missing |
| `comb08` | `environment.fuelEconomy` | primary combined MPG; EV fallback is MPGe | `mpg` or `mpge`, sourced |
| `combE` | `environment.fuelEconomy` | preferred for battery-electric energy consumption | `kwh_per_100_miles`, sourced |
| `range` | `environment.evRange` | positive EV/PHEV range only | `miles`, sourced |
| `co2TailpipeGpm` | `environment.emissions` | preferred direct tailpipe value | `grams_co2e_per_mile`, sourced |
| `co2` | `environment.emissions` | fallback when tailpipe field is unavailable | `grams_co2e_per_mile`, sourced |
| `fuelCost08` | `financial.fuelEnergyCost` | annual source cost divided by 12 | `usd_per_month`, derived |

No other canonical fields are populated.

## Vehicle-Class Rules

Safe category mappings:

- Minicompact/Subcompact Cars -> `subcompact_car`;
- Compact Cars -> `compact_car`;
- Mid-Size/Midsize Cars -> `midsize_car`;
- Large Cars -> `large_car`;
- Sport Utility Vehicles -> `suv`;
- Pickup Trucks -> `pickup`;
- Minivans -> `minivan`;
- Cargo/Passenger Vans -> `van`.

Safe body-style mappings exist only for explicit SUV, pickup truck, minivan, and station-wagon classes. Car size classes do not prove sedan, coupe, or hatchback body style, so body style becomes explicitly missing with `insufficient_specificity`. EPA SUV class does not prove crossover status and emits a reduced-specificity issue.

Two-seater, special-purpose, and unfamiliar classes remain missing with a typed ambiguity or unsupported-value issue. General vans have a category but no lossless canonical body-style value. Station wagons have a body style but no lossless current category value.

## Drivetrain Rules

- Front-Wheel Drive -> `FWD`;
- Rear-Wheel Drive -> `RWD`;
- All-Wheel Drive -> `AWD`;
- 4-Wheel Drive and Part-time 4-Wheel Drive -> `4WD`.

`2-Wheel Drive` and historical `4-Wheel or All-Wheel Drive` labels are ambiguous and remain missing. Drivetrain is never inferred from vehicle class.

## Transmission Rules

- explicit CVT, continuously variable, or variable-gear-ratio wording -> `cvt`;
- strings beginning with Manual -> `manual`;
- explicit Automatic wording -> `automatic`.

The complete EPA `trany` string remains in evidence. Unknown code formatting is not guessed.

## Fuel Rules

- Regular, Premium, Midgrade, or Gasoline -> `gas`;
- Diesel -> `diesel`;
- Electricity alone -> `electric`;
- Hydrogen alone -> `hydrogen`;
- explicit Hybrid source/model identity with gasoline and no plug-in evidence -> `hybrid`;
- gasoline plus electricity with explicit PHEV wording, positive electric range, or positive charging time -> `plug_in_hybrid`.

E85, CNG, natural gas, LPG, propane, conflicting conventional fuels, and unresolved gasoline/electric combinations remain missing. Alternate-efficiency presence alone does not establish a hybrid.

## Efficiency And Electric Data

The current CVR contains one fuel-economy datum rather than separate city, highway, combined, primary-fuel, and alternate-fuel fields.

- Combustion, diesel, hybrid, and plug-in hybrid records use positive `comb08` as combined MPG.
- Battery-electric records prefer positive `combE` as kWh/100 miles.
- If EV `combE` is unavailable, positive `comb08` is retained as MPGe.
- Non-positive or malformed selected values become explicitly missing rather than zero efficiency.

Positive EV/PHEV `range` maps to canonical EV range. A source range of zero for a non-plug-in vehicle becomes `missing/not_applicable`; it is not represented as a zero-mile EV.

`city08`, `highway08`, alternate-fuel efficiency, city/highway electric consumption, city/highway range, and charging time remain in evidence. The CVR has no lossless destination for their separate semantics.

EPA charging fields are hours, while `environment.chargingSpeed` requires kilowatts. Charging time cannot be converted into power without battery-energy and charging-curve data, so the adapter deliberately does not populate charging speed.

## Emissions And Scores

The adapter prefers `co2TailpipeGpm`, then falls back to `co2`. Source grams per mile map directly to canonical grams CO2e per mile. A legitimate electric-vehicle zero remains zero.

Alternate-fuel tailpipe CO2, EPA GHG scores, and EPA fuel-economy scores remain in evidence. The current CVR has no alternate-emissions field or source-defined 0-10 environmental-score destination. The adapter does not multiply these scores to manufacture generic 0-100 concepts.

## Annual Fuel Cost

FuelEconomy.gov `fuelCost08` is an annual estimate based on 15,000 miles, 55% city driving, and the source fuel prices. The adapter divides it by 12 and returns `financial.fuelEnergyCost` in USD/month with `status: "derived"`.

The source annual value, annual mileage, city-driving share, and `personalized: false` remain in `measurementContext`. This value is not presented as the buyer's exact ownership cost. Alternate-fuel annual cost remains evidence-only because the CVR has one fuel-energy-cost field.

## Omitted, Missing, And Not Applicable

- Source field absent: no canonical datum is emitted.
- Source field present as `null`: emit a missing datum only when that field has a canonical destination, plus an explicit-source-missing issue.
- Supported non-null value: emit an evidence-backed claim.
- Unsupported or ambiguous categorical value: emit a missing datum and typed issue.
- Gasoline/diesel/non-plug-in `range: 0`: emit `missing/not_applicable` and retain source evidence.
- Valid zero emissions: preserve zero as a canonical value.
- Source values with no CVR destination: preserve them in evidence and emit a grouped unsupported-destination warning when materially populated.

Omission never becomes explicit missing merely to make the contribution look complete.

## Evidence

At most three evidence records are created per source record:

1. `direct`: identity, published measurements, dates, and source-only measurements;
2. `mapped`: EPA vehicle class, drivetrain, transmission, and fuel vocabulary;
3. `derived`: annual fuel-cost assumptions and monthly conversion.

Each evidence record preserves provider, EPA source type, EPA ID, endpoint, source fields and original values, configuration scope, source/retrieval dates, market, methodology, license, data-use classification, normalization method, and notes about source and canonical units.

Every populated or explicitly missing datum references valid evidence. Unsupported source facts remain traceable through evidence and typed issues.

## Confidence

Direct EPA published values use high field confidence. Safe categorical mappings use high confidence; broad or reduced-specificity mappings use medium-to-high confidence. Derived monthly cost uses 0.90 confidence because the arithmetic is deterministic but the source estimate uses standardized assumptions.

Source confidence starts at 0.86 and adds at most 0.07 for coverage across five meaningful groups: configuration, fuel, efficiency, emissions, and primary fuel cost. It then subtracts bounded penalties for material invalid/ambiguous mappings, reduced specificity, and stale or absent source dates. Raw field count does not inflate confidence.

Confidence remains separate from recommendation match score.

## Typed Issues

The adapter emits `CanonicalContributionIssue` values for:

- invalid context, EPA ID, make, model, or year;
- malformed numeric values reaching normalization;
- explicit source missingness;
- unsupported or ambiguous vehicle class, fuel, drivetrain, or transmission;
- reduced vehicle-class or hybrid specificity;
- not-applicable EV range handling;
- current CVR fields that cannot losslessly represent an EPA source concept.

Invalid identity or context rejects the contribution. Other issues preserve a sparse contribution and prevent unsafe values from being fabricated.

## Deliberately Unmapped Fields

The following remain evidence-only because the current CVR has no lossless destination:

- cylinders and displacement;
- city/highway and alternate-fuel MPG;
- separate city/highway electric consumption;
- separate city/highway EV range;
- 120V/240V charging time;
- alternate-fuel annual cost;
- alternate-fuel tailpipe emissions;
- EPA GHG and fuel-economy scores;
- source creation/modification dates as vehicle traits.

The adapter does not add CVR fields merely to absorb one source schema.

## Known Limitations And Next Step

The adapter relies on a caller-selected EPA vehicle ID. It does not decide whether a menu option is exact, probable, ambiguous, or incorrect. It also cannot represent multiple fuel-economy units or alternate-fuel values simultaneously in the current CVR.

The exact next task is NHTSA + EPA multi-source merge validation. Use compatible mocked contributions for one vehicle, verify linkage, field authority, evidence preservation, missing-data completion, confidence, and order independence, and confirm that no configuration is selected automatically during the merge.
