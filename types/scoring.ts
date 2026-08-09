import type { ScoreWeights } from "./buyer";
import type {
  DecisionParticipation,
  DecisionPolicyDimension,
  DecisionPolicySource,
} from "./decisionPolicy";

export type ScoringCategory = keyof ScoreWeights;
export type EffectiveScoringMode = "weighted" | "constraint_only" | "needs_clarification";
export type EffectiveImportanceLevel = "low" | "normal" | "high" | "top";
export type ScoringDataAvailability = "available" | "unavailable";
export type ContributionDataStatus = "available" | "estimated" | "missing";

export type EffectiveScoringCategoryPolicy = {
  category: ScoringCategory;
  baseWeight: number;
  participation: DecisionParticipation;
  importance?: number;
  importanceLevel: EffectiveImportanceLevel;
  importanceMultiplier: number;
  participationMultiplier: number;
  effectiveRawWeight: number;
  normalizedEffectiveWeight: number;
  qualificationBehavior: "score_only" | "constraint_and_score" | "disabled" | "unresolved";
  scoringEnabled: boolean;
  reason: string;
  source: DecisionPolicySource;
  dataAvailability: ScoringDataAvailability;
  mayAppearInExplanations: boolean;
};

export type EffectiveHardConstraintPolicy = {
  dimension: DecisionPolicyDimension;
  participation: DecisionParticipation;
  enforced: boolean;
  source: DecisionPolicySource;
  reason: string;
};

export type EffectiveScoringPolicy = {
  mode: EffectiveScoringMode;
  targetWeightTotal: 100;
  categories: Record<ScoringCategory, EffectiveScoringCategoryPolicy>;
  effectiveWeights: ScoreWeights;
  effectiveHardConstraints: EffectiveHardConstraintPolicy[];
  disabledCategories: ScoringCategory[];
  unresolvedCategories: ScoringCategory[];
  positiveWeightTotal: number;
  legacyProfile: boolean;
  reason: string;
};

export type ScoreContributionRecord = {
  category: ScoringCategory;
  rawCategoryScore: number;
  normalizedCategoryScore: number;
  baseWeight: number;
  effectiveRawWeight: number;
  normalizedEffectiveWeight: number;
  weightedContribution: number;
  participation: DecisionParticipation;
  importance?: number;
  source: DecisionPolicySource;
  dataStatus: ContributionDataStatus;
  affectedRanking: boolean;
};
