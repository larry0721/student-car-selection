import { NextResponse } from "next/server";
import type { BuyerProfile } from "@/types/buyer";

type ProfileIntakeRequest = {
  description?: string;
  profile?: BuyerProfile;
};

type ProfilePatch = Partial<Omit<BuyerProfile, "scoreWeights">>;

export async function POST(request: Request) {
  const payload = (await request.json()) as ProfileIntakeRequest;
  const description = String(payload.description || "").trim();

  if (!description || !payload.profile) {
    return NextResponse.json({ profile: payload.profile, summary: "No written requirements were provided.", configured: false });
  }

  if (!process.env.OPENAI_API_KEY) {
    const patch = buildFallbackProfilePatch(description);
    return NextResponse.json({
      configured: false,
      profile: { ...payload.profile, ...patch },
      summary: patchToSummary(patch),
    });
  }

  try {
    const patch = await getOpenAiProfilePatch(description, payload.profile);
    return NextResponse.json({
      configured: true,
      profile: { ...payload.profile, ...patch },
      summary: patchToSummary(patch),
    });
  } catch (error) {
    const patch = buildFallbackProfilePatch(description);
    return NextResponse.json({
      configured: false,
      profile: { ...payload.profile, ...patch },
      summary: patchToSummary(patch),
      warning: error instanceof Error ? error.message : "AI profile parsing failed; local parser was used.",
    });
  }
}

