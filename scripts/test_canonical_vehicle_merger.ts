import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalVehicleFieldNames,
  canonicalVehicleFieldPaths,
  canonicalVehicleFieldUnits,
  canonicalVehicleSectionNames,
  type CanonicalDatum,
  type CanonicalRecordScope,
  type CanonicalSourceType,
  type CanonicalUnit,
  type CanonicalVehicleFieldPath,
  type CanonicalVehicleRecord,
} from "../types/canonicalVehicle";
import {
  canonicalContributionSchemaVersion,
  type CanonicalContributionDataUse,
  type CanonicalNormalizationMethod,
  type CanonicalVehicleLinkage,
  type CanonicalVehicleContribution,
} from "../types/canonicalVehicleContribution";
import { mergeCanonicalVehicleContributions } from "../src/vehicle-intelligence/canonical-vehicle-merger";
import { normalizeDecodedVinToContribution } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-contribution-adapter";
import type { DecodedVin } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-client";

const vin = "1HGCM82633A004352";
const retrievedAt = "2026-08-07T12:00:00.000Z";
const nhtsaDecoded: DecodedVin = {
  make: "HONDA",
  model: "Accord",
  modelYear: 2003,
  bodyClass: "Coupe",
  driveType: null,
  fuelTypePrimary: "Gasoline",
  transmissionStyle: "Automatic",
  vehicleType: "PASSENGER CAR",
};
const nhtsaNormalization = normalizeDecodedVinToContribution(
  { vin, decoded: nhtsaDecoded, dataUse: "production" },
  { ingestionId: "vertical-slice", retrievedAt, market: "US", sourceType: "nhtsa" },
);
assert.ok(nhtsaNormalization.contribution);
const nhtsaContribution = nhtsaNormalization.contribution;

const singleResult = mergeCanonicalVehicleContributions([nhtsaContribution]);
assert.equal(singleResult.records.length, 1);
const accordRecord = singleResult.records[0];
assert.equal(accordRecord.identity.make.value, "Honda");
assert.equal(accordRecord.identity.model.value, "Accord");
assert.equal(accordRecord.identity.modelYear.value, 2003);
assert.equal(accordRecord.identity.bodyStyle.value, "coupe");
assert.equal(accordRecord.identity.fuelType.value, "gas");
assert.equal(accordRecord.identity.transmission.value, "automatic");
assert.equal(accordRecord.identity.drivetrain.value, null);
assert.equal(accordRecord.identity.drivetrain.missingReason, "not_available");
assert.equal(accordRecord.identity.vehicleCategory.value, null);
assert.equal(accordRecord.identity.vehicleCategory.missingReason, "insufficient_specificity");
assert.equal(accordRecord.comfort.cabinNoise.missingReason, "not_collected");
assert.equal(accordRecord.financial.purchasePrice.missingReason, "not_collected");
assert.equal(accordRecord.recordId, `cvr:vin:${vin}`);
assert.equal(accordRecord.recordScope, "vin");
assert.ok(accordRecord.evidence.some((item) => item.providerName === "NHTSA vPIC"));
assert.ok(accordRecord.evidence.some((item) => item.sourceClaims?.some((claim) => claim.sourceField === "BodyClass" && claim.originalSourceValue === "Coupe")));
assertCompleteRecord(accordRecord);
assertEvidenceIntegrity(accordRecord, singleResult.issues);

const listingPrice = contribution({
  id: "listing-price",
  sourceType: "listing",
  providerName: "Marketplace A",
  scope: "listing",
  vin,
  claims: [{ fieldPath: "financial.purchasePrice", value: 6495 }],
});
const nonOverlapping = mergeCanonicalVehicleContributions([nhtsaContribution, listingPrice]);
assert.equal(nonOverlapping.records[0].identity.make.value, "Honda");
assert.equal(nonOverlapping.records[0].financial.purchasePrice.value, 6495);

