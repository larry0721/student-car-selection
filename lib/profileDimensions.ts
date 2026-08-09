import type {
  BodyStyle,
  BuyerProfile,
  Drivetrain,
  FuelType,
  Transmission,
} from "@/types/buyer";

export type ProfileDimension = "make" | "bodyStyle" | "vehicleCategory" | "fuelType" | "drivetrain" | "transmission";
export type ProfileDimensionIntent = "required" | "preferred" | "allowed" | "excluded";
export type ProfileDimensionState<T extends string> = Record<ProfileDimensionIntent, T[]>;

export function getProfileDimensionState(
  profile: BuyerProfile,
  dimension: ProfileDimension,
): ProfileDimensionState<string> {
  const state = emptyDimensionState();
  const hasCanonicalState = hasCanonicalDimensionState(profile, dimension);
  switch (dimension) {
    case "make":
      state.required.push(...(profile.requiredMakes || []), ...(!hasCanonicalState && profile.requiredMake ? [profile.requiredMake] : []));
      state.preferred.push(...(profile.preferredMakes || []), ...(!hasCanonicalState && profile.preferredMake ? [profile.preferredMake] : []));
      state.allowed.push(...(profile.allowedMakes || []));
      state.excluded.push(...(profile.excludedMakes || []));
      break;
    case "bodyStyle":
      state.required.push(...(profile.requiredBodyStyles || []), ...(!hasCanonicalState && profile.bodyStyle !== "any" ? [profile.bodyStyle] : []));
      state.preferred.push(...(profile.preferredBodyStyles || []));
      state.allowed.push(...(profile.allowedBodyStyles || []));
      state.excluded.push(...(profile.excludedBodyStyles || []));
      break;
    case "vehicleCategory":
      state.required.push(...(profile.requiredVehicleCategories || []));
      state.preferred.push(...(profile.preferredVehicleCategories || []));
      state.allowed.push(...(profile.allowedVehicleCategories || []));
      state.excluded.push(...(profile.excludedVehicleCategories || []));
      break;
    case "fuelType":
      state.required.push(...(profile.requiredFuelTypes || []), ...(!hasCanonicalState && profile.requiredFuelType ? [profile.requiredFuelType] : []));
      state.preferred.push(...(profile.preferredFuelTypes || []));
      state.allowed.push(...(profile.allowedFuelTypes || []));
      state.excluded.push(...(profile.excludedFuelTypes || []));
      break;
    case "drivetrain":
      state.required.push(...(profile.requiredDrivetrains || []), ...(!hasCanonicalState && profile.drivetrainPreference !== "any" ? [profile.drivetrainPreference] : []));
      state.preferred.push(...(profile.preferredDrivetrains || []));
      state.allowed.push(...(profile.allowedDrivetrains || []));
      state.excluded.push(...(profile.excludedDrivetrains || []));
      break;
    case "transmission":
      state.required.push(...(profile.requiredTransmissions || []), ...(!hasCanonicalState && profile.transmissionPreference !== "any" ? [profile.transmissionPreference] : []));
      state.preferred.push(...(profile.preferredTransmissions || []));
      state.allowed.push(...(profile.allowedTransmissions || []));
      state.excluded.push(...(profile.excludedTransmissions || []));
      break;
  }
  return resolveDimensionState(state);
}

export function hasCanonicalDimensionState(profile: BuyerProfile, dimension: ProfileDimension) {
  const fields: Record<ProfileDimension, Array<keyof BuyerProfile>> = {
    // `allowedMakes` and `excludedMakes` predate this migration. Required and
    // preferred arrays are the unambiguous signal that make state is canonical.
    make: ["requiredMakes", "preferredMakes"],
    bodyStyle: ["requiredBodyStyles", "preferredBodyStyles", "allowedBodyStyles", "excludedBodyStyles"],
    vehicleCategory: ["requiredVehicleCategories", "preferredVehicleCategories", "allowedVehicleCategories", "excludedVehicleCategories"],
    fuelType: ["requiredFuelTypes", "preferredFuelTypes", "allowedFuelTypes", "excludedFuelTypes"],
    drivetrain: ["requiredDrivetrains", "preferredDrivetrains", "allowedDrivetrains", "excludedDrivetrains"],
    transmission: ["requiredTransmissions", "preferredTransmissions", "allowedTransmissions", "excludedTransmissions"],
  };
  return fields[dimension].some((field) => Array.isArray(profile[field]) && (profile[field] as string[]).length > 0);
}

export function resolveDimensionState<T extends string>(input: ProfileDimensionState<T>): ProfileDimensionState<T> {
  const excluded = unique(input.excluded);
  const required = unique(input.required).filter((value) => !excluded.includes(value));
  const preferred = unique(input.preferred).filter((value) => !excluded.includes(value) && !required.includes(value));
  const allowed = unique(input.allowed).filter((value) => !excluded.includes(value) && !required.includes(value) && !preferred.includes(value));
  return { required: required as T[], preferred: preferred as T[], allowed: allowed as T[], excluded: excluded as T[] };
}