async function getOpenAiProfilePatch(description: string, profile: BuyerProfile): Promise<ProfilePatch> {
  const model = process.env.OPENAI_RECOMMENDATION_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Extract first-car buying requirements into JSON only. Only set fields that are clearly implied. Do not invent requirements.",
        },
        {
          role: "user",
          content: JSON.stringify({
            description,
            currentProfile: profile,
            allowedPatchShape: {
              maxPurchaseBudget: "number",
              monthlyBudget: "number",
              paymentMethod: "not-sure | cash | financing",
              purchaseCondition: "any | new | used",
              expectedAnnualMileage: "number",
              insuranceBudget: "number",
              minYear: "number",
              maxMileage: "number",
              minMpg: "number",
              fuelEconomyImportance: "1-5 number",
              reliabilityImportance: "1-5 number",
              performanceImportance: "1-5 number",
              cargoNeed: "not-sure | low | medium | high",
              familySize: "number",
              drivetrainPreference: "any | FWD | AWD | RWD | 4WD",
              transmissionPreference: "any | automatic | manual",
              bodyStyle: "any | sedan | suv | hatchback | truck | coupe | convertible | wagon | minivan",
              climate: "not-sure | mild | rain | snow",
              resaleValueImportance: "1-5 number",
              modificationPlans: "not-sure | no | yes",
              advancedFeaturesImportance: "1-5 number",
              safetyPriority: "not-sure | standard | high | maximum",
            },
          }),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI profile parsing failed with status ${response.status}.`);

  const data = await response.json();
  const text = getResponseText(data);
  if (!text) throw new Error("OpenAI profile parsing returned no JSON.");

  return sanitizePatch(JSON.parse(text));
}

function buildFallbackProfilePatch(description: string): ProfilePatch {
  const text = description.toLowerCase();
  const patch: ProfilePatch = {};
  const moneyValues = Array.from(text.matchAll(/\$?\s*(\d{2,3}(?:,\d{3})|\d{4,6})/g)).map((match) =>
    Number(match[1].replace(/,/g, "")),
  );

  if (moneyValues.length) patch.maxPurchaseBudget = Math.max(...moneyValues.filter((value) => value > 1000));
  const monthlyMatch = text.match(/(\$?\s*\d{2,4})\s*(?:\/\s*)?(?:per\s*)?(?:month|mo|monthly)/);
  if (monthlyMatch) patch.monthlyBudget = Number(monthlyMatch[1].replace(/[$,\s]/g, ""));
  const mpgMatch = text.match(/(\d{2,3})\s*(?:\+|plus)?\s*mpg/);
  if (mpgMatch) patch.minMpg = Number(mpgMatch[1]);
  const mileageMatch = text.match(/under\s*(\d{2,3}(?:,\d{3})|\d{4,6})\s*(?:miles|mi|mileage)/);
  if (mileageMatch) patch.maxMileage = Number(mileageMatch[1].replace(/,/g, ""));
  const familyMatch = text.match(/(?:family of|seat|seats|people)\s*(\d+)/);
  if (familyMatch) patch.familySize = Number(familyMatch[1]);

  if (/\bnew\b/.test(text)) patch.purchaseCondition = "new";
  if (/\bused\b|pre[-\s]?owned/.test(text)) patch.purchaseCondition = "used";
  if (/\bcash\b/.test(text)) patch.paymentMethod = "cash";
  if (/finance|financing|loan|monthly payment/.test(text)) patch.paymentMethod = "financing";
  if (/snow|ice|mountain|ski/.test(text)) {
    patch.climate = "snow";
    patch.drivetrainPreference = "AWD";
  } else if (/rain|wet/.test(text)) {
    patch.climate = "rain";
  }
  if (/awd|all wheel/.test(text)) patch.drivetrainPreference = "AWD";
  if (/4wd|four wheel/.test(text)) patch.drivetrainPreference = "4WD";
  if (/rwd|rear wheel/.test(text)) patch.drivetrainPreference = "RWD";
  if (/fwd|front wheel/.test(text)) patch.drivetrainPreference = "FWD";
  if (/manual|stick shift/.test(text)) patch.transmissionPreference = "manual";
  if (/automatic|auto transmission/.test(text)) patch.transmissionPreference = "automatic";
  if (/sedan/.test(text)) patch.bodyStyle = "sedan";
  if (/suv|crossover/.test(text)) patch.bodyStyle = "suv";
  if (/hatchback|hatch/.test(text)) patch.bodyStyle = "hatchback";
  if (/truck|pickup/.test(text)) patch.bodyStyle = "truck";
  if (/coupe|two door|2 door/.test(text)) patch.bodyStyle = "coupe";
  if (/convertible|cabriolet/.test(text)) patch.bodyStyle = "convertible";
  if (/wagon|estate/.test(text)) patch.bodyStyle = "wagon";
  if (/minivan|mini van|family van/.test(text)) patch.bodyStyle = "minivan";
  if (/cargo|space|camping|bike|sports gear/.test(text)) patch.cargoNeed = "high";
  if (/safe|safety/.test(text)) patch.safetyPriority = "high";
  if (/very safe|max safety|safest/.test(text)) patch.safetyPriority = "maximum";
  if (/reliable|reliability|last a long time/.test(text)) patch.reliabilityImportance = 5;
  if (/resale|hold value/.test(text)) patch.resaleValueImportance = 5;
  if (/performance|fast|fun to drive|sporty/.test(text)) patch.performanceImportance = 5;
  if (/features|carplay|adaptive cruise|blind spot|backup camera/.test(text)) patch.advancedFeaturesImportance = 5;
  if (/modify|mods|aftermarket/.test(text)) patch.modificationPlans = "yes";

  return sanitizePatch(patch);
}

function sanitizePatch(value: unknown): ProfilePatch {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const patch: ProfilePatch = {};

  setNumber(record, patch, "maxPurchaseBudget", 0, 200000);
  setNumber(record, patch, "monthlyBudget", 0, 5000);
  setNumber(record, patch, "expectedAnnualMileage", 0, 50000);
  setNumber(record, patch, "insuranceBudget", 0, 1000);
  setNumber(record, patch, "minYear", 1980, new Date().getFullYear() + 1);
  setNumber(record, patch, "maxMileage", 0, 300000);
  setNumber(record, patch, "minMpg", 0, 150);
  setNumber(record, patch, "fuelEconomyImportance", 1, 5);
  setNumber(record, patch, "reliabilityImportance", 1, 5);
  setNumber(record, patch, "performanceImportance", 1, 5);
  setNumber(record, patch, "familySize", 1, 9);
  setNumber(record, patch, "resaleValueImportance", 1, 5);
  setNumber(record, patch, "advancedFeaturesImportance", 1, 5);

  setEnum(record, patch, "paymentMethod", ["not-sure", "cash", "financing"]);
  setEnum(record, patch, "purchaseCondition", ["any", "new", "used"]);
  setEnum(record, patch, "cargoNeed", ["not-sure", "low", "medium", "high"]);
  setEnum(record, patch, "drivetrainPreference", ["any", "FWD", "AWD", "RWD", "4WD"]);
  setEnum(record, patch, "transmissionPreference", ["any", "automatic", "manual"]);
  setEnum(record, patch, "bodyStyle", ["any", "sedan", "suv", "hatchback", "truck", "coupe", "convertible", "wagon", "minivan"]);
  setEnum(record, patch, "climate", ["not-sure", "mild", "rain", "snow"]);
  setEnum(record, patch, "modificationPlans", ["not-sure", "no", "yes"]);
  setEnum(record, patch, "safetyPriority", ["not-sure", "standard", "high", "maximum"]);

  return patch;
}

function setNumber<Key extends keyof ProfilePatch>(
  record: Record<string, unknown>,
  patch: ProfilePatch,
  key: Key,
  min: number,
  max: number,
) {
  const value = Number(record[key]);
  if (Number.isFinite(value)) patch[key] = Math.max(min, Math.min(max, value)) as ProfilePatch[Key];
}

function setEnum<Key extends keyof ProfilePatch>(
  record: Record<string, unknown>,
  patch: ProfilePatch,
  key: Key,
  allowed: string[],
) {
  const value = record[key];
  if (typeof value === "string" && allowed.includes(value)) patch[key] = value as ProfilePatch[Key];
}

function patchToSummary(patch: ProfilePatch) {
  const keys = Object.keys(patch);
  return keys.length ? `Applied written requirements: ${keys.join(", ")}.` : "No concrete written requirements were detected.";
}

function getResponseText(data: unknown) {
  if (typeof data !== "object" || data === null) return "";
  const outputText = "output_text" in data ? data.output_text : undefined;
  if (typeof outputText === "string") return outputText;

  const output = "output" in data ? data.output : undefined;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (typeof item !== "object" || item === null || !("content" in item)) return [];
      return Array.isArray(item.content) ? item.content : [];
    })
    .map((content) => {
      if (typeof content !== "object" || content === null || !("text" in content)) return "";
      return typeof content.text === "string" ? content.text : "";
    })
    .join("")
    .trim();
}
