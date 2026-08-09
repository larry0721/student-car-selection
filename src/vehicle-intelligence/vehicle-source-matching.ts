import {
  getMakesForYear,
  getModelsForYearMake,
  getVehicleById,
  getVehicleOptions,
  type EpaVehicleRecord,
} from "./sources/epa/epa-client";
import type {
  CatalogVehicleMatchInput,
  CatalogVehicleSourceMatches,
  EpaCatalogSourceClient,
  NhtsaCatalogMatchCandidate,
  SourceMatchCandidateAssessment,
  SourceMatchDimension,
  SourceMatchResult,
  VehicleSourceMatchName,
} from "../../types/vehicleSourceMatch";

export const sourceMatchingPolicy = {
  probableThreshold: 0.72,
  ambiguityMargin: 0.1,
  unresolvedImportantFieldConfidenceCap: 0.84,
} as const;

type NormalizedCandidate = {
  sourceRecordId: string;
  vin: string | null;
  externalIds: Array<{ namespace: string; value: string }>;
  modelYear: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  fuelType: string | null;
  drivetrain: string | null;
  transmission: string | null;
  bodyStyle: string | null;
  vehicleCategory: string | null;
  engineDisplacementLiters: number | null;
  cylinders: number | null;
};

type Comparison = {
  outcome: "match" | "compatible" | "missing" | "conflict";
  rationale?: string;
};

type WeightedDimension = {
  dimension: SourceMatchDimension;
  weight: number;
  catalogValue: unknown;
  candidateValue: unknown;
  compare?: (catalogValue: unknown, candidateValue: unknown) => Comparison;
};

const defaultEpaClient: EpaCatalogSourceClient = {
  getMakesForYear,
  getModelsForYearMake,
  getVehicleOptions,
  getVehicleById,
};

export function matchCatalogVehicleSources(
  catalogVehicle: CatalogVehicleMatchInput,
  candidates: {
    nhtsa: readonly NhtsaCatalogMatchCandidate[];
    epa: readonly EpaVehicleRecord[];
  },
): CatalogVehicleSourceMatches {
  return {
    catalogVehicleId: catalogVehicle.id,
    nhtsa: matchNhtsaCandidates(catalogVehicle, candidates.nhtsa),
    epa: matchEpaCandidates(catalogVehicle, candidates.epa),
  };
}

export function matchNhtsaCandidates(
  catalogVehicle: CatalogVehicleMatchInput,
  candidates: readonly NhtsaCatalogMatchCandidate[],
): SourceMatchResult<NhtsaCatalogMatchCandidate> {
  return matchCandidates(
    "nhtsa",
    catalogVehicle,
    candidates,
    normalizeNhtsaCandidate,
  );
}

export function matchEpaCandidates(
  catalogVehicle: CatalogVehicleMatchInput,
  candidates: readonly EpaVehicleRecord[],
): SourceMatchResult<EpaVehicleRecord> {
  return matchCandidates(
    "epa",
    catalogVehicle,
    candidates,
    normalizeEpaCandidate,
  );
}

