import type { BuyerProfile } from "@/types/buyer";

export type BuyerProfilePatch = Partial<Omit<BuyerProfile, "scoreWeights">>;
export type PreferenceParserSource = "local" | "openai" | "fallback";
export type InterpretationConfidence = "high" | "medium" | "low";

export type PreferenceFact = {
  label: string;
  value: string;
  evidencePhrase: string;
  field?: keyof BuyerProfilePatch;
};

export type InferredPreference = {
  label: string;
  value: string;
  evidencePhrase: string;
  field?: keyof BuyerProfilePatch;
  requiresConfirmation: boolean;
};

export type PreferenceUncertainty = {
  topic: string;
  evidencePhrase: string;
  question: string;
};

export type PreferenceConflict = {
  topic: string;
  description: string;
  evidencePhrases: string[];
};

export type PreferenceFieldConfidence = {
  field: keyof BuyerProfilePatch;
  value: string | number | boolean;
  confidence: InterpretationConfidence;
  evidencePhrase: string;
  requiresConfirmation: boolean;
};

export type PreferenceInterpretation = {
  rawUserMessage: string;
  interpretationSummary: string;
  explicitFacts: PreferenceFact[];
  inferredPreferences: InferredPreference[];
  uncertainties: PreferenceUncertainty[];
  conflicts: PreferenceConflict[];
  confidenceByField: PreferenceFieldConfidence[];
  suggestedProfileUpdates: BuyerProfilePatch;
  nextClarifyingQuestion: string;
  parserSource: PreferenceParserSource;
};

const allowedPatchKeys = new Set<keyof BuyerProfilePatch>([
  "maxPurchaseBudget",
  "monthlyBudget",
  "downPayment",
  "loanTermMonths",
  "apr",
  "paymentMethod",
  "purchaseCondition",
  "expectedAnnualMileage",
  "fuelPrice",
  "insuranceBudget",
  "minYear",
  "maxMileage",
  "minMpg",
  "fuelEconomyImportance",
  "reliabilityImportance",
  "performanceImportance",
  "cargoNeed",
  "familySize",
  "drivetrainPreference",
  "transmissionPreference",
  "bodyStyle",
  "climate",
  "resaleValueImportance",
  "modificationPlans",
  "advancedFeaturesImportance",
  "safetyPriority",
  "requiredMake",
  "preferredMake",
  "requiredFuelType",
  "reliabilityMinimum",
  "safetyMinimum",
  "performanceMinimum",
  "flexibleConstraints",
  "allowCompromises",
]);

export function interpretPreferenceMessage(rawUserMessage: string): PreferenceInterpretation {
  return buildLocalInterpretation(rawUserMessage, "local");
}

export async function interpretPreferenceMessageWithOptionalAi(
  rawUserMessage: string,
  aiInterpreter?: (message: string) => Promise<unknown>,
): Promise<PreferenceInterpretation> {
  if (!aiInterpreter) return buildLocalInterpretation(rawUserMessage, "local");

  try {
    const candidate = await aiInterpreter(rawUserMessage);
    const validated = validatePreferenceInterpretation(candidate, rawUserMessage);
    if (validated) return { ...validated, parserSource: "openai" };
  } catch {
    // The deterministic local interpreter is the product fallback.
  }

  return buildLocalInterpretation(rawUserMessage, "fallback");
}

export function validatePreferenceInterpretation(
  value: unknown,
  rawUserMessage: string,
): PreferenceInterpretation | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const suggestedProfileUpdates = sanitizeProfilePatch(record.suggestedProfileUpdates);
  if (!suggestedProfileUpdates) return null;

  return {
    rawUserMessage,
    interpretationSummary: readString(record.interpretationSummary) || getVagueSummary(),
    explicitFacts: readFactList(record.explicitFacts),
    inferredPreferences: readInferredList(record.inferredPreferences),
    uncertainties: readUncertaintyList(record.uncertainties),
    conflicts: readConflictList(record.conflicts),
    confidenceByField: readConfidenceList(record.confidenceByField),
    suggestedProfileUpdates,
    nextClarifyingQuestion:
      readString(record.nextClarifyingQuestion) || "What is the maximum budget you want me to work within?",
    parserSource: "openai",
  };
}

