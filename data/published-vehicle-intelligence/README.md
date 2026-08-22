# Published Vehicle Intelligence

This directory is reserved for serialized shadow `CanonicalVehicleRecord` publication repositories.

Only records that pass the deterministic CVR Publishing Gate may enter a repository. Local repository files are ignored because they can contain retained source-derived vehicle intelligence.

The controlled Golden Set v1 shadow repository and its metadata-only manifest are persisted under `repositories/`. They remain local and gitignored, are not recommendation inputs, and must be created or replayed only through the existing publication repository boundary.
