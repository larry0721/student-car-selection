import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCandidatePipeline } from "../lib/recommendations";
import {
  compareVehicleFieldAuthorityShadow,
  resolveVehicleCatalogAuthority,
  resolveVehicleFieldAuthority,
} from "../src/vehicle-intelligence/vehicle-field-authority-resolver";
import { loadPublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";
import type { BuyerProfile } from "../types/buyer";
import type { PublishedVehicleIntelligenceRecord } from "../types/publishedVehicleIntelligence";
import type { Vehicle } from "../types/vehicle";

const root = process.cwd();
const catalog = readJson<Vehicle[]>("data/processed/vehicleCatalog.json");
const repositoryText = readFileSync(join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json"), "utf8");
const publications = loadPublishedCVRRepository(repositoryText).listPublishedVehicles();
const catalogBefore = stable(catalog);
const publicationsBefore = stable(publications);

assert.equal(catalog.length, 320);
assert.equal(publications.length, 5);

const nonGolden = catalog.find((vehicle) => !publications.some((publication) => publication.vehicleId === vehicle.id))!;
const noCvr = resolveVehicleFieldAuthority(nonGolden, publications);
assert.strictEqual(noCvr.vehicle, nonGolden, "A vehicle without a CVR must be returned unchanged.");
assert.equal(noCvr.trace.identityMatchStatus, "not_found");
assert.ok(noCvr.trace.fields.every((field) => field.status === "cvr_unavailable" && field.fallbackUsed));

const crv = vehicle("honda-cr-v-2016-craigslist-carstrucks-data");
const trustedDrivetrain = resolveVehicleFieldAuthority({ ...crv, drivetrain: "FWD" }, publications);
assert.equal(trustedDrivetrain.vehicle.drivetrain, "AWD");
assert.equal(field(trustedDrivetrain, "drivetrain").authority, "published_cvr");
assert.equal(field(trustedDrivetrain, "drivetrain").status, "cvr_override_eligible");

const prius = vehicle("toyota-prius-2016-usedcarscatalog");
const trustedFuel = resolveVehicleFieldAuthority({ ...prius, fuelType: "gas" }, publications);
assert.equal(trustedFuel.vehicle.fuelType, "hybrid");
assert.equal(field(trustedFuel, "fuelType").authority, "published_cvr");

const trustedMpg = resolveVehicleFieldAuthority({ ...prius, mpg: 49 }, publications);
assert.equal(trustedMpg.vehicle.mpg, 52);
assert.equal(field(trustedMpg, "mpg").canonicalFieldPath, "environment.fuelEconomy");

const leaf = vehicle("nissan-leaf-2018-craigslist-carstrucks-data");
const incompatibleEnergyUnit = resolveVehicleFieldAuthority(leaf, publications);
assert.equal(incompatibleEnergyUnit.vehicle.mpg, leaf.mpg);
assert.equal(field(incompatibleEnergyUnit, "mpg").status, "legacy_fallback");
assert.match(field(incompatibleEnergyUnit, "mpg").reason, /cannot be represented safely/);

const duplicate = {
  ...clone(publication(crv.id)),
  publicationId: `${publication(crv.id).publicationId}:duplicate`,
};
const ambiguous = resolveVehicleFieldAuthority(crv, [...publications, duplicate]);
assert.strictEqual(ambiguous.vehicle, crv);
assert.equal(ambiguous.trace.identityMatchStatus, "ambiguous");

const wrongIdentity = clone(publication(crv.id));
wrongIdentity.canonicalRecord.identity.make.value = "Toyota";
const rejectedIdentity = resolveVehicleFieldAuthority(crv, publications.map((item) => item.vehicleId === crv.id ? wrongIdentity : item));
assert.strictEqual(rejectedIdentity.vehicle, crv);
assert.equal(rejectedIdentity.trace.identityMatchStatus, "conflict");

const conflictedConfiguration = clone(publication(crv.id));
conflictedConfiguration.canonicalRecord.identity.drivetrain.confidence.sourceAgreement = "conflicts";
const rejectedConfiguration = resolveVehicleFieldAuthority(
  { ...crv, drivetrain: "FWD" },
  publications.map((item) => item.vehicleId === crv.id ? conflictedConfiguration : item),
);
assert.equal(rejectedConfiguration.vehicle.drivetrain, "FWD");
assert.equal(field(rejectedConfiguration, "drivetrain").status, "cvr_rejected_due_to_evidence_or_confidence");

const missingBody = resolveVehicleFieldAuthority(vehicle("hyundai-accent-2017-craigslist-carstrucks-data"), publications);
assert.equal(missingBody.vehicle.bodyType, "sedan");
assert.equal(field(missingBody, "bodyType").status, "cvr_rejected_due_to_evidence_or_confidence");

const reliabilityCandidate = clone(publication(crv.id));
const reliabilityDatum = reliabilityCandidate.canonicalRecord.reliability.longTermReliability;
reliabilityDatum.value = 99;
reliabilityDatum.status = "sourced";
reliabilityDatum.confidence = clone(reliabilityCandidate.canonicalRecord.safety.crashSafety.confidence);
reliabilityDatum.evidenceIds = [...reliabilityCandidate.canonicalRecord.safety.crashSafety.evidenceIds];
reliabilityDatum.missingReason = null;
const reliabilityProtected = resolveVehicleFieldAuthority(
  crv,
  publications.map((item) => item.vehicleId === crv.id ? reliabilityCandidate : item),
);
assert.equal(reliabilityProtected.vehicle.reliabilityScore, crv.reliabilityScore);
assert.equal(field(reliabilityProtected, "reliabilityScore").authority, "legacy");
assert.match(field(reliabilityProtected, "reliabilityScore").reason, /not recommendation-scoring eligible/);

const crashEvidenceProtected = resolveVehicleFieldAuthority(crv, publications);
assert.equal(crashEvidenceProtected.vehicle.safetyScore, crv.safetyScore);
assert.equal(field(crashEvidenceProtected, "safetyScore").authority, "legacy");
assert.ok(field(crashEvidenceProtected, "safetyScore").evidenceIds.length > 0);
assert.match(field(crashEvidenceProtected, "safetyScore").reason, /not substituted/);

for (const scoreField of ["performanceScore", "cargoScore", "featureScore", "resaleScore"] as const) {
  assert.equal(crashEvidenceProtected.vehicle[scoreField], crv[scoreField], `${scoreField} must not be invented or changed.`);
}

const genericVpicVehicle = { ...nonGolden, dataSources: ["seed", "nhtsa"] };
const genericVpicDecision = runCandidatePipeline(profile(), [genericVpicVehicle]).decisionSet.primaryRecommendations[0];
const safetyProvenance = genericVpicDecision.fieldProvenance.find((item) => item.field === "safetyScore");
assert.deepEqual(safetyProvenance, {
  field: "safetyScore",
  status: "estimated",
  source: "engine",
  method: "catalog_year_body_drivetrain_heuristic",
});
assert.equal(genericVpicDecision.scoreContributions.find((item) => item.category === "safety")?.dataStatus, "estimated");

const resolvedCatalog = resolveVehicleCatalogAuthority(catalog, publications);
const nonGoldenIds = new Set(catalog.filter((item) => !publications.some((publication) => publication.vehicleId === item.id)).map((item) => item.id));
assert.equal(nonGoldenIds.size, 315);
for (const id of nonGoldenIds) {
  assert.equal(stable(resolvedCatalog.find((item) => item.id === id)), stable(catalog.find((item) => item.id === id)), `${id} changed without a published CVR.`);
}

const shadow = compareVehicleFieldAuthorityShadow(catalog, publications);
assert.equal(shadow.summary.catalogCount, 320);
assert.equal(shadow.summary.publishedVehicleCount, 5);
assert.equal(shadow.results.filter((item) => item.trace.identityMatchStatus === "not_found").length, 315);
assert.equal(stable(catalog), catalogBefore, "Shadow comparison mutated the catalog.");
assert.equal(stable(publications), publicationsBefore, "Shadow comparison mutated published CVRs.");

const profileSet = {
  balanced: profile(),
  fuelFocused: profile({
    fuelEconomyImportance: 5,
    scoreWeights: { affordability: 10, reliability: 10, safety: 10, fuelEnergyCost: 50, insuranceCost: 5, maintenanceRisk: 5, practicality: 5, resaleValue: 0, drivingPreferenceFit: 5 },
  }),
  awdRequired: profile({ drivetrainPreference: "AWD", requiredDrivetrains: ["AWD"] }),
  hybridRequired: profile({ requiredFuelType: "hybrid", requiredFuelTypes: ["hybrid"] }),
  safetyFocused: profile({ safetyPriority: "maximum", scoreWeights: weights("safety") }),
  reliabilityFocused: profile({ reliabilityImportance: 5, scoreWeights: weights("reliability") }),
  performanceFocused: profile({ performanceImportance: 5, scoreWeights: weights("drivingPreferenceFit") }),
  gasolineAllowed: profile({ allowedFuelTypes: ["gas"] }),
  budgetConstrained: profile({ maxPurchaseBudget: 15000, monthlyBudget: 400 }),
  noBudgetLimit: profile({ maxPurchaseBudget: 0, monthlyBudget: 0 }),
  excludedMake: profile({ excludedMakes: ["Toyota"] }),
  requiredBodyStyle: profile({ bodyStyle: "suv", requiredBodyStyles: ["suv"] }),
  mixedPreferences: profile({
    maxPurchaseBudget: 25000,
    reliabilityImportance: 5,
    safetyPriority: "high",
    fuelEconomyImportance: 4,
    preferredFuelTypes: ["hybrid"],
    preferredBodyStyles: ["suv", "hatchback"],
    excludedMakes: ["Nissan"],
  }),
};
const rankingComparison = Object.fromEntries(Object.entries(profileSet).map(([name, buyerProfile]) => {
  const legacyPipeline = runCandidatePipeline(buyerProfile, catalog, { includeCompromises: true, includeExcluded: true });
  const resolvedPipeline = runCandidatePipeline(buyerProfile, resolvedCatalog, { includeCompromises: true, includeExcluded: true });
  const legacy = summarizeRanking(legacyPipeline);
  const resolved = summarizeRanking(resolvedPipeline);
  const legacyRecommendations = allRecommendations(legacyPipeline);
  const resolvedRecommendations = allRecommendations(resolvedPipeline);
  const qualificationChanges = resolvedRecommendations.flatMap((recommendation) => {
    const before = legacyRecommendations.find((item) => item.vehicle.id === recommendation.vehicle.id);
    return before && before.qualificationStatus !== recommendation.qualificationStatus
      ? [{ vehicleId: recommendation.vehicle.id, legacy: before.qualificationStatus, resolved: recommendation.qualificationStatus }]
      : [];
  });
  return [name, {
    legacy,
    resolved,
    topChanged: legacy.ids[0] !== resolved.ids[0],
    top3Changed: stable(legacy.ids.slice(0, 3)) !== stable(resolved.ids.slice(0, 3)),
    top10Changed: stable(legacy.ids) !== stable(resolved.ids),
    scoreChanges: resolved.scores.flatMap((entry) => {
      const before = legacy.scores.find((item) => item.id === entry.id);
      return before && before.score !== entry.score ? [{ vehicleId: entry.id, legacy: before.score, resolved: entry.score }] : [];
    }),
    qualificationChanges,
  }];
}));

for (const [name, comparison] of Object.entries(rankingComparison)) {
  for (const change of comparison.scoreChanges) {
    assert.ok(publications.some((item) => item.vehicleId === change.vehicleId), `${name} changed a non-published vehicle score.`);
  }
  for (const change of comparison.qualificationChanges) {
    assert.ok(publications.some((item) => item.vehicleId === change.vehicleId), `${name} changed a non-published vehicle qualification.`);
  }
}

console.log("Vehicle field authority resolver passed: 12 authority, identity, provenance, safety, reliability, and immutability scenarios.");
console.log(JSON.stringify({
  shadowSummary: shadow.summary,
  goldenChanges: shadow.results
    .filter((item) => item.trace.publicationId)
    .map((item) => ({
      vehicleId: item.vehicle.id,
      identity: item.trace.identityMatchStatus,
      fields: item.trace.fields.map((entry) => ({
        field: entry.field,
        legacy: entry.legacyValue,
        canonical: entry.canonicalValue,
        selected: entry.selectedValue,
        authority: entry.authority,
        status: entry.status,
        reason: entry.reason,
      })),
    })),
  rankingComparison,
}, null, 2));

function profile(updates: Partial<BuyerProfile> = {}): BuyerProfile {
  return {
    maxPurchaseBudget: 50000,
    monthlyBudget: 1200,
    downPayment: 5000,
    loanTermMonths: 60,
    apr: 7,
    paymentMethod: "not-sure",
    purchaseCondition: "any",
    expectedAnnualMileage: 12000,
    fuelPrice: 3.5,
    insuranceBudget: 300,
    minYear: 0,
    maxMileage: 0,
    minMpg: 0,
    fuelEconomyImportance: 3,
    reliabilityImportance: 3,
    performanceImportance: 3,
    cargoNeed: "not-sure",
    familySize: 1,
    drivetrainPreference: "any",
    transmissionPreference: "any",
    bodyStyle: "any",
    climate: "not-sure",
    resaleValueImportance: 3,
    modificationPlans: "not-sure",
    advancedFeaturesImportance: 3,
    safetyPriority: "not-sure",
    scoreWeights: { affordability: 30, reliability: 20, safety: 15, fuelEnergyCost: 10, insuranceCost: 10, maintenanceRisk: 5, practicality: 5, resaleValue: 5, drivingPreferenceFit: 0 },
    ...updates,
  };
}

function vehicle(id: string) {
  const match = catalog.find((item) => item.id === id);
  assert.ok(match, `Missing catalog vehicle ${id}.`);
  return match;
}

function publication(id: string) {
  const match = publications.find((item) => item.vehicleId === id);
  assert.ok(match, `Missing publication ${id}.`);
  return match;
}

function field(result: ReturnType<typeof resolveVehicleFieldAuthority>, name: string) {
  const match = result.trace.fields.find((item) => item.field === name);
  assert.ok(match, `Missing field resolution ${name}.`);
  return match;
}

function readJson<Value>(path: string): Value {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Value;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

function weights(primary: keyof BuyerProfile["scoreWeights"]): BuyerProfile["scoreWeights"] {
  return {
    affordability: 5, reliability: 5, safety: 5, fuelEnergyCost: 5, insuranceCost: 5,
    maintenanceRisk: 5, practicality: 5, resaleValue: 5, drivingPreferenceFit: 5,
    [primary]: 60,
  };
}

function summarizeRanking(result: ReturnType<typeof runCandidatePipeline>) {
  const top = result.rankedVehicles.slice(0, 10);
  return {
    ids: top.map((item) => item.id),
    scores: top.map((item) => ({ id: item.id, score: item.score })),
  };
}

function allRecommendations(result: ReturnType<typeof runCandidatePipeline>) {
  return [
    ...result.decisionSet.primaryRecommendations,
    ...result.decisionSet.compromiseRecommendations,
    ...result.decisionSet.excludedRecommendations,
  ];
}
