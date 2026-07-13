import type { ConstraintKey, ScoreWeights } from "@/types/buyer";

export type Vehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  bodyType: string;
  fuelType: string;
  drivetrain: string;
  transmission: string;
  mileage: number;
  price: number;
  condition: number;
  mpg: number;
  insurance: number;
  maintenanceEstimate?: number;
  depreciationEstimate?: number;
  reliabilityScore: number;
  safetyScore: number;
  performanceScore: number;
  cargoScore: number;
  resaleScore: number;
  featureScore: number;
  seats: number;
  pros: string[];
  watchouts: string[];
  commonIssues: string[];
  imageUrl?: string;
  imageSource?: string;
  imageVerified?: boolean;
  listingUrl?: string;
  dataSources?: string[];
  dataUpdatedAt?: string;
};

export type RecommendationConfidence = {
  score: number;
  level: "high" | "medium" | "low";
  factors: Array<{
    code: string;
    value: number | string | boolean;
    impact: "positive" | "neutral" | "negative";
  }>;
};

export type RecommendationSignal = {
  code: string;
  category: keyof ScoreWeights;
  field: string;
  vehicleValue: number | string | boolean;
  userPreference?: number | string | boolean;
  score?: number;
  weight?: number;
  contribution?: number;
};

export type RecommendationTradeoff = {
  code: string;
  category: keyof ScoreWeights;
  field: string;
  vehicleValue: number | string | boolean;
  userPreference?: number | string | boolean;
  severity: "low" | "medium" | "high";
  penaltyPoints: number;
};

export type RecommendationAssumption = {
  code: string;
  field: string;
  method: string;
  value?: number | string | boolean;
};

export type EstimatedField = {
  field: string;
  value: number | string | boolean;
  unit: "usd" | "usd_per_month" | "usd_per_year" | "score" | "text";
  method: string;
};

export type MissingInformation = {
  field: string;
  expectedSource: "listing-api" | "fueleconomy.gov" | "nhtsa" | "csv-import" | "user-input";
  impact: "low" | "medium" | "high";
};

export type FieldProvenanceStatus = "verified" | "sourced" | "estimated" | "derived" | "missing";

export type FieldProvenance = {
  field: string;
  status: FieldProvenanceStatus;
  source: "listing-api" | "fueleconomy.gov" | "nhtsa" | "csv-import" | "seed-catalog" | "user-input" | "engine";
  method: string;
};

export type HardConstraintResult = {
  code: ConstraintKey;
  label: string;
  passed: boolean;
  actual?: number | string | boolean;
  limit?: number | string | boolean;
  flexible: boolean;
  exclusionReason?: string;
};

export type OwnershipSummary = {
  estimatedMonthlyTotal: number;
  insuranceMonthly: number;
  maintenanceMonthly: number;
  fuelMonthly: number;
  depreciationMonthly: number;
};

export type FirstYearOwnershipEstimate = {
  insurance: number;
  maintenance: number;
  fuel: number;
  depreciation: number;
  total: number;
};

export type BetterAlternative = {
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  overallMatchScore: number;
  requiredConstraintChanges: HardConstraintResult[];
};

export type QualificationStatus = "qualified" | "compromise" | "excluded";

export type ConstraintBlocker = {
  code: ConstraintKey;
  label: string;
  excludedCount: number;
  compromiseCount: number;
};

export type CompromiseGuidance = {
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  qualificationStatus: QualificationStatus;
  overallMatchScore: number;
  singleConstraintChange: HardConstraintResult;
};

export type NoMatchResult = {
  noMatch: boolean;
  totalEvaluated: number;
  qualifiedCount: number;
  compromiseCount: number;
  excludedCount: number;
  topConstraintBlockers: ConstraintBlocker[];
  compromiseOptions: CompromiseGuidance[];
};

export type CandidatePipelineStageName =
  | "loadCatalog"
  | "candidateGeneration"
  | "constraintFiltering"
  | "suitabilityEvaluation"
  | "ranking"
  | "recommendationObject"
  | "advisorLayer";

export type CandidatePipelineStageDebug = {
  stage: CandidatePipelineStageName;
  inputCount: number;
  outputCount: number;
  note: string;
};

export type CandidatePipelineTopVehicle = {
  rank: number;
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  overallMatchScore: number;
  qualificationStatus: QualificationStatus;
};

export type CandidatePipelineRunnerUpLoss = {
  rank: number;
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  overallMatchScore: number;
  lostToVehicleId: string;
  scoreGap: number;
  primaryReason: string;
  category?: keyof ScoreWeights;
  categoryGap?: number;
};

