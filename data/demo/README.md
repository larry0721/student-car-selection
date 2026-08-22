# Golden Vehicle Intelligence Demo Data

`goldenVehicleIntelligence.v1.json` is a generated, deployable projection of the five reviewed golden vehicle records.

Regenerate it with:

```bash
pnpm generate:demo-intelligence
```

The generator reads the structured published-vehicle, NHTSA safety, and reliability-risk artifacts. Do not edit the snapshot by hand. It contains presentation-safe facts and source attribution only; production-scale ingestion and persistence remain separate.