const agreeMakeA = contribution({
  id: "agree-make-a",
  sourceType: "oem",
  providerName: "Manufacturer",
  claims: [{ fieldPath: "identity.make", value: "Honda", confidenceScore: 0.9 }],
});
const agreeMakeB = contribution({
  id: "agree-make-b",
  sourceType: "nhtsa",
  providerName: "NHTSA vPIC",
  claims: [{ fieldPath: "identity.make", value: "Honda", confidenceScore: 0.9 }],
});
const singleMake = mergeCanonicalVehicleContributions([agreeMakeA]).records[0].identity.make;
const agreeingMake = mergeCanonicalVehicleContributions([agreeMakeA, agreeMakeB]).records[0].identity.make;
assert.equal(agreeingMake.value, "Honda");
assert.equal(agreeingMake.confidence.sourceAgreement, "agrees");
assert.ok((agreeingMake.confidence.score || 0) > (singleMake.confidence.score || 0));

const agreeDriveA = contribution({
  id: "agree-drive-a",
  sourceType: "nhtsa",
  providerName: "NHTSA vPIC",
  scope: "vin",
  vin,
  claims: [{ fieldPath: "identity.drivetrain", value: "FWD" }],
});
const agreeDriveB = contribution({
  id: "agree-drive-b",
  sourceType: "oem",
  providerName: "Manufacturer",
  scope: "configuration",
  vin,
  claims: [{ fieldPath: "identity.drivetrain", value: "FWD" }],
});
const agreeingDrive = mergeCanonicalVehicleContributions([agreeDriveA, agreeDriveB]).records[0].identity.drivetrain;
assert.equal(agreeingDrive.value, "FWD");
assert.equal(agreeingDrive.confidence.sourceAgreement, "agrees");

const makeConflict = mergeCanonicalVehicleContributions([
  agreeMakeA,
  contribution({
    id: "make-conflict",
    sourceType: "oem",
    providerName: "Other manufacturer",
    linkage: { make: "Toyota" },
    claims: [{ fieldPath: "identity.make", value: "Toyota" }],
  }),
]);
assert.equal(makeConflict.records.length, 0);
assert.ok(makeConflict.issues.some((issue) => issue.code === "canonical_linkage_make_conflict"));

const yearConflict = mergeCanonicalVehicleContributions([
  agreeMakeA,
  contribution({
    id: "year-conflict",
    sourceType: "oem",
    providerName: "Manufacturer",
    linkage: { modelYear: 2004 },
    claims: [{ fieldPath: "identity.modelYear", value: 2004 }],
  }),
]);
assert.equal(yearConflict.records.length, 0);
assert.ok(yearConflict.issues.some((issue) => issue.code === "canonical_linkage_model_year_conflict"));

const sparseMakeOnly = contribution({
  id: "sparse-make-only",
  sourceType: "oem",
  providerName: "Manufacturer",
  linkage: { make: "Honda", model: null, modelYear: null },
  claims: [{ fieldPath: "identity.make", value: "Honda" }],
});
const sparseModelYearOnly = contribution({
  id: "sparse-model-year-only",
  sourceType: "professional_review",
  providerName: "Review source",
  linkage: { make: null, model: "Accord", modelYear: 2003 },
  claims: [{ fieldPath: "identity.model", value: "Accord" }],
});
const ambiguousSparseLinkage = mergeCanonicalVehicleContributions([sparseMakeOnly, sparseModelYearOnly]);
assert.equal(ambiguousSparseLinkage.records.length, 0);
assert.ok(ambiguousSparseLinkage.issues.some((issue) => issue.code === "canonical_linkage_ambiguous"));

