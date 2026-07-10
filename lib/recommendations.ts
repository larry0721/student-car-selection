import { calculateBudget } from "@/lib/affordability";
import { getVehicleDataQualityMisses, isRecommendableVehicle } from "@/lib/data/vehicleValidation";
import type { BuyerProfile, ScoreWeights } from "@/types/buyer";
import type { ScoredVehicle, Vehicle } from "@/types/vehicle";

const spaciousTypes = new Set(["hatchback", "wagon", "suv", "minivan", "truck"]);
const snowDrivetrains = new Set(["AWD", "4WD"]);
const beginnerFriendlyTypes = new Set(["sedan", "hatchback", "suv", "wagon", "minivan"]);

export const defaultScoreWeights: ScoreWeights = {
  budgetFit: 30,
  reliability: 20,
  safety: 15,
  fuelEconomy: 10,
  insuranceCost: 10,
  performance: 5,
  practicality: 5,
  resaleValue: 5,
};

export const scoreWeightLabels: Record<keyof ScoreWeights, string> = {
  budgetFit: "Budget fit",
  reliability: "Reliability",
  safety: "Safety",
  fuelEconomy: "Fuel economy",
  insuranceCost: "Insurance cost",
  performance: "Performance",
  practicality: "Practicality",
  resaleValue: "Resale value",
};

export function rankVehicles(profile: BuyerProfile, vehicles: Vehicle[]): ScoredVehicle[] {
  const budget = calculateBudget(profile);
  const maxPrice = getEffectiveMaxPrice(profile, budget.maxPurchasePrice);
  const scoredVehicles = vehicles
    .filter(isRecommendableVehicle)
    .map((vehicle) => scoreVehicle(vehicle, profile, maxPrice))
    .sort((a, b) => b.score - a.score || a.price - b.price);

  return scoredVehicles.map((vehicle) => ({
    ...vehicle,
    similarAlternatives: getSimilarAlternatives(vehicle, scoredVehicles),
  }));
}

export function getRequirementMatches(profile: BuyerProfile, vehicles: Vehicle[]) {
  return vehicles.filter((vehicle) => isRecommendableVehicle(vehicle) && !getVehicleRequirementMisses(vehicle, profile).length);
}

export function getVehicleRequirementMisses(vehicle: Vehicle, profile: BuyerProfile) {
  const dataQualityMisses = getVehicleDataQualityMisses(vehicle);
  if (dataQualityMisses.length) return dataQualityMisses;

  const budget = calculateBudget(profile);
  const maxPrice = getEffectiveMaxPrice(profile, budget.maxPurchasePrice);
  const misses: string[] = [];

  if (vehicle.price > maxPrice) misses.push(`price is above ${Math.round(maxPrice).toLocaleString("en-US")}`);
  if (profile.insuranceBudget && vehicle.insurance > profile.insuranceBudget) {
    misses.push(`insurance is above ${profile.insuranceBudget.toLocaleString("en-US")}/mo`);
  }
  if (profile.maxMileage && vehicle.mileage > profile.maxMileage) {
    misses.push(`mileage is above ${profile.maxMileage.toLocaleString("en-US")}`);
  }
  if (profile.minYear && vehicle.year < profile.minYear) misses.push(`year is older than ${profile.minYear}`);
  if (profile.minMpg && vehicle.mpg < profile.minMpg) misses.push(`fuel economy is below ${profile.minMpg} MPG`);

  if (profile.purchaseCondition === "new" && vehicle.year < new Date().getFullYear() - 1) {
    misses.push("not new enough");
  }
  if (profile.purchaseCondition === "used" && vehicle.year >= new Date().getFullYear()) {
    misses.push("not a used-car match");
  }
  if (profile.bodyStyle !== "any" && vehicle.bodyType !== profile.bodyStyle) {
    misses.push(`not a ${profile.bodyStyle}`);
  }
  if (profile.drivetrainPreference !== "any" && !drivetrainMeetsRequirement(vehicle.drivetrain, profile.drivetrainPreference)) {
    misses.push(`does not match ${profile.drivetrainPreference}`);
  }
  if (profile.transmissionPreference !== "any" && !transmissionMeetsRequirement(vehicle.transmission, profile.transmissionPreference)) {
    misses.push(`does not match ${profile.transmissionPreference} transmission`);
  }
  if (profile.familySize && vehicle.seats < profile.familySize) {
    misses.push(`does not seat ${profile.familySize}`);
  }
  if (profile.cargoNeed === "medium" && vehicle.cargoScore < 58) misses.push("cargo space is below medium need");
  if (profile.cargoNeed === "high" && vehicle.cargoScore < 78) misses.push("cargo space is below high need");
  if (profile.climate === "snow" && !snowDrivetrains.has(vehicle.drivetrain)) {
    misses.push("not AWD/4WD for snow");
  }
  if (profile.climate === "rain" && vehicle.safetyScore < 78) {
    misses.push("safety score is low for rainy conditions");
  }
  if (profile.safetyPriority === "high" && vehicle.safetyScore < 84) misses.push("safety is below high priority");
  if (profile.safetyPriority === "maximum" && vehicle.safetyScore < 90) misses.push("safety is below maximum priority");
  if (profile.reliabilityImportance >= 5 && vehicle.reliabilityScore < 84) {
    misses.push("reliability is below selected importance");
  }
  if (profile.performanceImportance >= 5 && vehicle.performanceScore < 68) {
    misses.push("performance is below selected importance");
  }
  if (profile.resaleValueImportance >= 5 && vehicle.resaleScore < 80) {
    misses.push("resale value is below selected importance");
  }
  if (profile.advancedFeaturesImportance >= 5 && vehicle.featureScore < 72) {
    misses.push("advanced features are below selected importance");
  }

  return misses;
}