function buildLocalInterpretation(rawUserMessage: string, parserSource: PreferenceParserSource): PreferenceInterpretation {
  const message = rawUserMessage.trim();
  const lower = message.toLowerCase();
  const explicitFacts: PreferenceFact[] = [];
  const inferredPreferences: InferredPreference[] = [];
  const uncertainties: PreferenceUncertainty[] = [];
  const conflicts: PreferenceConflict[] = [];
  const confidenceByField: PreferenceFieldConfidence[] = [];
  const suggestedProfileUpdates: BuyerProfilePatch = {};

  if (!message) {
    return {
      rawUserMessage,
      interpretationSummary:
        "I couldn't confidently interpret that yet. Let's start with your budget or the one thing you care about most.",
      explicitFacts: [],
      inferredPreferences: [],
      uncertainties: [
        {
          topic: "Starting point",
          evidencePhrase: "",
          question: "What is the maximum budget you want me to work within?",
        },
      ],
      conflicts: [],
      confidenceByField: [],
      suggestedProfileUpdates: {},
      nextClarifyingQuestion: "What is the maximum budget you want me to work within?",
      parserSource,
    };
  }

  const budget = getBudgetSignal(message);
  if (budget) {
    suggestedProfileUpdates.maxPurchaseBudget = budget.value;
    explicitFacts.push({
      label: budget.modifier === "around" ? "Approximate purchase budget" : "Purchase budget",
      value: `${budget.modifier === "around" ? "Around " : "Up to "}$${budget.value.toLocaleString()}`,
      evidencePhrase: budget.evidencePhrase,
      field: "maxPurchaseBudget",
    });
    confidenceByField.push({
      field: "maxPurchaseBudget",
      value: budget.value,
      confidence: budget.modifier === "around" ? "medium" : "high",
      evidencePhrase: budget.evidencePhrase,
      requiresConfirmation: budget.modifier === "around",
    });
  } else if (/\bcheap|affordable|costing too much|cannot spend much|budget\b/i.test(message)) {
    inferredPreferences.push({
      label: "Affordability matters",
      value: "The car should stay financially conservative.",
      evidencePhrase: findEvidence(message, /\bcheap|affordable|costing too much|cannot spend much|budget\b/i),
      requiresConfirmation: true,
    });
  }

  const monthly = getMonthlySignal(message);
  if (monthly) {
    suggestedProfileUpdates.monthlyBudget = monthly.value;
    explicitFacts.push({
      label: "Monthly budget",
      value: `$${monthly.value.toLocaleString()} per month`,
      evidencePhrase: monthly.evidencePhrase,
      field: "monthlyBudget",
    });
    confidenceByField.push({
      field: "monthlyBudget",
      value: monthly.value,
      confidence: "high",
      evidencePhrase: monthly.evidencePhrase,
      requiresConfirmation: false,
    });
  }

  const makeSignal = getMakeSignal(message);
  if (makeSignal) {
    if (makeSignal.required) suggestedProfileUpdates.requiredMake = makeSignal.make;
    else suggestedProfileUpdates.preferredMake = makeSignal.make;
    explicitFacts.push({
      label: makeSignal.required ? "Required make" : "Preferred make",
      value: makeSignal.make,
      evidencePhrase: makeSignal.evidencePhrase,
      field: makeSignal.required ? "requiredMake" : "preferredMake",
    });
    confidenceByField.push({
      field: makeSignal.required ? "requiredMake" : "preferredMake",
      value: makeSignal.make,
      confidence: makeSignal.required ? "high" : "medium",
      evidencePhrase: makeSignal.evidencePhrase,
      requiresConfirmation: !makeSignal.required,
    });
  }

  addConditionSignals(message, explicitFacts, confidenceByField, suggestedProfileUpdates);
  addBodyStyleSignals(message, explicitFacts, confidenceByField, suggestedProfileUpdates);
  addWeatherSignals(message, explicitFacts, inferredPreferences, confidenceByField, suggestedProfileUpdates);
  addFamilySignals(message, explicitFacts, inferredPreferences, confidenceByField, suggestedProfileUpdates);
  addSafetySignals(message, explicitFacts, inferredPreferences, confidenceByField, suggestedProfileUpdates);
  addPerformanceSignals(message, inferredPreferences, uncertainties, confidenceByField, suggestedProfileUpdates);
  addReliabilitySignals(message, explicitFacts, inferredPreferences, confidenceByField, suggestedProfileUpdates);
  addStyleSignals(message, inferredPreferences);
  addPracticalitySignals(message, inferredPreferences, confidenceByField, suggestedProfileUpdates);
  addFuelTypeSignals(message, explicitFacts, confidenceByField, suggestedProfileUpdates);

  addConflictSignals(message, makeSignal?.make, conflicts);

  if (isExtremelyVague(lower, explicitFacts, inferredPreferences)) {
    uncertainties.push({
      topic: "Core requirement",
      evidencePhrase: message,
      question: "What is the maximum budget you want me to work within?",
    });
  }

  const nextClarifyingQuestion = selectClarifyingQuestion(message, uncertainties, conflicts, budget);

  return {
    rawUserMessage,
    interpretationSummary: buildInterpretationSummary(explicitFacts, inferredPreferences, conflicts),
    explicitFacts,
    inferredPreferences,
    uncertainties,
    conflicts,
    confidenceByField: dedupeConfidence(confidenceByField),
    suggestedProfileUpdates: sanitizeLocalPatch(suggestedProfileUpdates),
    nextClarifyingQuestion,
    parserSource,
  };
}

