import assert from "node:assert/strict";
import {
  answerConversationQuestionWithSemantic,
  answerConversationQuestion,
  createDeterministicSemanticConversationIntakeSession,
  createSemanticConversationIntakeSession,
  createConversationIntakeSession,
  prepareConversationRevisionSession,
  requestAnotherConversationQuestion,
  skipConversationQuestion,
  type ConversationIntakeSession,
} from "../lib/conversationIntake";
import {
  approveConfirmedPreferenceProfile,
  createConfirmedPreferenceProfile,
} from "../lib/confirmedPreferenceProfile";
import { convertConfirmedPreferencesToBuyerProfile } from "../lib/confirmedProfileConversion";
import { assessConfirmedProfileConversionReadiness } from "../lib/recommendationReadiness";
import { defaultScoreWeights } from "../lib/recommendations";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";
import {
  createEmptyUnderstandingDraft,
  type SemanticUnderstandingProvider,
  type SemanticUnderstandingRequest,
  type SemanticUnderstandingResult,
  type UnderstandingDraft,
} from "../lib/semanticUnderstanding";
import type { BuyerProfile } from "../types/buyer";

const defaultProfile: BuyerProfile = {
  maxPurchaseBudget: 18000,
  monthlyBudget: 650,
  downPayment: 2000,
  loanTermMonths: 60,
  apr: 8.5,
  paymentMethod: "not-sure",
  purchaseCondition: "any",
  expectedAnnualMileage: 9000,
  fuelPrice: 4.25,
  insuranceBudget: 145,
  minYear: 2014,
  maxMileage: 110000,
  minMpg: 24,
  fuelEconomyImportance: 3,
  reliabilityImportance: 4,
  performanceImportance: 2,
  cargoNeed: "not-sure",
  familySize: 1,
  drivetrainPreference: "any",
  transmissionPreference: "any",
  bodyStyle: "any",
  climate: "not-sure",
  resaleValueImportance: 3,
  modificationPlans: "not-sure",
  advancedFeaturesImportance: 3,
  safetyPriority: "not-sure",
  scoreWeights: defaultScoreWeights,
};

const performance = createConversationIntakeSession("I want something powerful.");
assert.equal(performance.currentQuestion?.id, "performance_meaning");
const performanceAnswered = answerConversationQuestion(performance, "Quick acceleration and good handling.");
assert.equal(performanceAnswered.accumulatedInterpretation.suggestedProfileUpdates.performanceImportance, 5);
assert.ok(hasPreference(performanceAnswered, "Acceleration matters"));
assert.ok(hasPreference(performanceAnswered, "Handling matters"));
assert.equal(hasPreference(performanceAnswered, "Vehicle capability matters"), false);
assert.equal(hasUncertainty(performanceAnswered, "Meaning of powerful"), false);

