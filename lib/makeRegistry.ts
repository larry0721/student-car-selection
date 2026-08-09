export type VehicleMakeRegistryEntry = {
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
  pluralForms: string[];
  spellingVariants?: string[];
};

export type RecognizedMake = {
  canonicalName: string;
  rawText: string;
  confidence: number;
  source: "make-registry";
};

const registryEntries: VehicleMakeRegistryEntry[] = [
  entry("Toyota", ["toyota"], ["toyotas"]),
  entry("Lexus", ["lexus"], ["lexuses"]),
  entry("Cadillac", ["cadillac", "caddy"], ["cadillacs", "caddies"], ["cadilac"]),
  entry("BMW", ["bmw", "bimmer", "beemer"], ["bmws"]),
  entry("Mercedes-Benz", ["mercedes", "mercedes-benz", "mercedes benz", "benz", "three-pointed-star", "three pointed star"], []),
  entry("Honda", ["honda"], ["hondas"]),
  entry("Subaru", ["subaru"], ["subarus"]),
  entry("Mazda", ["mazda"], ["mazdas"]),
  entry("Ford", ["ford"], ["fords"]),
  entry("Chevrolet", ["chevrolet", "chevy"], ["chevrolets", "chevys"]),
  entry("Hyundai", ["hyundai"], ["hyundais"]),
  entry("Kia", ["kia"], ["kias"]),
  entry("Nissan", ["nissan"], ["nissans"]),
  entry("Audi", ["audi"], ["audis"]),
  entry("Volkswagen", ["volkswagen", "vw"], ["vws"]),
  entry("Jeep", ["jeep"], ["jeeps"]),
  entry("Tesla", ["tesla"], ["teslas"]),
  entry("Rivian", ["rivian"], ["rivians"]),
  entry("Lucid", ["lucid"], ["lucids"]),
  entry("Ram", ["ram"], ["rams"]),
  entry("GMC", ["gmc"], ["gmcs"]),
  entry("Mitsubishi", ["mitsubishi"], ["mitsubishis"]),
];

const aliasLookup = new Map<string, { entry: VehicleMakeRegistryEntry; confidence: number }>();
registryEntries.forEach((item) => {
  [...item.aliases, ...item.pluralForms].forEach((alias) => {
    aliasLookup.set(normalizeLookupText(alias), { entry: item, confidence: alias.length <= 3 ? 0.86 : 0.94 });
  });
  item.spellingVariants?.forEach((alias) => {
    aliasLookup.set(normalizeLookupText(alias), { entry: item, confidence: 0.82 });
  });
});

const makeTokenPattern = new RegExp(
  `\\b(?:${[...aliasLookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})\\b`,
  "gi",
);

export function getVehicleMakeRegistry() {
  return registryEntries;
}

export function normalizeVehicleMake(value: string): string {
  return aliasLookup.get(normalizeLookupText(value))?.entry.canonicalName || "";
}

export function recognizeMakesInText(text: string): RecognizedMake[] {
  const normalizedText = normalizeSearchText(text);
  const seen = new Set<string>();
  const matches: RecognizedMake[] = [];

  for (const match of normalizedText.matchAll(makeTokenPattern)) {
    const rawText = match[0];
    const lookup = aliasLookup.get(normalizeLookupText(rawText));
    if (!lookup) continue;
    const key = `${lookup.entry.canonicalName}:${rawText.toLowerCase()}:${match.index ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      canonicalName: lookup.entry.canonicalName,
      rawText,
      confidence: lookup.confidence,
      source: "make-registry",
    });
  }

  return matches;
}

export function buildMakeAlternationPattern() {
  return [...aliasLookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
}

function entry(
  canonicalName: string,
  aliases: string[],
  pluralForms: string[],
  spellingVariants: string[] = [],
): VehicleMakeRegistryEntry {
  return {
    canonicalName,
    normalizedName: normalizeLookupText(canonicalName),
    aliases,
    pluralForms,
    spellingVariants,
  };
}

function normalizeSearchText(text: string) {
  return text.trim().replace(/[’']/g, "'").replace(/[^\w\s$.,!?/-]/g, " ");
}

function normalizeLookupText(value: string) {
  return value.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
