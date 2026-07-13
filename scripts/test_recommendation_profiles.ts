import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultScoreWeights, getRequirementMatches, getVehicleRequirementMisses, rankVehicles } from "../lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "../types/buyer";
import type { ScoredVehicle, Vehicle } from "../types/vehicle";

const vehicleCatalog = JSON.parse(
  readFileSync(join(process.cwd(), "data/processed/vehicleCatalog.json"), "utf8"),
) as Vehicle[];

const baseProfile: BuyerProfile = {
  maxPurchaseBudget: 18000,
  monthlyBudget: 650,
  downPayment: 2000,
  loanTermMonths: 60,
  apr: 8.5,
  paymentMethod: "not-sure",
  purchaseCondition: "any",
  expectedAnnualMileage: 9000,
  fuelPrice: 4.25,
  insuranceBudget: 145,
  minYear: 2014,
  maxMileage: 140000,
  minMpg: 20,
  fuelEconomyImportance: 3,
  reliabilityImportance: 4,
  performanceImportance: 2,
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
  scoreWeights: defaultScoreWeights,
};

type ProfileCase = {
  profile: BuyerProfile;
  minMatches?: number;
  allowNoMatch?: boolean;
  assert?: (ranked: ScoredVehicle[], matches: Vehicle[]) => void;
};