function drivetrainMeetsRequirement(drivetrain: string, requirement: BuyerProfile["drivetrainPreference"]) {
  if (drivetrain === requirement) return true;
  if (requirement === "AWD" && drivetrain === "4WD") return true;
  if (requirement === "4WD" && drivetrain === "AWD") return true;
  return false;
}

function transmissionMeetsRequirement(transmission: string, requirement: BuyerProfile["transmissionPreference"]) {
  if (requirement === "automatic") return transmission !== "manual";
  return transmission === "manual";
}

function scoreVehicle(vehicle: Vehicle, profile: BuyerProfile, maxPrice: number): Omit<ScoredVehicle, "similarAlternatives"> {
  const reasons: string[] = [];
  const misses: string[] = [];
  const budgetFit = clamp((maxPrice / Math.max(vehicle.price, 1)) * 86);
  const paymentFit = profile.monthlyBudget
    ? clamp((profile.monthlyBudget / Math.max(vehicle.insurance + estimateFuelCost(vehicle, profile) + 175, 1)) * 70)
    : 76;
  const mileageFit = profile.maxMileage ? clamp((profile.maxMileage / Math.max(vehicle.mileage, 1)) * 84) : 78;
  const yearFit = profile.minYear ? (vehicle.year >= profile.minYear ? 100 : Math.max(35, 100 - (profile.minYear - vehicle.year) * 8)) : 78;
  const economyFit = vehicle.mpg >= profile.minMpg ? 100 : clamp((vehicle.mpg / Math.max(profile.minMpg, 1)) * 82);
  const insuranceFit = profile.insuranceBudget ? clamp((profile.insuranceBudget / Math.max(vehicle.insurance, 1)) * 88) : 82;
  const bodyFit = getBodyStyleFit(vehicle, profile);
  const drivetrainFit = getDrivetrainFit(vehicle, profile);
  const transmissionFit = getTransmissionFit(vehicle, profile);
  const cargoFit = getCargoFit(vehicle, profile);
  const familyFit = vehicle.seats >= Math.max(profile.familySize, 1) ? 100 : 45;
  const climateFit = getClimateFit(vehicle, profile);
  const safetyFit = getImportanceFit(vehicle.safetyScore, profile.safetyPriority === "maximum" ? 5 : profile.safetyPriority === "high" ? 4 : 3);
  const reliabilityFit = getImportanceFit(vehicle.reliabilityScore, profile.reliabilityImportance);
  const performanceFit = getImportanceFit(vehicle.performanceScore, profile.performanceImportance);
  const resaleFit = getImportanceFit(vehicle.resaleScore, profile.resaleValueImportance);
  const featureFit = getImportanceFit(vehicle.featureScore, profile.advancedFeaturesImportance);
  const modificationFit = getModificationFit(vehicle, profile);
  const purchaseConditionFit = getPurchaseConditionFit(vehicle, profile);

  addFitNotes(vehicle, profile, maxPrice, reasons, misses);

  const scoreBreakdown: Record<keyof ScoreWeights, number> = {
    budgetFit: Math.round((budgetFit * 0.7 + paymentFit * 0.3)),
    reliability: Math.round(reliabilityFit),
    safety: Math.round(safetyFit),
    fuelEconomy: Math.round(economyFit),
    insuranceCost: Math.round(insuranceFit),
    performance: Math.round(performanceFit),
    practicality: Math.round(
      bodyFit * 0.2 +
        cargoFit * 0.18 +
        familyFit * 0.12 +
        drivetrainFit * 0.1 +
        transmissionFit * 0.07 +
        climateFit * 0.08 +
        mileageFit * 0.08 +
        yearFit * 0.06 +
        featureFit * 0.06 +
        modificationFit * 0.03 +
        purchaseConditionFit * 0.02,
    ),
    resaleValue: Math.round(resaleFit),
  };

  const normalizedWeights = normalizeScoreWeights(profile.scoreWeights);
  const weightedContributions = getWeightedContributions(scoreBreakdown, normalizedWeights);
  const score = Object.values(weightedContributions).reduce((sum, value) => sum + value, 0);

  return {
    ...vehicle,
    score: Math.round(clamp(score)),
    scoreBreakdown,
    weightedContributions,
    reasons: reasons.slice(0, 5),
    misses: misses.slice(0, 4),
    ownership: {
      insuranceMonthly: vehicle.insurance,
      maintenanceMonthly: vehicle.maintenanceEstimate ?? estimateMaintenanceMonthly(vehicle),
      fuelMonthly: Math.round(estimateFuelCost(vehicle, profile)),
      depreciationAnnual: vehicle.depreciationEstimate ?? estimateDepreciationAnnual(vehicle),
    },
    buyingTips: getBuyingTips(vehicle, profile),
  };
}

