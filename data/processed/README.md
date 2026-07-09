# processed

Generated app-ready data lives here.

- `vehicleCatalog.json`: normalized vehicles consumed by `data/vehicleCatalog.ts`.
- `vehicleCatalog.metadata.json`: source files and important caveats for the generated catalog.

Regenerate these files with:

```bash
python3 scripts/build_vehicle_catalog.py
```

Safety and reliability fields are conservative heuristics until dedicated score overlays are uploaded or connected through Supabase/provider integrations.

The generator intentionally keeps a balanced catalog rather than simply taking the highest-scoring economy cars. This preserves coverage for trucks, manuals, AWD/4WD vehicles, wagons, minivans, coupes, convertibles, EVs, and newer model-year searches.
