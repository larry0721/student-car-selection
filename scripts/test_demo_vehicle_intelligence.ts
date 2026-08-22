import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVehicleIntelligenceViewModel,
  getDemoVehicleIntelligence,
  getDemoVehicleIntelligenceSnapshotMetadata,
  listDemoVehicleIntelligence,
} from "../lib/demoVehicleIntelligence";
import {
  buildProfilePatch,
  mapValidatedUnderstandingToProfile,
  mergeCanonicalConcepts,
} from "../lib/semanticMapping";
import { defaultScoreWeights, runCandidatePipeline } from "../lib/recommendations";
import {
  DeterministicSemanticUnderstandingProvider,
  understandAndValidate,
} from "../lib/semanticUnderstanding";
import type { BuyerProfile } from "../types/buyer";
import type { Vehicle } from "../types/vehicle";

const goldenVehicleIds = [
  "hyundai-accent-2017-craigslist-carstrucks-data",
  "toyota-prius-2016-usedcarscatalog",
  "toyota-rav4-2016-craigslist-carstrucks-data",
  "honda-cr-v-2016-craigslist-carstrucks-data",
  "nissan-leaf-2018-craigslist-carstrucks-data",
] as const;

const leafId = "nissan-leaf-2018-craigslist-carstrucks-data";
const accentId = "hyundai-accent-2017-craigslist-carstrucks-data";
const catalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];
const componentSource = readFileSync(
  join(process.cwd(), "components/VehicleIntelligencePanel.tsx"),
  "utf8",
);
const snapshotSource = readFileSync(
  join(process.cwd(), "data/demo/goldenVehicleIntelligence.v1.json"),
  "utf8",
);

let scenarioCount = 0;
const pendingScenarios: Promise<void>[] = [];

function scenario(name: string, assertion: () => void) {
  assertion();
  scenarioCount += 1;
  console.log(`PASS ${scenarioCount}: ${name}`);
}

function asyncScenario(name: string, assertion: () => Promise<void>) {
  pendingScenarios.push(assertion().then(() => {
    scenarioCount += 1;
    console.log(`PASS ${scenarioCount}: ${name}`);
  }));
}

const profile = demoProfile();

scenario("the deployable snapshot contains exactly the five approved golden vehicles", () => {
  assert.equal(listDemoVehicleIntelligence().length, 5);
  assert.deepEqual(
    listDemoVehicleIntelligence().map((vehicle) => vehicle.vehicleId).sort(),
    [...goldenVehicleIds].sort(),
  );
  assert.equal(getDemoVehicleIntelligenceSnapshotMetadata().recommendationRuntimeConnected, false);
});

scenario("a golden vehicle loads source-backed intelligence", () => {
  const record = getDemoVehicleIntelligence(accentId);
  assert.ok(record);
  assert.equal(record.displayName, "2017 Hyundai Accent");
  assert.ok(record.trustedFacts.length > 0);
});

scenario("a non-golden vehicle returns the documented unavailable state", () => {
  const nonGolden = catalog.find((vehicle) => !goldenVehicleIds.includes(vehicle.id as typeof goldenVehicleIds[number]));
  assert.ok(nonGolden);
  const view = buildVehicleIntelligenceViewModel({ vehicleId: nonGolden.id, profile });
  assert.equal(view.available, false);
  if (!view.available) {
    assert.equal(view.message, "Detailed trusted vehicle intelligence has not been added for this vehicle yet.");
  }
});

scenario("rated NHTSA evidence is rendered as component ratings", () => {
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: accentId, profile }));
  assert.equal(view.safety.state, "rated");
  assert.ok(view.safety.ratingRows.some((row) => row.label === "Overall" && row.value === "4 / 5"));
});

scenario("the Leaf preserves the official NOT_RATED state", () => {
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: leafId, profile }));
  assert.equal(view.safety.state, "not_rated");
  assert.equal(view.safety.ratingRows.length, 0);
  assert.match(view.safety.statusText, /no numeric NCAP crash-test rating is available/i);
});

scenario("NOT_RATED never becomes a numeric safety score", () => {
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: leafId, profile }));
  const renderedSafety = JSON.stringify(view.safety);
  assert.doesNotMatch(renderedSafety, /0\s*\/\s*5|50\s*\/\s*100/);
});

scenario("reliability evidence remains a qualitative concern assessment", () => {
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: accentId, profile }));
  assert.equal(view.reliability.concernLabel, "Meaningful Concern");
  assert.match(view.reliability.framing, /pattern worth knowing about/i);
  assert.doesNotMatch(JSON.stringify(view.reliability), /\/100|reliability score/i);
});

scenario("no reliabilityScore field exists in the deployable snapshot or standard UI", () => {
  assert.doesNotMatch(snapshotSource, /reliabilityScore/i);
  assert.doesNotMatch(componentSource, /reliabilityScore/i);
});

scenario("the missing-exposure limitation remains visible", () => {
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: accentId, profile }));
  assert.match(view.reliability.limitation, /population and mileage exposure are unavailable/i);
  assert.match(view.reliability.limitation, /comparative failure rate/i);
});

scenario("irrelevant missing fields do not create a giant limitation list", () => {
  const lowPriority = demoProfile({
    reliabilityImportance: 1,
    performanceImportance: 1,
    fuelEconomyImportance: 1,
    minMpg: 0,
    safetyPriority: "standard",
  });
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: accentId, profile: lowPriority }));
  assert.equal(view.limitations.length, 1);
  assert.match(view.limitations[0], /condition, service history, and inspection/i);
});

