# app

Next.js App Router files.

- `page.tsx`: renders the current personalized advisor draft.
- `layout.tsx`: app metadata and root HTML shell.
- `globals.css`: Tailwind import plus global page styles.
- `api/recommendations/route.ts`: server-side recommendation personalization endpoint. OpenAI calls belong here, never in client components.
- `api/vehicle-data/enrich/route.ts`: server-side data enrichment endpoint for NHTSA, FuelEconomy.gov, and listing API overlays.
