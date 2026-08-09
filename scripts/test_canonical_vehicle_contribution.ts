import assert from "node:assert/strict";
import {
  canonicalVehicleContributionFixtures,
  epaContributionFixture,
  marketplaceContributionFixture,
  nhtsaVinContributionFixture,
} from "../data/canonicalVehicleContributionExamples";
import { validateCanonicalVehicleContribution } from "../src/vehicle-intelligence/canonical-vehicle-contribution";
import type { CanonicalVehicleRecord } from "../types/canonicalVehicle";
import type {
  CanonicalVehicleContributionData,
  CanonicalVehicleContribution,
} from "../types/canonicalVehicleContribution";

for (const contribution of canonicalVehicleContributionFixtures) {
  const result = validateCanonicalVehicleContribution(contribution);
  assert.equal(result.valid, true, `${contribution.contributionId}: ${formatIssues(result)}`);
  assert.equal(contribution.dataUse, "fixture");
  assert.ok(contribution.evidence.every((evidence) => evidence.dataUse === "fixture"));
  assert.ok(contribution.sourceMetadata.fixtureNotice);
}

const identityOnly: CanonicalVehicleContributionData = {
  identity: {
    make: nhtsaVinContributionFixture.data.identity.make,
  },
};
assert.deepEqual(Object.keys(identityOnly), ["identity"]);
assert.deepEqual(Object.keys(identityOnly.identity || {}), ["make"]);

assert.equal("trim" in nhtsaVinContributionFixture.data.identity, false, "Omitted NHTSA trim means no source claim.");
assert.equal(marketplaceContributionFixture.data.identity.trim?.status, "missing");
assert.equal(marketplaceContributionFixture.data.identity.trim?.value, null);
assert.deepEqual(marketplaceContributionFixture.data.identity.trim?.evidenceIds, []);
assert.deepEqual(
  marketplaceContributionFixture.data.identity.trim?.attemptEvidenceIds,
  ["fixture:marketplace:abc-123:listing"],
  "Explicit missingness must retain evidence of the source attempt.",
);

assert.equal(nhtsaVinContributionFixture.linkage.vin, "1HGCM82633A004352");
assert.equal("vin" in nhtsaVinContributionFixture.data.identity, false, "VIN must remain linkage metadata, not a CVR field.");
assert.deepEqual(Object.keys(nhtsaVinContributionFixture.data), ["identity"]);
assert.deepEqual(Object.keys(epaContributionFixture.data).sort(), ["environment", "identity"]);
assert.equal("safety" in epaContributionFixture.data, false);
assert.equal("reliability" in epaContributionFixture.data, false);
assert.equal(marketplaceContributionFixture.sourceMetadata.photoUrl, "https://fixtures.invalid/abc-123.jpg");

const referencedEvidence = new Set(nhtsaVinContributionFixture.evidence.map((item) => item.evidenceId));
for (const datum of Object.values(nhtsaVinContributionFixture.data.identity)) {
  for (const evidenceId of [...datum.evidenceIds, ...datum.attemptEvidenceIds]) {
    assert.ok(referencedEvidence.has(evidenceId));
  }
}

const unknownPath = clone(nhtsaVinContributionFixture) as Record<string, unknown>;
const unknownPathData = unknownPath.data as Record<string, Record<string, unknown>>;
unknownPathData.identity.unknownNhtsaField = nhtsaVinContributionFixture.data.identity.make;
const unknownPathResult = validateCanonicalVehicleContribution(unknownPath);
assert.equal(unknownPathResult.valid, false);
assert.ok(unknownPathResult.issues.some((issue) => issue.code === "unknown_canonical_path"));

const brokenEvidence = clone(nhtsaVinContributionFixture) as {
  data: { identity: { make: { evidenceIds: string[] } } };
};
brokenEvidence.data.identity.make.evidenceIds = ["missing:evidence"];
const brokenEvidenceResult = validateCanonicalVehicleContribution(brokenEvidence);
assert.equal(brokenEvidenceResult.valid, false);
assert.ok(brokenEvidenceResult.issues.some((issue) => issue.code === "unknown_evidence_reference"));

const promotedFixture = clone(epaContributionFixture) as {
  evidence: Array<{ dataUse: string }>;
};
promotedFixture.evidence[0].dataUse = "production";
const promotedFixtureResult = validateCanonicalVehicleContribution(promotedFixture);
assert.equal(promotedFixtureResult.valid, false);
assert.ok(promotedFixtureResult.issues.some((issue) => issue.code === "evidence_data_use_mismatch"));

type IdentityContribution = NonNullable<CanonicalVehicleContributionData["identity"]>;
type BodyStyleContribution = NonNullable<IdentityContribution["bodyStyle"]>;
const validBodyStyle: BodyStyleContribution = nhtsaVinContributionFixture.data.identity.bodyStyle;
// @ts-expect-error Canonical contribution values must use the CVR body-style enum.
const invalidBodyStyle: BodyStyleContribution = { ...validBodyStyle, value: "motorcycle" };
void invalidBodyStyle;

// @ts-expect-error A partial source contribution is not a complete CanonicalVehicleRecord.
const incorrectlyCompleteRecord: CanonicalVehicleRecord = nhtsaVinContributionFixture;
void incorrectlyCompleteRecord;

const typedFixtures: CanonicalVehicleContribution[] = canonicalVehicleContributionFixtures;
assert.equal(typedFixtures.length, 3);

console.log("Canonical vehicle contribution contract passed: 3 fixture sources, sparse sections, evidence, linkage, and missingness validated.");

function clone<Value>(value: Value): unknown {
  return JSON.parse(JSON.stringify(value));
}

function formatIssues(result: ReturnType<typeof validateCanonicalVehicleContribution>) {
  return result.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
}