export async function discoverAndMatchEpaCandidates(
  catalogVehicle: CatalogVehicleMatchInput,
  client: EpaCatalogSourceClient = defaultEpaClient,
): Promise<SourceMatchResult<EpaVehicleRecord>> {
  const makes = await client.getMakesForYear(catalogVehicle.year);
  const makeMatches = makes.filter((item) => makesMatch(catalogVehicle.make, item.text) || makesMatch(catalogVehicle.make, item.value));
  if (!makeMatches.length) {
    return emptyResult("epa", `FuelEconomy.gov has no safely equivalent make for ${catalogVehicle.year} ${catalogVehicle.make}.`);
  }

  const modelMenus = await Promise.all(makeMatches.map(async (make) => ({
    make: make.value,
    models: await client.getModelsForYearMake(catalogVehicle.year, make.value),
  })));
  const modelMatches = modelMenus.flatMap(({ make, models }) => models
    .filter((model) => modelsMatch(catalogVehicle.model, model.text) || modelsMatch(catalogVehicle.model, model.value))
    .map((model) => ({ make, model: model.value })));
  if (!modelMatches.length) {
    return emptyResult("epa", `FuelEconomy.gov has no safely equivalent model for ${catalogVehicle.year} ${catalogVehicle.make} ${catalogVehicle.model}.`);
  }

  const optionGroups = await Promise.all(modelMatches.map(({ make, model }) => {
    return client.getVehicleOptions(catalogVehicle.year, make, model);
  }));
  const options = dedupeBy(optionGroups.flat(), (option) => option.id);
  if (!options.length) {
    return emptyResult("epa", "FuelEconomy.gov returned no configurations for the matched year, make, and model menus.");
  }

  const fetched = await Promise.allSettled(options.map((option) => client.getVehicleById(option.id)));
  const records = fetched.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!records.length) {
    return emptyResult("epa", "FuelEconomy.gov configurations were found, but none could be retrieved.");
  }

  const result = matchEpaCandidates(catalogVehicle, records);
  const failures = fetched.filter((item) => item.status === "rejected").length;
  return failures
    ? { ...result, rationale: [...result.rationale, `${failures} EPA configuration request${failures === 1 ? "" : "s"} failed and did not participate.`] }
    : result;
}

function matchCandidates<Candidate>(
  source: VehicleSourceMatchName,
  catalogVehicle: CatalogVehicleMatchInput,
  candidates: readonly Candidate[],
  normalizeCandidate: (candidate: Candidate) => NormalizedCandidate,
): SourceMatchResult<Candidate> {
  if (!candidates.length) return emptyResult(source, `No ${source.toUpperCase()} source candidates were available.`);
  const normalizedCandidates = candidates.map((candidate) => ({ candidate, normalized: normalizeCandidate(candidate) }));
  const uniqueCandidates = dedupeBy(normalizedCandidates, ({ normalized }) => {
    return `${normalized.sourceRecordId}:${JSON.stringify(normalized)}`;
  });
  const assessments = uniqueCandidates
    .map(({ candidate, normalized }) => assessCandidate(catalogVehicle, candidate, normalized))
    .sort(compareAssessments);
  const plausible = assessments.filter((item) => item.eligible && hasStrongIdentity(item));
  if (!plausible.length) {
    return {
      status: "not_found",
      source,
      selectedCandidate: null,
      candidates: assessments,
      confidence: 0,
      matchedOn: [],
      conflicts: uniqueSorted(assessments.flatMap((item) => item.conflicts)),
      missingComparisonFields: uniqueDimensions(assessments.flatMap((item) => item.missingComparisonFields)),
      rationale: [`Every ${source.toUpperCase()} candidate was absent, insufficiently identified, or contradicted the catalog vehicle.`],
    };
  }

  const top = plausible[0];
  const runnerUp = plausible[1];
  const margin = runnerUp ? round(top.confidence - runnerUp.confidence) : 1;
  const exactEligible = isExactAssessment(top);
  if (runnerUp && margin < sourceMatchingPolicy.ambiguityMargin) {
    return {
      status: "ambiguous",
      source,
      selectedCandidate: null,
      candidates: assessments,
      confidence: Math.min(0.69, top.confidence),
      matchedOn: top.matchedOn,
      conflicts: [],
      missingComparisonFields: top.missingComparisonFields,
      rationale: [
        `${plausible.length} candidates remain plausible.`,
        `The top-two confidence margin is ${margin.toFixed(2)}, below the required ${sourceMatchingPolicy.ambiguityMargin.toFixed(2)} margin.`,
        clarificationRationale(top, runnerUp),
      ],
    };
  }

  if (exactEligible) {
    return selectedResult("exact", source, assessments, top, [
      "Year, make, model, fuel type, drivetrain, and transmission agree without a hard contradiction.",
      runnerUp ? `The top candidate leads the runner-up by ${margin.toFixed(2)}.` : "Only one candidate remained plausible.",
    ]);
  }

  if (top.confidence >= sourceMatchingPolicy.probableThreshold) {
    return selectedResult("probable", source, assessments, top, [
      "Identity is strong, but at least one distinguishing configuration field remains unresolved.",
      runnerUp ? `The top candidate leads the runner-up by ${margin.toFixed(2)}.` : "Only one candidate remained plausible.",
    ]);
  }

  return {
    status: "not_found",
    source,
    selectedCandidate: null,
    candidates: assessments,
    confidence: 0,
    matchedOn: top.matchedOn,
    conflicts: [],
    missingComparisonFields: top.missingComparisonFields,
    rationale: [`The strongest candidate confidence ${top.confidence.toFixed(2)} is below the ${sourceMatchingPolicy.probableThreshold.toFixed(2)} probable threshold.`],
  };
}

