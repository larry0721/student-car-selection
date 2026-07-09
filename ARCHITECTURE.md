# First-Car Buyer App Architecture

## Confirmed Stack

- Frontend and backend: Next.js with the App Router
- Language: TypeScript
- Styling: Tailwind CSS
- Database and auth: Supabase
- Personalized recommendations: OpenAI API through server-side Next.js route handlers
- Deployment: Vercel

## Product Goal

Help first-time car buyers find realistic first cars by combining affordability, lifestyle preferences, ownership cost, reliability signals, and transparent recommendation explanations.

## Application Architecture

### Next.js App

The Next.js app owns the main product experience and server-side integration boundaries.

- `app/page.tsx`: first usable buyer profile and recommendation workspace.
- `app/api/recommendations/route.ts`: server-only OpenAI recommendation endpoint.
- `app/layout.tsx`: shared metadata and shell.
- `app/globals.css`: Tailwind entry point and design tokens.

Use client components for interactive form state and server route handlers for anything that touches secrets, Supabase service access, or the OpenAI API.

### Supabase

Supabase stores durable user data:

- Authenticated users.
- Buyer profiles.
- Saved comparison vehicles.
- Recommendation sessions and generated explanations.
- Future listing/cache tables for market data.

The browser should use the anon Supabase key only for row-level-security-protected reads and writes. Server route handlers can use privileged operations only when needed and only with server-side environment variables.

### OpenAI API

OpenAI calls must stay server-side in `app/api/*` routes so API keys never reach the browser.

Initial use:

- Accept buyer profile and candidate vehicles.
- Return concise personalized fit summaries, ranked recommendations, and first-buyer watchouts.
- Keep deterministic local scoring as a fallback when `OPENAI_API_KEY` is not configured.

### Vercel