const driveConflictA = contribution({
  id: "drive-conflict-a",
  sourceType: "csv_import",
  providerName: "Source A",
  claims: [{ fieldPath: "identity.drivetrain", value: "FWD", confidenceScore: 0.8 }],
});
const driveConflictB = contribution({
  id: "drive-conflict-b",
  sourceType: "csv_import",
  providerName: "Source B",
  claims: [{ fieldPath: "identity.drivetrain", value: "RWD", confidenceScore: 0.8 }],
});
const unresolvedDrive = mergeCanonicalVehicleContributions([driveConflictA, driveConflictB]);
assert.equal(unresolvedDrive.records[0].identity.drivetrain.value, null);
assert.equal(unresolvedDrive.records[0].identity.drivetrain.missingReason, "source_conflict");
assert.equal(unresolvedDrive.records[0].identity.drivetrain.confidence.score, null);
assert.equal(unresolvedDrive.records[0].identity.drivetrain.confidence.sourceAgreement, "conflicts");
assert.ok(unresolvedDrive.issues.some((issue) => issue.code === "canonical_field_conflict"));
assert.equal(unresolvedDrive.records[0].evidence.length, 2);
assertEvidenceIntegrity(unresolvedDrive.records[0], unresolvedDrive.issues);

const missingDrive = contribution({
  id: "missing-drive",
  sourceType: "listing",
  providerName: "Marketplace B",
  claims: [{ fieldPath: "identity.drivetrain", value: null, missingReason: "not_available" }],
});
const missingAndValue = mergeCanonicalVehicleContributions([missingDrive, agreeDriveA]);
assert.equal(missingAndValue.records[0].identity.drivetrain.value, "FWD");

const unsupportedDrive = contribution({
  id: "unsupported-drive",
  sourceType: "listing",
  providerName: "Marketplace C",
  claims: [{ fieldPath: "identity.drivetrain", value: null, missingReason: "unsupported" }],
});
const missingOnly = mergeCanonicalVehicleContributions([missingDrive, unsupportedDrive]);
assert.equal(missingOnly.records[0].identity.drivetrain.value, null);
assert.equal(missingOnly.records[0].identity.drivetrain.missingReason, "unsupported");
assert.ok(missingOnly.issues.some((issue) => issue.code === "canonical_field_explicitly_missing" && issue.evidenceIds.length === 2));
assert.equal(missingOnly.records[0].identity.drivetrain.evidenceIds.length, 0);
assert.equal(missingOnly.records[0].safety.crashSafety.missingReason, "not_collected");

const duplicateEvidenceA = contribution({
  id: "duplicate-a",
  sourceType: "oem",
  providerName: "Shared Source",
  claims: [{ fieldPath: "identity.make", value: "Honda" }],
});
const duplicateEvidenceB = clone(duplicateEvidenceA);
duplicateEvidenceB.contributionId = "duplicate-b";
duplicateEvidenceB.evidence[0].evidenceId = "duplicate-evidence-b";
duplicateEvidenceB.data.identity!.make!.evidenceIds = ["duplicate-evidence-b"];
const duplicateResult = mergeCanonicalVehicleContributions([duplicateEvidenceA, duplicateEvidenceB]);
assert.equal(duplicateResult.records[0].evidence.length, 1);
assertEvidenceIntegrity(duplicateResult.records[0], duplicateResult.issues);

const weakAgreement = mergeCanonicalVehicleContributions([
  contribution({
    id: "weak-a",
    sourceType: "derived",
    providerName: "Estimator A",
    method: "estimated",
    claims: [{ fieldPath: "financial.maintenanceCost", value: 90, status: "estimated", confidenceScore: 0.4 }],
  }),
  contribution({
    id: "weak-b",
    sourceType: "derived",
    providerName: "Estimator B",
    method: "estimated",
    claims: [{ fieldPath: "financial.maintenanceCost", value: 90, status: "estimated", confidenceScore: 0.4 }],
  }),
]);
assert.equal(weakAgreement.records[0].financial.maintenanceCost.status, "estimated");
assert.equal(weakAgreement.records[0].financial.maintenanceCost.confidence.score, 0.4);

const noConflictAgreement = mergeCanonicalVehicleContributions([driveConflictA, cloneWithId(driveConflictA, "drive-agree-copy")]);
assert.ok((unresolvedDrive.records[0].confidence.sourceAgreement.value || 0) < (noConflictAgreement.records[0].confidence.sourceAgreement.value || 0));