const profiles: Record<string, ProfileCase> = {
  lowBudgetCashBuyer: {
    profile: {
      ...baseProfile,
      paymentMethod: "cash",
      maxPurchaseBudget: 10500,
      monthlyBudget: 360,
      downPayment: 0,
      insuranceBudget: 125,
      minMpg: 28,
      fuelEconomyImportance: 4,
      reliabilityImportance: 5,
      scoreWeights: weights({ affordability: 38, reliability: 22, fuelEnergyCost: 15, insuranceCost: 15, safety: 5, practicality: 5 }),
    },
    assert: (ranked) => {
      assert.ok(ranked.every((vehicle) => vehicle.price <= 10500), "cash buyer results must honor purchase budget");
      assert.ok(ranked[0].matchSummary.affordability >= 65, "cash buyer top result should be affordability-led");
    },
  },
  collegeCommuter: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 14500,
      monthlyBudget: 520,
      downPayment: 1200,
      insuranceBudget: 135,
      expectedAnnualMileage: 11000,
      minMpg: 32,
      fuelEconomyImportance: 5,
      reliabilityImportance: 5,
      scoreWeights: weights({ affordability: 30, reliability: 24, fuelEnergyCost: 22, insuranceCost: 14, safety: 5, practicality: 5 }),
    },
    assert: (ranked) => {
      assert.ok(ranked[0].mpg >= 30, "college commuter should favor efficient cars");
    },
  },
  parentPrioritizingSafety: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 26000,
      monthlyBudget: 800,
      downPayment: 4000,
      insuranceBudget: 190,
      minYear: 2017,
      maxMileage: 100000,
      safetyPriority: "maximum",
      reliabilityImportance: 5,
      scoreWeights: weights({ safety: 35, reliability: 22, affordability: 14, maintenanceRisk: 12, practicality: 10, resaleValue: 7 }),
    },
    assert: (ranked) => {
      assert.ok(ranked[0].matchSummary.safety >= 65, "parent safety top result should have strong safety score");
    },
  },
  snowClimateDriver: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 28000,
      monthlyBudget: 820,
      downPayment: 3500,
      insuranceBudget: 185,
      minYear: 2016,
      drivetrainPreference: "AWD",
      climate: "snow",
      scoreWeights: weights({ practicality: 28, safety: 18, reliability: 17, affordability: 15, maintenanceRisk: 12, fuelEnergyCost: 5, resaleValue: 5 }),
    },
    assert: (ranked) => {
      assert.ok(ranked.every((vehicle) => vehicle.drivetrain === "AWD" || vehicle.drivetrain === "4WD"), "snow results must honor AWD/4WD hard constraint");
    },
  },
  highMileageCommuter: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 32000,
      monthlyBudget: 780,
      downPayment: 2500,
      expectedAnnualMileage: 18000,
      insuranceBudget: 170,
      minMpg: 38,
      fuelEconomyImportance: 5,
      scoreWeights: weights({ fuelEnergyCost: 34, affordability: 22, reliability: 18, insuranceCost: 12, maintenanceRisk: 9, safety: 5 }),
    },
    assert: (ranked) => {
      assert.ok(ranked[0].matchSummary.fuelEnergyCost >= ranked[0].matchSummary.drivingPreferenceFit, "high-mileage result should be fuel-led");
    },
  },
  performanceFocusedBuyer: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 26000,
      monthlyBudget: 760,
      downPayment: 2500,
      insuranceBudget: 230,
      minMpg: 16,
      transmissionPreference: "manual",
      performanceImportance: 5,
      modificationPlans: "yes",
      scoreWeights: weights({ drivingPreferenceFit: 50, affordability: 12, practicality: 10, reliability: 8, safety: 6, maintenanceRisk: 6, resaleValue: 5, insuranceCost: 3 }),
    },
    minMatches: 3,
    assert: (ranked) => {
      assert.ok(ranked.every((vehicle) => vehicle.transmission === "manual"), "performance buyer results must honor manual hard constraint");
      assert.ok(ranked[0].matchSummary.drivingPreferenceFit >= 55, "performance buyer top result should have meaningful driving fit");
    },
  },
  suvOnlyFamily: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 30000,
      monthlyBudget: 860,
      downPayment: 4500,
      insuranceBudget: 190,
      bodyStyle: "suv",
      familySize: 4,
      cargoNeed: "high",
      safetyPriority: "high",
      scoreWeights: weights({ practicality: 34, safety: 20, reliability: 16, affordability: 12, maintenanceRisk: 10, resaleValue: 8 }),
    },
    assert: (ranked) => {
      assert.ok(ranked.every((vehicle) => vehicle.bodyType === "suv"), "SUV family results must honor SUV hard constraint");
    },
  },
  hybridFocusedBuyer: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 24000,
      monthlyBudget: 720,
      downPayment: 2500,
      insuranceBudget: 170,
      minMpg: 45,
      fuelEconomyImportance: 5,
      scoreWeights: weights({ fuelEnergyCost: 38, affordability: 18, reliability: 16, maintenanceRisk: 12, insuranceCost: 8, safety: 8 }),
    },
    assert: (ranked) => {
      assert.ok(ranked[0].mpg >= 45, "hybrid-focused buyer should get high MPG or MPGe first");
    },
  },
  riskyLuxuryPreference: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 42000,
      monthlyBudget: 1100,
      downPayment: 6000,
      insuranceBudget: 260,
      minMpg: 16,
      performanceImportance: 5,
      advancedFeaturesImportance: 5,
      reliabilityImportance: 1,
      safetyPriority: "standard",
      scoreWeights: weights({ drivingPreferenceFit: 32, affordability: 16, safety: 12, reliability: 8, maintenanceRisk: 8, practicality: 14, resaleValue: 10 }),
    },
    assert: (ranked) => {
      assert.ok(ranked.some((vehicle) => vehicle.penalties.length || vehicle.misses.length), "risky preference should still expose penalties or misses");
    },
  },
  strictInsuranceLimits: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 18000,
      monthlyBudget: 560,
      downPayment: 2000,
      insuranceBudget: 115,
      minMpg: 28,
      scoreWeights: weights({ insuranceCost: 38, affordability: 24, maintenanceRisk: 14, fuelEnergyCost: 12, reliability: 8, safety: 4 }),
    },
    assert: (ranked) => {
      assert.ok(ranked[0].insurance <= 135, "strict insurance profile should favor low insurance estimates");
      assert.ok(ranked[0].matchSummary.insuranceCost >= 55, "strict insurance top result should score well on insurance");
    },
  },
  incompleteAnswers: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 0,
      monthlyBudget: 650,
      insuranceBudget: 145,
      minYear: 0,
      maxMileage: 0,
      minMpg: 0,
      fuelEconomyImportance: 2,
      reliabilityImportance: 3,
      performanceImportance: 2,
      resaleValueImportance: 2,
      advancedFeaturesImportance: 2,
      safetyPriority: "not-sure",
      scoreWeights: defaultScoreWeights,
    },
    minMatches: 10,
    assert: (ranked) => {
      assert.ok(ranked.length >= 10, "incomplete answers should still produce a broad ranked list");
    },
  },
  contradictoryPreferences: {
    profile: {
      ...baseProfile,
      maxPurchaseBudget: 8000,
      monthlyBudget: 260,
      downPayment: 500,
      insuranceBudget: 100,
      bodyStyle: "suv",
      drivetrainPreference: "AWD",
      climate: "snow",
      purchaseCondition: "new",
      familySize: 5,
      cargoNeed: "high",
      safetyPriority: "maximum",
      transmissionPreference: "manual",
      scoreWeights: weights({ affordability: 28, practicality: 24, safety: 20, reliability: 14, drivingPreferenceFit: 14 }),
    },
    allowNoMatch: true,
    assert: (ranked, matches) => {
      assert.equal(ranked.length, 0, "contradictory profile should produce no silent high-scoring match");
      assert.equal(matches.length, 0, "contradictory profile should have no strict hard-constraint matches");
    },
  },
};