function assessCandidate<Candidate>(
  catalog: CatalogVehicleMatchInput,
  candidate: Candidate,
  normalized: NormalizedCandidate,
): SourceMatchCandidateAssessment<Candidate> {
  const dimensions = comparisonDimensions(catalog, normalized);
  const matchedOn: SourceMatchDimension[] = [];
  const conflicts: string[] = [];
  const missingComparisonFields: SourceMatchDimension[] = [];
  const rationale: string[] = [];
  let earnedWeight = 0;
  let availableWeight = 0;

  for (const item of dimensions) {
    if (!hasCatalogValue(item.catalogValue)) continue;
    availableWeight += item.weight;
    const comparison = item.compare
      ? item.compare(item.catalogValue, item.candidateValue)
      : compareExact(item.catalogValue, item.candidateValue);
    if (comparison.outcome === "match") {
      earnedWeight += item.weight;
      matchedOn.push(item.dimension);
    } else if (comparison.outcome === "compatible") {
      earnedWeight += item.weight * 0.75;
      matchedOn.push(item.dimension);
      if (comparison.rationale) rationale.push(comparison.rationale);
    } else if (comparison.outcome === "missing") {
      earnedWeight += item.weight * 0.35;
      missingComparisonFields.push(item.dimension);
    } else {
      conflicts.push(`${item.dimension}: catalog ${display(item.catalogValue)} conflicts with source ${display(item.candidateValue)}`);
    }
  }

  let confidence = availableWeight ? earnedWeight / availableWeight : 0;
  const importantMissing = missingComparisonFields.some((field) => {
    return field === "fuelType" || field === "drivetrain" || field === "transmission";
  });
  if (importantMissing) confidence = Math.min(confidence, sourceMatchingPolicy.unresolvedImportantFieldConfidenceCap);
  if (conflicts.length) confidence = 0;
  if (!matchedOn.includes("modelYear") || !matchedOn.includes("make") || !matchedOn.includes("model")) {
    rationale.push("The candidate does not establish complete year/make/model identity.");
  }
  rationale.unshift(`${matchedOn.length} dimensions matched; ${missingComparisonFields.length} were unavailable; ${conflicts.length} conflicted.`);

  return {
    sourceRecordId: normalized.sourceRecordId,
    candidate,
    eligible: conflicts.length === 0,
    confidence: round(confidence),
    matchedOn: uniqueDimensions(matchedOn),
    conflicts,
    missingComparisonFields: uniqueDimensions(missingComparisonFields),
    rationale,
  };
}

