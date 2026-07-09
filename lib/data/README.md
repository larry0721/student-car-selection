# lib/data

Data integration layer for normalized vehicle enrichment.

- `nhtsa.ts`: NHTSA vPIC make/model/year adapter.
- `fuelEconomy.ts`: FuelEconomy.gov vehicle option and MPG adapter.
- `usedCarListings.ts`: used-car listing adapters for Marketcheck (`USED_CAR_API_PROVIDER=marketcheck`, `MARKETCHECK_API_KEY`) or a custom API (`USED_CAR_API_BASE_URL`, optional `USED_CAR_API_KEY`).
- `csvImport.ts`: optional CSV parser for user-provided score overlays.
- `mergeVehicleData.ts`: applies normalized overlays to catalog vehicles before scoring.
- `vehicleIdentity.ts`: shared make/model/year key helpers.

All providers should return `VehicleDataOverlay` so the recommendation algorithm does not depend on vendor-specific payload shapes.
