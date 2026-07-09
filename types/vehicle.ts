import type { ScoreWeights } from "@/types/buyer";

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
};

export type ScoredVehicle = Vehicle & {
  score: number;
  scoreBreakdown: Record<keyof ScoreWeights, number>;
  weightedContributions: Record<keyof ScoreWeights, number>;
  reasons: string[];
  misses: string[];
  ownership: {
    insuranceMonthly: number;
    maintenanceMonthly: number;
    fuelMonthly: number;
    depreciationAnnual: number;
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
