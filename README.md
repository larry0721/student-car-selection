# First Car Advisor

A portfolio-ready personalized car advisor for first-time buyers, built with Next.js, TypeScript, Tailwind CSS, Supabase, and the OpenAI API.

## What It Does

The app starts with an optional advisor intake. Users can answer as much or as little as they want, add free-form requirements, and search for car recommendations that match their profile. Results include top vehicle matches, compatibility scoring, reliability and safety estimates, insurance and maintenance estimates, fuel-cost estimates, depreciation context, common issues, pros and cons, similar alternatives, and buying tips.

Recommendations use a deterministic weighted scoring model with hard-constraint filtering, visible penalties, and confidence shown separately from match score. The default weights are affordability 25%, reliability 15%, safety 15%, fuel and energy cost 10%, insurance cost 10%, maintenance risk 10%, practicality 7%, resale value 5%, and driving preference fit 3%. Advanced users can adjust those weights and import score overlays from CSV.

The data layer supports live enrichment from NHTSA vPIC, FuelEconomy.gov, and used-car marketplace/listing APIs. NHTSA and FuelEconomy.gov work without keys. Marketplace listings, prices, and verified photos require a provider key such as Marketcheck, or a custom API configured with `USED_CAR_API_BASE_URL`. Users can optionally import CSV score overlays for reliability, safety, insurance, maintenance, MPG, and common issues.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase schema for normalized car data
- OpenAI API for natural-language preference parsing and recommendation explanations
- NHTSA vPIC, FuelEconomy.gov, and optional used-car listing APIs
- Vercel deployment

## Real Data Setup

- NHTSA vPIC: public API, no key required.
- FuelEconomy.gov: public API, no key required.
- Marketcheck listings: set `USED_CAR_API_PROVIDER=marketcheck` and `MARKETCHECK_API_KEY=...`.
- Custom listings: set `USED_CAR_API_BASE_URL=...` and optionally `USED_CAR_API_KEY=...`.

The Advanced options page shows whether each data source is connected. If no listing provider is configured, the app still uses government data and uploaded CSV overlays, but live listing prices and verified marketplace photos will not appear.

## Local Development

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

Run checks before publishing changes:

```bash
pnpm typecheck
pnpm lint
```

## Data Notes

The public repo keeps the cleaned recommendation catalog in `data/processed/`. Raw Kaggle downloads are intentionally ignored because they are large and can be regenerated locally. See `data/raw/KAGGLE_DATASET_REVIEW.md` and `scripts/build_vehicle_catalog.py` for the dataset evaluation and processing workflow.

## Deployment

Deploy the full app on Vercel from the public GitHub repository. GitHub Pages is not the best target for this project because the app uses Next.js API routes for profile parsing, recommendation requests, and data enrichment.

Required environment variables for production are listed in `.env.example`. Supabase and OpenAI keys should be configured in Vercel project settings, not committed to git.

## Main Folders

- `app/`: Next.js app routes, global styles, and API route handlers.
- `components/`: Reusable UI components for the advisor experience.
- `data/`: Seed vehicle catalog used before live market data is connected.
- `lib/`: Domain logic such as affordability, scoring, ownership estimates, data integrations, CSV parsing, and Supabase setup.
- `types/`: Shared TypeScript types for buyer profiles, vehicles, and recommendation results.
- `supabase/`: Database schema and future migrations.