function comparisonDimensions(
  catalog: CatalogVehicleMatchInput,
  candidate: NormalizedCandidate,
): WeightedDimension[] {
  const normalizedCatalog = {
    vin: normalizeVin(catalog.vin),
    externalIds: catalog.externalIds || [],
    modelYear: catalog.year,
    make: normalizeMake(catalog.make),
    model: normalizeModel(catalog.model),
    trim: normalizeText(catalog.trim),
    fuelType: normalizeFuelType(catalog.fuelType),
    drivetrain: normalizeDrivetrain(catalog.drivetrain),
    transmission: normalizeTransmission(catalog.transmission),
    bodyStyle: normalizeBodyStyle(catalog.bodyType),
    vehicleCategory: normalizeCategory(catalog.vehicleCategory),
    engineDisplacementLiters: finiteNumber(catalog.engineDisplacementLiters),
    cylinders: finiteNumber(catalog.cylinders),
  };
  return [
    { dimension: "vin", weight: 0.4, catalogValue: normalizedCatalog.vin, candidateValue: candidate.vin },
    { dimension: "externalId", weight: 0.25, catalogValue: normalizedCatalog.externalIds, candidateValue: candidate.externalIds, compare: compareExternalIds },
    { dimension: "modelYear", weight: 0.18, catalogValue: normalizedCatalog.modelYear, candidateValue: candidate.modelYear },
    { dimension: "make", weight: 0.18, catalogValue: normalizedCatalog.make, candidateValue: candidate.make },
    { dimension: "model", weight: 0.24, catalogValue: normalizedCatalog.model, candidateValue: candidate.model, compare: compareModel },
    { dimension: "trim", weight: 0.03, catalogValue: normalizedCatalog.trim, candidateValue: candidate.trim, compare: compareText },
    { dimension: "fuelType", weight: 0.11, catalogValue: normalizedCatalog.fuelType, candidateValue: candidate.fuelType },
    { dimension: "drivetrain", weight: 0.09, catalogValue: normalizedCatalog.drivetrain, candidateValue: candidate.drivetrain },
    { dimension: "transmission", weight: 0.08, catalogValue: normalizedCatalog.transmission, candidateValue: candidate.transmission, compare: compareTransmission },
    { dimension: "bodyStyle", weight: 0.05, catalogValue: normalizedCatalog.bodyStyle, candidateValue: candidate.bodyStyle },
    { dimension: "vehicleCategory", weight: 0.025, catalogValue: normalizedCatalog.vehicleCategory, candidateValue: candidate.vehicleCategory },
    { dimension: "engineDisplacement", weight: 0.025, catalogValue: normalizedCatalog.engineDisplacementLiters, candidateValue: candidate.engineDisplacementLiters, compare: compareNumber },
    { dimension: "cylinders", weight: 0.015, catalogValue: normalizedCatalog.cylinders, candidateValue: candidate.cylinders, compare: compareNumber },
  ];
}

function normalizeNhtsaCandidate(candidate: NhtsaCatalogMatchCandidate): NormalizedCandidate {
  return {
    sourceRecordId: candidate.sourceRecordId,
    vin: normalizeVin(candidate.vin),
    externalIds: candidate.externalIds || [],
    modelYear: candidate.modelYear,
    make: normalizeMake(candidate.make),
    model: normalizeModel(candidate.model),
    trim: normalizeText(candidate.trim),
    fuelType: normalizeFuelType(candidate.fuelTypePrimary),
    drivetrain: normalizeDrivetrain(candidate.driveType),
    transmission: normalizeTransmission(candidate.transmissionStyle),
    bodyStyle: normalizeBodyStyle(candidate.bodyClass),
    vehicleCategory: normalizeCategory(candidate.vehicleType),
    engineDisplacementLiters: finiteNumber(candidate.engineDisplacementLiters),
    cylinders: finiteNumber(candidate.cylinders),
  };
}

function normalizeEpaCandidate(candidate: EpaVehicleRecord): NormalizedCandidate {
  return {
    sourceRecordId: candidate.id,
    vin: null,
    externalIds: [{ namespace: "fueleconomy_gov_vehicle_id", value: candidate.id }],
    modelYear: candidate.year,
    make: normalizeMake(candidate.make),
    model: normalizeModel(candidate.model),
    trim: null,
    fuelType: normalizeEpaFuelType(candidate),
    drivetrain: normalizeDrivetrain(candidate.drive),
    transmission: normalizeTransmission(candidate.trany),
    bodyStyle: normalizeBodyStyle(candidate.VClass),
    vehicleCategory: normalizeCategory(candidate.VClass),
    engineDisplacementLiters: finiteNumber(candidate.displ),
    cylinders: finiteNumber(candidate.cylinders),
  };
}

