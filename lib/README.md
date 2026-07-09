# lib

Domain and integration logic.

- `affordability.ts`: buyer budget and number formatting helpers.
- `recommendations.ts`: weighted compatibility scoring, ownership estimates, similar alternatives, and buying tips. Default weights are budget fit 30%, reliability 20%, safety 15%, fuel economy 10%, insurance cost 10%, performance 5%, practicality 5%, and resale value 5%.
- `supabase.ts`: browser Supabase client factory.
- `data/`: provider clients and merge helpers for NHTSA, FuelEconomy.gov, configurable listing APIs, CSV imports, and normalized data overlays.

Prefer putting reusable business rules here instead of inside React components.
