import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vehicleCatalogData from "../data/processed/vehicleCatalog.json";
import {
  runControlledCatalogEnrichment,
  selectControlledEnrichmentGoldenSet,
  type ControlledEnrichmentSourceProvider,
} from "../src/vehicle-intelligence/controlled-catalog-enrichment";
import {
  appendCatalogEnrichmentReviewDecision,
  createCatalogEnrichmentReviewDecision,
  createCatalogEnrichmentReviewManifest,
  executeCatalogEnrichmentReviewDecision,
  generateCatalogEnrichmentReviewQueue,
  getActiveCatalogEnrichmentReviewDecision,
  parseCatalogEnrichmentReviewManifest,
  serializeCatalogEnrichmentReviewManifest,
  summarizeCatalogEnrichmentReviewQueue,
} from "../src/vehicle-intelligence/catalog-enrichment-review";
import type { EpaVehicleRecord } from "../src/vehicle-intelligence/sources/epa/epa-client";
import type { CatalogEnrichmentResult } from "../types/catalogEnrichment";
import type { CatalogEnrichmentReviewItem } from "../types/catalogEnrichmentReview";
import type { Vehicle } from "../types/vehicle";
import type {
  NhtsaCatalogMatchCandidate,
  SourceMatchCandidateAssessment,
  SourceMatchDimension,
  SourceMatchResult,
} from "../types/vehicleSourceMatch";

const timestamp = "2026-08-08T21:00:00.000Z";
const secondTimestamp = "2026-08-08T22:00:00.000Z";
const catalog = vehicleCatalogData as Vehicle[];
const productionCatalogBefore = readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8");
let unexpectedNetworkCalls = 0;
const originalFetch = globalThis.fetch;

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});

