import type { Vehicle } from "@/types/vehicle";

export type VehicleValidationField =
  | "year"
  | "make"
  | "model"
  | "bodyType"
  | "drivetrain"
  | "transmission"
  | "fuelType"
  | "price"
  | "mileage"
  | "mpg"
  | "insurance"
  | "safetyScore"
  | "reliabilityScore"
  | "maintenanceEstimate"
  | "seats";

export type VehicleValidationIssue = {
  field: VehicleValidationField;
  message: string;
};

const allowedBodyTypes = new Set(["sedan", "suv", "hatchback", "truck", "coupe", "convertible", "wagon", "minivan"]);
const allowedDrivetrains = new Set(["FWD", "AWD", "RWD", "4WD"]);
const allowedTransmissions = new Set(["automatic", "manual", "CVT"]);
const allowedFuelTypes = new Set(["gas", "hybrid", "diesel", "electric"]);
const fwdTruckExceptions = new Set(["ridgeline", "maverick"]);
const rwdSportsModels = new Set(["miata", "mx-5", "86", "brz", "camaro", "mustang"]);
const frontDrivePassengerModels = new Set([
  "accord",
  "accent",
  "civic",
  "corolla",
  "cruze",
  "elantra",
  "fiesta",
  "fit",
  "focus",
  "forte",
  "mazda2",
  "mazda3",
  "mirage",
  "optima",
  "rio",
  "sentra",
  "sonata",
  "sonic",
  "spark",
  "versa",
  "yaris",
]);

const expectedBodyByModel = new Map<string, string>([
  ["4runner", "suv"],
  ["bolt", "hatchback"],
  ["cherokee", "suv"],
  ["crosstrek", "suv"],
  ["cr-v", "suv"],
  ["cx-5", "suv"],
  ["ecosport", "suv"],
  ["forester", "suv"],
  ["frontier", "truck"],
  ["golf", "hatchback"],
  ["grand", "suv"],
  ["leaf", "hatchback"],
  ["murano", "suv"],
  ["odyssey", "minivan"],
  ["rav4", "suv"],
  ["sienna", "minivan"],
  ["silverado", "truck"],
  ["tacoma", "truck"],
  ["tundra", "truck"],
]);

const suspiciousExactModels = new Set([
  "awd",
  "b",
  "capitiva",
  "civichonda",
  "e",
  "econline",
  "foreser",
  "hd",
  "legay",
  "police",
  "s",
  "yari",
]);

export function validateVehicleRecord(vehicle: Vehicle, currentYear = new Date().getFullYear()): VehicleValidationIssue[] {
  const issues: VehicleValidationIssue[] = [];
  const modelKey = normalizeModel(vehicle.model);
  const expectedBody = expectedBodyByModel.get(modelKey);

  if (!Number.isInteger(vehicle.year) || vehicle.year < 1998 || vehicle.year > currentYear + 1) {
    issues.push({ field: "year", message: "year is outside a realistic consumer-car range" });
  }

  if (!vehicle.make?.trim() || vehicle.make.trim().length < 2) {
    issues.push({ field: "make", message: "make is missing or too short" });
  }

  if (!vehicle.model?.trim() || vehicle.model.trim().length < 2 || suspiciousExactModels.has(modelKey)) {
    issues.push({ field: "model", message: "model name is missing, truncated, misspelled, or too ambiguous to recommend" });
  }

  if (!allowedBodyTypes.has(vehicle.bodyType)) {
    issues.push({ field: "bodyType", message: "body style is not one of the supported car body styles" });
  }

  if (expectedBody && vehicle.bodyType !== expectedBody) {
    issues.push({ field: "bodyType", message: `${vehicle.model} is usually a ${expectedBody}, not a ${vehicle.bodyType}` });
  }

  if (!allowedDrivetrains.has(vehicle.drivetrain)) {
    issues.push({ field: "drivetrain", message: "drivetrain is not a supported value" });
  }

  if (!allowedTransmissions.has(vehicle.transmission)) {
    issues.push({ field: "transmission", message: "transmission is not a supported value" });
  }

  if (!allowedFuelTypes.has(vehicle.fuelType)) {
    issues.push({ field: "fuelType", message: "fuel type is not a supported value" });
  }

  if (!Number.isFinite(vehicle.price) || vehicle.price < 3000 || vehicle.price > 90000) {
    issues.push({ field: "price", message: "price is outside the realistic recommendation range" });
  }

  if (vehicle.year >= currentYear - 1 && vehicle.price < 12000) {
    issues.push({ field: "price", message: "late-model vehicle price is suspiciously low" });
  } else if (vehicle.year >= currentYear - 4 && vehicle.price < 7000) {
    issues.push({ field: "price", message: "newer used-vehicle price is suspiciously low" });
  }

  if (!Number.isFinite(vehicle.mileage) || vehicle.mileage < 0 || vehicle.mileage > 250000) {
    issues.push({ field: "mileage", message: "mileage is outside a realistic range" });
  }

  if (vehicle.year >= currentYear - 1 && vehicle.mileage > 25000) {
    issues.push({ field: "mileage", message: "late-model vehicle mileage is suspiciously high" });
  }

  validateMpg(vehicle, issues);
  validateScores(vehicle, issues);
  validateOwnershipEstimates(vehicle, issues);
  validateSeats(vehicle, issues);
  validateDrivetrainModelFit(vehicle, modelKey, issues);

  return issues;
}

