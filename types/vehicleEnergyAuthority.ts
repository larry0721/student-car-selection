export type ConventionalMpgAuthority = Readonly<{
  kind: "conventional_mpg";
  fuelType: "gas" | "hybrid";
  value: number;
  unit: "mpg";
  legacyMpgCompatible: true;
}>;

export type ElectricMpgeAuthority = Readonly<{
  kind: "electric_mpge";
  value: number;
  unit: "mpge";
  legacyMpgCompatible: false;
}>;

export type ElectricConsumptionAuthority = Readonly<{
  kind: "electric_consumption";
  value: number;
  unit: "kwh_per_100_miles";
  legacyMpgCompatible: false;
}>;

export type ElectricRangeAuthority = Readonly<{
  kind: "electric_range";
  value: number;
  unit: "miles";
  legacyMpgCompatible: false;
}>;

export type VehicleEnergyAuthority =
  | ConventionalMpgAuthority
  | ElectricMpgeAuthority
  | ElectricConsumptionAuthority
  | ElectricRangeAuthority;
