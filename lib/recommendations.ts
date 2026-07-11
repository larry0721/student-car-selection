import { calculateBudget } from "./affordability";
import { getVehicleDataQualityMisses, isRecommendableVehicle } from "./data/vehicleValidation";
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
  const budget = calculateBudget(profile);
  const maintenanceMonthly = vehicle.maintenanceEstimate ?? estimateMaintenanceMonthly(vehicle);
  const fuelMonthly = Math.round(estimateFuelCost(vehicle, profile));
  const depreciationAnnual = vehicle.depreciationEstimate ?? estimateDepreciationAnnual(vehicle);
  const estimatedPayment = estimateMonthlyPayment(vehicle, profile);
  const ownershipMonthly = vehicle.insurance + maintenanceMonthly + fuelMonthly + Math.round(depreciationAnnual / 12);
  const firstYearOwnership = {
    insurance: vehicle.insurance * 12,
    maintenance: maintenanceMonthly * 12,
    fuel: fuelMonthly * 12,
    depreciation: depreciationAnnual,
    total: vehicle.insurance * 12 + maintenanceMonthly * 12 + fuelMonthly * 12 + depreciationAnnual,
  };
  const paymentFit = getPaymentFit(estimatedPayment, budget.paymentBudget, profile);
  const purchaseFit = scoreLowerCost(vehicle.price, maxPrice, 0.58, 1.08);
  const insuranceFit = getInsuranceFit(vehicle, profile);
  const affordabilityFit = Math.round(purchaseFit * 0.5 + paymentFit * 0.35 + insuranceFit * 0.15);
  const ownershipCostFit = getOwnershipCostFit(ownershipMonthly, profile);
  const mileageFit = getMileageFit(vehicle, profile);
  const yearFit = getYearFit(vehicle, profile);
  const economyFit = getFuelEconomyFit(vehicle, profile);
  const bodyFit = getBodyStyleFit(vehicle, profile);
  const drivetrainFit = getDrivetrainFit(vehicle, profile);
  const transmissionFit = getTransmissionFit(vehicle, profile);
  const cargoFit = getCargoFit(vehicle, profile);
  const familyFit = getFamilyFit(vehicle, profile);
  const climateFit = getClimateFit(vehicle, profile);
  const safetyFit = getSafetyFit(vehicle, profile);
  const reliabilityFit = getReliabilityFit(vehicle, profile);
  const performanceFit = getPerformanceFit(vehicle, profile);
  const resaleFit = getResaleFit(vehicle, profile);
  const featureFit = getFeatureFit(vehicle, profile);
  const modificationFit = getModificationFit(vehicle, profile);
  const purchaseConditionFit = getPurchaseConditionFit(vehicle, profile);

  addFitNotes(vehicle, profile, maxPrice, estimatedPayment, ownershipMonthly, fuelMonthly, reasons, misses);

  const scoreBreakdown: Record<keyof ScoreWeights, number> = {
    budgetFit: affordabilityFit,
    reliability: Math.round(reliabilityFit),
    safety: Math.round(safetyFit),
    fuelEconomy: Math.round(economyFit),
    insuranceCost: Math.round(ownershipCostFit),
    performance: Math.round(performanceFit),
    practicality: Math.round(
      bodyFit * 0.22 +
        cargoFit * 0.16 +
        familyFit * 0.13 +
        drivetrainFit * 0.12 +
        climateFit * 0.09 +
        mileageFit * 0.08 +
        yearFit * 0.07 +
        transmissionFit * 0.05 +
        featureFit * 0.05 +
        modificationFit * 0.02 +
        purchaseConditionFit * 0.01,
    ),
    resaleValue: Math.round(resaleFit),
  };

  const normalizedWeights = normalizeScoreWeights(profile.scoreWeights);
  const weightedContributions = getWeightedContributions(scoreBreakdown, normalizedWeights);
  const score = Object.values(weightedContributions).reduce((sum, value) => sum + value, 0);

  return {
    ...vehicle,
    score: Math.round(clamp(score)),
    matchSummary: {
      overall: Math.round(clamp(score)),
      affordability: scoreBreakdown.budgetFit,
      reliability: scoreBreakdown.reliability,
      safety: scoreBreakdown.safety,
      ownershipCost: scoreBreakdown.insuranceCost,
      practicality: scoreBreakdown.practicality,
    },
    scoreBreakdown,
    weightedContributions,
    reasons: reasons.slice(0, 5),
    misses: misses.slice(0, 4),
    ownership: {
      insuranceMonthly: vehicle.insurance,
      maintenanceMonthly,
      fuelMonthly,
      depreciationAnnual,
    },
    firstYearOwnership,
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
  if (profile.bodyStyle === "any") return beginnerFriendlyTypes.has(vehicle.bodyType) ? 82 : 70;
  if (vehicle.bodyType === profile.bodyStyle) return 100;
  if (profile.bodyStyle === "suv" && spaciousTypes.has(vehicle.bodyType)) return 68;
  return 34;
}

function getDrivetrainFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.drivetrainPreference === "any") {
    if (profile.climate === "snow") return snowDrivetrains.has(vehicle.drivetrain) ? 92 : 45;
    return snowDrivetrains.has(vehicle.drivetrain) ? 84 : 78;
  }
  if (vehicle.drivetrain === profile.drivetrainPreference) return 100;
  if (profile.drivetrainPreference === "4WD" && vehicle.drivetrain === "AWD") return 82;
  if (profile.drivetrainPreference === "AWD" && vehicle.drivetrain === "4WD") return 80;
  return 28;
}

function getTransmissionFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.transmissionPreference === "any") return vehicle.transmission === "manual" ? 74 : 82;
  if (profile.transmissionPreference === "automatic") return vehicle.transmission === "manual" ? 22 : 100;
  return vehicle.transmission === "manual" ? 100 : 24;
}

function getCargoFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.cargoNeed === "not-sure") return scaleRange(vehicle.cargoScore, 35, 88);
  const target = profile.cargoNeed === "high" ? 86 : profile.cargoNeed === "medium" ? 66 : 38;
  return scoreHigherAgainstTarget(vehicle.cargoScore, target, 0.68, 1.12);
}

function getClimateFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.climate === "not-sure" || profile.climate === "mild") return 82;
  if (profile.climate === "snow") return snowDrivetrains.has(vehicle.drivetrain) ? 100 : 18;
  if (profile.climate === "rain") return vehicle.safetyScore >= 88 || snowDrivetrains.has(vehicle.drivetrain) ? 96 : 64;
  return 82;
}

function getPurchaseConditionFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.purchaseCondition === "any") return 82;
  if (profile.purchaseCondition === "new") return vehicle.year >= new Date().getFullYear() - 2 ? 100 : 30;
  return vehicle.year < new Date().getFullYear() ? 94 : 58;
}

function getModificationFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.modificationPlans !== "yes") return 82;
  if (vehicle.bodyType === "truck" || vehicle.model.includes("Civic") || vehicle.model.includes("3")) return 96;
  if (vehicle.bodyType === "coupe" || vehicle.bodyType === "hatchback") return 88;
  return 52;
}

function getPaymentFit(estimatedPayment: number, paymentBudget: number, profile: BuyerProfile) {
  if (profile.paymentMethod === "cash") return 82;
  const target = paymentBudget || Math.max(120, profile.monthlyBudget * 0.42);
  return scoreLowerCost(estimatedPayment, target, 0.62, 1.12);
}

function getInsuranceFit(vehicle: Vehicle, profile: BuyerProfile) {
  const target = profile.insuranceBudget || Math.max(120, profile.monthlyBudget * 0.22);
  return scoreLowerCost(vehicle.insurance, target, 0.68, 1.25);
}

function getOwnershipCostFit(ownershipMonthly: number, profile: BuyerProfile) {
  const target = Math.max(180, profile.monthlyBudget * (profile.paymentMethod === "cash" ? 0.72 : 0.48));
  return scoreLowerCost(ownershipMonthly, target, 0.55, 1.25);
}

function getMileageFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.maxMileage) return scoreLowerCost(vehicle.mileage, profile.maxMileage, 0.45, 1.08);

  const expectedMileage = Math.max(12000, (new Date().getFullYear() - vehicle.year) * 12000);
  return scoreLowerCost(vehicle.mileage, expectedMileage, 0.55, 1.55);
}

function getYearFit(vehicle: Vehicle, profile: BuyerProfile) {
  if (!profile.minYear) return scaleRange(vehicle.year, 2010, new Date().getFullYear());
  if (vehicle.year < profile.minYear) return Math.max(8, 58 - (profile.minYear - vehicle.year) * 10);
  return clamp(72 + (vehicle.year - profile.minYear) * 4);
}

