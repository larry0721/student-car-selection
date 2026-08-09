import type { BuyerProfilePatch } from "./preferenceInterpretation";
import type { Vehicle } from "@/types/vehicle";

export type CatalogIntentFeasibility = {
  candidateCount: number;
  catalogCount: number;
  terminalNoMatch: boolean;
  hardDimensions: string[];
};

export function assessCatalogIntentFeasibility(
  patch: BuyerProfilePatch,
  catalog: Vehicle[],
): CatalogIntentFeasibility {
  const hardDimensions: string[] = [];
  const candidates = catalog.filter((vehicle) => {
    const checks = getHardIntentChecks(patch, vehicle);
    checks.forEach((check) => {
      if (!hardDimensions.includes(check.dimension)) hardDimensions.push(check.dimension);
    });
    return checks.every((check) => check.passed);
  });

  return {
    candidateCount: candidates.length,
    catalogCount: catalog.length,
    terminalNoMatch: hardDimensions.length > 0 && candidates.length === 0,
    hardDimensions,
  };
}

function getHardIntentChecks(
  patch: BuyerProfilePatch,
  vehicle: Vehicle,
): Array<{ dimension: string; passed: boolean }> {
  const checks: Array<{ dimension: string; passed: boolean }> = [];
  const requiredMakes = values(patch.requiredMakes, patch.requiredMake);
  const excludedMakes = values(patch.excludedMakes);
  const requiredBodyStyles = values(
    patch.requiredBodyStyles,
    isLegacyConstraint(patch, "bodyStyle") ? patch.bodyStyle : undefined,
  );
  const requiredCategories = values(patch.requiredVehicleCategories);
  const excludedBodyStyles = values(patch.excludedBodyStyles, patch.excludedVehicleCategories);
  const requiredFuelTypes = values(patch.requiredFuelTypes, patch.requiredFuelType);
  const excludedFuelTypes = values(patch.excludedFuelTypes);
  const requiredDrivetrains = values(
    patch.requiredDrivetrains,
    isLegacyConstraint(patch, "drivetrain") ? patch.drivetrainPreference : undefined,
  );
  const excludedDrivetrains = values(patch.excludedDrivetrains);
  const requiredTransmissions = values(
    patch.requiredTransmissions,
    isLegacyConstraint(patch, "transmission") ? patch.transmissionPreference : undefined,
  );
  const excludedTransmissions = values(patch.excludedTransmissions);

  addSetCheck(checks, "make", vehicle.make, requiredMakes, excludedMakes);
  addSetCheck(checks, "body style", vehicle.bodyType, requiredBodyStyles, excludedBodyStyles);
  addSetCheck(checks, "vehicle category", vehicle.bodyType, requiredCategories, []);
  addSetCheck(checks, "fuel type", vehicle.fuelType, requiredFuelTypes, excludedFuelTypes);
  addSetCheck(checks, "drivetrain", vehicle.drivetrain, requiredDrivetrains, excludedDrivetrains, drivetrainMatches);
  addSetCheck(checks, "transmission", vehicle.transmission, requiredTransmissions, excludedTransmissions, transmissionMatches);

  if (patch.maxPurchaseBudget && policyCanEnforce(patch, "purchaseBudget")) {
    checks.push({ dimension: "purchase budget", passed: vehicle.price <= patch.maxPurchaseBudget });
  }
  if (patch.maxMileage) {
    checks.push({ dimension: "mileage", passed: vehicle.mileage <= patch.maxMileage });
  }
  if (patch.minYear) {
    checks.push({ dimension: "model year", passed: vehicle.year >= patch.minYear });
  }
  if (patch.familySize && patch.familySize > 1) {
    checks.push({ dimension: "seating", passed: vehicle.seats >= patch.familySize });
  }
  if (patch.reliabilityMinimum !== undefined) {
    checks.push({ dimension: "reliability", passed: vehicle.reliabilityScore >= patch.reliabilityMinimum });
  }
  if (patch.safetyMinimum !== undefined) {
    checks.push({ dimension: "safety", passed: vehicle.safetyScore >= patch.safetyMinimum });
  }
  if (patch.performanceMinimum !== undefined) {
    checks.push({ dimension: "performance", passed: vehicle.performanceScore >= patch.performanceMinimum });
  }

  return checks;
}

function addSetCheck(
  checks: Array<{ dimension: string; passed: boolean }>,
  dimension: string,
  actual: string,
  required: string[],
  excluded: string[],
  matches: (actualValue: string, expectedValue: string) => boolean = textMatches,
) {
  if (required.length) {
    checks.push({
      dimension,
      passed: required.some((expected) => matches(actual, expected)),
    });
  }
  if (excluded.length) {
    checks.push({
      dimension,
      passed: !excluded.some((expected) => matches(actual, expected)),
    });
  }
}

function values(...inputs: Array<string | string[] | undefined>) {
  return Array.from(new Set(inputs.flatMap((input) => Array.isArray(input) ? input : input ? [input] : [])));
}

function isLegacyConstraint(
  patch: BuyerProfilePatch,
  dimension: "bodyStyle" | "drivetrain" | "transmission",
) {
  const constraint = dimension === "bodyStyle"
    ? "bodyStyle"
    : dimension === "drivetrain"
      ? "drivetrain"
      : "transmission";
  return !patch.flexibleConstraints?.includes(constraint);
}

function policyCanEnforce(
  patch: BuyerProfilePatch,
  dimension: "purchaseBudget",
) {
  const participation = patch.decisionPolicies?.[dimension]?.participation;
  return participation !== "disabled"
    && participation !== "unresolved"
    && participation !== "deprioritized";
}

function textMatches(actual: string, expected: string) {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

function drivetrainMatches(actual: string, expected: string) {
  if (textMatches(actual, expected)) return true;
  const pair = new Set([actual.toUpperCase(), expected.toUpperCase()]);
  return pair.has("AWD") && pair.has("4WD");
}

function transmissionMatches(actual: string, expected: string) {
  return textMatches(actual, expected);
}
