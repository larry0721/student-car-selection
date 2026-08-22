import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { createVehicleKnowledgeProposalsFromContribution, createVehicleKnowledgeRepository } from "../src/vehicle-intelligence/vehicle-knowledge-repository";
import { getVehicleKnowledgeSourceAuthority } from "../src/vehicle-intelligence/vehicle-knowledge-trust-policy";
import { normalizeNhtsaSafetyToContribution } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-contribution-adapter";
import { getSafetyRatingByVehicleId, getSafetyRatingCandidates, type NhtsaSafetyCandidate, type NhtsaSafetyRecord } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-client";
import { matchNhtsaSafetyCandidate } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-safety-intelligence";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

const catalog = JSON.parse(readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8")) as Vehicle[];
const catalogBefore = stable(catalog);
const profile: BuyerProfile = {
  maxPurchaseBudget: 18000, monthlyBudget: 650, downPayment: 2000, loanTermMonths: 60, apr: 8,
  paymentMethod: "not-sure", purchaseCondition: "any", expectedAnnualMileage: 12000, fuelPrice: 4,
  insuranceBudget: 150, minYear: 2014, maxMileage: 140000, minMpg: 20, fuelEconomyImportance: 3,
  reliabilityImportance: 5, performanceImportance: 2, cargoNeed: "not-sure", familySize: 1,
  drivetrainPreference: "any", transmissionPreference: "any", bodyStyle: "any", climate: "not-sure",
  resaleValueImportance: 3, modificationPlans: "not-sure", advancedFeaturesImportance: 2,
  safetyPriority: "high", scoreWeights: { affordability: 25, reliability: 20, safety: 20, fuelEnergyCost: 10, insuranceCost: 10, maintenanceRisk: 5, practicality: 5, resaleValue: 3, drivingPreferenceFit: 2 },
};

async function main() {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  try {
    const oneCandidatePayload = { Results: [{ VehicleId: 11111, VehicleDescription: "2017 Hyundai Accent 4 DR FWD" }] };
    globalThis.fetch = mockFetch([oneCandidatePayload], () => networkCalls += 1);
    const one = await getSafetyRatingCandidates(2017, "Hyundai", "Accent");
    assert.equal(one.length, 1);
    assert.equal(one[0].vehicleId, 11111);
    assert.equal(one[0].drivetrain, "FWD");
    assert.equal(one[0].doorCount, 4);

    const multiplePayload = { Results: [
      { VehicleId: 10114, VehicleDescription: "2016 Toyota Rav4 SUV FWD" },
      { VehicleId: 10115, VehicleDescription: "2016 Toyota Rav4 SUV AWD" },
    ] };
    globalThis.fetch = mockFetch([multiplePayload], () => networkCalls += 1);
    const multiple = await getSafetyRatingCandidates(2016, "Toyota", "RAV4");
    assert.equal(multiple.length, 2);
    assert.deepEqual(multiple.map((item) => item.drivetrain), ["FWD", "AWD"]);

    const fwdMatch = matchNhtsaSafetyCandidate(identity({ drivetrain: "FWD", bodyStyle: "suv" }), multiple);
    assert.equal(fwdMatch.status, "EXACT");
    assert.equal(fwdMatch.selectedCandidate?.vehicleId, 10114);
    const awdMatch = matchNhtsaSafetyCandidate(identity({ drivetrain: "AWD", bodyStyle: "suv" }), multiple);
    assert.equal(awdMatch.status, "EXACT");
    assert.equal(awdMatch.selectedCandidate?.vehicleId, 10115);

    const ambiguousCandidates = multiple.map((item) => ({ ...item, drivetrain: null }));
    const ambiguous = matchNhtsaSafetyCandidate(identity({ drivetrain: null, bodyStyle: "suv" }), ambiguousCandidates);
    assert.equal(ambiguous.status, "AMBIGUOUS_MATCH");
    assert.equal(ambiguous.selectedCandidate, null);
    assert.equal(matchNhtsaSafetyCandidate(identity({}), []).status, "NO_MATCH");

    const ratedRaw = ratingPayload();
    globalThis.fetch = mockFetch([{ Results: [ratedRaw] }], () => networkCalls += 1);
    const rated = await getSafetyRatingByVehicleId(10114);
    assert.equal(rated.ratingState, "RATED");
    assert.equal(rated.ratings.overall, 5);
    assert.equal(rated.ratings.overallFrontCrash, 4);
    assert.equal(rated.ratings.rolloverPossibilityRatio, 0.174);
    assert.equal(rated.safetyTechnology.forwardCollisionWarning, "Optional");
    assert.equal(rated.safetyTechnology.laneDepartureWarning, "No");
    assert.equal(rated.safetyHistory.complaintsCount, 0);

    const notRatedRaw = ratingPayload({
      VehicleId: 12789, VehicleDescription: "2018 Nissan Leaf BEV 5 HB FWD", ModelYear: 2018, Make: "Nissan", Model: "Leaf",
      OverallRating: "Not Rated", OverallFrontCrashRating: "Not Rated", FrontCrashDriversideRating: "Not Rated",
      FrontCrashPassengersideRating: "Not Rated", OverallSideCrashRating: "Not Rated", SideCrashDriversideRating: "Not Rated",
      SideCrashPassengersideRating: "Not Rated", SidePoleCrashRating: "Not Rated", "combinedSideBarrierAndPoleRating-Front": "Not Rated",
      "combinedSideBarrierAndPoleRating-Rear": "Not Rated", "sideBarrierRating-Overall": "Not Rated", RolloverRating: "Not Rated", RolloverPossibility: "Not Rated",
    });
    globalThis.fetch = mockFetch([{ Results: [notRatedRaw] }], () => networkCalls += 1);
    const notRated = await getSafetyRatingByVehicleId(12789);
    assert.equal(notRated.ratingState, "NOT_RATED");
    assert.equal(notRated.ratings.overall, null);
    assert.notEqual(notRated.ratings.overall, 0);

    const zeroRaw = ratingPayload({ OverallRating: "0", RolloverPossibility: "0", ComplaintsCount: 0, RecallsCount: 0, InvestigationCount: 0 });
    globalThis.fetch = mockFetch([{ Results: [zeroRaw] }], () => networkCalls += 1);
    const zero = await getSafetyRatingByVehicleId(10114);
    assert.equal(zero.ratings.overall, 0);
    assert.equal(zero.ratings.rolloverPossibilityRatio, 0);
    assert.equal(zero.safetyHistory.recallsCount, 0);

    const normalized = normalizeNhtsaSafetyToContribution({ record: rated }, context());
    assert.ok(normalized.contribution);
    assert.equal(normalized.contribution.data.safety?.crashSafety?.value, 100);
    assert.equal(normalized.contribution.data.safety?.crashSafety?.measurementContext?.rolloverPossibilityRatio, 0.174);
    assert.equal(normalized.contribution.data.safety?.crashSafety?.measurementContext?.rolloverPossibilityPercent, 17.4);
    assert.equal(normalized.contribution.data.safety?.crashSafety?.measurementContext?.forwardCollisionWarning, "Optional");
    assert.equal(normalized.contribution.data.safety?.crashSafety?.measurementContext?.laneDepartureWarning, "No");
    assert.equal(normalized.contribution.source.sourceRecordId, "10114");
    assert.ok(normalized.contribution.evidence[0].sourceClaims.some((item) => item.sourceField === "OverallFrontCrashRating" && item.originalSourceValue === "4"));
    assert.ok(normalized.contribution.evidence[0].sourceClaims.some((item) => item.sourceField === "ComplaintsCount" && item.originalSourceValue === 0));

    const changedCounts = normalizeNhtsaSafetyToContribution({ record: { ...rated, safetyHistory: { complaintsCount: 999, recallsCount: 99, investigationCount: 9 } } }, context());
    assert.equal(changedCounts.contribution?.data.safety?.crashSafety?.value, normalized.contribution.data.safety?.crashSafety?.value);
    assert.equal(changedCounts.contribution?.data.safety?.crashSafety?.value, 100);

    const notRatedContribution = normalizeNhtsaSafetyToContribution({ record: notRated }, context());
    assert.ok(notRatedContribution.contribution);
    assert.equal(notRatedContribution.contribution.data.safety, undefined);
    assert.ok(notRatedContribution.issues.some((item) => item.code === "nhtsa_safety_not_rated"));
    assert.ok(notRatedContribution.contribution.evidence[0].sourceClaims.some((item) => item.originalSourceValue === "Not Rated"));

    assert.equal(getVehicleKnowledgeSourceAuthority("safety.crashSafety", "nhtsa", "configuration"), 96);
    assert.equal(getVehicleKnowledgeSourceAuthority("reliability.longTermReliability", "nhtsa", "configuration"), 55);
    assert.equal(getVehicleKnowledgeSourceAuthority("financial.purchasePrice", "nhtsa", "configuration"), 25);

    const repository = createVehicleKnowledgeRepository({ repositoryId: "nhtsa-safety-offline-test", dataUse: "test", createdAt: context().retrievedAt });
    const proposal = createVehicleKnowledgeProposalsFromContribution("rav4-test", normalized.contribution, { createdAt: context().retrievedAt, dataClassification: "test" })[0];
    const trusted = repository.addProposal(proposal);
    assert.equal(trusted.canonicalFieldPath, "safety.crashSafety");
    assert.equal(trusted.trustAssessment.trustState, "TRUSTED");
    assert.equal(trusted.sourceRecordId, "10114");
    assert.equal(ambiguous.selectedCandidate, null, "Ambiguous matching cannot produce a trusted source record.");

    const recommendationBefore = stable(runCandidatePipeline(profile, catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
    normalizeNhtsaSafetyToContribution({ record: rated }, context());
    const recommendationAfter = stable(runCandidatePipeline(profile, catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
    assert.equal(recommendationAfter, recommendationBefore);
    assert.equal(stable(catalog), catalogBefore);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(networkCalls, 5, "Only the five explicit mocked client requests should occur.");
  console.log("NHTSA Safety intelligence passed: 24 offline discovery, matching, parsing, evidence, trust, and isolation requirements.");
}

function ratingPayload(overrides: Record<string, unknown> = {}) {
  return {
    VehicleId: 10114, VehicleDescription: "2016 Toyota Rav4 SUV FWD", ModelYear: 2016, Make: "Toyota", Model: "RAV4",
    OverallRating: "5", OverallFrontCrashRating: "4", FrontCrashDriversideRating: "4", FrontCrashPassengersideRating: "4",
    OverallSideCrashRating: "5", SideCrashDriversideRating: "5", SideCrashPassengersideRating: "5", SidePoleCrashRating: "5",
    "combinedSideBarrierAndPoleRating-Front": "5", "combinedSideBarrierAndPoleRating-Rear": "5", "sideBarrierRating-Overall": "5",
    RolloverRating: "4", RolloverPossibility: "0.174", NHTSAElectronicStabilityControl: "Standard",
    NHTSAForwardCollisionWarning: "Optional", NHTSALaneDepartureWarning: "No", ComplaintsCount: 0, RecallsCount: 2, InvestigationCount: 1,
    VehiclePicture: "https://example.test/rav4.jpg", ...overrides,
  };
}

function identity(overrides: Partial<{ drivetrain: string | null; bodyStyle: string | null; fuelType: string | null }> = {}) {
  return { modelYear: 2016, make: "Toyota", model: "RAV4", drivetrain: overrides.drivetrain ?? null, bodyStyle: overrides.bodyStyle ?? null, fuelType: overrides.fuelType ?? "gas" };
}

function context() {
  return { ingestionId: "nhtsa-safety-offline", retrievedAt: "2026-08-16T12:00:00.000Z", market: "US", sourceType: "nhtsa" as const };
}

function mockFetch(payloads: unknown[], onCall: () => void): typeof fetch {
  let index = 0;
  return async () => {
    onCall();
    const payload = payloads[index++];
    if (payload === undefined) throw new Error("Unexpected mocked NHTSA Safety request.");
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