const fixtureRejected = mergeCanonicalVehicleContributions([
  { ...clone(nhtsaContribution), contributionId: "fixture-rejected", dataUse: "fixture", evidence: nhtsaContribution.evidence.map((item) => ({ ...item, dataUse: "fixture" })) },
]);
assert.equal(fixtureRejected.records.length, 0);
assert.ok(fixtureRejected.issues.some((issue) => issue.code === "canonical_merge_data_use_rejected"));
const testRejected = mergeCanonicalVehicleContributions([
  { ...clone(nhtsaContribution), contributionId: "test-rejected", dataUse: "test", evidence: nhtsaContribution.evidence.map((item) => ({ ...item, dataUse: "test" })) },
]);
assert.equal(testRejected.records.length, 0);
const mislabeledExample = contribution({
  id: "mislabeled-example",
  sourceType: "example_fixture",
  providerName: "Example source",
  claims: [{ fieldPath: "identity.make", value: "Honda" }],
});
assert.equal(mergeCanonicalVehicleContributions([mislabeledExample]).records.length, 0);

const vinMismatch = mergeCanonicalVehicleContributions([
  agreeDriveA,
  contribution({
    id: "vin-mismatch",
    sourceType: "oem",
    providerName: "Manufacturer",
    scope: "vin",
    vin: "2T1BURHE0JC012345",
    claims: [{ fieldPath: "identity.drivetrain", value: "FWD" }],
  }),
]);
assert.equal(vinMismatch.records.length, 0);
assert.ok(vinMismatch.issues.some((issue) => issue.code === "canonical_linkage_vin_conflict"));
assert.equal(mergeCanonicalVehicleContributions([agreeDriveA, agreeDriveB]).records.length, 1);

const listingPriceClaim = contribution({
  id: "scope-listing-price",
  sourceType: "listing",
  providerName: "Marketplace Current",
  scope: "listing",
  claims: [{ fieldPath: "financial.purchasePrice", value: 7000, confidenceScore: 0.85 }],
});
const vinPriceEstimate = contribution({
  id: "scope-vin-price",
  sourceType: "derived",
  providerName: "VIN estimator",
  scope: "vin",
  method: "estimated",
  claims: [{ fieldPath: "financial.purchasePrice", value: 12000, status: "estimated", confidenceScore: 0.6 }],
});
const scopedPrice = mergeCanonicalVehicleContributions([listingPriceClaim, vinPriceEstimate]);
assert.equal(scopedPrice.records[0].financial.purchasePrice.value, 7000);
assert.ok(scopedPrice.issues.some((issue) => issue.code === "canonical_field_conflict_resolved"));

const oldListingPrice = contribution({
  id: "old-listing-price",
  sourceType: "listing",
  providerName: "Marketplace history",
  scope: "listing",
  claims: [{ fieldPath: "financial.purchasePrice", value: 9000 }],
});
oldListingPrice.source.observedAt = "2024-01-01T00:00:00.000Z";
oldListingPrice.source.retrievedAt = "2024-01-01T00:00:00.000Z";
oldListingPrice.evidence[0].observedAt = "2024-01-01T00:00:00.000Z";
oldListingPrice.evidence[0].retrievedAt = "2024-01-01T00:00:00.000Z";
const currentListingPrice = contribution({
  id: "current-listing-price",
  sourceType: "listing",
  providerName: "Marketplace current",
  scope: "listing",
  claims: [{ fieldPath: "financial.purchasePrice", value: 7500 }],
});
const freshnessResolved = mergeCanonicalVehicleContributions([oldListingPrice, currentListingPrice]);
assert.equal(freshnessResolved.records[0].financial.purchasePrice.value, 7500);
assert.ok(freshnessResolved.issues.some((issue) => issue.code === "canonical_field_conflict_resolved"));

const undatedValue = contribution({
  id: "undated-value",
  sourceType: "professional_review",
  providerName: "Undated review",
  claims: [{ fieldPath: "driving.handling", value: 72 }],
});
undatedValue.data.driving!.handling!.asOfDate = null;
assert.equal(mergeCanonicalVehicleContributions([undatedValue]).records[0].driving.handling.asOfDate, null);