function getFuelEconomyFit(vehicle: Vehicle, profile: BuyerProfile) {
  const target = profile.minMpg || (profile.expectedAnnualMileage >= 12000 ? 32 : 26);
  const base = scoreHigherAgainstTarget(vehicle.mpg, target, 0.72, vehicle.fuelType === "electric" ? 4.2 : 1.45);
  const importance = profile.fuelEconomyImportance || 3;
  return applyImportance(base, importance);
}

function getReliabilityFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.reliabilityScore, 66, 96);
  const mileagePenalty = vehicle.mileage > 120000 ? 10 : vehicle.mileage > 90000 ? 5 : 0;
  return applyImportance(base - mileagePenalty, profile.reliabilityImportance);
}

function getSafetyFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.safetyScore, 78, 94);
  const importance = profile.safetyPriority === "maximum" ? 5 : profile.safetyPriority === "high" ? 4 : 3;
  return applyImportance(base, importance);
}

function getPerformanceFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.performanceScore, 42, 90);
  return applyImportance(base, profile.performanceImportance);
}

function getResaleFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.resaleScore, 58, 90);
  return applyImportance(base, profile.resaleValueImportance);
}

function getFeatureFit(vehicle: Vehicle, profile: BuyerProfile) {
  const base = scaleRange(vehicle.featureScore, 45, 90);
  return applyImportance(base, profile.advancedFeaturesImportance);
}

function getFamilyFit(vehicle: Vehicle, profile: BuyerProfile) {
  const seatsNeeded = Math.max(profile.familySize || 1, 1);
  if (seatsNeeded <= 1) return scaleRange(vehicle.seats, 2, 7);
  if (vehicle.seats < seatsNeeded) return 18;
  return clamp(78 + Math.min(vehicle.seats - seatsNeeded, 3) * 7);
}

function estimateMonthlyPayment(vehicle: Vehicle, profile: BuyerProfile) {
  if (profile.paymentMethod === "cash") return 0;
  const amountFinanced = Math.max(0, vehicle.price * 1.08 - profile.downPayment);
  const monthlyRate = profile.apr / 100 / 12;
  if (!monthlyRate) return amountFinanced / Math.max(profile.loanTermMonths, 1);
  return (amountFinanced * monthlyRate) / (1 - (1 + monthlyRate) ** -Math.max(profile.loanTermMonths, 1));
}

function scoreLowerCost(actual: number, target: number, idealRatio: number, maxRatio: number) {
  if (!Number.isFinite(actual) || actual < 0) return 0;
  if (!target || target <= 0) return 62;

  const ratio = actual / target;
  if (ratio <= idealRatio) return clamp(100 - ratio * 6);
  if (ratio <= 1) return interpolate(ratio, idealRatio, 1, 96, 66);
  if (ratio <= maxRatio) return interpolate(ratio, 1, maxRatio, 66, 18);
  return Math.max(0, 18 - (ratio - maxRatio) * 35);
}

function scoreHigherAgainstTarget(actual: number, target: number, weakRatio: number, excellentRatio: number) {
  if (!Number.isFinite(actual) || actual <= 0) return 0;
  if (!target || target <= 0) return 68;

  const ratio = actual / target;
  if (ratio <= weakRatio) return interpolate(ratio, 0, weakRatio, 12, 48);
  if (ratio <= 1) return interpolate(ratio, weakRatio, 1, 48, 76);
  if (ratio <= excellentRatio) return interpolate(ratio, 1, excellentRatio, 76, 100);
  return 100;
}

function scaleRange(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(((value - low) / Math.max(high - low, 1)) * 100);
}

function applyImportance(score: number, importance: number) {
  const clamped = clamp(score);
  if (!importance || importance <= 2) return clamp(62 + clamped * 0.32);
  if (importance === 3) return clamped;
  const exponent = importance >= 5 ? 1.32 : 1.16;
  return clamp(Math.pow(clamped / 100, exponent) * 100);
}

