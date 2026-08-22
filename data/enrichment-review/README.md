# Catalog Enrichment Review Data

This directory defines the local persistence boundary for catalog-enrichment review manifests.

- `manifests/` is ignored except for its placeholder. Review manifests may retain reviewer names, source record IDs, and bounded candidate snapshots, so they are local staging artifacts by default.
- Permanent tests construct `fixture` manifests in memory. Fixture decisions are rejected by `production` manifests.
- No raw API response, credential, API key, production catalog rewrite, or Canonical Vehicle Record belongs here.
- A reviewer may persist the exact JSON emitted by `serializeCatalogEnrichmentReviewManifest`. Existing decisions are append-only; a revision is a new version that supersedes the previous active decision.

Repository persistence can be reconsidered only after source licensing, retention, access control, and reviewer identity policies are approved.
