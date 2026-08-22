import type { BuyerProfile } from "./buyer";

export type DemoIntelligenceConfidence = "high" | "medium" | "low" | "unknown";

export type DemoIntelligenceSource = Readonly<{
  providerName: string;
  sourceRecordId: string;
  sourceUrl: string;
  retrievedAt: string;
}>;

export type DemoTrustedVehicleFact = Readonly<{
  field:
    | "bodyStyle"
    | "vehicleCategory"
    | "drivetrain"
    | "transmission"
    | "fuelType"
    | "fuelEconomy"
    | "emissions"
    | "evRange"
    | "chargingSpeed";
  value: string | number;
  unit: string;
  confidence: DemoIntelligenceConfidence;
  evidenceIds: readonly string[];
  sources: readonly DemoIntelligenceSource[];
}>;

export type DemoSafetyIntelligence = Readonly<{
  ratingState: "RATED" | "NOT_RATED";
  sourceVehicleId: string;
  vehicleDescription: string;
  matchConfidence: number;
  ratings: Readonly<{
    overall: number | null;
    frontCrash: number | null;
    sideCrash: number | null;
    rollover: number | null;
    rolloverPossibilityRatio: number | null;
  }>;
  technology: Readonly<{
    electronicStabilityControl: string | null;
    forwardCollisionWarning: string | null;
    laneDepartureWarning: string | null;
  }>;
  source: DemoIntelligenceSource;
}>;

export type DemoReliabilityConcern = Readonly<{
  component: string;
  corroboration: string;
  confidence: DemoIntelligenceConfidence;
  evidenceCount: number;
}>;

export type DemoReliabilityIntelligence = Readonly<{
  assessmentId: string;
  sourceInterpretationId: string;
  concernLevel:
    | "INSUFFICIENT_EVIDENCE"
    | "NO_MEANINGFUL_SIGNAL"
    | "LIMITED_CONCERN"
    | "MEANINGFUL_CONCERN"
    | "ELEVATED_CONCERN";
  primaryConcerns: readonly DemoReliabilityConcern[];
  evidenceConfidence: DemoIntelligenceConfidence;
  applicabilityScope: "model_year";
  applicabilityConfidence: "MEDIUM" | "LOW" | "UNKNOWN";
  exposureAvailability: "AVAILABLE" | "UNAVAILABLE";
  exposureLimitation: string;
  comparativeReliabilitySupported: false;
  recommendationScoringEligible: false;
  source: DemoIntelligenceSource;
}>;

export type DemoVehicleIntelligenceRecord = Readonly<{
  vehicleId: string;
  displayName: string;
  publication: Readonly<{
    publicationId: string;
    recordVersion: number;
    publishedAt: string;
  }>;
  trustedFacts: readonly DemoTrustedVehicleFact[];
  safety: DemoSafetyIntelligence;
  reliability: DemoReliabilityIntelligence;
}>;

export type DemoVehicleIntelligenceSnapshot = Readonly<{
  schemaVersion: "1.0.0";
  snapshotId: string;
  goldenDatasetVersion: string;
  generatedAt: string;
  recommendationRuntimeConnected: false;
  sourceVersions: Readonly<{
    publishedRepositoryId: string;
    publishedRepositoryUpdatedAt: string;
    safetySnapshotAt: string;
    reliabilityPolicyVersion: string;
  }>;
  vehicles: readonly DemoVehicleIntelligenceRecord[];
}>;

export type VehicleIntelligenceViewModel =
  | Readonly<{
      available: false;
      vehicleId: string;
      message: string;
    }>
  | Readonly<{
      available: true;
      vehicleId: string;
      displayName: string;
      publicationLabel: string;
      trustedFacts: readonly Readonly<{ label: string; value: string; confidence: DemoIntelligenceConfidence }>[];
      safety: Readonly<{
        state: "rated" | "not_rated";
        statusText: string;
        ratingRows: readonly Readonly<{ label: string; value: string }>[];
        technology: readonly string[];
        confidenceText: string;
        source: DemoIntelligenceSource;
      }>;
      reliability: Readonly<{
        concernLabel: string;
        framing: string;
        primaryConcerns: readonly string[];
        confidenceText: string;
        scopeText: string;
        limitation: string;
        source: DemoIntelligenceSource;
      }>;
      confidenceItems: readonly Readonly<{ label: string; detail: string }>[];
      limitations: readonly string[];
      sources: readonly DemoIntelligenceSource[];
    }>;

export type VehicleIntelligenceViewModelInput = Readonly<{
  vehicleId: string;
  profile?: BuyerProfile;
}>;
