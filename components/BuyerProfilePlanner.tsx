"use client";

import { type ReactNode, useMemo, useState } from "react";
import { DataImportPanel } from "@/components/DataImportPanel";
import { RecommendationCard } from "@/components/RecommendationCard";
import { vehicleCatalog } from "@/data/vehicleCatalog";
import { calculateBudget, formatMoney, formatNumber } from "@/lib/affordability";
import { mergeVehicleData } from "@/lib/data/mergeVehicleData";
import {
  defaultScoreWeights,
  getRequirementMatches,
  getVehicleRequirementMisses,
  normalizeScoreWeights,
  rankVehicles,
  scoreWeightLabels,
} from "@/lib/recommendations";
import type { BuyerProfile, ScoreWeights } from "@/types/buyer";
import type { DataProviderStatus, VehicleDataOverlay } from "@/types/data";
import type { AiRecommendation, ScoredVehicle, Vehicle } from "@/types/vehicle";

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

type NumericField = {
  [Key in keyof BuyerProfile]: BuyerProfile[Key] extends number ? Key : never;
}[keyof BuyerProfile];

type ScoreWeightField = keyof ScoreWeights;
type AppView = "advisor" | "compare" | "advanced";

export function BuyerProfilePlanner() {
  const [activeView, setActiveView] = useState<AppView>("advisor");
  const [profile, setProfile] = useState<BuyerProfile>(defaultProfile);
  const [aiRecommendations, setAiRecommendations] = useState<AiRecommendation[]>([]);
  const [aiStatus, setAiStatus] = useState("Answer a few questions or browse the draft matches.");
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [importedOverlays, setImportedOverlays] = useState<VehicleDataOverlay[]>([]);
  const [onlineOverlays, setOnlineOverlays] = useState<VehicleDataOverlay[]>([]);
  const [providerStatus, setProviderStatus] = useState<DataProviderStatus[]>([]);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [isLoadingOnlineData, setIsLoadingOnlineData] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [naturalRequirements, setNaturalRequirements] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const budget = useMemo(() => calculateBudget(profile), [profile]);
  const enrichedVehicles = useMemo(
    () => mergeVehicleData(vehicleCatalog, [...importedOverlays, ...onlineOverlays]),
    [importedOverlays, onlineOverlays],
  );
  const matchedVehicles = useMemo(() => getRequirementMatches(profile, enrichedVehicles), [profile, enrichedVehicles]);
  const rankedVehicles = useMemo(() => rankVehicles(profile, matchedVehicles).slice(0, 10), [profile, matchedVehicles]);
  const normalizedWeights = useMemo(() => normalizeScoreWeights(profile.scoreWeights), [profile.scoreWeights]);
  const aiByVehicleId = new Map(aiRecommendations.map((item) => [item.vehicleId, item]));
  const answeredCount = getAnsweredCount(profile);
  const comparedVehicles = getComparedVehicles(rankedVehicles, compareIds);
  const hasNoMatch = rankedVehicles.length === 0;
  const noMatchReasons = useMemo(() => getNoMatchReasons(profile, enrichedVehicles), [profile, enrichedVehicles]);

  function updateProfile(nextProfile: BuyerProfile) {
    setProfile(nextProfile);
    setAiRecommendations([]);
    setAiStatus("Preferences changed. Search to refresh online data and AI personalization.");
  }

  async function applyWrittenRequirements(currentProfile: BuyerProfile) {
    const description = naturalRequirements.trim();
    if (!description) return { profile: currentProfile, summary: "" };

    const response = await fetch("/api/profile-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, profile: currentProfile }),
    });
    const payload = (await response.json()) as {
      profile?: BuyerProfile;
      summary?: string;
      warning?: string;
    };

    if (!response.ok || !payload.profile) throw new Error(payload.warning || "Could not understand written requirements.");
    return { profile: payload.profile, summary: payload.summary || "" };
  }

  function updateScoreWeight(field: ScoreWeightField, value: number) {
    updateProfile({
      ...profile,
      scoreWeights: {
        ...profile.scoreWeights,
        [field]: value,
      },
    });
  }

  function resetAdvisor() {
    setNaturalRequirements("");
    updateProfile(defaultProfile);
  }

  function toggleCompare(vehicleId: string) {
    setCompareIds((current) => {
      if (current.includes(vehicleId)) return current.filter((id) => id !== vehicleId);
      return [...current, vehicleId].slice(-4);
    });
  }

  function importCsvOverlays(overlays: VehicleDataOverlay[], warnings: string[]) {
    setImportedOverlays(overlays);
    setAiRecommendations([]);
    setAiStatus(
      overlays.length
        ? `Imported ${overlays.length} CSV overlay${overlays.length === 1 ? "" : "s"}${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}.`
        : warnings[0] || "No CSV overlays were imported.",
    );
  }

  function getOnlineLookupVehicles(currentProfile: BuyerProfile) {
    const currentMatches = getRequirementMatches(currentProfile, mergeVehicleData(vehicleCatalog, importedOverlays));
    const shortlist = rankVehicles(currentProfile, currentMatches).slice(0, 10);
    return shortlist.length ? shortlist : vehicleCatalog.slice(0, 10);
  }

  async function fetchOnlineDataOverlays(currentProfile: BuyerProfile = profile) {
    const lookupVehicles = getOnlineLookupVehicles(currentProfile);
    const response = await fetch("/api/vehicle-data/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicles: lookupVehicles.map((vehicle) => ({
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
        })),
      }),
    });
    const payload = (await response.json()) as {
      overlays?: VehicleDataOverlay[];
      warnings?: string[];
      providerStatus?: DataProviderStatus[];
    };

    if (!response.ok) throw new Error("Online data enrichment failed.");
    return {
      overlays: payload.overlays || [],
      warnings: payload.warnings || [],
      providerStatus: payload.providerStatus || [],
    };
  }

  async function loadOnlineData() {
    setIsLoadingOnlineData(true);
    setAiRecommendations([]);
    setAiStatus("Loading NHTSA, FuelEconomy.gov, and listing data...");

    try {
      const { overlays, warnings, providerStatus: nextProviderStatus } = await fetchOnlineDataOverlays();
      setOnlineOverlays(overlays);
      setDataWarnings(warnings);
      setProviderStatus(nextProviderStatus);
      setAiStatus(
        overlays.length
          ? `Loaded ${overlays.length} online data overlay${overlays.length === 1 ? "" : "s"}.${warnings.length ? ` ${warnings.join(" ")}` : ""}`
          : `Online sources returned no matching overlays; using catalog data.${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
      );
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "Could not load online vehicle data.");
    } finally {
      setIsLoadingOnlineData(false);
    }
  }

  async function searchRecommendations() {
    setIsSearching(true);
    setIsLoadingOnlineData(true);
    setIsPersonalizing(true);
    setAiRecommendations([]);
    setAiStatus("Searching written needs, online data, uploaded overlays, weighted scores, and AI personalization...");

    let freshOnlineOverlays = onlineOverlays;
    let onlineStatus = "";
    let searchProfile = profile;
    let writtenStatus = "";

    try {
      const interpreted = await applyWrittenRequirements(profile);
      searchProfile = interpreted.profile;
      writtenStatus = interpreted.summary;
      setProfile(searchProfile);
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "Could not understand written requirements.");
      setIsSearching(false);
      setIsPersonalizing(false);
      setIsLoadingOnlineData(false);
      return;
    }

    try {
      const onlineData = await fetchOnlineDataOverlays(searchProfile);
      freshOnlineOverlays = onlineData.overlays;
      setOnlineOverlays(freshOnlineOverlays);
      setDataWarnings(onlineData.warnings);
      setProviderStatus(onlineData.providerStatus);
      onlineStatus = freshOnlineOverlays.length
        ? `${freshOnlineOverlays.length} online overlay${freshOnlineOverlays.length === 1 ? "" : "s"}${onlineData.warnings.length ? ` (${onlineData.warnings.join(" ")})` : ""}`
        : `catalog fallback${onlineData.warnings.length ? ` (${onlineData.warnings.join(" ")})` : ""}`;
    } catch (error) {
      onlineStatus = "online data unavailable";
    } finally {
      setIsLoadingOnlineData(false);
    }

    try {
      const mergedVehicles = mergeVehicleData(vehicleCatalog, [...importedOverlays, ...freshOnlineOverlays]);
      const strictMatches = getRequirementMatches(searchProfile, mergedVehicles);
      if (!strictMatches.length) {
        setAiRecommendations([]);
        setAiStatus(
          `No match. ${writtenStatus ? `${writtenStatus} ` : ""}No cars satisfy every selected requirement with ${onlineStatus} and ${importedOverlays.length} uploaded overlay${importedOverlays.length === 1 ? "" : "s"}.`,
        );
        return;
      }

      const searchVehicles = rankVehicles(
        searchProfile,
        strictMatches,
      ).slice(0, 10);
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: searchProfile, vehicles: searchVehicles }),
      });
      const payload = (await response.json()) as {
        recommendations?: AiRecommendation[];
        configured?: boolean;
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error || "Recommendation request failed.");

      setAiRecommendations(payload.recommendations || []);
      setAiStatus(
        `${writtenStatus ? `${writtenStatus} ` : ""}${payload.configured ? "OpenAI personalization applied" : "Server fallback applied"} with ${onlineStatus} and ${importedOverlays.length} uploaded overlay${importedOverlays.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setAiStatus(error instanceof Error ? error.message : "Could not personalize recommendations");
    } finally {
      setIsSearching(false);
      setIsPersonalizing(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid w-full max-w-[1500px] gap-6 px-4 py-5 md:px-7">
        <header className="sticky top-0 z-20 -mx-4 border-b border-white/10 bg-slate-950/80 px-4 py-3 backdrop-blur-xl md:-mx-7 md:px-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Personalized Car Advisor</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white md:text-4xl">
                Find a first car with real data and clear tradeoffs.
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <NavButton active={activeView === "advisor"} onClick={() => setActiveView("advisor")}>
                Advisor
              </NavButton>
              <NavButton active={activeView === "compare"} onClick={() => setActiveView("compare")}>
                Compare
              </NavButton>
              <NavButton active={activeView === "advanced"} onClick={() => setActiveView("advanced")}>
                Advanced options
              </NavButton>
            </div>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <AdvisorTile
            description={`Loan principal from ${formatMoney(budget.paymentBudget)}/mo over ${profile.loanTermMonths} months at ${profile.apr}% APR, plus ${formatMoney(profile.downPayment)} down, divided by estimated tax and fees.`}
            label="Buying power"
            value={formatMoney(budget.maxPurchasePrice)}
          />
          <AdvisorTile
            description={`${formatMoney(profile.monthlyBudget)} budget minus ${formatMoney(profile.insuranceBudget)} insurance, ${formatMoney(budget.fuelCost)} fuel, and ${formatMoney(budget.maintenanceReserve)} maintenance reserve.`}
            label="Payment room"
            value={`${formatMoney(budget.paymentBudget)}/mo`}
          />
          <AdvisorTile label="Top match" value={rankedVehicles[0] ? `${rankedVehicles[0].make} ${rankedVehicles[0].model}` : "No match"} />
          <AdvisorTile label="Compare list" value={`${comparedVehicles.length} cars`} />
        </section>

        {activeView === "advisor" ? (
          <>
            <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-white">Quick advisor intake</h2>
                  <p className="text-sm font-semibold text-slate-400">
                    Keep it light. Every question is optional, and Advanced options are tucked away.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="min-h-11 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-black text-slate-200 transition hover:border-cyan-300/60 hover:bg-cyan-300/10"
                    onClick={resetAdvisor}
                    type="button"
                  >
                    Reset
                  </button>
                  <button
                    className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-default disabled:opacity-65"
                    disabled={isSearching || isPersonalizing || isLoadingOnlineData}
                    onClick={searchRecommendations}
                    type="button"
                  >
                    {isSearching ? "Searching" : "Search matches"}
                  </button>
                </div>
              </div>

              <label className="grid gap-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
                <span>Describe your requirements</span>
                <textarea
                  className="min-h-28 resize-y rounded-lg border border-white/10 bg-slate-950/50 px-3 py-3 text-sm font-semibold normal-case leading-6 tracking-normal text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
                  onChange={(event) => {
                    setNaturalRequirements(event.target.value);
                    setAiRecommendations([]);
                    setAiStatus("Written requirements changed. Search to apply them.");
                  }}
                  placeholder="Example: I need a used AWD SUV under $18k for snow, less than 90k miles, automatic, safe, reliable, and cheap to insure."
                  value={naturalRequirements}
                />
              </label>

              <div className="grid gap-4 lg:grid-cols-3">
                <QuestionGroup title="Budget">
                  <NumberField label="Purchase budget" field="maxPurchaseBudget" step={500} profile={profile} setProfile={updateProfile} />
                  <NumberField label="Monthly limit" field="monthlyBudget" step={25} profile={profile} setProfile={updateProfile} />
                  <NumberField label="Insurance budget" field="insuranceBudget" step={5} profile={profile} setProfile={updateProfile} />
                  <SelectField
                    label="Cash or financing"
                    value={profile.paymentMethod}
                    onChange={(value) => updateProfile({ ...profile, paymentMethod: value as BuyerProfile["paymentMethod"] })}
                    options={[
                      ["not-sure", "Not sure"],
                      ["cash", "Cash"],
                      ["financing", "Financing"],
                    ]}
                  />
                </QuestionGroup>

                <QuestionGroup title="Use case">
                  <SelectField
                    label="Body style"
                    value={profile.bodyStyle}
                    onChange={(value) => updateProfile({ ...profile, bodyStyle: value as BuyerProfile["bodyStyle"] })}
                    options={[
                      ["any", "Any"],
                      ["sedan", "Sedan"],
                      ["suv", "SUV"],
                      ["hatchback", "Hatchback"],
                      ["truck", "Truck"],
                      ["coupe", "Coupe"],
                      ["convertible", "Convertible"],
                      ["wagon", "Wagon"],
                      ["minivan", "Minivan"],
                    ]}
                  />
                  <SelectField
                    label="Climate"
                    value={profile.climate}
                    onChange={(value) => updateProfile({ ...profile, climate: value as BuyerProfile["climate"] })}
                    options={[
                      ["not-sure", "Not sure"],
                      ["mild", "Mostly mild"],
                      ["rain", "Rain often"],
                      ["snow", "Snow or ice"],
                    ]}
                  />
                  <NumberField label="Family size" field="familySize" step={1} profile={profile} setProfile={updateProfile} />
                  <SelectField
                    label="Cargo space"
                    value={profile.cargoNeed}
                    onChange={(value) => updateProfile({ ...profile, cargoNeed: value as BuyerProfile["cargoNeed"] })}
                    options={[
                      ["not-sure", "Not sure"],
                      ["low", "Low"],
                      ["medium", "Medium"],
                      ["high", "High"],
                    ]}
                  />
                </QuestionGroup>

                <QuestionGroup title="Preferences">
                  <NumberField label="Annual mileage" field="expectedAnnualMileage" step={500} profile={profile} setProfile={updateProfile} />
                  <NumberField label="Minimum MPG" field="minMpg" step={1} profile={profile} setProfile={updateProfile} />
                  <SelectField
                    label="Drive wheels"
                    value={profile.drivetrainPreference}
                    onChange={(value) => updateProfile({ ...profile, drivetrainPreference: value as BuyerProfile["drivetrainPreference"] })}
                    options={[
                      ["any", "Any"],
                      ["FWD", "FWD"],
                      ["AWD", "AWD"],
                      ["RWD", "RWD"],
                      ["4WD", "4WD"],
                    ]}
                  />
                  <SelectField
                    label="Safety priority"
                    value={profile.safetyPriority}
                    onChange={(value) => updateProfile({ ...profile, safetyPriority: value as BuyerProfile["safetyPriority"] })}
                    options={[
                      ["not-sure", "Not sure"],
                      ["standard", "Standard"],
                      ["high", "High"],
                      ["maximum", "Maximum"],
                    ]}
                  />
                </QuestionGroup>
              </div>
            </section>

            <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
              <div>
                <h2 className="text-xl font-black text-white">Detailed questionnaire</h2>
                <p className="text-sm font-semibold text-slate-400">
                  These controls now sit directly under the advisor intake and become strict requirements when selected.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <QuestionGroup title="Buying details">
                  <SelectField
                    label="New or used"
                    value={profile.purchaseCondition}
                    onChange={(value) => updateProfile({ ...profile, purchaseCondition: value as BuyerProfile["purchaseCondition"] })}
                    options={[
                      ["any", "Either"],
                      ["new", "Prefer new"],
                      ["used", "Prefer used"],
                    ]}
                  />
                  <NumberField label="Down payment" field="downPayment" step={100} profile={profile} setProfile={updateProfile} />
                  <NumberField label="APR estimate" field="apr" step={0.1} profile={profile} setProfile={updateProfile} />
                  <NumberField label="Max mileage" field="maxMileage" step={5000} profile={profile} setProfile={updateProfile} />
                </QuestionGroup>
                <QuestionGroup title="Taste and control">
                  <SelectField
                    label="Transmission"
                    value={profile.transmissionPreference}
                    onChange={(value) => updateProfile({ ...profile, transmissionPreference: value as BuyerProfile["transmissionPreference"] })}
                    options={[
                      ["any", "Any"],
                      ["automatic", "Automatic"],
                      ["manual", "Manual"],
                    ]}
                  />
                  <SelectField
                    label="Modify the car"
                    value={profile.modificationPlans}
                    onChange={(value) => updateProfile({ ...profile, modificationPlans: value as BuyerProfile["modificationPlans"] })}
                    options={[
                      ["not-sure", "Not sure"],
                      ["no", "No"],
                      ["yes", "Yes"],
                    ]}
                  />
                  <RangeField label="Performance" field="performanceImportance" profile={profile} setProfile={updateProfile} />
                  <RangeField label="Resale value" field="resaleValueImportance" profile={profile} setProfile={updateProfile} />
                </QuestionGroup>
              </div>
            </section>

            <section className="grid gap-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-black text-white">Recommended cars</h2>
                  <p className="text-sm font-semibold text-slate-400">{aiStatus}</p>
                </div>
                <p className="text-sm font-black text-cyan-300">
                  Showing top {Math.min(3, rankedVehicles.length)} · {answeredCount} optional signals used
                </p>
              </div>

              {hasNoMatch ? (
                <NoMatchPanel reasons={noMatchReasons} />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {rankedVehicles.slice(0, 3).map((vehicle) => (
                    <RecommendationCard
                      aiRecommendation={aiByVehicleId.get(vehicle.id)}
                      isCompared={compareIds.includes(vehicle.id)}
                      key={vehicle.id}
                      onToggleCompare={toggleCompare}
                      vehicle={vehicle}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}

        {activeView === "compare" ? <ComparisonView vehicles={comparedVehicles} /> : null}

        {activeView === "advanced" ? (
          <section className="grid gap-4">
            <DataImportPanel
              importedCount={importedOverlays.length}
              isLoadingOnlineData={isLoadingOnlineData}
              onImport={importCsvOverlays}
              onLoadOnlineData={loadOnlineData}
              onlineCount={onlineOverlays.length}
              providerStatus={providerStatus}
              warnings={dataWarnings}
            />

            <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
              <div>
                <h2 className="text-xl font-black text-white">Scoring weights</h2>
                <p className="text-sm font-semibold text-slate-400">
                  Tune how the advisor ranks cars. Values are normalized automatically.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(Object.keys(defaultScoreWeights) as ScoreWeightField[]).map((field) => (
                  <WeightField
                    field={field}
                    key={field}
                    label={scoreWeightLabels[field]}
                    normalizedValue={Math.round(normalizedWeights[field])}
                    onChange={updateScoreWeight}
                    value={profile.scoreWeights[field]}
                  />
                ))}
              </div>
            </section>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ComparisonView({ vehicles }: { vehicles: ScoredVehicle[] }) {
  if (!vehicles.length) {
    return (
      <section className="grid gap-4">
        <div>
          <h2 className="text-2xl font-black text-white">Side-by-side comparison</h2>
          <p className="text-sm font-semibold text-slate-400">No match. There are no cars to compare under the current requirements.</p>
        </div>
        <NoMatchPanel />
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-2xl font-black text-white">Side-by-side comparison</h2>
        <p className="text-sm font-semibold text-slate-400">
          Add cars from Advisor to compare, or review the top three matches by default.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/10 bg-white/[0.055] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="grid min-w-[920px]" style={{ gridTemplateColumns: `180px repeat(${vehicles.length}, minmax(210px, 1fr))` }}>
          <CompareLabel label="Vehicle" />
          {vehicles.map((vehicle) => (
            <div className="border-b border-white/10 p-4" key={vehicle.id}>
              <div className="aspect-[16/10] overflow-hidden rounded-lg bg-slate-900">
                {vehicle.imageUrl && vehicle.imageVerified ? (
                  <img alt={`${vehicle.make} ${vehicle.model}`} className="h-full w-full object-cover" src={vehicle.imageUrl} />
                ) : (
                  <div aria-hidden="true" className="relative h-full bg-slate-900">
                    <div className="absolute inset-x-5 bottom-8 h-8 rounded-t-full border border-white/10 bg-white/[0.035]" />
                    <div className="absolute bottom-6 left-1/2 h-2.5 w-20 -translate-x-1/2 rounded-full bg-cyan-300/18" />
                    <div className="absolute bottom-5 left-[34%] h-4 w-4 rounded-full border border-white/15 bg-slate-950" />
                    <div className="absolute bottom-5 right-[34%] h-4 w-4 rounded-full border border-white/15 bg-slate-950" />
                  </div>
                )}
              </div>
              <h3 className="mt-3 text-lg font-black text-white">
                {vehicle.make} {vehicle.model}
              </h3>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-cyan-300">{vehicle.year} · {vehicle.bodyType}</p>
            </div>
          ))}
          <CompareRow label="Overall match" values={vehicles.map((vehicle) => `${vehicle.matchSummary.overall}/100`)} />
          <CompareRow label="Affordability" values={vehicles.map((vehicle) => `${vehicle.matchSummary.affordability}/100`)} />
          <CompareRow label="Reliability match" values={vehicles.map((vehicle) => `${vehicle.matchSummary.reliability}/100`)} />
          <CompareRow label="Safety match" values={vehicles.map((vehicle) => `${vehicle.matchSummary.safety}/100`)} />
          <CompareRow label="Ownership cost" values={vehicles.map((vehicle) => `${vehicle.matchSummary.ownershipCost}/100`)} />
          <CompareRow label="Practicality" values={vehicles.map((vehicle) => `${vehicle.matchSummary.practicality}/100`)} />
          <CompareRow label="Price" values={vehicles.map((vehicle) => formatMoney(vehicle.price))} />
          <CompareRow label="Mileage" values={vehicles.map((vehicle) => formatNumber(vehicle.mileage))} />
          <CompareRow label="Insurance" values={vehicles.map((vehicle) => `${formatMoney(vehicle.ownership.insuranceMonthly)}/mo`)} />
          <CompareRow label="Maintenance" values={vehicles.map((vehicle) => `${formatMoney(vehicle.ownership.maintenanceMonthly)}/mo`)} />
          <CompareRow label="Fuel" values={vehicles.map((vehicle) => `${formatMoney(vehicle.ownership.fuelMonthly)}/mo`)} />
          <CompareRow label="Top pros" values={vehicles.map((vehicle) => vehicle.pros.slice(0, 2).join(", "))} />
          <CompareRow label="Watchouts" values={vehicles.map((vehicle) => vehicle.watchouts.slice(0, 2).join(", "))} />
        </div>
      </div>
    </section>
  );
}

function NoMatchPanel({ reasons = [] }: { reasons?: string[] }) {
  return (
    <section className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-5">
      <h3 className="text-xl font-black text-amber-100">No match</h3>
      <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-amber-50/80">
        No cars satisfy every selected requirement. Loosen one or more strict filters like budget,
        MPG, mileage, body style, drivetrain, transmission, safety priority, or written requirements,
        then run Search matches again.
      </p>
      {reasons.length ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {reasons.map((reason) => (
            <div className="rounded-lg border border-amber-200/15 bg-slate-950/30 px-3 py-2 text-sm font-bold text-amber-50" key={reason}>
              {reason}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CompareLabel({ label }: { label: string }) {
  return <div className="border-b border-white/10 p-4 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>;
}

function CompareRow({ label, values }: { label: string; values: string[] }) {
  return (
    <>
      <CompareLabel label={label} />
      {values.map((value, index) => (
        <div className="border-b border-white/10 p-4 text-sm font-bold leading-6 text-slate-200" key={`${label}-${index}`}>
          {value}
        </div>
      ))}
    </>
  );
}

function NavButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      className={`min-h-10 rounded-lg border px-4 text-sm font-black transition ${
        active
          ? "border-cyan-300 bg-cyan-300 text-slate-950"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/50 hover:bg-cyan-300/10"
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function QuestionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function NumberField({
  label,
  field,
  step,
  profile,
  setProfile,
}: {
  label: string;
  field: NumericField;
  step: number;
  profile: BuyerProfile;
  setProfile: (profile: BuyerProfile) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span>{label}</span>
      <input
        className="h-11 rounded-lg border border-white/10 bg-slate-950/50 px-3 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
        min={0}
        onChange={(event) => setProfile({ ...profile, [field]: Number(event.target.value) || 0 })}
        step={step}
        type="number"
        value={profile[field]}
      />
    </label>
  );
}

function RangeField({
  label,
  field,
  profile,
  setProfile,
}: {
  label: string;
  field: NumericField;
  profile: BuyerProfile;
  setProfile: (profile: BuyerProfile) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span className="flex items-center justify-between gap-2">
        {label}
        <strong className="text-white">{profile[field]}/5</strong>
      </span>
      <input
        className="h-8 accent-cyan-300"
        max={5}
        min={1}
        onChange={(event) => setProfile({ ...profile, [field]: Number(event.target.value) })}
        step={1}
        type="range"
        value={profile[field]}
      />
    </label>
  );
}

function WeightField({
  field,
  label,
  value,
  normalizedValue,
  onChange,
}: {
  field: ScoreWeightField;
  label: string;
  value: number;
  normalizedValue: number;
  onChange: (field: ScoreWeightField, value: number) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span className="flex items-center justify-between gap-2">
        {label}
        <strong className="text-white">{normalizedValue}%</strong>
      </span>
      <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
        <input
          className="h-8 accent-cyan-300"
          max={50}
          min={0}
          onChange={(event) => onChange(field, Number(event.target.value))}
          step={1}
          type="range"
          value={value}
        />
        <input
          aria-label={`${label} weight value`}
          className="h-9 rounded-lg border border-white/10 bg-slate-950/50 px-2 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
          max={50}
          min={0}
          onChange={(event) => onChange(field, Number(event.target.value))}
          step={1}
          type="number"
          value={value}
        />
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
      <span>{label}</span>
      <select
        className="h-11 rounded-lg border border-white/10 bg-slate-950/50 px-3 text-sm font-extrabold text-white outline-none transition focus:border-cyan-300/80 focus:ring-4 focus:ring-cyan-300/15"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function AdvisorTile({ description, label, value }: { description?: string; label: string; value: string }) {
  return (
    <div className="min-h-24 rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur">
      <strong className="block truncate text-xl font-black text-white">{value}</strong>
      <span className="mt-2 block text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
      {description ? <span className="mt-2 block text-xs font-semibold leading-5 text-slate-500">{description}</span> : null}
    </div>
  );
}

function getComparedVehicles(vehicles: ScoredVehicle[], compareIds: string[]) {
  const selectedVehicles = vehicles.filter((vehicle) => compareIds.includes(vehicle.id));
  return selectedVehicles.length ? selectedVehicles : vehicles.slice(0, 3);
}

function getAnsweredCount(profile: BuyerProfile) {
  const neutralValues = new Set(["not-sure", "any"]);
  const optionalSignals = [
    profile.purchaseCondition,
    profile.paymentMethod,
    profile.cargoNeed,
    profile.drivetrainPreference,
    profile.transmissionPreference,
    profile.bodyStyle,
    profile.climate,
    profile.modificationPlans,
    profile.safetyPriority,
  ].filter((value) => !neutralValues.has(value)).length;

  const numericSignals = [
    profile.maxPurchaseBudget,
    profile.monthlyBudget,
    profile.insuranceBudget,
    profile.expectedAnnualMileage,
    profile.familySize > 1 ? profile.familySize : 0,
  ].filter(Boolean).length;

  return formatNumber(optionalSignals + numericSignals);
}

function getNoMatchReasons(profile: BuyerProfile, vehicles: Vehicle[]) {
  const counts = new Map<string, number>();
  vehicles.forEach((vehicle) => {
    getVehicleRequirementMisses(vehicle, profile).forEach((miss) => {
      counts.set(miss, (counts.get(miss) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([reason, count]) => `${reason} (${count} car${count === 1 ? "" : "s"})`);
}