const bmw = createConversationIntakeSession("I want a BMW, but repairs cannot be expensive.");
assert.equal(bmw.currentQuestion?.id, "make_flexibility");
const bmwAnswered = answerConversationQuestion(bmw, "The badge isn't required. I mainly like the style.");
assert.equal(bmwAnswered.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, "BMW");
assert.equal(bmwAnswered.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
assert.equal(bmwAnswered.accumulatedInterpretation.suggestedProfileUpdates.reliabilityImportance, 4);
assert.ok(hasPreference(bmwAnswered, "Design and image matter"));
assert.equal(hasConflict(bmwAnswered, "Premium preference versus repair cost"), false);

const safe = createConversationIntakeSession("I want something safe.");
assert.equal(safe.currentQuestion?.id, "budget_max");
const safeRevision = requestAnotherConversationQuestion(
  prepareConversationRevisionSession(safe, {
    ...defaultProfile,
    maxPurchaseBudget: 40000,
  }),
);
assert.notEqual(safeRevision.currentQuestion?.id, "budget_max");
assert.equal(safeRevision.baselineProfile?.maxPurchaseBudget, 40000);
const safeBudget = answerConversationQuestion(safe, "$15,000 maximum.");
assert.equal(safeBudget.accumulatedInterpretation.suggestedProfileUpdates.maxPurchaseBudget, 15000);
assert.equal(safeBudget.confirmedProfileUpdates.maxPurchaseBudget, 15000);
assert.equal(safeBudget.accumulatedInterpretation.suggestedProfileUpdates.monthlyBudget, undefined);
assert.ok(hasFact(safeBudget, "Purchase budget"));

const winter = createConversationIntakeSession("I need something for winter.");
assert.equal(winter.currentQuestion?.id, "winter_traction");
const winterAnswered = answerConversationQuestion(winter, "I drive in snow every day, so AWD is required.");
assert.equal(winterAnswered.accumulatedInterpretation.suggestedProfileUpdates.climate, "snow");
assert.equal(winterAnswered.accumulatedInterpretation.suggestedProfileUpdates.drivetrainPreference, "AWD");
assert.equal(winterAnswered.confirmedProfileUpdates.drivetrainPreference, "AWD");
assert.ok(hasFact(winterAnswered, "Required drivetrain"));

const lowCost = createConversationIntakeSession("I want something affordable and not costing too much.");
assert.equal(lowCost.currentQuestion?.id, "budget_max");
const lowCostBudget = answerConversationQuestion(lowCost, "$12,000 max.");
const reliabilityCorrection = answerConversationQuestion(lowCostBudget, "I'm willing to pay more if it is much more reliable.");
assert.ok(hasPreference(reliabilityCorrection, "Affordability matters"));
assert.equal(reliabilityCorrection.accumulatedInterpretation.suggestedProfileUpdates.reliabilityImportance, 5);
assert.equal(reliabilityCorrection.accumulatedInterpretation.suggestedProfileUpdates.allowCompromises, true);
assert.ok(hasConflict(reliabilityCorrection, "Affordability versus reliability flexibility"));

const skipped = createConversationIntakeSession("I want something powerful.");
const skippedNext = skipConversationQuestion(skipped);
assert.ok(skippedNext.skippedQuestionIds.includes("performance_meaning"));
assert.equal(hasUncertainty(skippedNext, "Meaning of powerful"), true);
assert.notEqual(skippedNext.interpretationConfidence, "high");
assert.equal(skippedNext.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, undefined);

let threeTurn = createConversationIntakeSession("I want something powerful.");
threeTurn = answerConversationQuestion(threeTurn, "Quick acceleration and good handling.");
assert.equal(threeTurn.currentQuestion?.id, "budget_max");
threeTurn = answerConversationQuestion(threeTurn, "$16,000 firm limit.");
assert.equal(threeTurn.currentQuestion?.id, "daily_use");
threeTurn = answerConversationQuestion(threeTurn, "Mostly school commute and daily driving.");
assert.equal(threeTurn.currentQuestion, null);
assert.equal(threeTurn.intakeStatus, "ready_for_confirmation");
assert.equal(threeTurn.answeredQuestionIds.length, 3);
assert.ok(threeTurn.conversationTurns.length >= 8);
assertNoRecommendationPayload(threeTurn);

for (const input of ["I want a Tesla.", "I only want Cadillac."]) {
  const terminalNoMatch = createDeterministicSemanticConversationIntakeSession(input);
  assert.equal(
    terminalNoMatch.currentQuestion,
    null,
    `${input} must not trigger a question that cannot make the required make available`,
  );
  assert.ok(
    terminalNoMatch.accumulatedInterpretation.suggestedProfileUpdates.requiredMakes?.length
      || terminalNoMatch.accumulatedInterpretation.suggestedProfileUpdates.requiredMake,
    `${input} must preserve the required make for honest no-match handling`,
  );
}

for (const input of ["motorcycle", "I want an ATV."]) {
  const outOfScope = createDeterministicSemanticConversationIntakeSession(input);
  assert.equal(
    outOfScope.currentQuestion,
    null,
    `${input} must not prepare an irrelevant car-buying clarification`,
  );
}

const ambiguousFuelChoice = createDeterministicSemanticConversationIntakeSession("Hybrid or electric.");
assert.equal(
  ambiguousFuelChoice.currentQuestion?.id,
  "relationship_intent",
  "Ambiguous supported options must be clarified before unrelated budget questions",
);
const allowedFuelChoice = answerConversationQuestion(
  ambiguousFuelChoice,
  "Both are acceptable.",
);
assert.deepEqual(
  allowedFuelChoice.accumulatedInterpretation.suggestedProfileUpdates.allowedFuelTypes?.slice().sort(),
  ["electric", "hybrid"],
);

console.log("Conversation intake loop passed.");
console.log("Sample conversations:");
printConversation("powerful -> acceleration and handling", performanceAnswered);
printConversation("BMW -> brand flexible, style important", bmwAnswered);
printConversation("safe car -> firm budget", safeBudget);

function hasPreference(session: ConversationIntakeSession, label: string) {
  return session.accumulatedInterpretation.inferredPreferences.some((preference) => preference.label === label);
}

function hasFact(session: ConversationIntakeSession, label: string) {
  return session.accumulatedInterpretation.explicitFacts.some((fact) => fact.label === label);
}

function hasConflict(session: ConversationIntakeSession, topic: string) {
  return session.unresolvedConflicts.some((conflict) => conflict.topic === topic);
}

function hasUncertainty(session: ConversationIntakeSession, topic: string) {
  return session.unresolvedUncertainties.some((uncertainty) => uncertainty.topic === topic);
}

function assertNoRecommendationPayload(session: ConversationIntakeSession) {
  const record = session as unknown as Record<string, unknown>;
  assert.equal(record.recommendations, undefined);
  assert.equal(record.rankedVehicles, undefined);
  assert.equal(record.vehicleResults, undefined);
}

function printConversation(label: string, session: ConversationIntakeSession) {
  console.log(label);
  session.conversationTurns.forEach((turn) => {
    console.log(`  ${turn.role}: ${turn.text}`);
  });
  console.log(`  final updates: ${JSON.stringify(session.accumulatedInterpretation.suggestedProfileUpdates)}`);
}

async function runSemanticConversationExamples() {
  const service = createSemanticUnderstandingService({
    providers: { fixture: new ConversationFixtureProvider() },
  });

  const oldEstablished = createConversationIntakeSession("I want something that makes me feel like I've finally made it.");
  const semanticEstablished = await createSemanticConversationIntakeSession(
    "I want something that makes me feel like I've finally made it.",
    service,
  );
  assert.equal(hasPreference(oldEstablished, "Image matters"), false);
  assert.ok(hasPreference(semanticEstablished, "Image matters"));
  assert.equal(semanticEstablished.confirmedProfileUpdates.preferredMake, undefined);

  const oldExpensive = createConversationIntakeSession("I want something that feels expensive without costing a fortune.");
  const semanticExpensive = await createSemanticConversationIntakeSession(
    "I want something that feels expensive without costing a fortune.",
    service,
  );
  assert.ok(hasPreference(semanticExpensive, "Premium feel matters"));
  assert.ok(hasPreference(semanticExpensive, "Repair risk matters") || hasPreference(semanticExpensive, "Image matters"));
  assert.equal(oldExpensive.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);

  const downtownTruck = await createSemanticConversationIntakeSession("I want a truck feeling but I live downtown.", service);
  assert.ok(hasConflict(downtownTruck, "Truck feel versus city use"));

  const bmwReliability = await createSemanticConversationIntakeSession("I've always liked BMW but reliability worries me.", service);
  assert.equal(bmwReliability.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, "BMW");
  assert.equal(bmwReliability.currentQuestion?.id, "make_flexibility");

  const contextStart = await createSemanticConversationIntakeSession("I want something powerful.", service);
  const contextAnswer = await answerConversationQuestionWithSemantic(
    contextStart,
    "I mainly want confidence passing slower traffic on the freeway.",
    service,
  );
  assert.ok(hasPreference(contextAnswer, "Acceleration matters"));
  assert.equal(contextAnswer.accumulatedInterpretation.suggestedProfileUpdates.performanceImportance, 5);

  const vague = await createSemanticConversationIntakeSession("I don't know anything about cars.", service);
  assert.equal(vague.accumulatedInterpretation.suggestedProfileUpdates.maxPurchaseBudget, undefined);
  assert.ok(vague.currentQuestion, "vague messages should ask a clarification instead of fabricating a profile");

  const fallbackService = createSemanticUnderstandingService({ env: {} as unknown as NodeJS.ProcessEnv });
  const toyota = await createSemanticConversationIntakeSession("I want a Toyota.", fallbackService);
  assert.equal(toyota.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Toyota");
  const toyotaConversion = convertConfirmedPreferencesToBuyerProfile(
    defaultProfile,
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(toyota, defaultProfile), 99),
  );
  assert.equal(toyotaConversion.buyerProfile.requiredMake, "Toyota");

  for (const input of ["I want a Cadillac", "show me Cadillacs", "I want a Caddy"]) {
    const cadillac = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(cadillac.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Cadillac", `${input} should reach the conversation as required Cadillac`);
    const cadillacConversion = convertConfirmedPreferencesToBuyerProfile(
      defaultProfile,
      approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(cadillac, defaultProfile), 99),
    );
    assert.equal(cadillacConversion.buyerProfile.requiredMake, "Cadillac");
  }
  for (const input of ["cadillac", "Cadillac", "Caddy", "cadilac"]) {
    const cadillac = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(cadillac.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
    assert.equal(cadillac.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, undefined);
    assert.equal(cadillac.currentQuestion?.id, "make_flexibility");
  }

  for (const input of ["I want a Toyota", "looking for Toyota"]) {
    const toyotaFragment = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(toyotaFragment.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Toyota", `${input} should match direct Toyota intent`);
  }
  for (const input of ["toyota", "Toyota"]) {
    const toyotaFragment = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(toyotaFragment.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
    assert.equal(toyotaFragment.currentQuestion?.id, "make_flexibility");
  }
  const maybeToyota = await createSemanticConversationIntakeSession("maybe Toyota", fallbackService);
  assert.equal(maybeToyota.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, "Toyota");
  assert.equal(maybeToyota.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);

  for (const input of ["I want a Lexus", "looking for Lexus"]) {
    const lexusFragment = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(lexusFragment.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Lexus", `${input} should match direct Lexus intent`);
  }
  for (const input of ["lexus", "Lexus"]) {
    const lexusFragment = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(lexusFragment.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
    assert.equal(lexusFragment.currentQuestion?.id, "make_flexibility");
  }

  const noToyota = await createSemanticConversationIntakeSession("no Toyota", fallbackService);
  assert.deepEqual(noToyota.accumulatedInterpretation.suggestedProfileUpdates.excludedMakes, ["Toyota"]);
  assert.equal(noToyota.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);

  for (const input of ["a truck", "need truck", "I want a truck"]) {
    const truck = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(truck.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, "truck", `${input} should reach BuyerProfile as truck intent`);
  }
  for (const input of ["truck", "pickup"]) {
    const truck = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(truck.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, undefined);
    assert.ok(truck.accumulatedInterpretation.canonicalMappings?.some((item) => item.conceptType === "body_style" && item.intent === "uncertain"));
  }

  for (const input of ["want hybrid", "fuel efficient hybrid"]) {
    const hybrid = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(hybrid.accumulatedInterpretation.suggestedProfileUpdates.requiredFuelType, "hybrid", `${input} should reach BuyerProfile as hybrid intent`);
  }
  for (const input of ["hybrid", "maybe a hybrid"]) {
    const hybrid = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(hybrid.accumulatedInterpretation.suggestedProfileUpdates.requiredFuelType, undefined);
  }

  for (const input of ["motorcycle", "motorbike", "RV", "camper van", "ATV", "electric scooter"]) {
    const outOfScope = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.ok(hasPreference(outOfScope, "Outside current scope"), `${input} should be preserved as outside-scope context`);
    assert.equal(outOfScope.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, undefined);
  }

  const unknownVehicle = await createSemanticConversationIntakeSession("I want a Snaztrax", fallbackService);
  assert.ok(hasPreference(unknownVehicle, "Unrecognized vehicle term"), "unknown vehicle language should be preserved for clarification");
  const unknownConversion = convertConfirmedPreferencesToBuyerProfile(
    defaultProfile,
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(unknownVehicle, defaultProfile), 99),
  );
  assert.equal(assessConfirmedProfileConversionReadiness(unknownConversion).ready, false);

  const bmwDirect = await createSemanticConversationIntakeSession("I want a BMW.", fallbackService);
  assert.equal(bmwDirect.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "BMW");
  assert.equal(bmwDirect.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, undefined);

  const toyotaHonda = await createSemanticConversationIntakeSession("Toyota preferred, but Honda is acceptable.", fallbackService);
  assert.equal(toyotaHonda.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, "Toyota");
  assert.deepEqual(toyotaHonda.accumulatedInterpretation.suggestedProfileUpdates.allowedMakes, ["Honda"]);

  const successfulFallback = await createSemanticConversationIntakeSession(
    "I want something that makes me feel successful.",
    fallbackService,
  );
  assert.ok(hasPreference(successfulFallback, "Image matters"));
  assert.equal(successfulFallback.accumulatedInterpretation.suggestedProfileUpdates.preferredMake, undefined);
  assert.ok(successfulFallback.currentQuestion, "preserved emotional meaning should still ask for useful clarification");

  const truckInputs = [
    "I want a truck.",
    "I need a pickup truck.",
    "I want a reliable truck under $20,000.",
    "I want something with a truck bed.",
    "I want a Ford truck.",
  ];
  for (const input of truckInputs) {
    const truckSession = await createSemanticConversationIntakeSession(input, fallbackService);
    assert.equal(truckSession.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, "truck", `${input} should normalize to truck`);
    assert.ok(
      truckSession.accumulatedInterpretation.canonicalMappings
        ?.some((item) => item.conceptType === "body_style" && item.value === "truck" && item.intent === "required"),
      `${input} should keep truck as a hard body-style fact`,
    );
    const draft = createConfirmedPreferenceProfile(truckSession, defaultProfile);
    const truckItem = draft.items.find((item) => item.field === "requiredBodyStyles");
    assert.equal(truckItem?.constraintStrength, "required", `${input} should survive confirmation as required`);
    const conversion = convertConfirmedPreferencesToBuyerProfile(defaultProfile, approveConfirmedPreferenceProfile(draft, 99));
    assert.deepEqual(conversion.buyerProfile.requiredBodyStyles, ["truck"], `${input} should preserve canonical truck state`);
    assert.equal(conversion.buyerProfile.bodyStyle, "truck", `${input} should reach BuyerProfile`);
    assert.equal(Boolean(conversion.buyerProfile.flexibleConstraints?.includes("bodyStyle")), false, `${input} should not relax body style`);
  }

  const flexibleTruck = await createSemanticConversationIntakeSession("I want a truck, but an SUV is acceptable if necessary.", fallbackService);
  assert.deepEqual(flexibleTruck.accumulatedInterpretation.suggestedProfileUpdates.preferredBodyStyles, ["truck"]);
  assert.deepEqual(flexibleTruck.accumulatedInterpretation.suggestedProfileUpdates.allowedBodyStyles, ["suv"]);
  const flexibleDraft = createConfirmedPreferenceProfile(flexibleTruck, defaultProfile);
  const flexibleTruckItem = flexibleDraft.items.find((item) => item.field === "preferredBodyStyles");
  assert.equal(flexibleTruckItem?.constraintStrength, "preferred");
  const flexibleConversion = convertConfirmedPreferencesToBuyerProfile(defaultProfile, approveConfirmedPreferenceProfile(flexibleDraft, 99));
  assert.deepEqual(flexibleConversion.buyerProfile.preferredBodyStyles, ["truck"]);
  assert.deepEqual(flexibleConversion.buyerProfile.allowedBodyStyles, ["suv"]);

  const sevenSeatSuv = await createSemanticConversationIntakeSession("I need a seven-seat SUV.", fallbackService);
  assert.equal(sevenSeatSuv.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, "suv");
  assert.equal(sevenSeatSuv.accumulatedInterpretation.suggestedProfileUpdates.familySize, 7);
  const sevenSeatConversion = convertConfirmedPreferencesToBuyerProfile(
    defaultProfile,
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(sevenSeatSuv, defaultProfile), 99),
  );
  assert.equal(sevenSeatConversion.buyerProfile.bodyStyle, "suv");
  assert.equal(sevenSeatConversion.buyerProfile.familySize, 7);

  const hybridSedan = await createSemanticConversationIntakeSession("I want a hybrid sedan.", fallbackService);
  assert.equal(hybridSedan.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, "sedan");
  assert.equal(hybridSedan.accumulatedInterpretation.suggestedProfileUpdates.requiredFuelType, "hybrid");
  const hybridSedanConversion = convertConfirmedPreferencesToBuyerProfile(
    defaultProfile,
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(hybridSedan, defaultProfile), 99),
  );
  assert.equal(hybridSedanConversion.buyerProfile.bodyStyle, "sedan");
  assert.equal(hybridSedanConversion.buyerProfile.requiredFuelType, "hybrid");

  const noSubaru = await createSemanticConversationIntakeSession("I need AWD and I do not want a Subaru.", fallbackService);
  assert.equal(noSubaru.accumulatedInterpretation.suggestedProfileUpdates.drivetrainPreference, "AWD");
  assert.deepEqual(noSubaru.accumulatedInterpretation.suggestedProfileUpdates.excludedMakes, ["Subaru"]);
  const noSubaruConversion = convertConfirmedPreferencesToBuyerProfile(
    defaultProfile,
    approveConfirmedPreferenceProfile(createConfirmedPreferenceProfile(noSubaru, defaultProfile), 99),
  );
  assert.equal(noSubaruConversion.buyerProfile.drivetrainPreference, "AWD");
  assert.deepEqual(noSubaruConversion.buyerProfile.excludedMakes, ["Subaru"]);

  const subaruSedan = await createSemanticConversationIntakeSession("I want a Subaru sedan.", fallbackService);
  assert.equal(subaruSedan.accumulatedInterpretation.suggestedProfileUpdates.requiredMake, "Subaru");
  assert.equal(subaruSedan.accumulatedInterpretation.suggestedProfileUpdates.bodyStyle, "sedan");
  assert.equal(subaruSedan.accumulatedInterpretation.suggestedProfileUpdates.excludedMakes, undefined);

  assertNoRecommendationPayload(semanticEstablished);
  console.log("Semantic-backed conversation examples passed.");
  printConversation("before semantic -> finally made it", oldEstablished);
  printConversation("after semantic -> finally made it", semanticEstablished);
  printConversation("after semantic -> freeway passing context", contextAnswer);
}

class ConversationFixtureProvider implements SemanticUnderstandingProvider {
  readonly providerId = "conversation-fixture-provider";
  readonly providerKind = "test-fixture" as const;

  async understand(request: SemanticUnderstandingRequest): Promise<SemanticUnderstandingResult> {
    return {
      providerId: this.providerId,
      providerKind: this.providerKind,
      draft: draftForMessage(request.currentMessage),
      warnings: [],
    };
  }
}

function draftForMessage(message: string) {
  const lower = message.toLowerCase();
  if (/finally made it|established|successful/.test(lower)) return draftStatusImage(message);
  if (/feels expensive|fortune/.test(lower)) return draftPremiumWithoutCost(message);
  if (/truck feeling|downtown/.test(lower)) return draftTruckDowntown(message);
  if (/bmw|reliability worries/.test(lower)) return draftBmwReliability(message);
  if (/powerful/.test(lower)) return draftPowerful(message);
  if (/freeway|passing/.test(lower)) return draftFreewayPassing(message);
  return draftVague(message);
}

function draftStatusImage(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.emotionalGoals.push(item("semantic:image", "status_image", "mature, successful image", message, "inferred", 0.78, "flexible"));
  return finishDraft(draft);
}

function draftPremiumWithoutCost(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.emotionalGoals.push(item("semantic:premium", "luxury_feel", "premium feel without luxury pricing", "feels expensive", "inferred", 0.78, "flexible"));
  draft.aversions.push(item("semantic:cost", "maintenance_tolerance", "low tolerance for high ownership cost", "without costing a fortune", "explicit", 0.86, "preferred"));
  return finishDraft(draft);
}

function draftTruckDowntown(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.referenceEntities.push({
    ...item("semantic:truck-reference", "vehicle_category", ["truck-like presence", "capability"], "truck feeling", "inferred", 0.72, "flexible"),
    entityKind: "vehicle_reference",
    canonicalValue: "Truck",
    likelyReferencedQualities: ["truck-like presence", "capability"],
  });
  draft.practicalGoals.push(item("semantic:downtown", "parking", "city-friendly parking", "live downtown", "explicit", 0.82, "preferred", false));
  draft.conflicts.push({
    id: "conflict:truck-city",
    topic: "Truck feel versus city use",
    description: "Truck-like size and downtown parking may conflict.",
    evidenceRefs: ["current-message"],
    conflictType: "contradiction",
    confidence: 0.84,
  });
  return finishDraft(draft);
}

function draftBmwReliability(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.recognizedEntities.push({
    ...item("semantic:bmw", "make", "BMW", "BMW", "explicit", 0.9, "preferred"),
    entityKind: "make",
    canonicalValue: "BMW",
  });
  draft.aversions.push(item("semantic:reliability", "maintenance_tolerance", "repair risk should stay conservative", "reliability worries me", "explicit", 0.84, "preferred"));
  draft.conflicts.push({
    id: "conflict:bmw-reliability",
    topic: "Premium preference versus repair cost",
    description: "BMW preference may compete with reliability worries.",
    evidenceRefs: ["current-message"],
    conflictType: "contradiction",
    confidence: 0.8,
  });
  return finishDraft(draft);
}

function draftPowerful(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.uncertainties.push({
    id: "uncertainty:power",
    topic: "Meaning of power",
    sourceText: "powerful",
    messageRef: "current-message",
    possibleInterpretations: ["acceleration", "handling", "truck-like capability"],
    impact: "high",
    question: "What kind of power matters most?",
  });
  return finishDraft(draft);
}

function draftFreewayPassing(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.inferredPreferences.push(item("semantic:passing", "acceleration", "passing confidence on the freeway", message, "inferred", 0.9, "preferred", false));
  return finishDraft(draft);
}

function draftVague(message: string) {
  const draft = createEmptyUnderstandingDraft(message);
  draft.uncertainties.push({
    id: "uncertainty:vague",
    topic: "Starting point",
    sourceText: message,
    messageRef: "current-message",
    possibleInterpretations: ["budget", "main use", "risk tolerance"],
    impact: "high",
    question: "What is the maximum budget or main use I should start with?",
  });
  return finishDraft(draft);
}

function item(
  id: string,
  concept: UnderstandingDraft["explicitPreferences"][number]["concept"],
  proposedValue: string | number | boolean | string[],
  sourceText: string,
  status: UnderstandingDraft["explicitPreferences"][number]["status"],
  confidence: number,
  proposedConstraintStrength: UnderstandingDraft["explicitPreferences"][number]["proposedConstraintStrength"],
  requiresConfirmation = true,
) {
  return {
    id,
    concept,
    proposedValue,
    sourceText,
    messageRef: "current-message",
    status,
    intent: status === "unresolved" || status === "uncertain"
      ? "uncertain" as const
      : id.includes("cost") || id.includes("aversion")
        ? "excluded" as const
        : proposedConstraintStrength === "required"
          ? "required" as const
          : "preferred" as const,
    confidence,
    proposedConstraintStrength,
    interpretationExplanation: `${sourceText} supports ${concept}.`,
    requiresConfirmation,
  };
}

function finishDraft(draft: UnderstandingDraft) {
  const interpretations = [
    ...draft.explicitPreferences,
    ...draft.inferredPreferences,
    ...draft.recognizedEntities,
    ...draft.referenceEntities,
    ...draft.emotionalGoals,
    ...draft.practicalGoals,
    ...draft.aversions,
    ...draft.constraints,
    ...draft.unresolvedConcepts,
  ];
  draft.confidenceByInterpretation = interpretations.map((interpretation) => ({
    interpretationId: interpretation.id,
    confidence: interpretation.confidence,
    reason: interpretation.interpretationExplanation,
  }));
  return draft;
}

runSemanticConversationExamples().catch((error) => {
  console.error(error);
  process.exit(1);
});