export function withDimensionIntent<T extends string>(
  current: ProfileDimensionState<T>,
  intent: ProfileDimensionIntent,
  values: T[],
): ProfileDimensionState<T> {
  return resolveDimensionState({
    ...current,
    [intent]: [...current[intent], ...values],
  });
}

export function applyDimensionIntent<T extends string>(
  profile: BuyerProfile,
  dimension: ProfileDimension,
  intent: ProfileDimensionIntent,
  values: T[],
): BuyerProfile {
  const current = getProfileDimensionState(profile, dimension) as ProfileDimensionState<T>;
  const normalizedValues = unique(values) as T[];
  const next: ProfileDimensionState<T> = {
    required: current.required.filter((value) => !normalizedValues.includes(value)),
    preferred: current.preferred.filter((value) => !normalizedValues.includes(value)),
    allowed: current.allowed.filter((value) => !normalizedValues.includes(value)),
    excluded: current.excluded.filter((value) => !normalizedValues.includes(value)),
  };
  next[intent].push(...normalizedValues);
  return applyDimensionState(profile, dimension, resolveDimensionState(next));
}

export function normalizeProfileDimensions(profile: BuyerProfile) {
  return (Object.keys(dimensionFields) as ProfileDimension[]).reduce(
    (next, dimension) => applyDimensionState(next, dimension, getProfileDimensionState(next, dimension)),
    profile,
  );
}

export function dimensionField(
  dimension: ProfileDimension,
  intent: ProfileDimensionIntent,
): keyof BuyerProfile {
  return dimensionFields[dimension][intent];
}

export function dimensionIntentForField(field: keyof BuyerProfile): { dimension: ProfileDimension; intent: ProfileDimensionIntent } | null {
  for (const [dimension, intents] of Object.entries(dimensionFields) as Array<[ProfileDimension, Record<ProfileDimensionIntent, keyof BuyerProfile>]>) {
    for (const intent of ["required", "preferred", "allowed", "excluded"] as const) {
      if (intents[intent] === field) return { dimension, intent };
    }
  }
  return null;
}

const dimensionFields: Record<ProfileDimension, Record<ProfileDimensionIntent, keyof BuyerProfile>> = {
    make: { required: "requiredMakes", preferred: "preferredMakes", allowed: "allowedMakes", excluded: "excludedMakes" },
    bodyStyle: { required: "requiredBodyStyles", preferred: "preferredBodyStyles", allowed: "allowedBodyStyles", excluded: "excludedBodyStyles" },
    vehicleCategory: { required: "requiredVehicleCategories", preferred: "preferredVehicleCategories", allowed: "allowedVehicleCategories", excluded: "excludedVehicleCategories" },
    fuelType: { required: "requiredFuelTypes", preferred: "preferredFuelTypes", allowed: "allowedFuelTypes", excluded: "excludedFuelTypes" },
    drivetrain: { required: "requiredDrivetrains", preferred: "preferredDrivetrains", allowed: "allowedDrivetrains", excluded: "excludedDrivetrains" },
    transmission: { required: "requiredTransmissions", preferred: "preferredTransmissions", allowed: "allowedTransmissions", excluded: "excludedTransmissions" },
};

export function applyDimensionState<T extends string>(
  profile: BuyerProfile,
  dimension: ProfileDimension,
  state: ProfileDimensionState<T>,
): BuyerProfile {
  const next = { ...profile } as BuyerProfile;
  for (const intent of ["required", "preferred", "allowed", "excluded"] as const) {
    (next as unknown as Record<string, unknown>)[dimensionField(dimension, intent)] = state[intent].length ? state[intent] : undefined;
  }
  applyLegacyCompatibility(next, dimension, state);
  return next;
}

function applyLegacyCompatibility(profile: BuyerProfile, dimension: ProfileDimension, state: ProfileDimensionState<string>) {
  if (dimension === "make") {
    profile.requiredMake = state.required.length === 1 ? state.required[0] : undefined;
    profile.preferredMake = state.preferred.length === 1 ? state.preferred[0] : undefined;
    profile.allowedMakes = state.allowed.length ? state.allowed : undefined;
    profile.excludedMakes = state.excluded.length ? state.excluded : undefined;
  }
  if (dimension === "bodyStyle") profile.bodyStyle = state.required.length === 1 ? state.required[0] as BodyStyle : "any";
  if (dimension === "fuelType") profile.requiredFuelType = state.required.length === 1 ? state.required[0] as FuelType : undefined;
  if (dimension === "drivetrain") profile.drivetrainPreference = state.required.length === 1 ? state.required[0] as Drivetrain : "any";
  if (dimension === "transmission") {
    profile.transmissionPreference = state.required.length === 1 && state.required[0] !== "cvt"
      ? state.required[0] as Exclude<Transmission, "cvt">
      : "any";
  }
}

function emptyDimensionState(): ProfileDimensionState<string> {
  return { required: [], preferred: [], allowed: [], excluded: [] };
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
