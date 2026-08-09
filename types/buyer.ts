export type ScoreWeights = {
  affordability: number;
  reliability: number;
  safety: number;
  fuelEnergyCost: number;
  insuranceCost: number;
  maintenanceRisk: number;
  practicality: number;
  resaleValue: number;
  drivingPreferenceFit: number;
};

export type ImportanceLevel = "low" | "normal" | "important" | "very-important";
export type BodyStyle = "sedan" | "suv" | "hatchback" | "truck" | "coupe" | "convertible" | "wagon" | "minivan";
export type FuelType = "gas" | "hybrid" | "electric" | "diesel";
export type Drivetrain = "FWD" | "AWD" | "RWD" | "4WD";
export type Transmission = "automatic" | "manual" | "cvt";

export type ConstraintKey =
  | "totalBudget"
  | "monthlyPayment"
  | "make"
  | "purchaseCondition"
  | "bodyStyle"
  | "drivetrain"
  | "maxMileage"
  | "minYear"
  | "transmission"
  | "seating"
  | "fuelType"
  | "reliabilityMinimum"
  | "safetyMinimum"
  | "performanceMinimum";

export type BuyerProfile = {
  maxPurchaseBudget: number;
  monthlyBudget: number;
  downPayment: number;
  loanTermMonths: number;
  apr: number;
  paymentMethod: "not-sure" | "cash" | "financing";
  purchaseCondition: "any" | "new" | "used";
  expectedAnnualMileage: number;
  fuelPrice: number;
  insuranceBudget: number;
  minYear: number;
  maxMileage: number;
  minMpg: number;
  fuelEconomyImportance: number;
  reliabilityImportance: number;
  performanceImportance: number;
  cargoNeed: "not-sure" | "low" | "medium" | "high";
  familySize: number;
  drivetrainPreference: "any" | Drivetrain;
  transmissionPreference: "any" | Exclude<Transmission, "cvt">;
  bodyStyle: "any" | BodyStyle;
  climate: "not-sure" | "mild" | "rain" | "snow";
  resaleValueImportance: number;
  modificationPlans: "not-sure" | "no" | "yes";
  advancedFeaturesImportance: number;
  safetyPriority: "not-sure" | "standard" | "high" | "maximum";
  scoreWeights: ScoreWeights;
  requiredMake?: string;
  preferredMake?: string;
  allowedMakes?: string[];
  excludedMakes?: string[];
  requiredFuelType?: FuelType;
  requiredMakes?: string[];
  preferredMakes?: string[];
  requiredBodyStyles?: BodyStyle[];
  preferredBodyStyles?: BodyStyle[];
  allowedBodyStyles?: BodyStyle[];
  excludedBodyStyles?: BodyStyle[];
  requiredVehicleCategories?: BodyStyle[];
  preferredVehicleCategories?: BodyStyle[];
  allowedVehicleCategories?: BodyStyle[];
  excludedVehicleCategories?: BodyStyle[];
  requiredFuelTypes?: FuelType[];
  preferredFuelTypes?: FuelType[];
  allowedFuelTypes?: FuelType[];
  excludedFuelTypes?: FuelType[];
  requiredDrivetrains?: Drivetrain[];
  preferredDrivetrains?: Drivetrain[];
  allowedDrivetrains?: Drivetrain[];
  excludedDrivetrains?: Drivetrain[];
  requiredTransmissions?: Transmission[];
  preferredTransmissions?: Transmission[];
  allowedTransmissions?: Transmission[];
  excludedTransmissions?: Transmission[];
  reliabilityMinimum?: number;
  safetyMinimum?: number;
  performanceMinimum?: number;
  flexibleConstraints?: ConstraintKey[];
  allowCompromises?: boolean;
  decisionPolicies?: DecisionParticipationPolicyMap;
};

export type BudgetSummary = {
  fuelCost: number;
  maintenanceReserve: number;
  paymentBudget: number;
  maxPurchasePrice: number;
};
import type { DecisionParticipationPolicyMap } from "./decisionPolicy";
