# Vehicle Knowledge Repository Data

This directory is separate from the immutable catalog in `data/processed/vehicleCatalog.json`.

- `repositories/` is the local persistence boundary for serialized Vehicle Knowledge Repository state and is gitignored except for its placeholder.
- `data/vehicleKnowledgeFixtures.ts` contains the only seeded knowledge in this phase. Every fixture claim is classified `fixture` and permanent tests prevent it from entering a production repository.
- Repository files contain normalized one-field claims, bounded canonical evidence, trust assessments, and append-only audit events. They must not contain raw API payloads, credentials, API keys, or catalog rewrites.
- Stable JSON from `serializeVehicleKnowledgeRepository` can later migrate into database tables without changing claim semantics.

Production repository persistence requires approved source licensing, access control, backup, migration, and retention policies.
