# EPA / FuelEconomy.gov Source Client

## Role

The EPA source client is the network boundary for official FuelEconomy.gov vehicle data. It discovers source records and returns a strict source-typed representation without converting, matching, merging, scoring, or recommending vehicles.

```text
FuelEconomy.gov
  -> EPA source client
  -> EpaMenuItem / EpaVehicleOption / EpaVehicleRecord
  -> future EPA contribution adapter
  -> CanonicalVehicleContribution
  -> canonical merger
  -> CanonicalVehicleRecord
```

The client lives at `src/vehicle-intelligence/sources/epa/epa-client.ts`. It is server/source-layer code and has no UI, route, catalog, recommendation, or canonical-record imports.

## Public API

```ts
getMakesForYear(year: number): Promise<EpaMenuItem[]>

getModelsForYearMake(
  year: number,
  make: string,
): Promise<EpaMenuItem[]>

getVehicleOptions(
  year: number,
  make: string,
  model: string,
): Promise<EpaVehicleOption[]>

getVehicleById(
  vehicleId: string | number,
): Promise<EpaVehicleRecord>
```

Each public function performs exactly one request. There are no hidden follow-up calls or automatic configuration choices.

## Official Endpoints

The base URL is `https://www.fueleconomy.gov/ws/rest`.

| Operation | Endpoint |
| --- | --- |
| Makes for year | `/vehicle/menu/make?year={year}` |
| Models for year and make | `/vehicle/menu/model?year={year}&make={make}` |
| Configurations and IDs | `/vehicle/menu/options?year={year}&make={make}&model={model}` |
| Full source record | `/vehicle/{id}` |

Every request sends `Accept: application/json`. The client does not scrape HTML and does not fall back to regex-based XML parsing.

## Lookup Flow

FuelEconomy.gov identity is configuration-based:

```text
year
  -> make
  -> model
  -> all EPA options
  -> caller-selected EPA vehicle ID
  -> full EPA source record
```

`getVehicleOptions` returns every configuration supplied by the service. It never selects the first item or assumes that a make/model label identifies one unique EPA record.

## Menu Normalization

FuelEconomy.gov may encode `menuItem` as one object, an array, `null`, or an empty array. The client normalizes these into predictable arrays:

- one object becomes a one-element array;
- multiple objects remain an array;
- `null` and an empty array become `[]`;
- a missing `menuItem`, non-object item, blank label, or blank value is an unexpected response error.

`EpaMenuItem` preserves the source `text` and `value` fields. `EpaVehicleOption` maps `value` to the exact string `id`, maps `text` to `label`, and adds the requested year/make/model context. Leading zeroes in string IDs are retained.

## Source Fields

`EpaVehicleRecord` keeps FuelEconomy.gov source names rather than CVR names.

Identity and configuration:

- `id`, `year`, `make`, `model`;
- `VClass`, `drive`, `trany`, `cylinders`, `displ`;
- `fuelType`, `fuelType1`, `fuelType2`.

Efficiency:

- `city08`, `highway08`, `comb08`;
- `cityA08`, `highwayA08`, `combA08`.

Electric and plug-in data:

- `range`, `rangeCity`, `rangeHwy`;
- `charge240`, `charge120`;
- `cityE`, `highwayE`, `combE`.

Cost and environment:

- `fuelCost08`, `fuelCostA08`;
- `co2`, `co2TailpipeGpm`, `co2TailpipeAGpm`;
- `ghgScore`, `ghgScoreA`, `feScore`, `feScoreA`.

Metadata:

- `createdOn`, `modifiedOn`.

The required source identity fields are `id`, `year`, `make`, and `model`. A full response without these fields is rejected.

## Parsing And Null Rules

Source values are parsed deterministically:

- finite numbers remain numbers;
- numeric strings become numbers;
- zero remains zero;
- present empty strings become `null`;
- malformed optional numeric values become `null`, never zero;
- absent optional source fields remain absent from the returned object;
- documented `-1` unavailable sentinels become `null` for `co2`, `ghgScore`, `ghgScoreA`, `feScore`, and `feScoreA`;
- other zero or negative source values are preserved unless the source documentation defines them as unavailable.

This keeps three states distinct: a real zero, a present but unavailable/null value, and a source field that was not returned. A later contribution adapter will decide how each state maps to canonical claims or explicit missingness.

## Input Validation

- Model year must be an integer from 1984 through the current UTC year plus two.
- Make and model must be non-blank strings.
- EPA vehicle ID must be a positive safe integer or numeric string.
- Invalid input fails before any request is made.

Query values and path IDs are encoded with standard URL APIs.

## Error Behavior

The client uses the repository's standard `Error` style and preserves the original error as `cause` for network, timeout, and JSON parsing failures.

Distinct errors cover:

- invalid year, make, model, or vehicle ID;
- network failure;
- the established six-second source timeout;
- non-2xx HTTP status;
- malformed JSON;
- malformed menu or menu item;
- malformed vehicle response;
- empty vehicle record;
- missing required vehicle identity fields.

Empty menus are valid `[]` results, not fabricated errors or fallback matches.

## Caching

No general source-cache abstraction exists in the vehicle-intelligence layer. This task therefore adds no cache. A future cache can wrap these four public functions or the request boundary without changing the returned source types. The client does not issue repeated hidden requests inside one call.

## Legacy Boundary

`lib/data/fuelEconomy.ts` remains the application's legacy runtime enrichment path. It performs model-family fallback matching, limits options to three, fetches details automatically, normalizes values into legacy vehicle fields, and creates `VehicleDataOverlay` objects.

Those behaviors are deliberately not reused here because this source client must preserve all configurations and must not make matching decisions. The legacy module and current recommendation behavior remain unchanged.

## Deliberate Non-Responsibilities

The source client does not:

- choose an EPA configuration;
- infer exact, probable, or ambiguous matches;
- normalize transmission, drivetrain, fuel, or efficiency into CVR values;
- create `CanonicalVehicleContribution`;
- create or merge `CanonicalVehicleRecord`;
- update the legacy catalog or overlays;
- score or rank a vehicle;
- call recommendation code;
- cache or persist records.

## Step 4B Boundary

Phase 3.2C Step 4B should implement a pure EPA contribution adapter. It should accept an `EpaVehicleRecord`, preserve the EPA vehicle ID and source claims, map supported fields into sparse `CanonicalVehicleContribution` datums, represent unavailable source fields explicitly, emit normalization issues, and remain separate from configuration matching.

Configuration matching should remain a separate later responsibility. It must compare requested vehicle identity against all `EpaVehicleOption` objects and report exact, probable, ambiguous, or not-found status without hiding alternatives.

## Test Policy

`scripts/test_epa_client.ts` replaces `globalThis.fetch` for its entire run. Permanent tests use no live requests. They cover singleton and array menus, empty menus, multiple options, exact IDs, gasoline/hybrid/EV records, parsing and sentinels, failure modes, input immutability, request count, explicit JSON negotiation, and isolation from canonical and recommendation modules.

Limited live verification is a manual source check only. Normal automated tests never depend on FuelEconomy.gov availability.
