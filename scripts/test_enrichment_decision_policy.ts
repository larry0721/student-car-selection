import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideEnrichment,
  enrichmentDecisionPolicy,
} from "../src/vehicle-intelligence/enrichment-decision-policy";
import type {
  SourceMatchCandidateAssessment,
  SourceMatchResult,
} from "../types/vehicleSourceMatch";

type Candidate = { id: string };

const exact = result({ status: "exact", confidence: 0.94 });
const exactSnapshot = clone(exact);
assert.deepEqual(decideEnrichment(exact), {
  action: "AUTO_ENRICH",
  confidence: 0.94,
  reason: "The selected source record is an exact, conflict-free match above the automatic-enrichment threshold.",
  supportingEvidence: {
    source: "epa",
    matchStatus: "exact",
    selectedSourceRecordId: "source-1",
    candidateCount: 1,
    plausibleCandidateCount: 1,
    matchedOn: ["fuelType", "make", "model", "modelYear"],
    missingComparisonFields: [],
    matchRationale: ["Strong identity and configuration agreement."],
  },
  blockingConflicts: [],
  reviewNotes: [
    "The contribution adapter and canonical merger must still validate the source data before any catalog update.",
  ],
});
assert.deepEqual(exact, exactSnapshot, "Decision policy must not mutate the match result.");

assert.equal(
  decideEnrichment(result({ status: "exact", confidence: enrichmentDecisionPolicy.autoEnrichMinimumConfidence })).action,
  "AUTO_ENRICH",
  "The documented threshold is inclusive.",
);

const belowThreshold = decideEnrichment(result({ status: "exact", confidence: 0.89 }));
assert.equal(belowThreshold.action, "REVIEW_REQUIRED");
assert.match(belowThreshold.reviewNotes.join(" "), /below the 0\.90/);

const exactWithConflict = decideEnrichment(result({
  status: "exact",
  confidence: 0.98,
  conflicts: ["drivetrain: catalog AWD conflicts with source FWD"],
}));
assert.equal(exactWithConflict.action, "REVIEW_REQUIRED");
assert.deepEqual(exactWithConflict.blockingConflicts, ["drivetrain: catalog AWD conflicts with source FWD"]);

const exactWithoutSelection = decideEnrichment(result({
  status: "exact",
  confidence: 0.98,
  selectedCandidate: null,
}));
assert.equal(exactWithoutSelection.action, "REVIEW_REQUIRED");
assert.match(exactWithoutSelection.reviewNotes.join(" "), /eligible selected source candidate/);

const probable = decideEnrichment(result({
  status: "probable",
  confidence: 0.84,
  missingComparisonFields: ["transmission", "drivetrain"],
}));
assert.equal(probable.action, "REVIEW_REQUIRED");
assert.deepEqual(probable.supportingEvidence.missingComparisonFields, ["drivetrain", "transmission"]);
assert.match(probable.reviewNotes.join(" "), /Confirm the selected source record/);

const ambiguous = decideEnrichment(result({
  status: "ambiguous",
  confidence: 0.69,
  selectedCandidate: null,
  candidates: [candidate("source-1"), candidate("source-2")],
  missingComparisonFields: ["trim"],
}));
assert.equal(ambiguous.action, "DEFER");
assert.equal(ambiguous.supportingEvidence.plausibleCandidateCount, 2);
assert.match(ambiguous.reviewNotes.join(" "), /Resolve the ambiguity between 2 eligible candidates/);

const notFound = decideEnrichment(result({
  status: "not_found",
  confidence: 0,
  selectedCandidate: null,
  candidates: [candidate("wrong-drive", false, ["drivetrain conflict"])],
  conflicts: ["drivetrain conflict"],
}));
assert.equal(notFound.action, "SKIP");
assert.deepEqual(notFound.blockingConflicts, ["drivetrain conflict"]);
assert.match(notFound.reviewNotes.join(" "), /blocked by explicit conflicts/);

const repeated = decideEnrichment(exact);
assert.deepEqual(repeated, decideEnrichment(exact), "The same match result must always produce the same decision.");

const policySource = readFileSync(
  join(process.cwd(), "src/vehicle-intelligence/enrichment-decision-policy.ts"),
  "utf8",
);
assert.equal(policySource.includes("mergeCanonicalVehicleContributions"), false);
assert.equal(/from\s+["'][^"']*recommendations/.test(policySource), false);
assert.equal(/from\s+["'][^"']*vehicleCatalog/.test(policySource), false);

console.log("Enrichment decision policy passed: all actions, threshold guards, evidence, conflicts, determinism, immutability, and isolation verified.");

function result(overrides: Partial<SourceMatchResult<Candidate>>): SourceMatchResult<Candidate> {
  const selectedCandidate = overrides.selectedCandidate === undefined
    ? candidate("source-1")
    : overrides.selectedCandidate;
  return {
    status: "exact",
    source: "epa",
    selectedCandidate,
    candidates: overrides.candidates ?? (selectedCandidate ? [selectedCandidate] : []),
    confidence: 0.94,
    matchedOn: ["modelYear", "make", "model", "fuelType"],
    conflicts: [],
    missingComparisonFields: [],
    rationale: ["Strong identity and configuration agreement."],
    ...overrides,
  };
}

function candidate(
  sourceRecordId: string,
  eligible = true,
  conflicts: string[] = [],
): SourceMatchCandidateAssessment<Candidate> {
  return {
    sourceRecordId,
    candidate: { id: sourceRecordId },
    eligible,
    confidence: eligible ? 0.94 : 0,
    matchedOn: eligible ? ["modelYear", "make", "model"] : [],
    conflicts,
    missingComparisonFields: [],
    rationale: [],
  };
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}