export function normalizeScoreWeights(weights: ScoreWeights) {
  const sanitized = Object.fromEntries(
    Object.entries({ ...defaultScoreWeights, ...weights }).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
  ) as ScoreWeights;
  const total = Object.values(sanitized).reduce((sum, value) => sum + value, 0);
  if (!total) return defaultScoreWeights;

  return Object.fromEntries(
    Object.entries(sanitized).map(([key, value]) => [key, (value / total) * 100]),
  ) as ScoreWeights;
}

function getWeightedContributions(scoreBreakdown: Record<keyof ScoreWeights, number>, weights: ScoreWeights) {
  return Object.fromEntries(
    Object.entries(scoreBreakdown).map(([key, value]) => {
      const weight = weights[key as keyof ScoreWeights];
      return [key, Math.round(((Number(value) || 0) * weight) / 100)];
    }),
  ) as Record<keyof ScoreWeights, number>;
}

function getEffectiveMaxPrice(profile: BuyerProfile, estimatedBudget: number) {
  const statedBudget = profile.maxPurchaseBudget || 0;
  if (profile.paymentMethod === "cash" && statedBudget) return statedBudget;
  if (statedBudget && estimatedBudget) return Math.min(Math.max(statedBudget, estimatedBudget * 0.75), estimatedBudget * 1.2);
  return statedBudget || estimatedBudget || 18000;
}

function getBodyStyleFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.bodyStyle === "any") return 82;
  return vehicle.bodyType === profile.bodyStyle ? 100 : spaciousTypes.has(vehicle.bodyType) && profile.bodyStyle === "suv" ? 74 : 58;
}

function getDrivetrainFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.drivetrainPreference === "any") return 82;
  if (vehicle.drivetrain === profile.drivetrainPreference) return 100;
  if (profile.drivetrainPreference === "4WD" && vehicle.drivetrain === "AWD") return 88;
  if (profile.drivetrainPreference === "AWD" && vehicle.drivetrain === "4WD") return 84;
  return 55;
}

function getTransmissionFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.transmissionPreference === "any") return 84;
  if (profile.transmissionPreference === "automatic") return vehicle.transmission === "manual" ? 45 : 100;
  return vehicle.transmission === "manual" ? 100 : 62;
}

function getCargoFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.cargoNeed === "not-sure") return 80;
  const target = profile.cargoNeed === "high" ? 82 : profile.cargoNeed === "medium" ? 62 : 40;
  return clamp((vehicle.cargoScore / target) * 82);
}

function getClimateFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.climate === "not-sure" || profile.climate === "mild") return 82;
  if (profile.climate === "snow") return snowDrivetrains.has(vehicle.drivetrain) ? 100 : 62;
  if (profile.climate === "rain") return vehicle.safetyScore >= 85 || snowDrivetrains.has(vehicle.drivetrain) ? 96 : 74;
  return 82;
}

function getPurchaseConditionFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.purchaseCondition === "any") return 82;
  if (profile.purchaseCondition === "new") return vehicle.year >= new Date().getFullYear() - 2 ? 100 : 52;
  return vehicle.year < new Date().getFullYear() ? 100 : 72;
}

function getModificationFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.modificationPlans !== "yes") return 82;
  if (vehicle.bodyType === "truck" || vehicle.model.includes("Civic") || vehicle.model.includes("3")) return 95;
  return 68;
}

function getImportanceFit(score: number, importance: number) {
  if (!importance || importance <= 2) return 78 + score * 0.1;
  return score;
}

function estimateFuelCost(vehicle: Vehicle, profile: BuyerProfile) {
  if (!vehicle.mpg) return 0;
  return (profile.expectedAnnualMileage / 12 / vehicle.mpg) * profile.fuelPrice;
}

function estimateMaintenanceMonthly(vehicle: Vehicle) {
  const age = Math.max(1, new Date().getFullYear() - vehicle.year);
  const mileageFactor = vehicle.mileage > 90000 ? 55 : vehicle.mileage > 70000 ? 35 : 20;
  const conditionFactor = Math.max(0, 5 - vehicle.condition) * 18;
  const bodyFactor = vehicle.bodyType === "truck" || vehicle.bodyType === "suv" ? 25 : 0;
  const brandFactor = /toyota|honda/i.test(vehicle.make) ? -15 : /subaru|mazda|hyundai/i.test(vehicle.make) ? 0 : 20;

  return Math.max(75, Math.round(55 + age * 5 + mileageFactor + conditionFactor + bodyFactor + brandFactor));
}

function estimateDepreciationAnnual(vehicle: Vehicle) {
  const age = Math.max(1, new Date().getFullYear() - vehicle.year);
  const ageRate = age <= 3 ? 0.12 : age <= 7 ? 0.08 : 0.045;
  const resaleAdjustment = (100 - vehicle.resaleScore) / 1000;
  return Math.round(vehicle.price * (ageRate + resaleAdjustment));
}

