import type { EnrichmentDecision } from "../../types/enrichmentDecision";
import type { SourceMatchResult } from "../../types/vehicleSourceMatch";

export const enrichmentDecisionPolicy = Object.freeze({
  autoEnrichMinimumConfidence: 0.9,
});

export function decideEnrichment<Candidate>(
  matchResult: SourceMatchResult<Candidate>,
): EnrichmentDecision {
  const blockingConflicts = uniqueSorted([
    ...matchResult.conflicts,
    ...(matchResult.selectedCandidate?.conflicts ?? []),
  ]);
  const selectedCandidateIsUsable = Boolean(
    matchResult.selectedCandidate?.eligible
      && matchResult.selectedCandidate.sourceRecordId.trim(),
  );
  const supportingEvidence = {
    source: matchResult.source,
    matchStatus: matchResult.status,
    selectedSourceRecordId: matchResult.selectedCandidate?.sourceRecordId ?? null,
    candidateCount: matchResult.candidates.length,
    plausibleCandidateCount: matchResult.candidates.filter((candidate) => candidate.eligible).length,
    matchedOn: [...matchResult.matchedOn].sort(),
    missingComparisonFields: [...matchResult.missingComparisonFields].sort(),
    matchRationale: [...matchResult.rationale],
  };

  if (matchResult.status === "not_found") {
    return {
      action: "SKIP",
      confidence: matchResult.confidence,
      reason: "No source record is sufficiently compatible with the catalog vehicle.",
      supportingEvidence,
      blockingConflicts,
      reviewNotes: [
        blockingConflicts.length > 0
          ? "All evaluated candidates were blocked by explicit conflicts."
          : "Source coverage or identity evidence is insufficient; no enrichment should be attempted.",
      ],
    };
  }

  if (matchResult.status === "ambiguous") {
    return {
      action: "DEFER",
      confidence: matchResult.confidence,
      reason: "Multiple source candidates remain plausible, so selecting one would require guessing.",
      supportingEvidence,
      blockingConflicts,
      reviewNotes: [
        `Resolve the ambiguity between ${supportingEvidence.plausibleCandidateCount} eligible candidates before enrichment.`,
        missingFieldNote(matchResult.missingComparisonFields),
      ].filter(Boolean),
    };
  }

  if (matchResult.status === "probable") {
    return {
      action: "REVIEW_REQUIRED",
      confidence: matchResult.confidence,
      reason: "The source identity is probable, but unresolved evidence prevents unattended enrichment.",
      supportingEvidence,
      blockingConflicts,
      reviewNotes: [
        "Confirm the selected source record before applying its contribution.",
        missingFieldNote(matchResult.missingComparisonFields),
      ].filter(Boolean),
    };
  }

  const autoEnrichEligible = matchResult.confidence >= enrichmentDecisionPolicy.autoEnrichMinimumConfidence
    && selectedCandidateIsUsable
    && blockingConflicts.length === 0;

  if (!autoEnrichEligible) {
    return {
      action: "REVIEW_REQUIRED",
      confidence: matchResult.confidence,
      reason: "The exact-match label does not satisfy every unattended-enrichment safeguard.",
      supportingEvidence,
      blockingConflicts,
      reviewNotes: exactMatchReviewNotes(matchResult, selectedCandidateIsUsable, blockingConflicts),
    };
  }

  return {
    action: "AUTO_ENRICH",
    confidence: matchResult.confidence,
    reason: "The selected source record is an exact, conflict-free match above the automatic-enrichment threshold.",
    supportingEvidence,
    blockingConflicts: [],
    reviewNotes: [
      "The contribution adapter and canonical merger must still validate the source data before any catalog update.",
    ],
  };
}

function exactMatchReviewNotes<Candidate>(
  matchResult: SourceMatchResult<Candidate>,
  selectedCandidateIsUsable: boolean,
  blockingConflicts: string[],
) {
  const notes: string[] = [];
  if (matchResult.confidence < enrichmentDecisionPolicy.autoEnrichMinimumConfidence) {
    notes.push(
      `Confidence ${matchResult.confidence.toFixed(2)} is below the ${enrichmentDecisionPolicy.autoEnrichMinimumConfidence.toFixed(2)} automatic-enrichment threshold.`,
    );
  }
  if (!selectedCandidateIsUsable) {
    notes.push("The match does not contain an eligible selected source candidate.");
  }
  if (blockingConflicts.length > 0) {
    notes.push("Resolve every blocking conflict before enrichment.");
  }
  return notes;
}

function missingFieldNote(fields: SourceMatchResult<unknown>["missingComparisonFields"]) {
  return fields.length > 0
    ? `Review missing comparison fields: ${[...fields].sort().join(", ")}.`
    : "";
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}