const rankedByProfile: Record<string, ScoredVehicle[]> = {};
const distributions: Array<{ name: string; count: number; top?: number; min?: number; max?: number; average?: number; spread?: number }> = [];

Object.entries(profiles).forEach(([name, testCase]) => {
  const matches = getRequirementMatches(testCase.profile, vehicleCatalog);
  const ranked = rankVehicles(testCase.profile, matches).slice(0, 10);
  rankedByProfile[name] = ranked;

  if (testCase.allowNoMatch) {
    assert.equal(ranked.length, 0, `${name} should have no ranked matches`);
    assert.ok(getNoMatchReasons(testCase.profile).length > 0, `${name} should expose hard-constraint blockers`);
    testCase.assert?.(ranked, matches);
    distributions.push({ name, count: 0 });
    return;
  }

  assert.ok(ranked.length >= (testCase.minMatches ?? 5), `${name} should have enough ranked matches`);
  assert.ok(ranked.every((vehicle) => vehicle.hardConstraintStatus.passed), `${name} must not include hard-constraint violations`);
  assert.ok(ranked.every(hasStructuredScore), `${name} should expose the full structured score contract`);
  assert.ok(getScoreSpread(ranked) >= getMinimumScoreSpread(name), `${name} top results should have meaningful score spread`);
  testCase.assert?.(ranked, matches);
  distributions.push(getDistribution(name, ranked));
});

const rankedProfiles = Object.fromEntries(Object.entries(rankedByProfile).filter(([, ranked]) => ranked.length));
const topVehicleNames = Object.values(rankedProfiles).map((ranked) => getVehicleName(ranked[0]));
const topFiveSignatures = Object.values(rankedProfiles).map((ranked) => ranked.slice(0, 5).map((vehicle) => vehicle.id).join("|"));
assert.ok(new Set(topVehicleNames).size >= 5, "different profiles should not collapse to one top vehicle");
assert.ok(new Set(topFiveSignatures).size >= 9, "different profiles should produce meaningfully different top-five rankings");

const spreads = Object.entries(rankedProfiles).map(([name, ranked]) => getScoreSpread(ranked));
const averageSpread = average(spreads);
const topScores = Object.values(rankedProfiles).map((ranked) => ranked[0].score);
assert.ok(averageSpread >= 8, `average top-ten score spread should be at least 8, got ${averageSpread}`);
assert.ok(
  Math.max(...topScores) - Math.min(...topScores) >= 15,
  "top scores should vary across very different user profiles",
);
assert.ok(
  Object.values(rankedProfiles).filter((ranked) => ranked[0].score >= 90).length <= 2,
  "top recommendations should not cluster near the 90s",
);