function getSimilarAlternatives(vehicle: Omit<ScoredVehicle, "similarAlternatives">, vehicles: Array<Omit<ScoredVehicle, "similarAlternatives">>) {
  const seenNames = new Set<string>();
  return vehicles
    .filter((candidate) => candidate.id !== vehicle.id)
    .map((candidate) => ({
      name: `${candidate.make} ${candidate.model}`,
      similarity:
        (candidate.bodyType === vehicle.bodyType ? 5 : spaciousTypes.has(candidate.bodyType) && spaciousTypes.has(vehicle.bodyType) ? 2 : 0) +
        (candidate.drivetrain === vehicle.drivetrain ? 2 : 0) +
        (candidate.fuelType === vehicle.fuelType ? 1 : 0) +
        (Math.abs(candidate.price - vehicle.price) <= 3000 ? 2 : 0) +
        (Math.abs(candidate.score - vehicle.score) <= 5 ? 1 : 0),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))
    .filter((candidate) => {
      if (seenNames.has(candidate.name)) return false;
      seenNames.add(candidate.name);
      return true;
    })
    .slice(0, 3)
    .map((candidate) => candidate.name);
}

function getBuyingTips(vehicle: Vehicle, profile: BuyerProfile) {
  const tips = [
    "Compare at least three listings before negotiating.",
    "Ask for maintenance records and a pre-purchase inspection.",
  ];

  if (vehicle.transmission === "CVT") tips.push("Confirm CVT fluid service history and test for smooth acceleration.");
  if (vehicle.drivetrain === "AWD") tips.push("Check that all four tires match in brand, size, and tread depth.");
  if (vehicle.fuelType === "hybrid") tips.push("Ask for hybrid battery health information before buying.");
  if (vehicle.bodyType === "truck") tips.push("Inspect the frame, suspension, bed, and signs of towing or work use.");
  if (vehicle.bodyType === "coupe" || vehicle.bodyType === "convertible") tips.push("Confirm insurance cost and visibility comfort before buying.");
  if (vehicle.bodyType === "minivan") tips.push("Check sliding doors, rear HVAC, and third-row folding hardware.");
  if (profile.paymentMethod === "financing") tips.push("Get loan preapproval before visiting sellers.");
  if (profile.paymentMethod === "cash") tips.push("Keep taxes, registration, inspection, and first maintenance outside the purchase offer.");
  if (profile.climate === "snow") tips.push("Budget for quality tires; AWD does not replace winter traction.");

  return tips.slice(0, 4);
}

function addFitNotes(
  vehicle: Vehicle,
  profile: BuyerProfile,
  maxPrice: number,
  reasons: string[],
  misses: string[],
) {
  if (vehicle.price <= maxPrice) reasons.push("fits the current budget estimate");
  else misses.push("price may stretch the current budget");

  if (profile.purchaseCondition === "used" && vehicle.year < new Date().getFullYear()) reasons.push("fits a used-car search");
  if (profile.paymentMethod === "cash") reasons.push("cash buying estimate keeps financing optional");
  if (profile.paymentMethod === "financing") reasons.push("fits a financing-first comparison");

  if (vehicle.mpg >= profile.minMpg) reasons.push("fuel economy supports the mileage plan");
  else if (profile.fuelEconomyImportance >= 4) misses.push("fuel economy may feel weak for this preference");

  if (profile.reliabilityImportance >= 4 && vehicle.reliabilityScore >= 86) reasons.push("strong reliability fit");
  if (profile.performanceImportance >= 4 && vehicle.performanceScore >= 70) reasons.push("has a stronger performance feel");
  if (profile.cargoNeed === "high" && vehicle.cargoScore >= 80) reasons.push("cargo room fits the request");
  if (profile.familySize > 4 && vehicle.seats < profile.familySize) misses.push("seating may be tight for the family size");

  if (profile.drivetrainPreference !== "any" && vehicle.drivetrain === profile.drivetrainPreference) {
    reasons.push(`matches ${profile.drivetrainPreference} preference`);
  }

  if (profile.climate === "snow" && snowDrivetrains.has(vehicle.drivetrain)) reasons.push("better suited for snow");
  if (profile.climate === "snow" && !snowDrivetrains.has(vehicle.drivetrain)) misses.push("snow traction may need tires or caution");

  if (profile.bodyStyle !== "any" && vehicle.bodyType === profile.bodyStyle) reasons.push(`matches ${profile.bodyStyle} style`);
  if (profile.safetyPriority !== "not-sure" && vehicle.safetyScore >= 86) reasons.push("safety score fits the priority");
  if (profile.resaleValueImportance >= 4 && vehicle.resaleScore >= 84) reasons.push("resale value is a strength");
  if (profile.advancedFeaturesImportance >= 4 && vehicle.featureScore < 65) misses.push("advanced features may feel limited");
  if (!beginnerFriendlyTypes.has(vehicle.bodyType)) misses.push("may need extra first-car confidence checks");
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value || 0));
}
