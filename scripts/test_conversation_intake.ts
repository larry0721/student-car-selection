import assert from "node:assert/strict";
import {
  answerConversationQuestion,
  createConversationIntakeSession,
  skipConversationQuestion,
  type ConversationIntakeSession,
} from "../lib/conversationIntake";

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