scenario("a material missing performance field is surfaced for a performance-focused buyer", () => {
  const performanceProfile = demoProfile({ performanceImportance: 5 });
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: accentId, profile: performanceProfile }));
  assert.ok(view.limitations.some((item) => /acceleration and handling evidence/i.test(item)));
});

scenario("trusted facts never expose missing or stale values", () => {
  for (const record of listDemoVehicleIntelligence()) {
    for (const fact of record.trustedFacts) {
      assert.ok(fact.value !== null && fact.value !== undefined && fact.value !== "");
      assert.ok(["high", "medium", "low"].includes(fact.confidence));
      assert.ok(fact.sources.length > 0);
    }
  }
});

scenario("EPA and NHTSA source identifiers and attribution are retained", () => {
  const view = requireAvailable(buildVehicleIntelligenceViewModel({ vehicleId: accentId, profile }));
  assert.ok(view.sources.some((source) => source.providerName.includes("EPA") && source.sourceRecordId === "37479"));
  assert.ok(view.sources.some((source) => source.providerName.includes("NHTSA") && source.sourceRecordId === "11111"));
  assert.ok(view.sources.every((source) => source.sourceUrl.startsWith("https://")));
});

asyncScenario("a correction replaces the stale SUV exclusion with the latest allowed state", async () => {
  const provider = new DeterministicSemanticUnderstandingProvider();
  const [first, revision] = await Promise.all([
    understandAndValidate(provider, {
      currentMessage: "No SUVs.",
      conversationHistory: [{ id: "turn-1", role: "user", text: "No SUVs." }],
    }),
    understandAndValidate(provider, {
      currentMessage: "Actually SUVs are okay, I just don't want anything huge.",
      conversationHistory: [{ id: "turn-2", role: "user", text: "Actually SUVs are okay, I just don't want anything huge." }],
    }),
  ]);
  const firstMapping = mapValidatedUnderstandingToProfile(first);
  const revisionMapping = mapValidatedUnderstandingToProfile(revision);
  const patch = buildProfilePatch(mergeCanonicalConcepts(firstMapping.concepts, revisionMapping.concepts));
  assert.deepEqual(patch.allowedBodyStyles, ["suv"]);
  assert.equal(patch.excludedBodyStyles, undefined);
});

scenario("the evidence adapter cannot change recommendation order", () => {
  const before = runCandidatePipeline(profile, catalog, { includeCompromises: true, includeExcluded: true });
  const beforeTop = before.decisionSet.primaryRecommendations.slice(0, 5).map((item) => item.vehicleId);
  for (const vehicleId of beforeTop) buildVehicleIntelligenceViewModel({ vehicleId, profile });
  const after = runCandidatePipeline(profile, catalog, { includeCompromises: true, includeExcluded: true });
  assert.deepEqual(after.decisionSet.primaryRecommendations.slice(0, 5).map((item) => item.vehicleId), beforeTop);
  assert.equal(after.pipelineDebug.qualifiedCount, before.pipelineDebug.qualifiedCount);
  assert.equal(after.pipelineDebug.excludedCount, before.pipelineDebug.excludedCount);
});

scenario("the standard UI contains no internal vehicle-intelligence terminology", () => {
  assert.doesNotMatch(
    componentSource,
    /CanonicalVehicleRecord|VehicleKnowledgeClaim|source contribution|\bcompiler\b|\brepository\b|\bontology\b|trust state enum/i,
  );
});

scenario("the standard UI exposes no raw API JSON", () => {
  assert.doesNotMatch(componentSource, /JSON\.stringify|<pre|rawFields|rawPayload/i);
});

scenario("the panel uses responsive constraints and no fixed content width", () => {
  assert.match(componentSource, /min-w-0/);
  assert.match(componentSource, /sm:grid-cols-2/);
  assert.doesNotMatch(componentSource, /w-\[(?:[5-9]\d\d|\d{4,})px\]/);
});

void finish().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function requireAvailable(view: ReturnType<typeof buildVehicleIntelligenceViewModel>) {
  assert.equal(view.available, true);
  if (!view.available) throw new Error("Expected demo intelligence to be available");
  return view;
}

function demoProfile(overrides: Partial<BuyerProfile> = {}): BuyerProfile {
  return {
    maxPurchaseBudget: 22000,
    monthlyBudget: 750,
    downPayment: 3000,
    loanTermMonths: 60,
    apr: 7.5,
    paymentMethod: "not-sure",
    purchaseCondition: "used",
    expectedAnnualMileage: 10000,
    fuelPrice: 4.25,
    insuranceBudget: 170,
    minYear: 2014,
    maxMileage: 120000,
    minMpg: 24,
    fuelEconomyImportance: 3,
    reliabilityImportance: 4,
    performanceImportance: 2,
    cargoNeed: "not-sure",
    familySize: 1,
    drivetrainPreference: "any",
    transmissionPreference: "any",
    bodyStyle: "any",
    climate: "mild",
    resaleValueImportance: 3,
    modificationPlans: "no",
    advancedFeaturesImportance: 3,
    safetyPriority: "high",
    scoreWeights: { ...defaultScoreWeights },
    ...overrides,
  };
}

async function settleAsyncScenarios() {
  await Promise.all(pendingScenarios);
}

async function finish() {
  await settleAsyncScenarios();
  assert.ok(scenarioCount >= 15);
  console.log(`Demo vehicle intelligence passed ${scenarioCount} permanent scenarios.`);
}