export type CandidatePipelineDebug = {
  catalogCount: number;
  candidateCount: number;
  filteredCount: number;
  excludedCount: number;
  qualifiedCount: number;
  compromiseCount: number;
  stages: CandidatePipelineStageDebug[];
  topFive: CandidatePipelineTopVehicle[];
  runnerUpLossReasons: CandidatePipelineRunnerUpLoss[];
  advisorLayerSource: "recommendation_object";
};

export type RecommendationDecisionSet = {
  primaryRecommendations: RecommendationObject[];
  compromiseRecommendations: RecommendationObject[];
  excludedRecommendations: RecommendationObject[];
  noMatch: NoMatchResult;
  pipelineDebug: CandidatePipelineDebug;
};

export type RecommendationObject = {
  vehicleId: string;
  vehicle: Vehicle;
  qualified: boolean;
  qualificationStatus: QualificationStatus;
  qualificationSummary: {
    status: QualificationStatus;
    passedCount: number;
    failedCount: number;
    compromiseCount: number;
  };
  hardConstraintResults: HardConstraintResult[];
  hardConstraintsPassed: HardConstraintResult[];
  softPreferenceScore: number;
  overallMatchScore: number;
  recommendationConfidence: RecommendationConfidence;
  dataQualityConfidence: RecommendationConfidence;
  reasonsForRecommendation: RecommendationSignal[];
  tradeoffs: RecommendationTradeoff[];
  assumptionsUsed: RecommendationAssumption[];
  estimatedFields: EstimatedField[];
  missingInformation: MissingInformation[];
  fieldProvenance: FieldProvenance[];
  ownershipSummary: OwnershipSummary;
  firstYearOwnershipEstimate: FirstYearOwnershipEstimate;
  betterAlternativesIfConstraintsChange: BetterAlternative[];
};

export type DecisionReportChoice = {
  vehicleId?: string;
  year?: number;
  make?: string;
  model?: string;
  overallMatchScore?: number;
  categoryScore?: number;
  reason: string;
};

export type DecisionReport = {
  bestOverall: DecisionReportChoice;
  bestValue: DecisionReportChoice;
  safestChoice: DecisionReportChoice;
  userPreferredChoice: DecisionReportChoice;
  executiveSummary: string[];
  userPriorities: RecommendationSignal[];
  hardRequirements: HardConstraintResult[];
  whySelected: RecommendationSignal[];
  primaryTradeoffs: RecommendationTradeoff[];
  runnerUp?: DecisionReportChoice;
  whyRunnerUpLost: string;
  assumptions: RecommendationAssumption[];
  missingInformation: MissingInformation[];
  estimatedFields: EstimatedField[];
  recommendationConfidence?: RecommendationConfidence;
  dataQualityConfidence?: RecommendationConfidence;
  whatCouldChangeRecommendation: string[];
};

export type ScoredVehicle = Vehicle & {
  score: number;
  matchSummary: {
    overall: number;
    affordability: number;
    reliability: number;
    safety: number;
    fuelEnergyCost: number;
    insuranceCost: number;
    maintenanceRisk: number;
    ownershipCost: number;
    practicality: number;
    resaleValue: number;
    drivingPreferenceFit: number;
  };
  scoreBreakdown: Record<keyof ScoreWeights, number>;
  weightedContributions: Record<keyof ScoreWeights, number>;
  categoryWeights: Record<keyof ScoreWeights, number>;
  positiveContributions: Array<{
    category: keyof ScoreWeights;
    label: string;
    score: number;
    weight: number;
    points: number;
  }>;
  penalties: Array<{
    label: string;
    points: number;
    reason: string;
  }>;
  hardConstraintStatus: {
    status: QualificationStatus;
    passed: boolean;
    checked: string[];
    results: HardConstraintResult[];
    failures: HardConstraintResult[];
  };
  assumptions: string[];
  missingDataWarnings: string[];
  confidence: {
    score: number;
    level: "high" | "medium" | "low";
    reasons: string[];
  };
  recommendation: RecommendationObject;
  reasons: string[];
  misses: string[];
  ownership: {
    insuranceMonthly: number;
    maintenanceMonthly: number;
    fuelMonthly: number;
    depreciationAnnual: number;
  };
  firstYearOwnership: {
    insurance: number;
    maintenance: number;
    fuel: number;
    depreciation: number;
    total: number;
  };
  similarAlternatives: string[];
  buyingTips: string[];
};

export type AiRecommendation = {
  vehicleId: string;
  summary: string;
  reasons: string[];
  watchouts: string[];
};
