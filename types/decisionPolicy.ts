export const decisionPolicyDimensionValues = [
  "purchaseBudget",
  "monthlyPayment",
  "totalOwnershipBudget",
  "affordability",
  "maintenanceRisk",
  "insuranceCost",
  "fuelEnergyCost",
  "resaleValue",
  "reliability",
  "safety",
  "performance",
  "make",
  "bodyStyle",
  "fuelType",
  "drivetrain",
  "transmission",
  "seating",
  "modelYear",
  "mileage",
] as const;

export type DecisionPolicyDimension = (typeof decisionPolicyDimensionValues)[number];

export const decisionParticipationValues = [
  "enforced",
  "active",
  "deprioritized",
  "disabled",
  "unresolved",
] as const;

export type DecisionParticipation = (typeof decisionParticipationValues)[number];

export const decisionPolicySourceValues = [
  "user_explicit",
  "user_confirmed",
  "user_correction",
  "manual_edit",
  "model_interpretation",
  "deterministic_fallback",
  "inferred",
  "application_default",
] as const;

export type DecisionPolicySource = (typeof decisionPolicySourceValues)[number];

export const decisionPolicyConfirmationValues = [
  "explicit",
  "confirmed",
  "inferred",
  "defaulted",
] as const;

export type DecisionPolicyConfirmation = (typeof decisionPolicyConfirmationValues)[number];

export type DecisionParticipationPolicy = {
  dimension: DecisionPolicyDimension;
  participation: DecisionParticipation;
  importance?: number;
  source: DecisionPolicySource;
  confidence: number;
  confirmation: DecisionPolicyConfirmation;
  sourceText: string;
  messageRef: string;
  explanation: string;
};

export type DecisionParticipationPolicyMap = Partial<
  Record<DecisionPolicyDimension, DecisionParticipationPolicy>
>;

export type SemanticDecisionPolicyInstruction = {
  id: string;
  dimension: DecisionPolicyDimension;
  participation: DecisionParticipation;
  importance: number | null;
  sourceText: string;
  messageRef: string;
  status: "explicit" | "inferred" | "uncertain" | "contradicted" | "unresolved";
  confidence: number;
  interpretationSource:
    | "deterministic_recognition"
    | "model_interpretation"
    | "deterministic_fallback"
    | "prior_confirmed_context"
    | "user_correction";
  explanation: string;
  requiresConfirmation: boolean;
};
