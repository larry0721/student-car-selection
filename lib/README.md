# lib

Domain and integration logic.

- `affordability.ts`: buyer budget and number formatting helpers.
- `recommendations.ts`: deterministic hard-constraint filtering, weighted compatibility scoring, confidence scoring, ownership estimates, similar alternatives, and buying tips. Default weights are affordability 25%, reliability 15%, safety 15%, fuel and energy cost 10%, insurance cost 10%, maintenance risk 10%, practicality 7%, resale value 5%, and driving preference fit 3%.
- `supabase.ts`: browser Supabase client factory.
- `data/`: provider clients and merge helpers for NHTSA, FuelEconomy.gov, configurable listing APIs, CSV imports, and normalized data overlays.

Prefer putting reusable business rules here instead of inside React components.