Vercel hosts the Next.js app and stores runtime environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` if server-only admin access is later needed
- `OPENAI_API_KEY`
- `OPENAI_RECOMMENDATION_MODEL`

## Database Schema

### profiles

Supabase Auth already provides `auth.users`; this table stores app-level profile data.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key references auth.users(id) | User id |
| display_name | text | Optional display name |
| created_at | timestamptz default now() | Creation time |
| updated_at | timestamptz default now() | Last update time |

### buyer_profiles

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key default gen_random_uuid() | Profile id |
| user_id | uuid references auth.users(id) | Owner |
| label | text | Example: School commute |
| monthly_budget | integer not null | Maximum all-in monthly spend |
| down_payment | integer not null | Cash available up front |
| loan_term_months | integer not null | Planned financing length |
| apr | numeric(5,2) not null | Estimated interest rate |
| monthly_miles | integer not null | Expected driving |
| fuel_price | numeric(5,2) not null | Local fuel estimate |
| insurance_budget | integer not null | Expected monthly insurance |
| min_year | integer | Preference |
| max_mileage | integer | Preference |
| max_price | integer | Derived or manually set |
| min_condition | integer | 1-5 |
| preferred_type | text | Sedan, hatchback, SUV, truck, motorcycle, etc. |
| preferred_fuel | text | Gas, hybrid, electric, etc. |
| preferred_drivetrain | text | FWD, AWD, 4WD, RWD |
| min_mpg | integer | Efficiency target |
| custom_requirements | text | Freeform lifestyle needs |
| created_at | timestamptz default now() | Creation time |
| updated_at | timestamptz default now() | Last update time |

### vehicles

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key default gen_random_uuid() | Vehicle id |
| make | text not null | Manufacturer |
| model | text not null | Model |
| year | integer not null | Model year |
| body_type | text not null | Sedan, hatchback, pickup, etc. |
| fuel_type | text not null | Gas, hybrid, electric, etc. |
| drivetrain | text not null | FWD, AWD, 4WD, RWD |
| transmission | text | Automatic, CVT, manual |
| reliability_score | integer | 0-100 normalized |
| safety_score | integer | 0-100 normalized |
| typical_mpg | integer | Combined MPG or MPGe |
| typical_insurance | integer | Estimated monthly insurance |
| ownership_notes | text | Known strengths and risks |
| created_at | timestamptz default now() | Creation time |
| updated_at | timestamptz default now() | Last update time |

### listings

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key default gen_random_uuid() | Listing id |
| vehicle_id | uuid references vehicles(id) | Catalog vehicle |
| source | text not null | Manual, dealer, marketplace, API |
| vin | text | Optional VIN |
| mileage | integer not null | Listing mileage |
| price | integer not null | Asking price |
| condition | integer not null | 1-5 normalized |
| location | text | City/region |
| url | text | Source URL |
| first_seen_at | timestamptz default now() | Discovery time |
| last_seen_at | timestamptz default now() | Last refresh time |

### comparison_items

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key default gen_random_uuid() | Comparison item |
| user_id | uuid references auth.users(id) | Owner |
| buyer_profile_id | uuid references buyer_profiles(id) | Profile context |
| listing_id | uuid references listings(id) | Listing-backed option |
| custom_vehicle | jsonb | Manual vehicle details |
| notes | text | Buyer notes |
| status | text | Saved, contacted, test drive, inspected, rejected |
| created_at | timestamptz default now() | Added time |

### recommendation_sessions

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key default gen_random_uuid() | Session id |
| user_id | uuid references auth.users(id) | Owner |
| buyer_profile_id | uuid references buyer_profiles(id) | Profile used |
| criteria | jsonb not null | Frozen scoring inputs |
| model | text | OpenAI model used |
| created_at | timestamptz default now() | Run time |

### recommendation_results

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid primary key default gen_random_uuid() | Result id |
| session_id | uuid references recommendation_sessions(id) | Parent session |
| listing_id | uuid references listings(id) | Listing result |
| vehicle_id | uuid references vehicles(id) | Catalog result |
| score | integer not null | 0-100 |
| reasons | jsonb not null | Explanation bullets |
| watchouts | jsonb not null | Risk bullets |
| rank | integer not null | Display order |

## Folder Structure

```text
student-car-selection/
  app/
    api/
      recommendations/
        route.ts
    globals.css
    layout.tsx
    page.tsx
  components/
    BuyerProfilePlanner.tsx
    RecommendationCard.tsx
  lib/
    affordability.ts
    recommendations.ts
    supabase.ts
  data/
    seedVehicles.ts
  types/
    buyer.ts
    vehicle.ts
  supabase/
    schema.sql
  package.json
  next.config.ts
  tailwind.config.ts
  postcss.config.js
  tsconfig.json
```

## Feature Development Order

1. Stack foundation and buyer affordability planner
   - Next.js, TypeScript, Tailwind, basic Supabase/OpenAI environment wiring.
   - Buyer profile inputs and derived buying power.
   - Deterministic first recommendations from seeded vehicles.

2. Guided preference intake
   - Commute, parking, weather, passengers, cargo, confidence, safety, reliability, and style.
   - Convert answers into structured scoring criteria.

3. OpenAI personalized recommendation endpoint
   - Generate buyer-specific explanations and watchouts.
   - Keep deterministic scoring as fallback and guardrail.

4. Supabase persistence
   - Save buyer profiles and comparison items with row-level security.
   - Add sign-in only when persistence needs a real user identity.

5. Shortlist and comparison workflow
   - Favorites, notes, status, dealer/listing links, inspection checklist, and test-drive tracking.

6. Vehicle detail pages
   - Ownership cost breakdowns, first-buyer suitability, maintenance risks, and safety/reliability context.

7. Listing search and data ingestion
   - Add API-backed listing sources and cache normalized listings in Supabase.

8. Market intelligence
   - Price fairness, depreciation estimates, insurance/fuel sensitivity, and alerts.

9. Vercel production hardening
   - Environment validation, analytics, error boundaries, rate limits, and recommendation evals.