function normalizeEpaFuelType(candidate: EpaVehicleRecord) {
  const combined = [candidate.fuelType, candidate.fuelType1, candidate.fuelType2, candidate.atvType]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ");
  const normalized = normalizeText(combined) || "";
  const hasElectric = /\b(electric|electricity|bev)\b/.test(normalized);
  const hasGas = /\b(gas|gasoline|regular|premium|midgrade)\b/.test(normalized) && !/natural gas/.test(normalized);
  if (/\b(plug in hybrid|phev)\b/.test(normalized) || (hasElectric && hasGas && ((candidate.range || 0) > 0 || (candidate.charge240 || 0) > 0))) return "plug_in_hybrid";
  if (/\b(hybrid|hev)\b/.test(normalized)) return "hybrid";
  if (hasElectric && hasGas) return null;
  if (hasElectric && !hasGas) return "electric";
  return normalizeFuelType(combined);
}

function normalizeMake(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const aliases: Record<string, string> = {
    "toyota motor corporation": "toyota",
    "honda motor co ltd": "honda",
    "ford motor company": "ford",
    "nissan motor co ltd": "nissan",
  };
  return aliases[normalized] || normalized;
}

function normalizeModel(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const compactLetterNumberName = String(value).replace(/\b([a-z])[-\s]+(\d{2,})\b/gi, "$1$2");
  const normalized = normalizeText(compactLetterNumberName);
  if (!normalized) return null;
  return normalized;
}

function normalizeFuelType(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/\b(plug in hybrid|phev)\b/.test(normalized)) return "plug_in_hybrid";
  if (/\b(hybrid|hev)\b/.test(normalized)) return "hybrid";
  if (/\b(battery electric|electricity|electric|bev)\b/.test(normalized)) return "electric";
  if (/\bdiesel\b/.test(normalized)) return "diesel";
  if (/\b(hydrogen|fuel cell|fcev)\b/.test(normalized)) return "hydrogen";
  if (/\b(gasoline|gas|regular|premium|midgrade|petrol)\b/.test(normalized)) return "gas";
  return normalized;
}

function normalizeDrivetrain(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/\b(front wheel drive|fwd)\b/.test(normalized)) return "FWD";
  if (/\b(rear wheel drive|rwd)\b/.test(normalized)) return "RWD";
  if (/\b(all wheel drive|awd)\b/.test(normalized)) return "AWD";
  if (/\b(4 wheel drive|four wheel drive|4wd|4x4)\b/.test(normalized)) return "4WD";
  return null;
}

function normalizeTransmission(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/\b(cvt|continuously variable|variable gear ratios)\b/.test(normalized)) return "cvt";
  if (/\bmanual\b/.test(normalized)) return "manual";
  if (/\bautomatic\b/.test(normalized)) return "automatic";
  return null;
}

function normalizeBodyStyle(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/\b(pickup|pickup truck)\b/.test(normalized)) return "truck";
  if (/\b(sport utility vehicle|suv|crossover utility)\b/.test(normalized)) return "suv";
  if (/\b(hatchback|liftback)\b/.test(normalized)) return "hatchback";
  if (/\b(sedan|saloon)\b/.test(normalized)) return "sedan";
  if (/\b(coupe)\b/.test(normalized)) return "coupe";
  if (/\b(convertible|roadster|cabriolet)\b/.test(normalized)) return "convertible";
  if (/\b(station wagon|wagon)\b/.test(normalized)) return "wagon";
  if (/\bminivan\b/.test(normalized)) return "minivan";
  return null;
}