assert.ok(
  getOverlap(rankedByProfile.lowBudgetCashBuyer, rankedByProfile.suvOnlyFamily) <= 1,
  "low-budget cash and SUV family top-five results should barely overlap",
);
assert.ok(
  getOverlap(rankedByProfile.performanceFocusedBuyer, rankedByProfile.hybridFocusedBuyer) <= 1,
  "performance and hybrid top-five results should barely overlap",
);

console.log("Recommendation profile differentiation passed.");
console.log("Score distributions:");
distributions.forEach((distribution) => {
  if (!distribution.count) {
    console.log(`${distribution.name}: no match`);
    return;
  }

  console.log(
    `${distribution.name}: count ${distribution.count}, top ${distribution.top}, min ${distribution.min}, max ${distribution.max}, avg ${distribution.average}, spread ${distribution.spread}; top ${getVehicleName(rankedByProfile[distribution.name][0])}`,
  );
});

function weights(overrides: Partial<ScoreWeights>): ScoreWeights {
  return { ...defaultScoreWeights, ...overrides };
}

function hasStructuredScore(vehicle: ScoredVehicle) {
  const categoryScores = Object.values(vehicle.scoreBreakdown);
  const weightTotal = Object.values(vehicle.categoryWeights).reduce((sum, value) => sum + value, 0);

  return (
    Number.isFinite(vehicle.score) &&
    vehicle.score >= 0 &&
    vehicle.score <= 100 &&
    categoryScores.every((score) => Number.isFinite(score) && score >= 0 && score <= 100) &&
    Math.abs(weightTotal - 100) < 0.001 &&
    vehicle.positiveContributions.length > 0 &&
    Array.isArray(vehicle.penalties) &&
    vehicle.hardConstraintStatus.passed &&
    Number.isFinite(vehicle.confidence.score) &&
    vehicle.confidence.score >= 0 &&
    vehicle.confidence.score <= 100 &&
    ["high", "medium", "low"].includes(vehicle.confidence.level) &&
    Array.isArray(vehicle.assumptions) &&
    Array.isArray(vehicle.missingDataWarnings)
  );
}

function getScoreSpread(ranked: ScoredVehicle[]) {
  if (!ranked.length) return 0;
  return ranked[0].score - ranked[Math.min(ranked.length, 10) - 1].score;
}

function getMinimumScoreSpread(profileName: string) {
  if (profileName === "performanceFocusedBuyer") return 6;
  if (profileName === "hybridFocusedBuyer") return 6;
  if (profileName === "riskyLuxuryPreference") return 6;
  if (profileName === "incompleteAnswers") return 3;
  return 8;
}

function getOverlap(first: ScoredVehicle[], second: ScoredVehicle[]) {
  const firstIds = new Set(first.slice(0, 5).map((vehicle) => vehicle.id));
  return second.slice(0, 5).filter((vehicle) => firstIds.has(vehicle.id)).length;
}

function getDistribution(name: string, ranked: ScoredVehicle[]) {
  const scores = ranked.map((vehicle) => vehicle.score);
  return {
    name,
    count: ranked.length,
    top: scores[0],
    min: Math.min(...scores),
    max: Math.max(...scores),
    average: Math.round(average(scores)),
    spread: getScoreSpread(ranked),
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function getVehicleName(vehicle: Vehicle) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}

function getNoMatchReasons(profile: BuyerProfile) {
  const reasons = new Set<string>();
  vehicleCatalog.forEach((vehicle) => {
    getVehicleRequirementMisses(vehicle, profile).forEach((reason) => reasons.add(reason));
  });
  return [...reasons];
}
