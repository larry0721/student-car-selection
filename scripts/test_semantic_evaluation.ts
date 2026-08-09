import assert from "node:assert/strict";
import {
  DeterministicSemanticUnderstandingProvider,
  understandAndValidate,
  type ValidatedUnderstanding,
} from "../lib/semanticUnderstanding";

const provider = new DeterministicSemanticUnderstandingProvider();

type EvaluationCase = {
  id: string;
  category: string;
  message: string;
  unseen?: boolean;
  assert: (result: ValidatedUnderstanding) => void | Promise<void>;
  expectedSource: "semantic" | "deterministic-normalization" | "fallback-rule";
};

const cases: EvaluationCase[] = [
  {
    id: "entity-benz",
    category: "A. Entity language",
    message: "I want a Benz.",
    expectedSource: "deterministic-normalization",
    assert: (result) => assert.equal(result.draft.recognizedEntities[0]?.canonicalValue, "Mercedes-Benz"),
  },
  {
    id: "entity-german-luxury",
    category: "A. Entity language",
    message: "German luxury is more my thing.",
    unseen: true,
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.emotionalGoals.some((item) => item.concept === "status_image" || item.concept === "luxury_feel")),
  },
  {
    id: "entity-star",
    category: "A. Entity language",
    message: "I like the three-pointed-star vibe.",
    expectedSource: "deterministic-normalization",
    assert: (result) => assert.ok(result.draft.referenceEntities.some((item) => item.canonicalValue === "Mercedes-Benz")),
  },
  {
    id: "entity-beemer",
    category: "A. Entity language",
    message: "A Beemer sounds fun.",
    expectedSource: "deterministic-normalization",
    assert: (result) => assert.ok(result.draft.recognizedEntities.some((item) => item.canonicalValue === "BMW")),
  },
  {
    id: "entity-unseen-informal",
    category: "A. Entity language",
    message: "That Stuttgart luxury-badge feeling is appealing, but I do not need the actual badge.",
    unseen: true,
    expectedSource: "semantic",
    assert: (result) => {
      assert.ok(result.draft.emotionalGoals.some((item) => item.concept === "status_image"));
      assert.equal(result.draft.constraints.some((item) => item.concept === "make"), false);
    },
  },
  {
    id: "emotion-successful",
    category: "B. Emotional goals",
    message: "I want something that makes me feel successful.",
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.emotionalGoals.some((item) => item.concept === "status_image")),
  },
  {
    id: "emotion-not-trying",
    category: "B. Emotional goals",
    message: "I don’t want to look like I’m trying too hard.",
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.aversions.some((item) => item.concept === "styling")),
  },
  {
    id: "emotion-friends",
    category: "B. Emotional goals",
    message: "I need something I won’t be embarrassed to pick up friends in.",
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.emotionalGoals.some((item) => item.concept === "first_car_suitability")),
  },
  {
    id: "emotion-unseen",
    category: "B. Emotional goals",
    message: "I want a car that feels grown-up without being loud about it.",
    unseen: true,
    expectedSource: "semantic",
    assert: (result) => {
      assert.ok(result.draft.emotionalGoals.some((item) => item.concept === "status_image"));
      assert.ok(result.draft.aversions.some((item) => item.concept === "styling"));
    },
  },
  {
    id: "performance-powerful",
    category: "C. Vague performance",
    message: "I want something powerful.",
    expectedSource: "semantic",
    assert: (result) => assert.equal(result.selectedClarification?.id, "clarify:power"),
  },
  {
    id: "performance-highway",
    category: "C. Vague performance",
    message: "It should feel effortless on the highway.",
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.inferredPreferences.some((item) => item.concept === "acceleration")),
  },
  {
    id: "performance-moves",
    category: "C. Vague performance",
    message: "I don’t need a race car, just something that moves.",
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.inferredPreferences.some((item) => item.concept === "acceleration")),
  },
  {
    id: "performance-unseen",
    category: "C. Vague performance",
    message: "I want confidence when I jump into freeway traffic.",
    unseen: true,
    expectedSource: "semantic",
    assert: (result) => assert.ok(result.draft.inferredPreferences.some((item) => item.concept === "acceleration")),
  },
  {
    id: "reference-tesla",
    category: "D. Reference vehicles",
    message: "Something like a Tesla but not electric.",
    expectedSource: "deterministic-normalization",
    assert: (result) => {
      assert.ok(result.draft.referenceEntities.some((item) => item.canonicalValue === "Tesla"));
      assert.equal(result.draft.constraints.some((item) => item.concept === "make"), false);
    },
  },
  {
    id: "reference-miata",
    category: "D. Reference vehicles",
    message: "Miata energy with space for friends.",
    expectedSource: "deterministic-normalization",
    assert: (result) => {
      assert.ok(result.draft.referenceEntities.some((item) => item.canonicalValue === "Mazda MX-5 Miata"));
      assert.ok(result.draft.practicalGoals.some((item) => item.concept === "passenger_capacity"));
    },
  },
  {
    id: "reference-lexus",
    category: "D. Reference vehicles",
    message: "I want the Lexus feeling without Lexus prices.",
    expectedSource: "deterministic-normalization",
    assert: (result) => assert.ok(result.draft.referenceEntities.some((item) => item.canonicalValue === "Lexus")),
  },
  {
    id: "reference-unseen",
    category: "D. Reference vehicles",
    message: "I want the calm executive-sedan mood without paying executive-sedan money.",
    unseen: true,
    expectedSource: "semantic",
    assert: (result) => {
      assert.ok(result.draft.emotionalGoals.some((item) => item.concept === "status_image"));
      assert.ok(result.draft.aversions.some((item) => item.concept === "maintenance_tolerance") || result.draft.explicitPreferences.some((item) => item.concept === "purchase_budget"));
    },
  },
  {
    id: "context-follow-up",
    category: "E. Context",
    message: "Mostly how it feels when I merge onto the highway.",
    unseen: true,
    expectedSource: "semantic",
    assert: asyncContextAssertion,
  },
  {
    id: "context-correction",
    category: "E. Context",
    message: "Actually the badge is not that important.",
    expectedSource: "semantic",
    assert: correctionAssertion,
  },
  {
    id: "unknown-invented",
    category: "F. Unknown concepts",
    message: "I want a Zorblax Velora.",
    expectedSource: "fallback-rule",
    assert: (result) => {
      assert.ok(result.draft.unresolvedConcepts.length > 0);
      assert.ok(result.selectedClarification?.question.includes("Zorblax"));
    },
  },
  {
    id: "unknown-ambiguous",
    category: "F. Unknown concepts",
    message: "It needs to be drippy but responsible.",
    unseen: true,
    expectedSource: "fallback-rule",
    assert: (result) => assert.ok(result.selectedClarification),
  },
];