function normalizeCategory(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/\bpickup\b/.test(normalized)) return "pickup";
  if (/\b(sport utility vehicle|suv)\b/.test(normalized)) return "suv";
  if (/\b(minicompact|subcompact) cars?\b/.test(normalized)) return "subcompact_car";
  if (/\bcompact cars?\b/.test(normalized)) return "compact_car";
  if (/\b(mid size|midsize) cars?\b/.test(normalized)) return "midsize_car";
  if (/\blarge cars?\b/.test(normalized)) return "large_car";
  if (/\bminivan\b/.test(normalized)) return "minivan";
  if (/\bvan\b/.test(normalized)) return "van";
  return null;
}

function compareExact(catalogValue: unknown, candidateValue: unknown): Comparison {
  if (!hasCandidateValue(candidateValue)) return { outcome: "missing" };
  return stableValue(catalogValue) === stableValue(candidateValue) ? { outcome: "match" } : { outcome: "conflict" };
}

function compareText(catalogValue: unknown, candidateValue: unknown): Comparison {
  if (!hasCandidateValue(candidateValue)) return { outcome: "missing" };
  return normalizeText(catalogValue) === normalizeText(candidateValue) ? { outcome: "match" } : { outcome: "conflict" };
}

function compareModel(catalogValue: unknown, candidateValue: unknown): Comparison {
  if (!hasCandidateValue(candidateValue)) return { outcome: "missing" };
  const catalog = String(catalogValue);
  const candidate = String(candidateValue);
  if (catalog === candidate) return { outcome: "match" };
  if (hasOnlyConfigurationSuffix(catalog, candidate) || hasOnlyConfigurationSuffix(candidate, catalog)) {
    return { outcome: "compatible", rationale: `Model labels ${JSON.stringify(catalog)} and ${JSON.stringify(candidate)} differ only by a recognized configuration suffix.` };
  }
  return { outcome: "conflict" };
}

function compareTransmission(catalogValue: unknown, candidateValue: unknown): Comparison {
  if (!hasCandidateValue(candidateValue)) return { outcome: "missing" };
  if (catalogValue === candidateValue) return { outcome: "match" };
  if ([catalogValue, candidateValue].includes("automatic") && [catalogValue, candidateValue].includes("cvt")) {
    return { outcome: "compatible", rationale: "Automatic and CVT were treated as compatible broad/specific automatic-family descriptions." };
  }
  return { outcome: "conflict" };
}

function compareNumber(catalogValue: unknown, candidateValue: unknown): Comparison {
  if (!hasCandidateValue(candidateValue)) return { outcome: "missing" };
  return Math.abs(Number(catalogValue) - Number(candidateValue)) <= 0.05 ? { outcome: "match" } : { outcome: "conflict" };
}

function compareExternalIds(catalogValue: unknown, candidateValue: unknown): Comparison {
  const catalogIds = Array.isArray(catalogValue) ? catalogValue as Array<{ namespace: string; value: string }> : [];
  const candidateIds = Array.isArray(candidateValue) ? candidateValue as Array<{ namespace: string; value: string }> : [];
  if (!candidateIds.length) return { outcome: "missing" };
  const candidateKeys = new Set(candidateIds.map(externalIdKey));
  return catalogIds.some((id) => candidateKeys.has(externalIdKey(id))) ? { outcome: "match" } : { outcome: "conflict" };
}

function hasOnlyConfigurationSuffix(base: string, extended: string) {
  if (!extended.startsWith(`${base} `)) return false;
  const suffix = extended.slice(base.length + 1).split(" ").filter(Boolean);
  return suffix.length > 0 && suffix.every((token) => {
    return /^(awd|fwd|rwd|2wd|4wd|4x4|pickup|hybrid|hev|phev|electric|ev|diesel|automatic|manual|cvt|[0-9]+(?:\.[0-9]+)?l?)$/.test(token);
  });
}

