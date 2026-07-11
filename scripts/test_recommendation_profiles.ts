import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultScoreWeights, getRequirementMatches, rankVehicles } from "../lib/recommendations";
import type { BuyerProfile } from "../types/buyer";
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

const profiles: Record<string, BuyerProfile> = {
  budgetCommuter: {
    ...baseProfile,
    maxPurchaseBudget: 12000,
    monthlyBudget: 480,
    downPayment: 1000,
    insuranceBudget: 145,
    minMpg: 32,
    fuelEconomyImportance: 5,
    reliabilityImportance: 5,
    scoreWeights: {
      budgetFit: 40,
      reliability: 25,
      safety: 5,
      fuelEconomy: 15,
      insuranceCost: 15,
      performance: 0,
      practicality: 0,
      resaleValue: 0,
    },
  },
  snowFamily: {
    ...baseProfile,
    maxPurchaseBudget: 32000,
    monthlyBudget: 850,
    downPayment: 4000,
    insuranceBudget: 190,
    minYear: 2017,
    minMpg: 20,
    familySize: 4,
    cargoNeed: "high",
    bodyStyle: "suv",
    drivetrainPreference: "AWD",
    climate: "snow",
    safetyPriority: "maximum",
    scoreWeights: {
      budgetFit: 15,
      reliability: 15,
      safety: 25,
      fuelEconomy: 5,
      insuranceCost: 5,
      performance: 0,
      practicality: 30,
      resaleValue: 5,
    },
  },
  manualFun: {
    ...baseProfile,
    maxPurchaseBudget: 26000,
    monthlyBudget: 760,
    downPayment: 2500,
    insuranceBudget: 220,
    minMpg: 18,
    bodyStyle: "any",
    transmissionPreference: "manual",
    performanceImportance: 5,
    modificationPlans: "yes",
    safetyPriority: "standard",
    scoreWeights: {
      budgetFit: 15,
      reliability: 10,
      safety: 10,
      fuelEconomy: 0,
      insuranceCost: 5,
      performance: 35,
      practicality: 20,
      resaleValue: 5,
    },
  },
  highMileageEfficiency: {
    ...baseProfile,
    maxPurchaseBudget: 50000,
    monthlyBudget: 950,
    downPayment: 5000,
    insuranceBudget: 220,
    expectedAnnualMileage: 16000,
    minYear: 2015,
    minMpg: 75,
    fuelEconomyImportance: 5,
    reliabilityImportance: 3,
    scoreWeights: {
      budgetFit: 15,
      reliability: 10,
      safety: 10,
      fuelEconomy: 40,
      insuranceCost: 15,
      performance: 0,
      practicality: 5,
      resaleValue: 5,
    },
  },
};

const rankedByProfile = Object.fromEntries(
  Object.entries(profiles).map(([name, profile]) => {
    const matches = getRequirementMatches(profile, vehicleCatalog);
    const ranked = rankVehicles(profile, matches).slice(0, 10);
    assert.ok(ranked.length >= getMinimumMatchCount(name), `${name} should have enough ranked matches`);
    assert.ok(getScoreSpread(ranked) >= getMinimumScoreSpread(name), `${name} top results should have meaningful score spread`);
    assert.ok(ranked.every((vehicle) => hasVisibleScores(vehicle)), `${name} should expose all visible score categories`);
    return [name, ranked];
  }),
) as Record<string, ScoredVehicle[]>;

const topVehicleNames = Object.values(rankedByProfile).map((ranked) => getVehicleName(ranked[0]));
assert.ok(new Set(topVehicleNames).size >= 3, "different profiles should produce at least three distinct top vehicles");

assert.ok(
  getOverlap(rankedByProfile.budgetCommuter, rankedByProfile.snowFamily) <= 1,
  "budget commuter and snow family top-five results should barely overlap",
);
assert.ok(
  getOverlap(rankedByProfile.manualFun, rankedByProfile.highMileageEfficiency) <= 1,
  "manual fun and efficiency top-five results should barely overlap",
);

assert.ok(
  rankedByProfile.budgetCommuter[0].matchSummary.affordability >= 70,
  "budget commuter top result should be affordable",
);
assert.ok(
  rankedByProfile.snowFamily.every((vehicle) => vehicle.bodyType === "suv" && (vehicle.drivetrain === "AWD" || vehicle.drivetrain === "4WD")),
  "snow family results should honor SUV and AWD/4WD requirements",
);
assert.ok(
  rankedByProfile.manualFun.every((vehicle) => vehicle.transmission === "manual"),
  "manual fun results should honor manual transmission",
);
assert.ok(
  rankedByProfile.highMileageEfficiency[0].mpg >= 75,
  "high-mileage efficiency top result should strongly favor MPG/MPGe",
);

console.log("Recommendation profile differentiation passed.");
Object.entries(rankedByProfile).forEach(([name, ranked]) => {
  const top = ranked[0];
  console.log(
    `${name}: ${top.score}/100 ${getVehicleName(top)}; spread ${getScoreSpread(ranked)}; top5 ${ranked
      .slice(0, 5)
      .map(getVehicleName)
      .join(" | ")}`,
  );
});

function hasVisibleScores(vehicle: ScoredVehicle) {
  return [
    vehicle.matchSummary.overall,
    vehicle.matchSummary.affordability,
    vehicle.matchSummary.reliability,
    vehicle.matchSummary.safety,
    vehicle.matchSummary.ownershipCost,
    vehicle.matchSummary.practicality,
  ].every((score) => Number.isFinite(score) && score >= 0 && score <= 100);
}

function getScoreSpread(ranked: ScoredVehicle[]) {
  return ranked[0].score - ranked[Math.min(ranked.length, 10) - 1].score;
}

function getMinimumMatchCount(profileName: string) {
  return profileName === "manualFun" ? 3 : 5;
}

function getMinimumScoreSpread(profileName: string) {
  return profileName === "highMileageEfficiency" ? 5 : 8;
}

function getOverlap(first: ScoredVehicle[], second: ScoredVehicle[]) {
  const firstIds = new Set(first.slice(0, 5).map((vehicle) => vehicle.id));
  return second.slice(0, 5).filter((vehicle) => firstIds.has(vehicle.id)).length;
}

function getVehicleName(vehicle: Vehicle) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
}