const originalInputs = clone([nhtsaContribution, listingPrice]);
const ordered = mergeCanonicalVehicleContributions([nhtsaContribution, listingPrice]);
const reversed = mergeCanonicalVehicleContributions([listingPrice, nhtsaContribution]);
assert.deepEqual(ordered, reversed, "Canonical merger must be order independent.");
assert.deepEqual([nhtsaContribution, listingPrice], originalInputs, "Canonical merger must not mutate contributions.");
assert.equal(ordered.records[0].recordId, mergeCanonicalVehicleContributions([clone(listingPrice), clone(nhtsaContribution)]).records[0].recordId);

const mergerSource = readFileSync(join(process.cwd(), "src/vehicle-intelligence/canonical-vehicle-merger.ts"), "utf8");
assert.equal(/from\s+["'][^"']*recommendations/.test(mergerSource), false, "Merger must not import recommendation code.");

console.log("Canonical vehicle merger passed: linkage, authority, scope, evidence, confidence, completion, stable identity, and order independence verified.");
console.log(`NHTSA vertical slice: ${accordRecord.identity.modelYear.value} ${accordRecord.identity.make.value} ${accordRecord.identity.model.value} ${accordRecord.identity.bodyStyle.value}; ${countMissing(accordRecord)} fields missing without fabrication.`);

type ClaimInput = {
  fieldPath: CanonicalVehicleFieldPath;
  value: unknown;
  status?: "verified" | "sourced" | "estimated" | "derived";
  confidenceScore?: number;
  missingReason?: "not_available" | "unsupported" | "insufficient_specificity" | "invalid";
};

function contribution(options: {
  id: string;
  sourceType: CanonicalSourceType;
  providerName: string;
  claims: ClaimInput[];
  scope?: CanonicalRecordScope;
  vin?: string | null;
  linkage?: Partial<CanonicalVehicleLinkage>;
  method?: CanonicalNormalizationMethod;
  dataUse?: CanonicalContributionDataUse;
}): CanonicalVehicleContribution {
  const dataUse = options.dataUse || "production";
  const evidenceId = `evidence:${options.id}`;
  const scope = options.scope || "model_year";
  const linkage: CanonicalVehicleLinkage = {
    canonicalRecordId: null,
    vin: options.vin ?? null,
    make: "Honda",
    model: "Accord",
    modelYear: 2003,
    generation: null,
    trim: null,
    configurationId: null,
    externalIds: [],
    ...options.linkage,
  };
  const data: Record<string, Record<string, unknown>> = {};
  for (const claim of options.claims) {
    const [sectionName, fieldName] = claim.fieldPath.split(".");
    const unit = getUnit(claim.fieldPath);
    data[sectionName] ||= {};
    data[sectionName][fieldName] = claim.value === null
      ? {
          value: null,
          unit,
          status: "missing",
          confidence: confidence(null),
          evidenceIds: [],
          attemptEvidenceIds: [evidenceId],
          estimated: false,
          estimationMethod: null,
          asOfDate: null,
          measurementContext: null,
          missingReason: claim.missingReason || "not_available",
        }
      : {
          value: claim.value,
          unit,
          status: claim.status || "sourced",
          confidence: confidence(claim.confidenceScore ?? 0.82),
          evidenceIds: [evidenceId],
          attemptEvidenceIds: [],
          estimated: claim.status === "estimated",
          estimationMethod: claim.status === "estimated" || claim.status === "derived" ? "Synthetic deterministic test method." : null,
          asOfDate: retrievedAt,
          measurementContext: null,
          missingReason: null,
        };
  }

  return {
    schemaVersion: canonicalContributionSchemaVersion,
    contributionId: options.id,
    dataUse,
    normalizationVersion: "merger-test-1",
    recordScope: scope,
    source: {
      sourceType: options.sourceType,
      providerName: options.providerName,
      sourceRecordId: options.id,
      sourceUrl: null,
      observedAt: retrievedAt,
      retrievedAt,
      market: "US",
      methodology: "Synthetic merger unit-test contribution.",
      license: "Test only",
    },
    linkage,
    sourceConfidence: confidence(0.82),
    sourceMetadata: { testFixture: true },
    evidence: [{
      evidenceId,
      sourceType: options.sourceType,
      providerName: options.providerName,
      sourceRecordId: options.id,
      sourceUrl: null,
      scope: scope === "model_year" || scope === "configuration" || scope === "listing" || scope === "vin" ? scope : "model_year",
      observedAt: retrievedAt,
      retrievedAt,
      market: "US",
      methodology: "Synthetic merger unit-test evidence.",
      license: "Test only",
      dataUse,
      sourceClaims: options.claims.map((claim) => ({ sourceField: claim.fieldPath, originalSourceValue: claim.value as never })),
      normalizationMethod: options.method || "direct",
      normalizationNotes: ["Deterministic merger test fixture."],
    }],
    data: data as CanonicalVehicleContribution["data"],
    issues: [],
  };
}

function confidence(score: number | null) {
  return {
    score,
    level: score === null ? "unknown" as const : score >= 0.8 ? "high" as const : score >= 0.55 ? "medium" as const : "low" as const,
    sourceAgreement: score === null ? "not_applicable" as const : "single_source" as const,
    basis: ["Synthetic deterministic merger test confidence."],
  };
}

function getUnit(fieldPath: CanonicalVehicleFieldPath): CanonicalUnit {
  const [sectionName, fieldName] = fieldPath.split(".") as [keyof typeof canonicalVehicleFieldUnits, string];
  return (canonicalVehicleFieldUnits[sectionName] as Record<string, CanonicalUnit>)[fieldName];
}

function assertCompleteRecord(record: CanonicalVehicleRecord) {
  assert.equal(canonicalVehicleFieldPaths.length, 73);
  for (const sectionName of canonicalVehicleSectionNames) {
    const section = record[sectionName] as unknown as Record<string, CanonicalDatum<unknown>>;
    assert.deepEqual(Object.keys(section).sort(), [...canonicalVehicleFieldNames[sectionName]].sort());
  }
}

function assertEvidenceIntegrity(record: CanonicalVehicleRecord, issues: { evidenceIds: string[] }[]) {
  const evidenceIds = new Set(record.evidence.map((item) => item.evidenceId));
  assert.equal(evidenceIds.size, record.evidence.length);
  for (const sectionName of canonicalVehicleSectionNames) {
    const section = record[sectionName] as unknown as Record<string, CanonicalDatum<unknown>>;
    for (const datum of Object.values(section)) {
      assert.ok(datum.evidenceIds.every((id) => evidenceIds.has(id)));
    }
  }
  assert.ok(issues.flatMap((issue) => issue.evidenceIds).every((id) => evidenceIds.has(id)));
}

function countMissing(record: CanonicalVehicleRecord) {
  return canonicalVehicleSectionNames.reduce((total, sectionName) => {
    const section = record[sectionName] as unknown as Record<string, CanonicalDatum<unknown>>;
    return total + Object.values(section).filter((datum) => datum.value === null).length;
  }, 0);
}

function cloneWithId(contribution: CanonicalVehicleContribution, id: string) {
  const next = clone(contribution);
  const oldEvidenceId = next.evidence[0].evidenceId;
  const newEvidenceId = `evidence:${id}`;
  next.contributionId = id;
  next.source.sourceRecordId = id;
  next.source.providerName = `${next.source.providerName} copy`;
  next.evidence[0].evidenceId = newEvidenceId;
  next.evidence[0].sourceRecordId = id;
  next.evidence[0].providerName = next.source.providerName;
  for (const section of Object.values(next.data)) {
    for (const datum of Object.values(section || {})) {
      datum.evidenceIds = datum.evidenceIds.map((item: string) => item === oldEvidenceId ? newEvidenceId : item);
      datum.attemptEvidenceIds = datum.attemptEvidenceIds.map((item: string) => item === oldEvidenceId ? newEvidenceId : item);
    }
  }
  return next;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