function isExactAssessment<Candidate>(assessment: SourceMatchCandidateAssessment<Candidate>) {
  return assessment.eligible
    && hasStrongIdentity(assessment)
    && assessment.matchedOn.includes("fuelType")
    && assessment.matchedOn.includes("drivetrain")
    && assessment.matchedOn.includes("transmission")
    && !assessment.missingComparisonFields.some((field) => field === "fuelType" || field === "drivetrain" || field === "transmission")
    && assessment.confidence >= 0.9;
}

function hasStrongIdentity<Candidate>(assessment: SourceMatchCandidateAssessment<Candidate>) {
  return assessment.matchedOn.includes("modelYear")
    && assessment.matchedOn.includes("make")
    && assessment.matchedOn.includes("model");
}

function selectedResult<Candidate>(
  status: "exact" | "probable",
  source: VehicleSourceMatchName,
  candidates: SourceMatchCandidateAssessment<Candidate>[],
  selectedCandidate: SourceMatchCandidateAssessment<Candidate>,
  rationale: string[],
): SourceMatchResult<Candidate> {
  return {
    status,
    source,
    selectedCandidate,
    candidates,
    confidence: status === "probable" ? Math.min(0.89, selectedCandidate.confidence) : selectedCandidate.confidence,
    matchedOn: selectedCandidate.matchedOn,
    conflicts: selectedCandidate.conflicts,
    missingComparisonFields: selectedCandidate.missingComparisonFields,
    rationale: [...rationale, ...selectedCandidate.rationale],
  };
}

function emptyResult<Candidate>(source: VehicleSourceMatchName, rationale: string): SourceMatchResult<Candidate> {
  return {
    status: "not_found",
    source,
    selectedCandidate: null,
    candidates: [],
    confidence: 0,
    matchedOn: [],
    conflicts: [],
    missingComparisonFields: [],
    rationale: [rationale],
  };
}

function clarificationRationale<Candidate>(
  top: SourceMatchCandidateAssessment<Candidate>,
  runnerUp: SourceMatchCandidateAssessment<Candidate>,
) {
  const topMissing = new Set(top.missingComparisonFields);
  const runnerMissing = new Set(runnerUp.missingComparisonFields);
  const distinguishingMissing = uniqueDimensions([
    ...top.missingComparisonFields.filter((field) => !runnerMissing.has(field)),
    ...runnerUp.missingComparisonFields.filter((field) => !topMissing.has(field)),
  ]);
  return distinguishingMissing.length
    ? `Additional ${distinguishingMissing[0]} information would help separate the leading candidates.`
    : "A trim, engine, or external configuration identifier is needed to separate the leading candidates.";
}

function compareAssessments<Candidate>(
  left: SourceMatchCandidateAssessment<Candidate>,
  right: SourceMatchCandidateAssessment<Candidate>,
) {
  if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
  return right.confidence - left.confidence || left.sourceRecordId.localeCompare(right.sourceRecordId);
}

function makesMatch(left: string, right: string) {
  const normalizedLeft = normalizeMake(left);
  return normalizedLeft !== null && normalizedLeft === normalizeMake(right);
}

function modelsMatch(left: string, right: string) {
  const normalizedLeft = normalizeModel(left);
  const normalizedRight = normalizeModel(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return compareModel(normalizedLeft, normalizedRight).outcome !== "conflict";
}

function normalizeText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeVin(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().toUpperCase();
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasCatalogValue(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "";
}

function hasCandidateValue(value: unknown) {
  return hasCatalogValue(value);
}

function stableValue(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : JSON.stringify(value);
}

function externalIdKey(id: { namespace: string; value: string }) {
  return `${normalizeText(id.namespace)}:${normalizeText(id.value)}`;
}

function uniqueDimensions(values: SourceMatchDimension[]) {
  return [...new Set(values)].sort();
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function dedupeBy<Value>(values: Value[], key: (value: Value) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function display(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  return JSON.stringify(value);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
