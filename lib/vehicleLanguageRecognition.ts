import type { SemanticConcept } from "./carDomainOntology";
import { recognizeMakesInText } from "./makeRegistry";

export type VehicleEntityKind = "make" | "model" | "reference_vehicle" | "unknown_vehicle_language";

export type VehicleLanguageEntity = {
  kind: VehicleEntityKind;
  canonicalName: string;
  rawText: string;
  confidence: number;
  concept: SemanticConcept;
  source: "deterministic-normalization";
};

export type VehicleReferenceEntity = VehicleLanguageEntity & {
  likelyReferencedQualities: string[];
  requiresClarification: boolean;
};

export type VehicleLanguageRecognitionResult = {
  recognizedEntities: VehicleLanguageEntity[];
  referenceEntities: VehicleReferenceEntity[];
  unresolvedVehicleLanguage: VehicleLanguageEntity[];
};

const modelReferences: Array<{ canonicalName: string; patterns: RegExp[]; qualities: string[] }> = [
  { canonicalName: "Mazda MX-5 Miata", patterns: [/\bmiata\b/i, /\bmx-?5\b/i], qualities: ["small", "lightweight", "playful handling", "driver engagement"] },
  { canonicalName: "Tesla", patterns: [/\btesla\b/i], qualities: ["technology", "quick acceleration", "minimal interior", "electric powertrain"] },
  { canonicalName: "Lexus", patterns: [/\blexus\b/i], qualities: ["comfort", "quietness", "premium interior", "reliability image"] },
  { canonicalName: "Toyota 4Runner", patterns: [/\b4runner\b/i], qualities: ["rugged image", "SUV practicality", "off-road capability"] },
  { canonicalName: "Honda Civic", patterns: [/\bcivic\b/i], qualities: ["efficient commute", "first-car practicality", "low ownership risk"] },
  { canonicalName: "Toyota Prius", patterns: [/\bprius\b/i], qualities: ["fuel economy", "low ownership cost", "practical hatchback"] },
];

const referenceLanguage = /\b(like|vibe|energy|feel|feeling|look|style|reminds me of|similar to|sounds fun|without .* prices|but not)\b/i;

export function recognizeVehicleLanguage(text: string): VehicleLanguageRecognitionResult {
  const recognizedEntities: VehicleLanguageEntity[] = [];
  const referenceEntities: VehicleReferenceEntity[] = [];
  const unresolvedVehicleLanguage: VehicleLanguageEntity[] = [];

  for (const make of recognizeMakesInText(text)) {
    const evidence = make.rawText;
    const entity: VehicleLanguageEntity = {
      kind: "make",
      canonicalName: make.canonicalName,
      rawText: evidence,
      confidence: make.confidence,
      concept: "make",
      source: "deterministic-normalization",
    };
    recognizedEntities.push(entity);
    if (referenceLanguage.test(text) || /\b(german luxury|luxury badge|badge|brand image)\b/i.test(text)) {
      referenceEntities.push({
        ...entity,
        kind: "reference_vehicle",
        likelyReferencedQualities: getMakeReferenceQualities(make.canonicalName, text),
        requiresClarification: /\brequired|must|need\b/i.test(text) ? false : true,
      });
    }
  }

  const outOfScope = getOutOfScopeVehicleTerm(text);
  if (outOfScope) {
    unresolvedVehicleLanguage.push({
      kind: "unknown_vehicle_language",
      canonicalName: outOfScope,
      rawText: outOfScope,
      confidence: 0.88,
      concept: "unknown",
      source: "deterministic-normalization",
    });
  }

  const unknownExcluded = getUnknownExcludedVehicleTerm(text);
  if (
    unknownExcluded
    && ![...recognizedEntities, ...referenceEntities, ...unresolvedVehicleLanguage]
      .some((entity) => entity.rawText.toLowerCase() === unknownExcluded.toLowerCase())
  ) {
    unresolvedVehicleLanguage.push({
      kind: "unknown_vehicle_language",
      canonicalName: unknownExcluded,
      rawText: unknownExcluded,
      confidence: 0.45,
      concept: "unknown",
      source: "deterministic-normalization",
    });
  }

  for (const model of modelReferences) {
    const evidence = findFirstMatch(text, model.patterns);
    if (!evidence) continue;
    if (referenceEntities.some((entity) => entity.canonicalName === model.canonicalName && entity.rawText === evidence)) continue;
    const isReference = referenceLanguage.test(text) || /\benergy|feeling|vibe\b/i.test(text);
    const entity: VehicleLanguageEntity = {
      kind: isReference ? "reference_vehicle" : "model",
      canonicalName: model.canonicalName,
      rawText: evidence,
      confidence: 0.9,
      concept: isReference ? "vehicle_category" : "model",
      source: "deterministic-normalization",
    };
    if (isReference) {
      referenceEntities.push({
        ...entity,
        kind: "reference_vehicle",
        likelyReferencedQualities: model.qualities,
        requiresClarification: true,
      });
    } else {
      recognizedEntities.push(entity);
    }
  }

  const invented = text.match(/\b(?:I want|looking for|need|like)\s+(?:a|an)?\s*([A-Z][a-zA-Z0-9-]{3,}(?:\s+[A-Z][a-zA-Z0-9-]{2,})?)\b/);
  if (invented) {
    const rawText = invented[1].trim();
    const known = [...recognizedEntities, ...referenceEntities].some((entity) =>
      entity.rawText.toLowerCase() === rawText.toLowerCase() || entity.canonicalName.toLowerCase() === rawText.toLowerCase(),
    );
    if (!known && !/SUV|AWD|FWD|RWD|EV|hybrid|sedan|truck/i.test(rawText)) {
      unresolvedVehicleLanguage.push({
        kind: "unknown_vehicle_language",
        canonicalName: rawText,
        rawText,
        confidence: 0.35,
        concept: "unknown",
        source: "deterministic-normalization",
      });
    }
  }

  return { recognizedEntities, referenceEntities, unresolvedVehicleLanguage };
}

function findFirstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0];
  }
  return "";
}

function getOutOfScopeVehicleTerm(text: string) {
  return text.match(/\b(?:motorcycle|motorbike|rv|camper van|atv|electric scooter|scooter|boat)\b/i)?.[0] || "";
}

function getUnknownExcludedVehicleTerm(text: string) {
  const match = text.match(
    /\b(?:no|not|avoid|exclude|except|anything (?:but|except)|stay away from)\s+(?:a\s+|an\s+)?([A-Za-z][A-Za-z0-9-]{2,})\b/i,
  );
  const value = match?.[1] || "";
  if (!value || value[0] !== value[0].toUpperCase()) return "";
  if (/^(?:SUVs?|trucks?|pickups?|minivans?|sedans?|wagons?|hatchbacks?|coupes?|convertibles?|AWD|4WD|FWD|RWD|diesel|electric|hybrid|manual|automatic|CVT)$/i.test(value)) {
    return "";
  }
  return value;
}

function getMakeReferenceQualities(make: string, text: string) {
  const qualities = new Set<string>();
  if (/luxury|premium|successful|badge|image|look|vibe/i.test(text)) qualities.add("brand image");
  if (/technology|minimal|screen|electric|ev/i.test(text) || make === "Tesla") qualities.add("technology");
  if (/comfort|quiet|smooth/i.test(text) || make === "Lexus" || make === "Mercedes-Benz") qualities.add("comfort");
  if (/fun|drive|sport|quick|power/i.test(text) || make === "BMW") qualities.add("driving experience");
  if (!qualities.size) qualities.add("general vehicle reference");
  return [...qualities];
}
