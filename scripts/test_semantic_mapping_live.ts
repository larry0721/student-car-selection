import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mapValidatedUnderstandingToProfile } from "../lib/semanticMapping";
import { createSemanticUnderstandingService } from "../lib/semanticUnderstandingService";

type Expected = {
  input: string;
  intents: Record<string, "required" | "preferred" | "allowed" | "excluded" | "uncertain">;
};

const cases: Expected[] = [
  { input: "Toyota", intents: { Toyota: "uncertain" } },
  { input: "I want a Toyota", intents: { Toyota: "required" } },
  { input: "I only want Toyota", intents: { Toyota: "required" } },
  { input: "Maybe Toyota", intents: { Toyota: "preferred" } },
  { input: "I prefer Toyota", intents: { Toyota: "preferred" } },
  { input: "Toyota is okay", intents: { Toyota: "allowed" } },
  { input: "Toyota or Honda", intents: { Toyota: "allowed", Honda: "allowed" } },
  { input: "Toyota preferred, but Honda is okay", intents: { Toyota: "preferred", Honda: "allowed" } },
  { input: "No Toyota", intents: { Toyota: "excluded" } },
  { input: "Anything except Toyota", intents: { Toyota: "excluded" } },
  { input: "I changed my mind — no Toyota", intents: { Toyota: "excluded" } },
  { input: "I said no Toyota, but Lexus is fine", intents: { Toyota: "excluded", Lexus: "allowed" } },
];

async function main() {
  loadLocalEnvWithoutPrintingSecrets();
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipped live semantic mapping verification because OPENAI_API_KEY is not configured.");
    return;
  }

  const service = createSemanticUnderstandingService({ providerMode: "model" });
  const rows: Array<Record<string, unknown>> = [];

  for (const [index, testCase] of cases.entries()) {
    const result = await service.understand({
      currentMessage: testCase.input,
      conversationHistory: [{ id: `turn-${index + 1}`, role: "user", text: testCase.input }],
    });
    assert.equal(result.providerUsed, "model", `${testCase.input}: provider`);
    assert.equal(result.fallbackUsed, false, `${testCase.input}: fallback`);
    assert.equal(result.status, "success", `${testCase.input}: status`);
    assert.ok(result.validatedUnderstanding, `${testCase.input}: validated understanding`);

    const mapping = mapValidatedUnderstandingToProfile(result.validatedUnderstanding);
    const makes = mapping.concepts.filter((item) => item.conceptType === "vehicle_make");
    for (const [make, intent] of Object.entries(testCase.intents)) {
      const item = makes.find((candidate) => candidate.value === make);
      assert.ok(item, `${testCase.input}: ${make} should be mapped`);
      if (testCase.input === "Maybe Toyota") {
        assert.notEqual(item.intent, "required", `${testCase.input}: must never become required`);
      } else {
        assert.equal(item.intent, intent, `${testCase.input}: ${make} intent`);
      }
    }

    const excluded = new Set(mapping.profilePatch.excludedMakes || []);
    if (testCase.intents.Toyota === "excluded") {
      assert.ok(excluded.has("Toyota"));
      assert.equal(mapping.profilePatch.requiredMake, undefined);
      assert.equal(mapping.profilePatch.preferredMake, undefined);
      assert.equal(Boolean(mapping.profilePatch.allowedMakes?.includes("Toyota")), false);
    }

    rows.push({
      input: testCase.input,
      provider: result.providerUsed,
      fallback: result.fallbackUsed,
      intents: makes.map((item) => `${item.value}:${item.intent}`).join(", "),
      profile: JSON.stringify(mapping.profilePatch),
      clarification: result.validatedUnderstanding.selectedClarification?.question || "none",
    });
  }

  console.table(rows);
  console.log("Live authoritative semantic mapping verification passed.");
}

function loadLocalEnvWithoutPrintingSecrets() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (process.env[key]) continue;
    const rawValue = trimmed.slice(separator + 1).trim();
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