async function run() {
  globalThis.fetch = async () => {
    unexpectedNetworkCalls += 1;
    throw new Error("Catalog enrichment review tests must not use live network access.");
  };

  const goldenResults = await createGoldenReviewResults();
  const queue = generateCatalogEnrichmentReviewQueue(goldenResults, {
    generatedAt: timestamp,
    dataUse: "fixture",
    includeCatalogAnomalySkips: true,
  });

  // 1-2. Probable and ambiguous source matches become deterministic review items.
  const probableItem = requireItem(queue.items, "toyota-prius-2016", "nhtsa");
  assert.equal(probableItem.matchResult.status, "probable");
  assert.equal(probableItem.status, "pending");
  const ambiguousItem = requireItem(queue.items, "toyota-camry-2015", "epa");
  assert.equal(ambiguousItem.matchResult.status, "ambiguous");
  assert.equal(ambiguousItem.priority.tier, 2);
  assert.ok(ambiguousItem.candidates.length >= 2);
  assert.ok(ambiguousItem.comparison.suggestedNextEvidence.length > 0);

  // 3-4. Approval is candidate-bound and rejects missing/unknown source records.
  assert.throws(() => createDecision(probableItem, "APPROVE_SOURCE"), /requires a candidate/);
  assert.throws(() => createDecision(probableItem, "APPROVE_SOURCE", "not-in-review-item"), /requires a candidate/);
  assert.throws(
    () => createDecision(probableItem, "APPROVE_SOURCE", probableItem.candidates[0].sourceRecordId),
    /VIN-backed candidate/,
  );

  // 5-7. Approval routes through the EPA adapter and merger; no manual CVR surface exists.
  const epaApprovalResult = await createSingleReviewResult("probable", "epa", catalogVehicle("Toyota", "Camry", 2015));
  const epaApprovalItem = generateCatalogEnrichmentReviewQueue([epaApprovalResult], {
    generatedAt: timestamp,
    dataUse: "production",
  }).items[0];
  assert.ok(epaApprovalItem && epaApprovalItem.source === "epa");
  const approved = createDecision(
    epaApprovalItem,
    "APPROVE_SOURCE",
    epaApprovalItem.candidates[0].sourceRecordId,
  );
  const approvalExecution = await executeCatalogEnrichmentReviewDecision(
    epaApprovalResult,
    epaApprovalItem,
    approved,
    { retrievedAt: timestamp },
  );
  assert.equal(approvalExecution.contributions.length, 1);
  assert.equal(approvalExecution.contributions[0].source.sourceType, "epa");
  assert.ok(approvalExecution.canonicalRecord, approvalExecution.issues.join("\n"));
  assert.equal(approvalExecution.canonicalRecord?.recordStatus, "draft");
  assert.equal(approvalExecution.productionCatalogMutated, false);
  assert.equal("canonicalRecord" in approved, false);
  if (false) {
    // @ts-expect-error Review decisions cannot accept manually constructed canonical facts.
    createCatalogEnrichmentReviewDecision(epaApprovalItem, { action: "APPROVE_SOURCE", reason: "x", decidedAt: timestamp, canonicalRecord: {} });
  }

  // 8. Rejection is retained but creates no contribution.
  const rejected = createDecision(
    epaApprovalItem,
    "REJECT_SOURCE",
    epaApprovalItem.candidates[0].sourceRecordId,
  );
  const rejectedExecution = await executeCatalogEnrichmentReviewDecision(epaApprovalResult, epaApprovalItem, rejected);
  assert.equal(rejectedExecution.contributions.length, 0);
  assert.equal(rejectedExecution.canonicalRecord, null);
  assert.ok(rejected.reviewedCandidateIds.includes(epaApprovalItem.candidates[0].sourceRecordId));

  // 9. Deferral retains the evidence needed to resolve the match.
  const deferred = createCatalogEnrichmentReviewDecision(ambiguousItem, {
    action: "DEFER",
    reason: "Engine configuration is still unknown.",
    unresolvedFields: ["engineDisplacement"],
    decidedAt: timestamp,
  });
  assert.deepEqual(deferred.unresolvedFields, ["engineDisplacement"]);
  assert.throws(() => createCatalogEnrichmentReviewDecision(ambiguousItem, {
    action: "DEFER",
    reason: "Still unclear.",
    unresolvedFields: [],
    decidedAt: timestamp,
  }), /at least one unresolved field/);

  // 10-12. Corrections retain before/after evidence, rerun matching, and never mutate the catalog.
  const tacomaResult = goldenResults.find((result) => result.catalogSnapshot.model === "Tacoma");
  assert.ok(tacomaResult);
  const tacomaItem = queue.items.find((item) => item.catalogVehicleId === tacomaResult.catalogVehicleId && item.source === "epa");
  assert.ok(tacomaItem);
  const tacomaBefore = clone(tacomaResult.catalogSnapshot);
  const correction = createCatalogEnrichmentReviewDecision(tacomaItem, {
    action: "CORRECT_CATALOG_METADATA",
    reason: "Official EPA configuration evidence identifies rear-wheel drive.",
    catalogCorrections: [{
      field: "drivetrain",
      originalValue: "FWD",
      correctedValue: "RWD",
      reason: "The catalog drivetrain contradicts the official configuration.",
      supportingEvidence: [tacomaItem.candidates[0].sourceRecordId],
    }],
    evidence: [{ kind: "source_record", reference: tacomaItem.candidates[0].sourceRecordId, note: "EPA drive field" }],
    decidedAt: timestamp,
  });
  assert.equal(correction.catalogCorrections[0].originalValue, "FWD");
  assert.equal(correction.catalogCorrections[0].correctedValue, "RWD");
  const correctionExecution = await executeCatalogEnrichmentReviewDecision(tacomaResult, tacomaItem, correction);
  assert.equal(correctionExecution.correctedCatalogSnapshot.drivetrain, "RWD");
  assert.notEqual(correctionExecution.refreshedMatchResult?.status, "not_found");
  assert.ok(correctionExecution.refreshedEnrichmentDecision);
  assert.deepEqual(tacomaResult.catalogSnapshot, tacomaBefore);
  assert.equal(correctionExecution.contributions.length, 0);

  // 13. A confirmed source miss is explicit and non-destructive.
  const yariItem = queue.items.find((item) => item.catalogSnapshot.model === "Yari");
  assert.ok(yariItem);
  const notFound = createCatalogEnrichmentReviewDecision(yariItem, {
    action: "MARK_NOT_FOUND",
    reason: "No official source candidate responsibly matches the truncated catalog identity.",
    reviewedCandidateIds: yariItem.candidates.map((candidate) => candidate.sourceRecordId),
    decidedAt: timestamp,
  });
  assert.equal(notFound.action, "MARK_NOT_FOUND");
  const notFoundExecution = await executeCatalogEnrichmentReviewDecision(
    goldenResults.find((result) => result.catalogVehicleId === yariItem.catalogVehicleId) as CatalogEnrichmentResult,
    yariItem,
    notFound,
  );
  assert.equal(notFoundExecution.canonicalRecord, null);

  // 14-17. Manifest history is append-only, revisions supersede, and serialization is stable.
  let manifest = createCatalogEnrichmentReviewManifest({
    manifestId: "golden-review-fixture",
    dataUse: "fixture",
    createdAt: timestamp,
  });
  manifest = appendCatalogEnrichmentReviewDecision(manifest, deferred);
  const revised = createCatalogEnrichmentReviewDecision(ambiguousItem, {
    action: "DEFER",
    reason: "VIN and engine configuration are still needed.",
    unresolvedFields: ["vin", "engineDisplacement"],
    decidedAt: secondTimestamp,
  }, manifest.decisions);
  manifest = appendCatalogEnrichmentReviewDecision(manifest, revised);
  assert.equal(manifest.decisions.length, 2);
  assert.equal(revised.reviewVersion, 2);
  assert.equal(revised.supersedesDecisionId, deferred.decisionId);
  assert.equal(getActiveCatalogEnrichmentReviewDecision(manifest, ambiguousItem.reviewId)?.decisionId, revised.decisionId);
  const serialized = serializeCatalogEnrichmentReviewManifest(manifest);
  assert.equal(serializeCatalogEnrichmentReviewManifest(parseCatalogEnrichmentReviewManifest(serialized)), serialized);
  assert.throws(() => appendCatalogEnrichmentReviewDecision(manifest, revised), /already exists/);

  // 18-20. Reasons and snapshots are required; fixture decisions cannot cross into production.
  assert.throws(() => createCatalogEnrichmentReviewDecision(epaApprovalItem, {
    action: "APPROVE_SOURCE",
    selectedSourceRecordId: epaApprovalItem.candidates[0].sourceRecordId,
    reason: " ",
    decidedAt: timestamp,
  }), /Reviewer reason is required/);
  assert.deepEqual(approved.selectedCandidateSnapshot, epaApprovalItem.candidates[0].sourceRecord);
  assert.equal(Object.isFrozen(approved), true);
  const productionManifest = createCatalogEnrichmentReviewManifest({
    manifestId: "production-review",
    dataUse: "production",
    createdAt: timestamp,
  });
  assert.throws(() => appendCatalogEnrichmentReviewDecision(productionManifest, deferred), /fixture decisions cannot enter/);

  // 21-23. Architecture remains isolated from recommendations, catalog writes, and live network calls.
  const workflowSource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/catalog-enrichment-review.ts"), "utf8");
  for (const requiredCall of [
    "epaContributionAdapter.normalize",
    "nhtsaContributionAdapter.normalize",
    "mergeCanonicalVehicleContributions",
    "matchEpaCandidates",
    "matchNhtsaCandidates",
    "decideEnrichment",
  ]) assert.ok(workflowSource.includes(requiredCall), `Review workflow must use ${requiredCall}.`);
  assert.equal(/from\s+["'][^"']*recommendations/.test(workflowSource), false);
  assert.equal(workflowSource.includes("vehicleCatalogData"), false);
  assert.equal(readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"), productionCatalogBefore);
  assert.equal(unexpectedNetworkCalls, 0);

  const summary = summarizeCatalogEnrichmentReviewQueue(queue.items);
  assert.equal(summary.totalPending, queue.items.length);
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "Prius"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "Leaf"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "CR-V"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "RAV4"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "Camry"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "F-150"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "Volt"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "Tacoma"));
  assert.ok(queue.items.some((item) => item.catalogSnapshot.model === "Yari"));

  console.log("Catalog enrichment review passed: queue, decisions, corrections, revision history, manifests, adapters, merger, isolation, and offline behavior verified.");
  console.log(JSON.stringify({
    totalReviewItems: queue.items.length,
    summary,
    byPriorityTier: Object.fromEntries([1, 2, 3, 4].map((tier) => [tier, queue.items.filter((item) => item.priority.tier === tier).length])),
    reviewItems: queue.items.map((item) => ({
      vehicle: `${item.catalogSnapshot.year} ${item.catalogSnapshot.make} ${item.catalogSnapshot.model}`,
      source: item.source,
      matchStatus: item.matchResult.status,
      leadingSourceRecordId: item.comparison.leadingCandidateSourceRecordId,
      confidence: item.matchResult.confidence,
      priorityTier: item.priority.tier,
      needs: item.comparison.suggestedNextEvidence,
    })),
  }, null, 2));
}

async function createGoldenReviewResults() {
  const selected = selectControlledEnrichmentGoldenSet(catalog);
  const wanted = new Set(["hybrid", "battery_electric", "awd_crossover", "family_suv", "gasoline_sedan", "pickup_truck", "powertrain_anomaly", "drivetrain_anomaly", "identity_anomaly", "compact_sedan"]);
  const results: CatalogEnrichmentResult[] = [];
  for (const entry of selected.filter((item) => wanted.has(item.criterion))) {
    const nhtsaStatus = entry.criterion === "identity_anomaly" || entry.criterion === "compact_sedan" ? "not_found" : "probable";
    const epaStatus = ["hybrid", "battery_electric", "awd_crossover", "family_suv"].includes(entry.criterion)
      ? "exact"
      : ["gasoline_sedan", "pickup_truck"].includes(entry.criterion)
        ? "ambiguous"
        : "not_found";
    results.push(await runControlledCatalogEnrichment(entry.vehicle, {
      retrievedAt: timestamp,
      catalogUniverse: catalog,
      sourceProvider: provider(nhtsaStatus, epaStatus, entry.criterion),
    }));
  }
  return results;
}

async function createSingleReviewResult(
  status: SourceMatchResult<unknown>["status"],
  source: "nhtsa" | "epa",
  vehicle: Vehicle,
) {
  return runControlledCatalogEnrichment(vehicle, {
    retrievedAt: timestamp,
    catalogUniverse: catalog,
    sourceProvider: provider(source === "nhtsa" ? status : "not_found", source === "epa" ? status : "not_found", "single"),
  });
}

function provider(
  nhtsaStatus: SourceMatchResult<unknown>["status"],
  epaStatus: SourceMatchResult<unknown>["status"],
  criterion: string,
): ControlledEnrichmentSourceProvider {
  return {
    async matchNhtsa(vehicle) {
      const candidate = nhtsaCandidate(vehicle, nhtsaStatus === "exact");
      return sourceResult("nhtsa", nhtsaStatus, candidate, clone(candidate), criterion);
    },
    async matchEpa(vehicle) {
      const candidate = epaCandidate(vehicle, criterion);
      const second = { ...clone(candidate), id: `${Number(candidate.id) + 1}`, displ: (candidate.displ ?? 2) + 1 };
      return sourceResult("epa", epaStatus, candidate, second, criterion);
    },
  };
}

function sourceResult<Candidate>(
  source: "nhtsa" | "epa",
  status: SourceMatchResult<unknown>["status"],
  primaryCandidate: Candidate,
  secondCandidate: Candidate,
  criterion: string,
): SourceMatchResult<Candidate> {
  const primaryId = sourceId(primaryCandidate);
  const conflicts = status === "not_found" && (criterion === "drivetrain_anomaly" || criterion === "powertrain_anomaly")
    ? [criterion === "drivetrain_anomaly" ? "drivetrain: catalog FWD conflicts with source RWD" : "fuelType: catalog electric conflicts with source plug_in_hybrid"]
    : [];
  const primary = assessment(primaryId, primaryCandidate, status === "probable" ? 0.79 : 0.96, conflicts);
  const candidates = status === "ambiguous"
    ? [primary, assessment(sourceId(secondCandidate), secondCandidate, 0.94)]
    : status === "not_found" && criterion !== "identity_anomaly" && criterion !== "compact_sedan"
      ? [primary]
      : status === "not_found" ? [] : [primary];
  return {
    status,
    source,
    selectedCandidate: status === "exact" || status === "probable" ? primary : null,
    candidates,
    confidence: status === "exact" ? 0.96 : status === "probable" ? 0.79 : status === "ambiguous" ? 0.69 : 0,
    matchedOn: status === "not_found" ? ["modelYear", "make", "model"] : ["modelYear", "make", "model", "fuelType", "drivetrain", "transmission"],
    conflicts,
    missingComparisonFields: status === "probable" ? ["trim"] : status === "ambiguous" ? ["engineDisplacement"] : [],
    rationale: [status === "not_found" ? "No candidate passed every catalog claim." : "Offline controlled review fixture."],
  };
}

function assessment<Candidate>(
  sourceRecordId: string,
  candidate: Candidate,
  confidence: number,
  conflicts: string[] = [],
): SourceMatchCandidateAssessment<Candidate> {
  return {
    sourceRecordId,
    candidate,
    eligible: conflicts.length === 0,
    confidence: conflicts.length ? 0 : confidence,
    matchedOn: ["modelYear", "make", "model", "fuelType", "drivetrain", "transmission"],
    conflicts,
    missingComparisonFields: ["trim"],
    rationale: ["Offline source candidate."],
  };
}

function nhtsaCandidate(vehicle: Pick<Vehicle, "year" | "make" | "model" | "bodyType" | "fuelType" | "drivetrain" | "transmission">, withVin: boolean): NhtsaCatalogMatchCandidate {
  return {
    sourceRecordId: withVin ? "1HGCM82633A004352" : `nhtsa:model:${vehicle.year}:${vehicle.make}:${vehicle.model}`,
    vin: withVin ? "1HGCM82633A004352" : null,
    make: vehicle.make,
    model: vehicle.model,
    modelYear: vehicle.year,
    bodyClass: bodyClass(vehicle.bodyType),
    vehicleType: vehicle.bodyType === "truck" ? "TRUCK" : "PASSENGER CAR",
    driveType: drive(vehicle.drivetrain),
    fuelTypePrimary: fuel(vehicle.fuelType),
    transmissionStyle: transmission(vehicle.transmission),
  };
}

function epaCandidate(vehicle: Pick<Vehicle, "year" | "make" | "model" | "bodyType" | "fuelType" | "drivetrain" | "transmission">, criterion: string): EpaVehicleRecord {
  const isVolt = criterion === "powertrain_anomaly";
  const isTacoma = criterion === "drivetrain_anomaly";
  return {
    id: String(50000 + vehicle.year),
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    VClass: vehicle.bodyType === "truck" ? "Standard Pickup Trucks 2WD" : vehicle.bodyType === "suv" ? "Small Sport Utility Vehicle 2WD" : vehicle.bodyType === "hatchback" ? "Compact Cars" : "Midsize Cars",
    drive: isTacoma ? "Rear-Wheel Drive" : drive(vehicle.drivetrain),
    trany: transmission(vehicle.transmission),
    fuelType: isVolt ? "Regular Gas and Electricity" : fuel(vehicle.fuelType),
    fuelType1: isVolt ? "Regular Gasoline" : fuel(vehicle.fuelType),
    fuelType2: isVolt ? "Electricity" : null,
    atvType: isVolt ? "Plug-in Hybrid" : vehicle.fuelType === "hybrid" ? "Hybrid" : vehicle.fuelType === "electric" ? "EV" : null,
    range: isVolt ? 53 : vehicle.fuelType === "electric" ? 151 : 0,
    charge240: isVolt || vehicle.fuelType === "electric" ? 7 : 0,
    cylinders: vehicle.fuelType === "electric" ? null : 4,
    displ: vehicle.fuelType === "electric" ? null : 2.5,
    city08: vehicle.fuelType === "electric" ? 110 : 25,
    highway08: vehicle.fuelType === "electric" ? 95 : 35,
    comb08: vehicle.fuelType === "electric" ? 103 : 29,
    fuelCost08: 1200,
    createdOn: "2026-01-01",
    modifiedOn: "2026-02-01",
  };
}

function createDecision(
  item: CatalogEnrichmentReviewItem,
  action: "APPROVE_SOURCE" | "REJECT_SOURCE",
  selectedSourceRecordId?: string,
) {
  return createCatalogEnrichmentReviewDecision(item, {
    action,
    selectedSourceRecordId,
    reason: action === "APPROVE_SOURCE" ? "The retained official source candidate matches the reviewed configuration." : "The candidate does not describe this catalog vehicle.",
    decidedAt: timestamp,
  });
}

function requireItem(items: CatalogEnrichmentReviewItem[], idFragment: string, source: "nhtsa" | "epa") {
  const item = items.find((candidate) => candidate.catalogVehicleId.includes(idFragment) && candidate.source === source);
  assert.ok(item, `Expected ${source} review item containing ${idFragment}.`);
  return item;
}

function catalogVehicle(make: string, model: string, year: number) {
  const vehicle = catalog.find((candidate) => candidate.make === make && candidate.model === model && candidate.year === year);
  assert.ok(vehicle);
  return vehicle;
}

function sourceId(candidate: unknown) {
  if (candidate && typeof candidate === "object") {
    if ("sourceRecordId" in candidate && typeof candidate.sourceRecordId === "string") return candidate.sourceRecordId;
    if ("id" in candidate && typeof candidate.id === "string") return candidate.id;
  }
  return "unknown";
}

function bodyClass(bodyType: string) {
  if (bodyType === "suv") return "Sport Utility Vehicle (SUV)";
  if (bodyType === "truck") return "Pickup";
  if (bodyType === "hatchback") return "Hatchback/Liftback";
  return "Sedan/Saloon";
}

function drive(value: string) {
  return ({ FWD: "Front-Wheel Drive", AWD: "All-Wheel Drive", RWD: "Rear-Wheel Drive", "4WD": "Four-Wheel Drive" } as Record<string, string>)[value] ?? value;
}

function fuel(value: string) {
  if (value === "hybrid") return "Hybrid Electric Vehicle (HEV)";
  if (value === "electric") return "Electricity";
  if (value === "diesel") return "Diesel";
  return "Regular Gasoline";
}

function transmission(value: string) {
  return value === "manual" ? "Manual" : value.toLowerCase() === "cvt" ? "Continuously Variable Transmission (CVT)" : "Automatic (S8)";
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

type _ReviewFieldCoverage = SourceMatchDimension;
