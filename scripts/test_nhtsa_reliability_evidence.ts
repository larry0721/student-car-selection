import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { getComplaintsByVehicle } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-complaint-client";
import { NhtsaDefectClientError } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-defect-http";
import { getRecallsByVehicle } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-recall-client";
import {
  buildVehicleReliabilityEvidenceSnapshot,
  getNhtsaReliabilityEvidence,
  normalizeNhtsaDefectComponent,
} from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-reliability-evidence";
import type { BuyerProfile } from "../types/buyer";
import type { NhtsaComplaintLookupResult, NhtsaRecallLookupResult } from "../types/nhtsaReliabilityEvidence";
import type { Vehicle } from "../types/vehicle";

const now = "2026-08-17T12:00:00.000Z";
const vehicle = { vehicleId: "test-rav4", modelYear: 2016, make: "Toyota", model: "RAV4" } as const;
const catalog = JSON.parse(readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8")) as Vehicle[];
const catalogBefore = stable(catalog);

async function main() {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  try {
    globalThis.fetch = mockFetch([
      ok({ Count: 2, Message: "Results returned successfully", results: [recallRaw(), recallRaw()] }),
      ok({ count: 2, message: "Results returned successfully", results: [complaintRaw(), complaintRaw()] }),
      response({ Count: 0, Message: "Results returned successfully", results: [] }, 400),
      ok({ count: 0, message: "Results returned successfully", results: [] }),
      response({ message: "Service unavailable", results: [] }, 503),
      ok({ count: 0, message: "Results returned successfully", results: [] }),
    ], () => networkCalls += 1);

    const recalls = await getRecallsByVehicle(2016, "Toyota", "RAV4");
    assert.equal(recalls.state, "RECALL_RECORDS_FOUND");
    assert.equal(recalls.records.length, 1, "Stable campaign IDs must deduplicate repeat retrieval records.");
    assert.equal(recalls.records[0].campaignNumber, "20V734000");
    assert.equal(recalls.records[0].parkIt, false);
    assert.equal(recalls.records[0].rawFields.NHTSACampaignNumber, "20V734000");

    const complaints = await getComplaintsByVehicle(2016, "Toyota", "RAV4");
    assert.equal(complaints.state, "COMPLAINT_RECORDS_FOUND");
    assert.equal(complaints.records.length, 1, "Stable ODI IDs must deduplicate repeat retrieval records.");
    assert.equal(complaints.records[0].odiNumber, "11500001");
    assert.equal(complaints.records[0].crashReported, true);
    assert.equal(complaints.records[0].fireReported, false);
    assert.equal(complaints.records[0].injuries, 0, "Zero injuries must remain zero.");
    assert.equal(complaints.records[0].deaths, 0, "Zero deaths must remain zero.");

    const emptyRecalls = await getRecallsByVehicle(2017, "Hyundai", "Accent");
    assert.equal(emptyRecalls.state, "NO_RECALL_RECORD_FOUND");
    assert.deepEqual(emptyRecalls.records, []);
    const emptyComplaints = await getComplaintsByVehicle(1900, "Example", "Empty");
    assert.equal(emptyComplaints.state, "NO_COMPLAINT_RECORD_FOUND");

    const snapshot = buildVehicleReliabilityEvidenceSnapshot({
      vehicle,
      recalls,
      complaints,
      generatedAt: now,
      dataUse: "test",
    });
    assert.equal(snapshot.recalls.length, 1);
    assert.equal(snapshot.complaints.length, 1);
    assert.equal(snapshot.recalls[0].sourceScope, "model_year", "Broad year/make/model evidence must not become configuration evidence.");
    assert.equal(snapshot.complaints[0].sourceScope, "model_year");
    assert.equal(snapshot.complaints[0].assertionStatus, "REPORTED_ALLEGATION");
    assert.equal(snapshot.complaints[0].allegationVerified, false, "Complaint allegations must not become verified mechanical facts.");
    assert.ok(snapshot.recalls[0].evidence.sourceClaims?.some((claim) => claim.sourceField === "NHTSACampaignNumber"));
    assert.ok(snapshot.complaints[0].evidence.sourceClaims?.some((claim) => claim.sourceField === "odiNumber"));
    assert.equal(snapshot.evidence.length, 2);
    assert.equal(snapshot.severitySummary.complaintCrashRecords, 1);
    assert.equal(snapshot.severitySummary.complaintFireRecords, 0);
    assert.equal(snapshot.severitySummary.totalReportedInjuries, 0);
    assert.deepEqual(snapshot.dateRange, { earliest: "11/23/2020", latest: "04/01/2023" }, "Date summaries must be bounded to plausible source dates.");
    assert.equal(snapshot.reliabilityScore, null, "Defect evidence must not create an aggregate reliability score.");
    assert.equal(snapshot.evidenceCoverage.reliabilityScoreSupported, false);
    assert.equal(snapshot.productionRecommendationConnected, false);
    assert.equal(snapshot.investigations.state, "UNSUPPORTED");
    assert.equal(snapshot.manufacturerCommunications.state, "UNSUPPORTED");
    assert.ok(snapshot.componentSummary.some((item) => item.component === "brakes"));
    assert.ok(snapshot.componentSummary.some((item) => item.component === "electrical"));

    assert.deepEqual(normalizeNhtsaDefectComponent("POWER TRAIN:AUTOMATIC TRANSMISSION"), ["powertrain", "transmission"]);
    assert.deepEqual(normalizeNhtsaDefectComponent("ENGINE"), ["engine"]);
    assert.deepEqual(normalizeNhtsaDefectComponent("ELECTRICAL SYSTEM"), ["electrical"]);
    assert.deepEqual(normalizeNhtsaDefectComponent("SERVICE BRAKES"), ["brakes"]);
    assert.deepEqual(normalizeNhtsaDefectComponent("AIR BAGS"), ["airbags"]);
    assert.deepEqual(normalizeNhtsaDefectComponent("SEATS"), ["unknown_other"]);
    assert.equal(snapshot.complaints[0].originalComponent, "SERVICE BRAKES,ELECTRICAL SYSTEM", "Original source component text must be retained.");

    const noRecordsSnapshot = buildVehicleReliabilityEvidenceSnapshot({
      vehicle,
      recalls: emptyRecalls,
      complaints: emptyComplaints,
      generatedAt: now,
      dataUse: "test",
    });
    assert.equal(noRecordsSnapshot.evidenceCoverage.reliabilityEvidenceAvailable, false);
    assert.equal(noRecordsSnapshot.reliabilityScore, null, "Zero complaints cannot mean perfect reliability.");

    const failed = await getNhtsaReliabilityEvidence(vehicle, { generatedAt: now, dataUse: "test" });
    assert.equal(failed.snapshot.evidenceCoverage.recalls, "SOURCE_FAILURE");
    assert.equal(failed.snapshot.evidenceCoverage.complaints, "NO_RECORDS_FOUND");
    assert.equal(failed.sourceErrors.length, 1);
    assert.equal(failed.sourceErrors[0].source, "recalls");
    assert.match(failed.sourceErrors[0].error, /HTTP status 503/);

    const recommendationBefore = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
    buildVehicleReliabilityEvidenceSnapshot({ vehicle, recalls, complaints, generatedAt: now, dataUse: "test" });
    const recommendationAfter = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
    assert.equal(recommendationAfter, recommendationBefore, "Reliability evidence collection must not alter recommendations.");
    assert.equal(stable(catalog), catalogBefore, "Reliability evidence collection must not mutate the catalog.");

    const implementation = readFileSync(join(process.cwd(), "src/vehicle-intelligence/sources/nhtsa/nhtsa-reliability-evidence.ts"), "utf8");
    assert.doesNotMatch(implementation, /runCandidatePipeline|RecommendationObject|DecisionReport/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(networkCalls, 6, "Permanent tests must use only controlled mocked requests.");
  console.log("NHTSA reliability evidence passed: 22 offline parsing, deduplication, scope, severity, lineage, and isolation requirements.");
}

function recallRaw() {
  return {
    Manufacturer: "Toyota Motor Engineering & Manufacturing",
    NHTSACampaignNumber: "20V734000",
    parkIt: false,
    parkOutSide: false,
    overTheAirUpdate: false,
    NHTSAActionNumber: "",
    ReportReceivedDate: "11/23/2020",
    Component: "FUEL SYSTEM, GASOLINE:DELIVERY:FUEL PUMP",
    Summary: "The fuel pump may stop operating.",
    Consequence: "An engine stall can increase crash risk.",
    Remedy: "Dealers will replace the fuel pump.",
    Notes: "Owner notification applies.",
    ModelYear: "2016",
    Make: "TOYOTA",
    Model: "RAV4",
  };
}

function complaintRaw() {
  return {
    odiNumber: 11500001,
    manufacturer: "Toyota Motor North America, Inc.",
    crash: true,
    fire: false,
    numberOfInjuries: 0,
    numberOfDeaths: 0,
    dateOfIncident: "04/01/2023",
    dateComplaintFiled: "04/03/2023",
    vin: "REDACTED123",
    components: "SERVICE BRAKES,ELECTRICAL SYSTEM",
    summary: "The consumer reported brake warning illumination.",
    mileage: 0,
    vehicleSpeed: 0,
    products: [{ type: "Vehicle", productYear: "2016", productMake: "TOYOTA", productModel: "RAV4" }],
  };
}

function profile(): BuyerProfile {
  return {
    maxPurchaseBudget: 18000, monthlyBudget: 650, downPayment: 2000, loanTermMonths: 60, apr: 8,
    paymentMethod: "not-sure", purchaseCondition: "any", expectedAnnualMileage: 12000, fuelPrice: 4,
    insuranceBudget: 150, minYear: 2014, maxMileage: 140000, minMpg: 20, fuelEconomyImportance: 3,
    reliabilityImportance: 5, performanceImportance: 2, cargoNeed: "not-sure", familySize: 1,
    drivetrainPreference: "any", transmissionPreference: "any", bodyStyle: "any", climate: "not-sure",
    resaleValueImportance: 3, modificationPlans: "not-sure", advancedFeaturesImportance: 2,
    safetyPriority: "high", scoreWeights: { affordability: 25, reliability: 20, safety: 20, fuelEnergyCost: 10, insuranceCost: 10, maintenanceRisk: 5, practicality: 5, resaleValue: 3, drivingPreferenceFit: 2 },
  };
}

function ok(payload: unknown) {
  return response(payload, 200);
}

function response(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(responses: Response[], onCall: () => void): typeof fetch {
  let index = 0;
  return async () => {
    onCall();
    const next = responses[index++];
    if (!next) throw new NhtsaDefectClientError("NETWORK_FAILURE", "Unexpected mocked NHTSA request.");
    return next;
  };
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