function addConditionSignals(
  message: string,
  explicitFacts: PreferenceFact[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const used = findEvidence(message, /\bused|pre[-\s]?owned\b/i);
  const isNew = findEvidence(message, /\bnew\b/i);
  if (used) {
    suggestedProfileUpdates.purchaseCondition = "used";
    explicitFacts.push({ label: "Purchase condition", value: "Used", evidencePhrase: used, field: "purchaseCondition" });
    confidenceByField.push({
      field: "purchaseCondition",
      value: "used",
      confidence: "high",
      evidencePhrase: used,
      requiresConfirmation: false,
    });
  } else if (isNew) {
    suggestedProfileUpdates.purchaseCondition = "new";
    explicitFacts.push({ label: "Purchase condition", value: "New", evidencePhrase: isNew, field: "purchaseCondition" });
    confidenceByField.push({
      field: "purchaseCondition",
      value: "new",
      confidence: "medium",
      evidencePhrase: isNew,
      requiresConfirmation: true,
    });
  }
}

function addBodyStyleSignals(
  message: string,
  explicitFacts: PreferenceFact[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const bodyStyles: Array<[NonNullable<BuyerProfilePatch["bodyStyle"]>, RegExp]> = [
    ["suv", /\bsuv|crossover\b/i],
    ["sedan", /\bsedan\b/i],
    ["hatchback", /\bhatchback|hatch\b/i],
    ["truck", /\btruck|pickup\b/i],
    ["coupe", /\bcoupe|two door|2 door\b/i],
    ["convertible", /\bconvertible|cabriolet\b/i],
    ["wagon", /\bwagon|estate\b/i],
    ["minivan", /\bminivan|mini van|family van\b/i],
  ];
  const match = bodyStyles.map(([value, pattern]) => ({ value, evidence: findEvidence(message, pattern) })).find((entry) => entry.evidence);
  if (!match?.evidence) return;
  const strength = getMentionStrength(message, match.evidence);
  suggestedProfileUpdates.bodyStyle = match.value;
  explicitFacts.push({
    label: strength === "preferred" ? "Preferred body style" : "Required body style",
    value: match.value.toUpperCase(),
    evidencePhrase: match.evidence,
    field: "bodyStyle",
  });
  confidenceByField.push({
    field: "bodyStyle",
    value: match.value,
    confidence: strength === "preferred" ? "medium" : "high",
    evidencePhrase: match.evidence,
    requiresConfirmation: strength === "preferred",
  });
}

function addWeatherSignals(
  message: string,
  explicitFacts: PreferenceFact[],
  inferredPreferences: InferredPreference[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const snow = findEvidence(message, /\bsnow|ice|winter|mountains?\b/i);
  const rain = findEvidence(message, /\brain|wet\b/i);
  if (snow) {
    suggestedProfileUpdates.climate = "snow";
    explicitFacts.push({ label: "Climate", value: "Snow or ice", evidencePhrase: snow, field: "climate" });
    confidenceByField.push({
      field: "climate",
      value: "snow",
      confidence: "high",
      evidencePhrase: snow,
      requiresConfirmation: false,
    });
    inferredPreferences.push({
      label: "Bad-weather confidence matters",
      value: "Winter driving likely raises the value of traction and stability.",
      evidencePhrase: snow,
      requiresConfirmation: true,
    });
  } else if (rain) {
    suggestedProfileUpdates.climate = "rain";
    explicitFacts.push({ label: "Climate", value: "Rain often", evidencePhrase: rain, field: "climate" });
    confidenceByField.push({
      field: "climate",
      value: "rain",
      confidence: "high",
      evidencePhrase: rain,
      requiresConfirmation: false,
    });
  }

  const awd = findEvidence(message, /\bawd|all[-\s]?wheel\b/i);
  const fourWheel = findEvidence(message, /\b4wd|four[-\s]?wheel\b/i);
  if (awd || fourWheel) {
    const value = awd ? "AWD" : "4WD";
    const evidence = awd || fourWheel || "";
    const strength = getMentionStrength(message, evidence);
    suggestedProfileUpdates.drivetrainPreference = value;
    explicitFacts.push({
      label: strength === "preferred" ? "Preferred drivetrain" : "Required drivetrain",
      value,
      evidencePhrase: evidence,
      field: "drivetrainPreference",
    });
    confidenceByField.push({
      field: "drivetrainPreference",
      value,
      confidence: strength === "preferred" ? "medium" : "high",
      evidencePhrase: evidence,
      requiresConfirmation: strength === "preferred",
    });
  }
}

function addFamilySignals(
  message: string,
  explicitFacts: PreferenceFact[],
  inferredPreferences: InferredPreference[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const familySize = message.match(/(?:family of|seat|seats|people)\s*(\d+)/i);
  if (familySize) {
    const size = Number(familySize[1]);
    if (Number.isFinite(size) && size >= 1 && size <= 9) {
      suggestedProfileUpdates.familySize = size;
      explicitFacts.push({
        label: "Passenger need",
        value: `${size} people`,
        evidencePhrase: familySize[0],
        field: "familySize",
      });
      confidenceByField.push({
        field: "familySize",
        value: size,
        confidence: "high",
        evidencePhrase: familySize[0],
        requiresConfirmation: false,
      });
    }
  }

  const family = findEvidence(message, /\bfamily|kids|children\b/i);
  if (family) {
    inferredPreferences.push({
      label: "Family practicality matters",
      value: "Passenger space and easy daily use should carry more weight.",
      evidencePhrase: family,
      requiresConfirmation: familySize == null,
    });
    if (!suggestedProfileUpdates.cargoNeed) suggestedProfileUpdates.cargoNeed = "high";
    confidenceByField.push({
      field: "cargoNeed",
      value: "high",
      confidence: "medium",
      evidencePhrase: family,
      requiresConfirmation: true,
    });
  }
}

function addSafetySignals(
  message: string,
  explicitFacts: PreferenceFact[],
  inferredPreferences: InferredPreference[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const safest = findEvidence(message, /\bmaximum safety|safety maximum|max safety|safest\b/i);
  const safe = findEvidence(message, /\bsafe|safety|first car\b/i);
  if (safest) {
    suggestedProfileUpdates.safetyPriority = "maximum";
    explicitFacts.push({ label: "Safety priority", value: "Maximum", evidencePhrase: safest, field: "safetyPriority" });
    confidenceByField.push({
      field: "safetyPriority",
      value: "maximum",
      confidence: "high",
      evidencePhrase: safest,
      requiresConfirmation: false,
    });
  } else if (safe) {
    suggestedProfileUpdates.safetyPriority = "high";
    explicitFacts.push({ label: "Safety priority", value: "High", evidencePhrase: safe, field: "safetyPriority" });
    confidenceByField.push({
      field: "safetyPriority",
      value: "high",
      confidence: "medium",
      evidencePhrase: safe,
      requiresConfirmation: true,
    });
  }

  const firstCar = findEvidence(message, /\bfirst car\b/i);
  if (firstCar) {
    inferredPreferences.push({
      label: "First-car risk should stay low",
      value: "A forgiving, safe, low-drama vehicle is likely more useful than a fragile one.",
      evidencePhrase: firstCar,
      requiresConfirmation: false,
    });
  }
}

function addPerformanceSignals(
  message: string,
  inferredPreferences: InferredPreference[],
  uncertainties: PreferenceUncertainty[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const performance = findEvidence(message, /\bpowerful|fast|sporty|fun|exciting|good handling|handles well\b/i);
  if (!performance) return;

  suggestedProfileUpdates.performanceImportance = 5;
  inferredPreferences.push({
    label: "Driving enjoyment matters",
    value: "The car should feel more engaging than basic transportation.",
    evidencePhrase: performance,
    field: "performanceImportance",
    requiresConfirmation: true,
  });
  confidenceByField.push({
    field: "performanceImportance",
    value: 5,
    confidence: /\bpowerful\b/i.test(performance) ? "low" : "medium",
    evidencePhrase: performance,
    requiresConfirmation: true,
  });

  if (/\bpowerful\b/i.test(performance)) {
    uncertainties.push({
      topic: "Meaning of powerful",
      evidencePhrase: performance,
      question: "When you say powerful, do you mean quick acceleration, sporty handling, or a larger and more capable vehicle?",
    });
  }
}

function addReliabilitySignals(
  message: string,
  explicitFacts: PreferenceFact[],
  inferredPreferences: InferredPreference[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const reliable = findEvidence(message, /\breliable|dependable|low repair risk|won.?t break|peace of mind\b/i);
  const lowMaintenance = findEvidence(message, /\bexpensive repairs|low maintenance|cheap repairs|repairs cannot be expensive\b/i);
  if (reliable) {
    suggestedProfileUpdates.reliabilityImportance = 5;
    explicitFacts.push({
      label: "Reliability preference",
      value: "Reliability matters",
      evidencePhrase: reliable,
      field: "reliabilityImportance",
    });
    confidenceByField.push({
      field: "reliabilityImportance",
      value: 5,
      confidence: "high",
      evidencePhrase: reliable,
      requiresConfirmation: false,
    });
  }
  if (lowMaintenance) {
    if (!suggestedProfileUpdates.reliabilityImportance) suggestedProfileUpdates.reliabilityImportance = 4;
    inferredPreferences.push({
      label: "Low ownership risk matters",
      value: "Repair and maintenance costs should stay conservative.",
      evidencePhrase: lowMaintenance,
      field: "reliabilityImportance",
      requiresConfirmation: true,
    });
    confidenceByField.push({
      field: "reliabilityImportance",
      value: suggestedProfileUpdates.reliabilityImportance,
      confidence: "medium",
      evidencePhrase: lowMaintenance,
      requiresConfirmation: true,
    });
  }
}

function addStyleSignals(message: string, inferredPreferences: InferredPreference[]) {
  const style = findEvidence(message, /\blooks expensive|premium|stylish|cool|aggressive|understated\b/i);
  if (!style) return;
  inferredPreferences.push({
    label: "Design and image matter",
    value: "The car should feel more premium or distinctive than a purely practical choice.",
    evidencePhrase: style,
    requiresConfirmation: true,
  });
}

function addPracticalitySignals(
  message: string,
  inferredPreferences: InferredPreference[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const practical = findEvidence(message, /\bcargo|road trips?|school commute|daily driver|commuter|camping|gear\b/i);
  if (!practical) return;
  inferredPreferences.push({
    label: "Everyday practicality matters",
    value: "The car should be easy to live with in regular use.",
    evidencePhrase: practical,
    requiresConfirmation: true,
  });
  if (/\bcargo|road trips?|camping|gear\b/i.test(practical)) {
    suggestedProfileUpdates.cargoNeed = "high";
    confidenceByField.push({
      field: "cargoNeed",
      value: "high",
      confidence: "medium",
      evidencePhrase: practical,
      requiresConfirmation: true,
    });
  }
}

function getMentionStrength(message: string, evidence: string): "required" | "preferred" {
  const index = message.toLowerCase().indexOf(evidence.toLowerCase());
  const start = Math.max(0, index - 22);
  const end = Math.min(message.length, index + evidence.length + 22);
  const nearby = message.slice(start, end);
  if (/\b(prefer|preferred|like|would be nice|ideally|if possible)\b/i.test(nearby)) return "preferred";
  return "required";
}

function addFuelTypeSignals(
  message: string,
  explicitFacts: PreferenceFact[],
  confidenceByField: PreferenceFieldConfidence[],
  suggestedProfileUpdates: BuyerProfilePatch,
) {
  const hybrid = findEvidence(message, /\bhybrid\b/i);
  const electric = findEvidence(message, /\belectric|ev\b/i);
  if (!hybrid && !electric) return;
  const value = hybrid ? "hybrid" : "electric";
  const evidence = hybrid || electric || "";
  suggestedProfileUpdates.requiredFuelType = value;
  explicitFacts.push({ label: "Fuel type", value, evidencePhrase: evidence, field: "requiredFuelType" });
  confidenceByField.push({
    field: "requiredFuelType",
    value,
    confidence: "high",
    evidencePhrase: evidence,
    requiresConfirmation: false,
  });
}

function addConflictSignals(message: string, make: string | undefined, conflicts: PreferenceConflict[]) {
  const performance = findEvidence(message, /\bpowerful|fast|sporty|fun|exciting|good handling\b/i);
  const lowMaintenance = findEvidence(message, /\bexpensive repairs|low maintenance|cheap repairs|repairs cannot be expensive\b/i);
  const lowBudget = findEvidence(message, /\bcheap|affordable|under\s*\$?\s*\d|costing too much|cannot spend much\b/i);
  const premium = findEvidence(message, /\bbmw|mercedes|audi|lexus|premium|luxury|looks expensive\b/i);

  if (performance && lowMaintenance) {
    conflicts.push({
      topic: "Performance versus ownership risk",
      description: "Higher-performance cars can cost more to insure, repair, and maintain.",
      evidencePhrases: [performance, lowMaintenance],
    });
  }
  if ((make || premium) && lowMaintenance) {
    conflicts.push({
      topic: "Premium preference versus repair cost",
      description: "Luxury or premium-brand cars can work against a low-repair-cost goal.",
      evidencePhrases: [make || premium || "", lowMaintenance],
    });
  }
  if (premium && lowBudget) {
    conflicts.push({
      topic: "Premium image versus low budget",
      description: "A premium look can narrow the safe, reliable choices if the budget is strict.",
      evidencePhrases: [premium, lowBudget],
    });
  }
}

function selectClarifyingQuestion(
  message: string,
  uncertainties: PreferenceUncertainty[],
  conflicts: PreferenceConflict[],
  budget: ReturnType<typeof getBudgetSignal>,
) {
  const powerful = uncertainties.find((uncertainty) => uncertainty.topic === "Meaning of powerful");
  if (powerful) return powerful.question;
  if (/\bbmw\b/i.test(message) && /repair|maintenance/i.test(message)) {
    return "Would you prefer a BMW only if ownership costs stay reasonable, or is the BMW badge non-negotiable?";
  }
  if (conflicts[0]) return "Which matters more if those goals compete: the emotional choice or the lower-risk ownership choice?";
  if (!budget) return "What is the maximum budget you want me to work within?";
  return "Will this car mostly be used for commuting, school, family driving, or bad weather?";
}

function buildInterpretationSummary(explicitFacts: PreferenceFact[], inferredPreferences: InferredPreference[], conflicts: PreferenceConflict[]) {
  if (!explicitFacts.length && !inferredPreferences.length) return getVagueSummary();

  const hasPerformance = inferredPreferences.some((preference) => preference.label === "Driving enjoyment matters");
  const hasLowRisk = inferredPreferences.some((preference) => preference.label === "Low ownership risk matters");
  const hasFirstCar = inferredPreferences.some((preference) => preference.label === "First-car risk should stay low");
  const hasBudget = explicitFacts.some((fact) => fact.field === "maxPurchaseBudget");
  const hasSafety = explicitFacts.some((fact) => fact.field === "safetyPriority");
  const preferredMake = explicitFacts.find((fact) => fact.field === "preferredMake");

  if (hasPerformance && hasLowRisk) {
    return "You want a car that feels exciting without creating high ownership risk.";
  }
  if (preferredMake && hasLowRisk) {
    return `You prefer ${preferredMake.value}, but you want repair and maintenance risk kept conservative.`;
  }
  if (hasBudget && hasSafety && hasFirstCar) {
    return "You want a safe first car that stays inside a clear purchase budget.";
  }
  if (hasPerformance) {
    return "You want a car that feels more engaging than basic transportation, but I need to confirm what kind of power matters to you.";
  }

  const goals = [...explicitFacts.slice(0, 2).map((fact) => fact.value), ...inferredPreferences.slice(0, 2).map((pref) => pref.value)];
  const summary = `You are describing a car search focused on ${formatList(goals)}.`;
  if (conflicts.length) return `${summary} I also see a tradeoff that should be checked before turning this into recommendations.`;
  return summary;
}

function getVagueSummary() {
  return "I can start there, but I need one or two concrete details before this becomes a responsible car search.";
}

function getBudgetSignal(message: string) {
  const budgetPattern =
    /\b(?:(under|below|less than|max(?:imum)?|up to|around|about)\s*)?\$?\s*(\d{1,3}(?:,\d{3})|\d{4,6}|\d{1,3})\s*(k)?\b(?=[\s.,!?]*(?:budget|car|vehicle|dollars?|usd))/i;
  const directPattern = /\$\s*(\d{1,3}(?:,\d{3})|\d{4,6}|\d{1,3})\s*(k)?/i;
  const match = message.match(directPattern) || message.match(budgetPattern);
  if (!match) return null;
  const modifier = String(match[1] || "").toLowerCase();
  const amountText = match[2] || match[1];
  const hasK = Boolean(match[3] || (!match[3] && /\d+\s*k\b/i.test(match[0])));
  const value = parseMoney(amountText, hasK);
  if (!value || value < 1000) return null;
  return {
    value,
    modifier: /around|about/.test(modifier) ? "around" : "maximum",
    evidencePhrase: match[0].trim(),
  };
}

function getMonthlySignal(message: string) {
  const match = message.match(/\$?\s*(\d{2,4})\s*(?:\/\s*)?(?:per\s*)?(?:month|mo|monthly)/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, evidencePhrase: match[0].trim() };
}

function getMakeSignal(message: string) {
  const match = message.match(/\b(?:bmw|toyota|honda|mazda|lexus|subaru|ford|chevrolet|chevy|hyundai|kia|nissan|audi|mercedes)\b/i);
  if (!match) return null;
  const nearbyStart = Math.max(0, match.index ? match.index - 18 : 0);
  const nearbyEnd = Math.min(message.length, (match.index || 0) + match[0].length + 18);
  const nearbyPhrase = message.slice(nearbyStart, nearbyEnd).trim();
  const required = /\b(must|only|required|require|has to be|need)\b/i.test(nearbyPhrase);
  return {
    make: normalizeMake(match[0]),
    required,
    evidencePhrase: match[0],
  };
}

function parseMoney(amountText: string, hasK: boolean) {
  const numeric = Number(amountText.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return hasK || numeric < 1000 ? numeric * 1000 : numeric;
}

function normalizeMake(make: string) {
  const lower = make.toLowerCase();
  if (lower === "chevy") return "Chevrolet";
  if (lower === "bmw") return "BMW";
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function isExtremelyVague(lower: string, explicitFacts: PreferenceFact[], inferredPreferences: InferredPreference[]) {
  return explicitFacts.length === 0 && inferredPreferences.length === 0 && /\b(car|vehicle|something)\b/.test(lower);
}

function findEvidence(message: string, pattern: RegExp) {
  return message.match(pattern)?.[0] || "";
}

function formatList(values: string[]) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (!unique.length) return "a few early preferences";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function dedupeConfidence(confidence: PreferenceFieldConfidence[]) {
  const seen = new Set<string>();
  return confidence.filter((entry) => {
    const key = `${entry.field}:${entry.value}:${entry.evidencePhrase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeLocalPatch(patch: BuyerProfilePatch): BuyerProfilePatch {
  const sanitized = sanitizeProfilePatch(patch);
  return sanitized || {};
}

function sanitizeProfilePatch(value: unknown): BuyerProfilePatch | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const sanitized: BuyerProfilePatch = {};
  for (const [key, fieldValue] of Object.entries(record)) {
    if (!allowedPatchKeys.has(key as keyof BuyerProfilePatch)) return null;
    (sanitized as Record<string, unknown>)[key] = fieldValue;
  }
  return sanitized;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readFactList(value: unknown): PreferenceFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const label = readString(record.label);
    const factValue = readString(record.value);
    const evidencePhrase = readString(record.evidencePhrase);
    if (!label || !factValue) return [];
    return [{ label, value: factValue, evidencePhrase, field: record.field as keyof BuyerProfilePatch | undefined }];
  });
}

function readInferredList(value: unknown): InferredPreference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const label = readString(record.label);
    const prefValue = readString(record.value);
    const evidencePhrase = readString(record.evidencePhrase);
    if (!label || !prefValue) return [];
    return [
      {
        label,
        value: prefValue,
        evidencePhrase,
        field: record.field as keyof BuyerProfilePatch | undefined,
        requiresConfirmation: Boolean(record.requiresConfirmation),
      },
    ];
  });
}

function readUncertaintyList(value: unknown): PreferenceUncertainty[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const topic = readString(record.topic);
    const question = readString(record.question);
    if (!topic || !question) return [];
    return [{ topic, question, evidencePhrase: readString(record.evidencePhrase) }];
  });
}

function readConflictList(value: unknown): PreferenceConflict[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const topic = readString(record.topic);
    const description = readString(record.description);
    if (!topic || !description) return [];
    return [
      {
        topic,
        description,
        evidencePhrases: Array.isArray(record.evidencePhrases) ? record.evidencePhrases.filter((phrase) => typeof phrase === "string") : [],
      },
    ];
  });
}

function readConfidenceList(value: unknown): PreferenceFieldConfidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    const field = record.field as keyof BuyerProfilePatch;
    const confidence = record.confidence;
    if (!allowedPatchKeys.has(field) || !["high", "medium", "low"].includes(String(confidence))) return [];
    return [
      {
        field,
        value: typeof record.value === "number" || typeof record.value === "boolean" || typeof record.value === "string" ? record.value : "",
        confidence: confidence as InterpretationConfidence,
        evidencePhrase: readString(record.evidencePhrase),
        requiresConfirmation: Boolean(record.requiresConfirmation),
      },
    ];
  });
}
