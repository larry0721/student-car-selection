import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import { interpretReliabilityEvidence } from "../src/vehicle-intelligence/reliability-evidence-interpretation-policy";
import { buildVehicleReliabilityEvidenceSnapshot } from "../src/vehicle-intelligence/sources/nhtsa/nhtsa-reliability-evidence";
import type { BuyerProfile } from "../types/buyer";
import type {
  NhtsaComplaintLookupResult,
  NhtsaComplaintRecord,
  NhtsaRecallLookupResult,
  NhtsaRecallRecord,
} from "../types/nhtsaReliabilityEvidence";
import type { Vehicle } from "../types/vehicle";

const generatedAt = "2026-08-17T12:00:00.000Z";
const vehicle = { vehicleId: "policy-test-vehicle", modelYear: 2020, make: "Example", model: "Model" } as const;
const catalog = JSON.parse(readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8")) as Vehicle[];
const catalogBefore = stable(catalog);

function main() {
  const oneHundred = interpretReliabilityEvidence(snapshot(complaints(100, "ENGINE"), recalls([])));
  const threeHundred = interpretReliabilityEvidence(snapshot(complaints(300, "ENGINE"), recalls([])));
  assert.equal(oneHundred.issueClusters[0].complaintCount, 100);
  assert.equal(threeHundred.issueClusters[0].complaintCount, 300);
  assert.equal(oneHundred.assessmentState, "POTENTIAL_PATTERN");
  assert.equal(threeHundred.assessmentState, "POTENTIAL_PATTERN");
  assert.equal(oneHundred.confidence.level, threeHundred.confidence.level);
  assert.equal(oneHundred.comparativeRank, null);
  assert.equal(threeHundred.comparativeRank, null, "Raw complaint count must not create comparative ranking.");

  const repeated = interpretReliabilityEvidence(snapshot(complaints(5, "ELECTRICAL SYSTEM"), recalls([])));
  assert.equal(repeated.corroboration.state, "REPEATED_ALLEGATIONS");
  assert.equal(repeated.assessmentState, "POTENTIAL_PATTERN");
  assert.notEqual(repeated.assessmentState, "CORROBORATED_PATTERN");
  assert.ok(repeated.issueClusters.every((cluster) => cluster.sameDefectConfirmed === false));

  const corroborated = interpretReliabilityEvidence(snapshot(
    complaints(2, "SERVICE BRAKES"),
    recalls([recall("25V000001", "SERVICE BRAKES")]),
  ));
  const brakeCluster = corroborated.issueClusters.find((cluster) => cluster.component === "brakes");
  assert.ok(brakeCluster);
  assert.equal(brakeCluster.corroboration, "COMPLAINT_PATTERN_WITH_RECALL");
  assert.equal(corroborated.assessmentState, "CORROBORATED_PATTERN");
  assert.ok(brakeCluster.evidenceIds.includes("nhtsa:defect:recall:25V000001"));

  const ambiguousComponent = interpretReliabilityEvidence(snapshot(
    complaints(5, "UNKNOWN OR OTHER"),
    recalls([recall("25V000009", "UNKNOWN OR OTHER")]),
  ));
  assert.equal(ambiguousComponent.corroboration.state, "REPEATED_ALLEGATIONS");
  assert.notEqual(ambiguousComponent.assessmentState, "CORROBORATED_PATTERN", "Unknown component overlap cannot establish complaint-recall corroboration.");

  const serious = interpretReliabilityEvidence(snapshot(
    complaints(1, "ENGINE", { crashReported: true, fireReported: true, injuries: 2 }),
    recalls([]),
  ));
  assert.equal(serious.seriousSignals.seriousCount, 1);
  assert.equal(serious.seriousSignals.signals[0].level, "SERIOUS_SIGNAL");
  assert.match(serious.seriousSignals.signals[0].reasons.join(" "), /injur/i);
  assert.match(serious.seriousSignals.signals[0].reasons.join(" "), /fire/i);
  assert.match(serious.seriousSignals.signals[0].reasons.join(" "), /crash/i);

  const empty = interpretReliabilityEvidence(snapshot(complaints(0, "ENGINE"), recalls([])));
  assert.equal(empty.evidenceAvailable, false);
  assert.equal(empty.assessmentState, "INSUFFICIENT_EVIDENCE");
  assert.equal(empty.reliabilityScore, null);
  const notRatedContext = interpretReliabilityEvidence({
    ...snapshot(complaints(0, "ENGINE"), recalls([])),
    limitations: ["Separate NHTSA safety source reports NOT_RATED."],
  });
  assert.equal(notRatedContext.assessmentState, "INSUFFICIENT_EVIDENCE", "Not Rated context cannot become a negative reliability assessment.");

  assert.equal(corroborated.scope, "model_year");
  assert.equal(corroborated.applicability.scope, "model_year");
  assert.equal(corroborated.applicability.configurationSpecific, false);
  assert.equal(corroborated.applicability.vinSpecific, false);
  assert.equal(corroborated.exposureContext.state, "PARTIAL");
  assert.equal(corroborated.exposureContext.complaintRateAvailable, false);
  assert.equal(corroborated.exposureContext.complaintRate, null);
  assert.ok(corroborated.exposureContext.basis.some((item) => /exposure-adjusted complaint rate unavailable/i.test(item)));

  for (const event of repeated.seriousSignals.signals) assert.equal(event.allegation, true);
  assert.equal(repeated.issueClusters[0].sourceTypes[0], "COMPLAINT");
  assert.equal(repeated.reliabilityScore, null);
  assert.equal(repeated.productionRecommendationConnected, false);
  assert.ok(!Object.hasOwn(repeated, "score"));

  const criticalWithoutCorroboration = interpretReliabilityEvidence(snapshot(
    complaints(1, "ENGINE", { deaths: 1 }),
    recalls([]),
  ));
  assert.equal(criticalWithoutCorroboration.seriousSignals.criticalCount, 1);
  assert.notEqual(criticalWithoutCorroboration.assessmentState, "STRONG_NEGATIVE_SIGNAL", "A critical allegation without corroboration cannot become a strong negative assessment.");

  const criticalWithCorroboration = interpretReliabilityEvidence(snapshot(
    complaints(2, "ENGINE", { deaths: 1 }),
    recalls([recall("25V000002", "ENGINE")]),
  ));
  assert.equal(criticalWithCorroboration.assessmentState, "STRONG_NEGATIVE_SIGNAL");
  assert.equal(criticalWithCorroboration.confidence.level, "MEDIUM");
  assert.ok(criticalWithCorroboration.confidence.basis.some((item) => /not vehicle reliability quality/i.test(item)));

  const recommendationBefore = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  interpretReliabilityEvidence(snapshot(complaints(300, "ENGINE"), recalls([recall("25V000003", "ENGINE")])));
  const recommendationAfter = stable(runCandidatePipeline(profile(), catalog, { includeCompromises: true, includeExcluded: true }).decisionSet);
  assert.equal(recommendationAfter, recommendationBefore);
  assert.equal(stable(catalog), catalogBefore);

  console.log("Reliability interpretation policy passed: count neutrality, clustering, severity, corroboration, exposure, scope, confidence, and recommendation isolation.");
}

function snapshot(complaintLookup: NhtsaComplaintLookupResult, recallLookup: NhtsaRecallLookupResult) {
  return buildVehicleReliabilityEvidenceSnapshot({
    vehicle,
    complaints: complaintLookup,
    recalls: recallLookup,
    generatedAt,
    dataUse: "test",
  });
}

function complaints(
  count: number,
  component: string,
  severity: Partial<Pick<NhtsaComplaintRecord, "crashReported" | "fireReported" | "injuries" | "deaths">> = {},
): NhtsaComplaintLookupResult {
  const records = Array.from({ length: count }, (_, index) => complaint(String(10_000_000 + index), component, severity));
  return {
    state: records.length ? "COMPLAINT_RECORDS_FOUND" : "NO_COMPLAINT_RECORD_FOUND",
    records,
    sourceUrl: "https://api.nhtsa.gov/complaints/complaintsByVehicle",
  };
}

function complaint(
  odiNumber: string,
  component: string,
  severity: Partial<Pick<NhtsaComplaintRecord, "crashReported" | "fireReported" | "injuries" | "deaths">>,
): NhtsaComplaintRecord {
  return {
    odiNumber,
    manufacturer: "Example Manufacturer",
    incidentDate: "01/01/2025",
    complaintFiledDate: "01/02/2025",
    component,
    summary: "Consumer allegation retained for policy testing.",
    crashReported: severity.crashReported ?? false,
    fireReported: severity.fireReported ?? false,
    injuries: severity.injuries ?? 0,
    deaths: severity.deaths ?? 0,
    mileage: null,
    vehicleSpeed: null,
    modelYear: vehicle.modelYear,
    make: vehicle.make,
    model: vehicle.model,
    sourceUrl: "https://api.nhtsa.gov/complaints/odinumber",
    rawFields: { odiNumber, components: component },
  };
}

function recalls(records: NhtsaRecallRecord[]): NhtsaRecallLookupResult {
  return {
    state: records.length ? "RECALL_RECORDS_FOUND" : "NO_RECALL_RECORD_FOUND",
    records,
    sourceUrl: "https://api.nhtsa.gov/recalls/recallsByVehicle",
  };
}

function recall(campaignNumber: string, component: string): NhtsaRecallRecord {
  return {
    campaignNumber,
    manufacturer: "Example Manufacturer",
    component,
    summary: "Official safety recall.",
    consequence: "Safety consequence retained without severity inference.",
    remedy: "Remedy available.",
    notes: null,
    reportReceivedDate: "02/01/2025",
    modelYear: vehicle.modelYear,
    make: vehicle.make,
    model: vehicle.model,
    nhtsaActionNumber: null,
    parkIt: false,
    parkOutside: false,
    overTheAirUpdate: false,
    sourceUrl: "https://api.nhtsa.gov/recalls/campaignNumber",
    rawFields: { NHTSACampaignNumber: campaignNumber, Component: component },
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

function stable(value: unknown) {
  return JSON.stringify(value);
}

main();