function interpolate(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number) {
  if (inputMax === inputMin) return outputMax;
  const progress = (value - inputMin) / (inputMax - inputMin);
  return outputMin + (outputMax - outputMin) * progress;
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
  estimatedPayment: number,
  ownershipMonthly: number,
  fuelMonthly: number,
  reasons: string[],
  misses: string[],
) {
  const price = formatCurrency(vehicle.price);
  const budgetCap = formatCurrency(maxPrice);
  const insurance = formatCurrency(vehicle.insurance);
  const monthlyOwnership = formatCurrency(ownershipMonthly);

  if (vehicle.price <= maxPrice) reasons.push(`${price} stays within your buying-power cap of ${budgetCap}`);
  else misses.push(`${price} is above your buying-power cap of ${budgetCap}`);

  if (profile.purchaseCondition === "used" && vehicle.year < new Date().getFullYear()) {
    reasons.push(`${vehicle.year} model year fits your used-car search`);
  }
  if (profile.purchaseCondition === "new" && vehicle.year >= new Date().getFullYear() - 1) {
    reasons.push(`${vehicle.year} model year fits your new-car preference`);
  }
  if (profile.paymentMethod === "cash") reasons.push(`cash plan avoids an estimated ${formatCurrency(estimatedPayment)}/mo loan payment`);
  if (profile.paymentMethod === "financing") {
    reasons.push(`estimated payment is ${formatCurrency(estimatedPayment)}/mo before insurance, fuel, and maintenance`);
  }

  if (vehicle.insurance <= profile.insuranceBudget) reasons.push(`${insurance}/mo insurance estimate fits your ${formatCurrency(profile.insuranceBudget)}/mo cap`);
  else misses.push(`${insurance}/mo insurance estimate is above your ${formatCurrency(profile.insuranceBudget)}/mo cap`);

  if (vehicle.mpg >= profile.minMpg) reasons.push(`${vehicle.mpg} MPG meets your ${profile.minMpg} MPG target`);
  else if (profile.fuelEconomyImportance >= 4) misses.push(`${vehicle.mpg} MPG is below your ${profile.minMpg} MPG target`);

  if (profile.expectedAnnualMileage >= 12000) {
    reasons.push(`${formatCurrency(fuelMonthly)}/mo fuel estimate reflects your ${profile.expectedAnnualMileage.toLocaleString("en-US")} annual miles`);
  }

  if (profile.reliabilityImportance >= 4 && vehicle.reliabilityScore >= 86) {
    reasons.push(`${vehicle.reliabilityScore}/100 reliability score supports your high reliability priority`);
  }
  if (profile.performanceImportance >= 4 && vehicle.performanceScore >= 70) {
    reasons.push(`${vehicle.performanceScore}/100 performance score supports your sportier preference`);
  }
  if (profile.cargoNeed === "high" && vehicle.cargoScore >= 80) reasons.push(`${vehicle.cargoScore}/100 cargo score fits your high cargo need`);
  if (profile.familySize > 4 && vehicle.seats < profile.familySize) {
    misses.push(`${vehicle.seats} seats may be tight for a family size of ${profile.familySize}`);
  }

  if (profile.drivetrainPreference !== "any" && vehicle.drivetrain === profile.drivetrainPreference) {
    reasons.push(`${vehicle.drivetrain} matches your drivetrain preference`);
  }

  if (profile.climate === "snow" && snowDrivetrains.has(vehicle.drivetrain)) reasons.push(`${vehicle.drivetrain} is a better match for snow`);
  if (profile.climate === "snow" && !snowDrivetrains.has(vehicle.drivetrain)) misses.push(`${vehicle.drivetrain} may need winter tires for snow`);

  if (profile.bodyStyle !== "any" && vehicle.bodyType === profile.bodyStyle) reasons.push(`${vehicle.bodyType} body style matches your request`);
  if (profile.safetyPriority !== "not-sure" && vehicle.safetyScore >= 86) {
    reasons.push(`${vehicle.safetyScore}/100 safety score fits your ${profile.safetyPriority} safety priority`);
  }
  if (profile.resaleValueImportance >= 4 && vehicle.resaleScore >= 84) reasons.push(`${vehicle.resaleScore}/100 resale score is a strength`);
  if (profile.advancedFeaturesImportance >= 4 && vehicle.featureScore < 65) {
    misses.push(`${vehicle.featureScore}/100 feature score may feel limited`);
  }
  reasons.push(`${monthlyOwnership}/mo estimated ownership cost combines insurance, maintenance, fuel, and depreciation`);
  if (!beginnerFriendlyTypes.has(vehicle.bodyType)) misses.push("may need extra first-car confidence checks");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value || 0));
}
