import type {
  CanonicalConfidence,
  CanonicalEvidence,
  CanonicalEvidenceNormalizationMethod,
  CanonicalRecordScope,
  CanonicalSourceType,
  CanonicalUnit,
  CanonicalVehicleFieldPath,
} from "../types/canonicalVehicle";
import type { CanonicalContributionSource } from "../types/canonicalVehicleContribution";
import type { CatalogEnrichmentReviewDecision } from "../types/catalogEnrichmentReview";
import type { VehicleKnowledgeProposal } from "../types/vehicleKnowledge";

const fixtureVehicleId = "fixture-vehicle-2020";

export const vehicleKnowledgeReviewDecisionFixture: CatalogEnrichmentReviewDecision = {
  decisionId: "fixture-review:epa:1",
  reviewId: "fixture-vehicle-2020:epa",
  catalogVehicleId: fixtureVehicleId,
  source: "epa",
  action: "APPROVE_SOURCE",
  selectedSourceRecordId: "epa-reviewed-1",
  selectedCandidateSnapshot: null,
  reason: "The official EPA configuration record matches the reviewed fixture configuration.",
  evidence: [{ kind: "source_record", reference: "epa-reviewed-1", note: "Fixture review evidence" }],
  catalogCorrections: [],
  resolvedConflicts: [],
  unresolvedFields: [],
  reviewedCandidateIds: ["epa-reviewed-1"],
  reviewer: { reviewerId: "fixture_reviewer", displayName: "Fixture Reviewer" },
  decidedAt: "2026-07-01T00:00:00.000Z",
  reviewVersion: 1,
  supersedesDecisionId: null,
  dataUse: "fixture",
};

export const vehicleKnowledgeFixtureProposals = {
  epaFuelEconomy: proposal({
    field: "environment.fuelEconomy",
    value: 52,
    unit: "mpg",
    sourceType: "epa",
    providerName: "FuelEconomy.gov",
    sourceRecordId: "epa-mpg-1",
    scope: "configuration",
    retrievedAt: "2026-07-01T00:00:00.000Z",
  }),
  nhtsaIdentity: proposal({
    field: "identity.make",
    value: "Toyota",
    unit: "none",
    sourceType: "nhtsa",
    providerName: "NHTSA vPIC",
    sourceRecordId: "1HGCM82633A004352",
    scope: "vin",
    retrievedAt: "2026-07-01T00:00:00.000Z",
  }),
  agreeingNhtsaDrivetrain: proposal({
    field: "identity.drivetrain",
    value: "AWD",
    unit: "none",
    sourceType: "nhtsa",
    providerName: "NHTSA vPIC",
    sourceRecordId: "VIN-AGREE-1",
    scope: "vin",
    retrievedAt: "2026-07-02T00:00:00.000Z",
  }),
  agreeingOemDrivetrain: proposal({
    field: "identity.drivetrain",
    value: "AWD",
    unit: "none",
    sourceType: "oem",
    providerName: "Fixture OEM",
    sourceRecordId: "OEM-AGREE-1",
    scope: "configuration",
    retrievedAt: "2026-07-03T00:00:00.000Z",
  }),
  conflictingNhtsaDrivetrain: proposal({
    vehicleId: "fixture-conflict-vehicle",
    field: "identity.drivetrain",
    value: "AWD",
    unit: "none",
    sourceType: "nhtsa",
    providerName: "NHTSA vPIC",
    sourceRecordId: "VIN-CONFLICT-1",
    scope: "vin",
    retrievedAt: "2026-07-02T00:00:00.000Z",
  }),
  conflictingOemDrivetrain: proposal({
    vehicleId: "fixture-conflict-vehicle",
    field: "identity.drivetrain",
    value: "FWD",
    unit: "none",
    sourceType: "oem",
    providerName: "Fixture OEM",
    sourceRecordId: "OEM-CONFLICT-1",
    scope: "configuration",
    retrievedAt: "2026-07-03T00:00:00.000Z",
  }),
  oldEpaFuelCost: proposal({
    field: "financial.fuelEnergyCost",
    value: 195,
    unit: "usd_per_month",
    sourceType: "epa",
    providerName: "FuelEconomy.gov",
    sourceRecordId: "epa-cost-old",
    scope: "configuration",
    retrievedAt: "2026-01-01T00:00:00.000Z",
  }),
  newEpaFuelCost: proposal({
    field: "financial.fuelEnergyCost",
    value: 202,
    unit: "usd_per_month",
    sourceType: "epa",
    providerName: "FuelEconomy.gov",
    sourceRecordId: "epa-cost-new",
    scope: "configuration",
    retrievedAt: "2026-07-15T00:00:00.000Z",
  }),
  staleListingPrice: proposal({
    field: "financial.purchasePrice",
    value: 18_500,
    unit: "usd",
    sourceType: "listing",
    providerName: "Fixture Marketplace",
    sourceRecordId: "listing-stale-1",
    scope: "listing",
    retrievedAt: "2025-01-01T00:00:00.000Z",
  }),
  rejectedSafetyClaim: proposal({
    field: "safety.crashSafety",
    value: 99,
    unit: "score_0_100",
    sourceType: "epa",
    providerName: "FuelEconomy.gov",
    sourceRecordId: "epa-unsupported-safety",
    scope: "configuration",
    retrievedAt: "2026-07-01T00:00:00.000Z",
    confidence: { score: null, level: "unknown", sourceAgreement: "single_source", basis: ["Fixture intentionally lacks source confidence."] },
  }),
  reviewedFuelEconomy: proposal({
    field: "environment.fuelEconomy",
    value: 48,
    unit: "mpg",
    sourceType: "epa",
    providerName: "FuelEconomy.gov",
    sourceRecordId: "epa-reviewed-1",
    scope: "configuration",
    retrievedAt: "2026-07-01T00:00:00.000Z",
    reviewDecision: vehicleKnowledgeReviewDecisionFixture,
  }),
} as const;