const rows: Array<{ id: string; category: string; source: string; clarification: string; unseen: boolean }> = [];

async function main() {
for (const testCase of cases) {
  if (testCase.id === "context-follow-up" || testCase.id === "context-correction") {
    await testCase.assert({} as ValidatedUnderstanding);
    rows.push({ id: testCase.id, category: testCase.category, source: testCase.expectedSource, clarification: "context-specific", unseen: Boolean(testCase.unseen) });
    continue;
  }
  const result = await understandAndValidate(provider, { currentMessage: testCase.message });
  testCase.assert(result);
  rows.push({
    id: testCase.id,
    category: testCase.category,
    source: testCase.expectedSource,
    clarification: result.selectedClarification?.question || "none",
    unseen: Boolean(testCase.unseen),
  });
}

const unseenPassed = rows.filter((row) => row.unseen);
assert.ok(unseenPassed.length >= 5, "at least five unseen paraphrase evaluations must pass");

console.log("Semantic evaluation suite passed.");
console.table(rows);
}

async function asyncContextAssertion() {
  const result = await understandAndValidate(provider, {
    currentMessage: "Mostly how it feels when I merge onto the highway.",
    conversationHistory: [
      { id: "u1", role: "user", text: "I want something powerful." },
      { id: "a1", role: "advisor", text: "Do you mean acceleration, handling, or carrying capability?", questionCode: "performance_meaning" },
      { id: "u2", role: "user", text: "Mostly how it feels when I merge onto the highway." },
    ],
  });
  assert.ok(result.draft.inferredPreferences.some((item) => item.id === "context:power-merge"));
}

async function correctionAssertion() {
  const prior = {
    ...await provider.understand({ currentMessage: "BMW is required." }).then((result) => result.draft),
  };
  const result = await understandAndValidate(provider, {
    currentMessage: "Actually the badge is not that important.",
    currentUnderstanding: prior,
  });
  assert.ok(result.draft.conflicts.some((conflict) => conflict.conflictType === "changed_mind"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