export function isRecommendableVehicle(vehicle: Vehicle) {
  return validateVehicleRecord(vehicle).length === 0;
}

export function auditVehicleCatalog(vehicles: Vehicle[]) {
  return vehicles.map((vehicle) => ({
    vehicle,
    issues: validateVehicleRecord(vehicle),
    recommendable: isRecommendableVehicle(vehicle),
  }));
}

export function getVehicleDataQualityMisses(vehicle: Vehicle) {
  return validateVehicleRecord(vehicle).map((issue) => `data quality: ${issue.message}`);
}

function validateMpg(vehicle: Vehicle, issues: VehicleValidationIssue[]) {
  if (!Number.isFinite(vehicle.mpg)) {
    issues.push({ field: "mpg", message: "MPG is missing or invalid" });
    return;
  }

  if (vehicle.fuelType === "electric" && (vehicle.mpg < 60 || vehicle.mpg > 160)) {
    issues.push({ field: "mpg", message: "electric efficiency should be represented as a realistic MPGe value" });
  } else if (vehicle.fuelType === "hybrid" && (vehicle.mpg < 35 || vehicle.mpg > 80)) {
    issues.push({ field: "mpg", message: "hybrid MPG is outside a realistic range" });
  } else if ((vehicle.fuelType === "gas" || vehicle.fuelType === "diesel") && (vehicle.mpg < 10 || vehicle.mpg > 60)) {
    issues.push({ field: "mpg", message: "gas or diesel MPG is outside a realistic range" });
  }
}

function validateScores(vehicle: Vehicle, issues: VehicleValidationIssue[]) {
  if (!inRange(vehicle.safetyScore, 50, 100)) {
    issues.push({ field: "safetyScore", message: "safety score must be between 50 and 100" });
  }

  if (!inRange(vehicle.reliabilityScore, 45, 100)) {
    issues.push({ field: "reliabilityScore", message: "reliability score must be between 45 and 100" });
  }
}

function validateOwnershipEstimates(vehicle: Vehicle, issues: VehicleValidationIssue[]) {
  if (!inRange(vehicle.insurance, 55, 450)) {
    issues.push({ field: "insurance", message: "monthly insurance estimate is outside a realistic first-car range" });
  }

  const maintenance = vehicle.maintenanceEstimate;
  if (maintenance !== undefined && !inRange(maintenance, 50, 450)) {
    issues.push({ field: "maintenanceEstimate", message: "monthly maintenance estimate is outside a realistic range" });
  }
}

function validateSeats(vehicle: Vehicle, issues: VehicleValidationIssue[]) {
  if (!Number.isInteger(vehicle.seats) || vehicle.seats < 2 || vehicle.seats > 8) {
    issues.push({ field: "seats", message: "seat count is outside a realistic passenger-vehicle range" });
  }

  if (vehicle.bodyType === "minivan" && vehicle.seats < 6) {
    issues.push({ field: "seats", message: "minivans should have at least six seats" });
  }

  if (vehicle.bodyType === "convertible" && vehicle.seats > 4) {
    issues.push({ field: "seats", message: "convertible seat count is suspiciously high" });
  }
}

function validateDrivetrainModelFit(vehicle: Vehicle, modelKey: string, issues: VehicleValidationIssue[]) {
  if (vehicle.bodyType === "truck" && vehicle.drivetrain === "FWD" && !fwdTruckExceptions.has(modelKey)) {
    issues.push({ field: "drivetrain", message: "front-wheel-drive truck record is suspicious" });
  }

  if (rwdSportsModels.has(modelKey) && vehicle.drivetrain !== "RWD") {
    issues.push({ field: "drivetrain", message: `${vehicle.model} should be rear-wheel drive in this catalog` });
  }

  if (vehicle.make === "Subaru" && modelKey !== "brz" && vehicle.drivetrain !== "AWD" && vehicle.drivetrain !== "4WD") {
    issues.push({ field: "drivetrain", message: "Subaru passenger models should be AWD/4WD in this catalog" });
  }

  if (frontDrivePassengerModels.has(modelKey) && (vehicle.drivetrain === "RWD" || vehicle.drivetrain === "4WD")) {
    issues.push({ field: "drivetrain", message: `${vehicle.model} drivetrain is suspicious for this body style` });
  }

  if (modelKey === "odyssey" && (vehicle.drivetrain === "RWD" || vehicle.drivetrain === "4WD")) {
    issues.push({ field: "drivetrain", message: "Honda Odyssey should not be RWD/4WD" });
  }
}

function normalizeModel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).join("-");
}

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}