type ProposalInput = {
  vehicleId?: string;
  field: CanonicalVehicleFieldPath;
  value: string | number;
  unit: CanonicalUnit;
  sourceType: CanonicalSourceType;
  providerName: string;
  sourceRecordId: string;
  scope: CanonicalRecordScope;
  retrievedAt: string;
  normalizationMethod?: CanonicalEvidenceNormalizationMethod;
  confidence?: CanonicalConfidence;
  reviewDecision?: CatalogEnrichmentReviewDecision;
};

function proposal(input: ProposalInput): VehicleKnowledgeProposal {
  const normalizationMethod = input.normalizationMethod ?? "direct";
  const evidenceId = `fixture-evidence:${input.sourceRecordId}:${input.field}`;
  const source: CanonicalContributionSource = {
    sourceType: input.sourceType,
    providerName: input.providerName,
    sourceRecordId: input.sourceRecordId,
    sourceUrl: null,
    observedAt: input.retrievedAt,
    retrievedAt: input.retrievedAt,
    market: "US",
    methodology: "Controlled vehicle-knowledge fixture.",
    license: "Fixture only; not production source data.",
  };
  const evidence: CanonicalEvidence = {
    evidenceId,
    sourceType: input.sourceType,
    providerName: input.providerName,
    sourceRecordId: input.sourceRecordId,
    sourceUrl: null,
    scope: input.scope,
    observedAt: input.retrievedAt,
    retrievedAt: input.retrievedAt,
    market: "US",
    methodology: "Controlled vehicle-knowledge fixture.",
    license: "Fixture only; not production source data.",
    dataUse: "fixture",
    sourceClaims: [{ sourceField: input.field, originalSourceValue: input.value }],
    normalizationMethod,
    normalizationNotes: ["Fixture normalization."],
  };
  return {
    vehicleId: input.vehicleId ?? fixtureVehicleId,
    canonicalFieldPath: input.field,
    canonicalValue: input.value,
    unit: input.unit,
    valueStatus: normalizationMethod === "derived" ? "derived" : normalizationMethod === "estimated" ? "estimated" : "sourced",
    estimationMethod: normalizationMethod === "derived" || normalizationMethod === "estimated" ? "Controlled fixture method." : null,
    measurementContext: null,
    source,
    evidence: [evidence],
    confidence: input.confidence ?? {
      score: 94,
      level: "high",
      sourceAgreement: "single_source",
      basis: ["Controlled authoritative fixture."],
    },
    recordScope: input.scope,
    normalizationMethod,
    effectiveFrom: input.retrievedAt,
    effectiveTo: null,
    createdAt: input.retrievedAt,
    reviewDecision: input.reviewDecision ?? null,
    dataClassification: "fixture",
  };
}
