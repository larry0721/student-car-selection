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
  drivetrainPreference: "any" | "FWD" | "AWD" | "RWD" | "4WD";
  transmissionPreference: "any" | "automatic" | "manual";
  bodyStyle: "any" | "sedan" | "suv" | "hatchback" | "truck" | "coupe" | "convertible" | "wagon" | "minivan";
  climate: "not-sure" | "mild" | "rain" | "snow";
  resaleValueImportance: number;
  modificationPlans: "not-sure" | "no" | "yes";
  advancedFeaturesImportance: number;
  safetyPriority: "not-sure" | "standard" | "high" | "maximum";
  scoreWeights: ScoreWeights;
  requiredMake?: string;
  preferredMake?: string;
  requiredFuelType?: "gas" | "hybrid" | "electric" | "diesel";
  reliabilityMinimum?: number;
  safetyMinimum?: number;
  performanceMinimum?: number;
  flexibleConstraints?: ConstraintKey[];
  allowCompromises?: boolean;
};

export type BudgetSummary = {
  fuelCost: number;
  maintenanceReserve: number;
  paymentBudget: number;
  maxPurchasePrice: number;
};
