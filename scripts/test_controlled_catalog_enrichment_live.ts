import vehicleCatalogData from "../data/processed/vehicleCatalog.json";
import {
  runControlledCatalogEnrichment,
  selectControlledEnrichmentGoldenSet,
} from "../src/vehicle-intelligence/controlled-catalog-enrichment";
import type { CatalogEnrichmentResult } from "../types/catalogEnrichment";
import type { Vehicle } from "../types/vehicle";

const catalog = vehicleCatalogData as Vehicle[];

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const retrievedAt = new Date().toISOString();
  const goldenSet = selectControlledEnrichmentGoldenSet(catalog);
  const results = [];
  for (const selection of goldenSet) {
    const result = await runControlledCatalogEnrichment(selection.vehicle, {
      retrievedAt,
      market: "US",
      catalogUniverse: catalog,
    });
    results.push(summarize(selection.criterion, selection.rationale, result));
  }
  console.log(JSON.stringify({
    retrievedAt,
    catalogCount: catalog.length,
    goldenSetCount: goldenSet.length,
    stagingBoundary: "runtime_only",
    productionCatalogMutated: false,
    results,
  }, null, 2));
}

function summarize(
  criterion: string,
  rationale: string,
  result: CatalogEnrichmentResult,
) {
  return {
    criterion,
    rationale,
    catalog: {
      id: result.catalogSnapshot.id,
      year: result.catalogSnapshot.year,
      make: result.catalogSnapshot.make,
      model: result.catalogSnapshot.model,
      bodyType: result.catalogSnapshot.bodyType,
      fuelType: result.catalogSnapshot.fuelType,
      drivetrain: result.catalogSnapshot.drivetrain,
      transmission: result.catalogSnapshot.transmission,
    },
    nhtsa: sourceSummary(result, "nhtsa"),
    epa: sourceSummary(result, "epa"),
    contributionsAccepted: result.contributions.accepted.map((contribution) => ({
      source: contribution.source.sourceType,
      sourceRecordId: contribution.source.sourceRecordId,
      evidenceCount: contribution.evidence.length,
    })),
    contributionsWithheldOrRejected: result.contributions.dispositions
      .filter((item) => item.disposition !== "accepted"),
    stagedCvr: {
      present: Boolean(result.canonicalRecord),
      recordId: result.canonicalRecord?.recordId ?? null,
      populatedFieldCount: result.evidenceSummary.populatedFieldCount,
      missingFieldCount: result.evidenceSummary.missingFieldCount,
      evidenceCount: result.evidenceSummary.evidenceCount,
      dataQualityConfidence: result.canonicalRecord?.confidence.dataQuality.value ?? null,
      evidenceQualityConfidence: result.canonicalRecord?.confidence.evidenceQuality.value ?? null,
      sourceAgreementConfidence: result.canonicalRecord?.confidence.sourceAgreement.value ?? null,
    },
    conflicts: unique([
      ...(result.sourceMatches.nhtsa?.conflicts ?? []),
      ...(result.sourceMatches.epa?.conflicts ?? []),
      ...result.mergerIssues.filter((issue) => issue.code.includes("conflict")).map((issue) => issue.message),
    ]),
    catalogIssues: result.catalogDataIssues.map((issue) => ({
      kind: issue.kind,
      field: issue.field,
      severity: issue.severity,
      message: issue.message,
    })),
    sourceFailures: result.issues.filter((issue) => issue.stage === "matching" && issue.severity === "error"),
    integrity: result.integrity,
    finalStatus: result.status,
  };
}

function sourceSummary(
  result: CatalogEnrichmentResult,
  source: "nhtsa" | "epa",
) {
  const match = result.sourceMatches[source];
  const decision = result.enrichmentDecisions[source];
  return {
    matchStatus: match?.status ?? "failed",
    matchConfidence: match?.confidence ?? null,
    candidateCount: match?.candidates.length ?? 0,
    selectedSourceRecordId: match?.selectedCandidate?.sourceRecordId ?? null,
    matchedOn: match?.matchedOn ?? [],
    conflicts: match?.conflicts ?? [],
    missingComparisonFields: match?.missingComparisonFields ?? [],
    decision: decision?.action ?? null,
    decisionReason: decision?.reason ?? null,
  };
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}
