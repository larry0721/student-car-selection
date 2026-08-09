import assert from "node:assert/strict";
import {
  fullyPopulatedPriusRecord,
  partiallyKnownVehicleRecord,
} from "../data/canonicalVehicleExamples";
import {
  canonicalVehicleFieldNames,
  canonicalVehicleFieldPaths,
  canonicalVehicleSectionNames,
  type CanonicalDatum,
  type CanonicalVehicleRecord,
} from "../types/canonicalVehicle";

assert.equal(canonicalVehicleSectionNames.length, 12);
assert.equal(canonicalVehicleFieldPaths.length, 73);
assert.equal(new Set(canonicalVehicleFieldPaths).size, 73);

auditRecord(fullyPopulatedPriusRecord, { requireEveryValue: true });
const partialMissingCount = auditRecord(partiallyKnownVehicleRecord, { requireEveryValue: false });
assert.ok(partialMissingCount >= 50, "Partial example should preserve unknown fields as missing.");

console.log(`Canonical Vehicle Record contract passed: ${canonicalVehicleFieldPaths.length} fields across ${canonicalVehicleSectionNames.length} sections.`);
console.log(`Fully populated example missing fields: 0; partial example missing fields: ${partialMissingCount}.`);

function auditRecord(
  record: CanonicalVehicleRecord,
  options: { requireEveryValue: boolean },
) {
  const evidenceIds = new Set(record.evidence.map((item) => item.evidenceId));
  assert.equal(evidenceIds.size, record.evidence.length, `${record.recordId}: evidence IDs must be unique`);
  let missingCount = 0;

  for (const sectionName of canonicalVehicleSectionNames) {
    const section = record[sectionName] as unknown as Record<string, CanonicalDatum<unknown>>;
    const expectedFields = canonicalVehicleFieldNames[sectionName];
    assert.deepEqual(
      Object.keys(section).sort(),
      [...expectedFields].sort(),
      `${record.recordId}: ${sectionName} field shape drifted`,
    );

    for (const fieldName of expectedFields) {
      const datum = section[fieldName];
      assert.ok(datum, `${record.recordId}: missing ${sectionName}.${fieldName}`);
      assert.ok(datum.confidence.basis.length > 0, `${record.recordId}: confidence basis missing for ${sectionName}.${fieldName}`);

      if (datum.value === null) {
        missingCount += 1;
        assert.equal(datum.status, "missing");
        assert.equal(datum.evidenceIds.length, 0);
        assert.equal(datum.estimated, false);
        assert.equal(datum.estimationMethod, null);
        assert.ok(datum.missingReason);
        assert.equal(datum.asOfDate, null);
        continue;
      }

      assert.notEqual(datum.status, "missing");
      assert.equal(datum.missingReason, null);
      assert.ok(datum.evidenceIds.length > 0, `${record.recordId}: evidence missing for ${sectionName}.${fieldName}`);
      assert.ok(datum.asOfDate, `${record.recordId}: as-of date missing for ${sectionName}.${fieldName}`);
      for (const evidenceId of datum.evidenceIds) {
        assert.ok(evidenceIds.has(evidenceId), `${record.recordId}: unknown evidence ${evidenceId}`);
      }
      assert.equal(datum.estimated, datum.status === "estimated");
      if (datum.status === "estimated" || datum.status === "derived") {
        assert.ok(datum.estimationMethod, `${record.recordId}: method missing for ${sectionName}.${fieldName}`);
      }
      if (datum.confidence.score !== null) {
        assert.ok(datum.confidence.score >= 0 && datum.confidence.score <= 1);
      }
    }
  }

  if (options.requireEveryValue) assert.equal(missingCount, 0);
  return missingCount;
}
