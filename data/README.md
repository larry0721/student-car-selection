# data

Vehicle data is staged in layers so the app can run locally, accept CSV overlays, and later sync normalized records into Supabase.

- `vehicleCatalog.ts`: typed app entry point for the generated catalog used by the recommendation UI.
- `processed/vehicleCatalog.json`: compact normalized catalog generated from Kaggle Craigslist listings, CooperUnion specs, Used-cars-catalog, 2023 model specs, and 2025 EV specs.
- `processed/vehicleCatalog.metadata.json`: source and generation notes for the current catalog build.
- `seedVehicles.ts`: small legacy fallback catalog kept for reference while the processed catalog is the active data source.

The current catalog is balanced across body style, drivetrain, transmission, EV/newer-year coverage, and common first-car segments to reduce strict-filter no-match cases. Archived listing photos are marked unverified, so the UI avoids showing mismatched or stale car images unless a live listing provider or user CSV explicitly verifies them.
