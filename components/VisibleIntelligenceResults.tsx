import { useMemo, useState } from "react";
import { formatMoney, formatNumber } from "@/lib/affordability";
import { scoreWeightLabels } from "@/lib/recommendations";
import type { BuyerProfile } from "@/types/buyer";
import type {
  CandidatePipelineDebug,
  DecisionReport,
  DecisionReportChoice,
  FieldProvenance,
  HardConstraintResult,
  RecommendationAssumption,
  RecommendationDecisionSet,
  RecommendationObject,
  RecommendationSignal,
  RecommendationTradeoff,
  ScoredVehicle,
} from "@/types/vehicle";

type VisibleIntelligenceResultsProps = {
  rankedVehicles: ScoredVehicle[];
  decisionSet: RecommendationDecisionSet;
  decisionReport: DecisionReport;
  profile: BuyerProfile;
  compareIds: string[];
  onToggleCompare: (vehicleId: string) => void;
};

type DecisionSignal = {
  title: string;
  conclusion: string;
  support: string;
};

export function VisibleIntelligenceResults({
  rankedVehicles,
  decisionSet,
  decisionReport,
  profile,
  compareIds,
  onToggleCompare,
}: VisibleIntelligenceResultsProps) {
  const [showChangeFactors, setShowChangeFactors] = useState(false);
  const topVehicle = rankedVehicles[0];
  const recommendation = topVehicle?.recommendation || decisionSet.primaryRecommendations[0];
  const runnerUpLoss = decisionSet.pipelineDebug.runnerUpLossReasons[0]?.primaryReason || decisionReport.whyRunnerUpLost;

  const advisorText = useMemo(() => {
    if (!recommendation || !topVehicle) return { headline: "", reason: "" };
    return getAdvisorText(recommendation, topVehicle);
  }, [recommendation, topVehicle]);

  if (!topVehicle || !recommendation) return null;

  const monthlyHeadroom = profile.monthlyBudget - recommendation.ownershipSummary.estimatedMonthlyTotal;
  const biggestTradeoff = getBiggestTradeoff(recommendation);
  const decisionSignals = getDecisionSignals(topVehicle, recommendation, profile, monthlyHeadroom);
  const needsDataDisclosure = recommendation.dataQualityConfidence.level !== "high";
  const missingInformation = recommendation.missingInformation.map(
    (item) => `${formatFieldLabel(item.field)} from ${item.expectedSource} (${item.impact} impact)`,
  );
  const estimatedFields = recommendation.estimatedFields.map(
    (item) => `${formatFieldLabel(item.field)}: ${formatEstimateValue(item.value, item.unit)} by ${item.method}`,
  );

  return (
    <div className="grid gap-4">
      <section className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.06] shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur">
        <div className="grid gap-0 lg:grid-cols-[minmax(260px,0.74fr)_minmax(0,1.26fr)]">
          <VehicleImage vehicle={topVehicle} />

          <div className="grid gap-5 p-5 md:p-7">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.13em] text-cyan-100">
                  Advisor recommendation
                </span>
                <span className="text-xs font-bold text-slate-400">
                  {decisionSet.pipelineDebug.qualifiedCount} of {decisionSet.pipelineDebug.candidateCount} valid candidates satisfied your requirements.
                </span>
              </div>
              <div>
                <h2 className="max-w-4xl text-3xl font-black leading-tight tracking-tight text-white md:text-5xl">
                  {advisorText.headline}
                </h2>
                <p className="mt-3 max-w-3xl text-base font-semibold leading-7 text-slate-200 md:text-lg">
                  {advisorText.reason}
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {decisionSignals.map((signal) => (
                <DecisionSignalCard key={signal.title} signal={signal} />
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
              <div className="rounded-lg border border-amber-200/15 bg-amber-200/10 p-4">
                <p className="text-sm font-black text-amber-50">The main compromise is {biggestTradeoff}</p>
              </div>
              <div className="grid gap-2 rounded-lg border border-white/10 bg-slate-950/35 p-4">
                <ConfidenceLine
                  label="Recommendation confidence"
                  score={recommendation.recommendationConfidence.score}
                  level={recommendation.recommendationConfidence.level}
                  note="Reflects how clearly this car fits your profile."
                />
                <ConfidenceLine
                  label="Data confidence"
                  score={recommendation.dataQualityConfidence.score}
                  level={recommendation.dataQualityConfidence.level}
                  note="Reflects how complete and verified the vehicle information is."
                />
              </div>
            </div>

            {needsDataDisclosure ? (
              <p className="rounded-lg border border-white/10 bg-slate-950/35 px-4 py-3 text-sm font-semibold leading-6 text-slate-300">
                This recommendation is suitable for shortlisting. Live price, mileage, and condition should be verified before purchase.
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200"
                onClick={() => setShowChangeFactors((current) => !current)}
                type="button"
              >
                What would change your recommendation?
              </button>
              <button
                className={`min-h-11 rounded-lg border px-4 text-sm font-black transition ${
                  compareIds.includes(topVehicle.id)
                    ? "border-cyan-300 bg-cyan-300/20 text-cyan-100"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan-300/50 hover:bg-cyan-300/10"
                }`}
                onClick={() => onToggleCompare(topVehicle.id)}
                type="button"
              >
                {compareIds.includes(topVehicle.id) ? "Added to compare" : "Compare"}
              </button>
            </div>

            {showChangeFactors ? <ChangeFactors items={decisionReport.whatCouldChangeRecommendation} /> : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.05] p-4 md:p-5">
        <SectionHeader eyebrow="Alternative Perspectives" title="The same recommendation set viewed four ways." />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <PerspectiveCard title="Best Overall" choice={decisionReport.bestOverall} recommendation={findRecommendation(decisionSet, decisionReport.bestOverall)} />
          <PerspectiveCard title="Best Value" choice={decisionReport.bestValue} recommendation={findRecommendation(decisionSet, decisionReport.bestValue)} />
          <PerspectiveCard title="Safest Choice" choice={decisionReport.safestChoice} recommendation={findRecommendation(decisionSet, decisionReport.safestChoice)} />
          <PerspectiveCard title="User Preferred Choice" choice={decisionReport.userPreferredChoice} recommendation={findRecommendation(decisionSet, decisionReport.userPreferredChoice)} />
        </div>
      </section>

      <details className="group rounded-lg border border-white/10 bg-white/[0.05] p-4 md:p-5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4">
          <SectionHeader eyebrow="How I reached this decision" title="Open the candidate pipeline." />
          <ExpandIcon />
        </summary>
        <div className="mt-5 border-t border-white/10 pt-5">
          <PipelineStrip debug={decisionSet.pipelineDebug} />
        </div>
      </details>

      <details className="group rounded-lg border border-white/10 bg-white/[0.05] p-4 md:p-5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4">
          <SectionHeader eyebrow="Ownership Details" title="Open the cost breakdown." />
          <ExpandIcon />
        </summary>
        <div className="mt-5 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="Purchase price" value={formatMoney(topVehicle.price)} />
          <InfoTile label="Monthly ownership" value={`${formatMoney(recommendation.ownershipSummary.estimatedMonthlyTotal)}/mo`} />
          <InfoTile label="Insurance" value={`${formatMoney(recommendation.ownershipSummary.insuranceMonthly)}/mo`} />
          <InfoTile label="Fuel" value={`${formatMoney(recommendation.ownershipSummary.fuelMonthly)}/mo`} />
          <InfoTile label="Maintenance" value={`${formatMoney(recommendation.ownershipSummary.maintenanceMonthly)}/mo`} />
          <InfoTile label="First-year ownership" value={formatMoney(recommendation.firstYearOwnershipEstimate.total)} />
          <InfoTile label="Mileage" value={formatNumber(topVehicle.mileage)} />
          <InfoTile label="Age" value={`${Math.max(0, new Date().getFullYear() - topVehicle.year)} years`} />
          <BudgetHeadroom monthlyHeadroom={monthlyHeadroom} profile={profile} />
        </div>
      </details>

      <details className="group rounded-lg border border-white/10 bg-white/[0.05] p-4 md:p-5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4">
          <SectionHeader eyebrow="Full Reasoning and Provenance" title="Open the detailed decision trace." />
          <ExpandIcon />
        </summary>
        <div className="mt-5 grid gap-4 border-t border-white/10 pt-5 xl:grid-cols-2">
          <NoteList title="User Priorities" items={formatSignals(decisionReport.userPriorities)} />
          <ConstraintList title="Hard Requirements" constraints={decisionReport.hardRequirements} />
          <NoteList title="Category Contributions" items={formatSignals(recommendation.reasonsForRecommendation)} />
          <TradeoffList tradeoffs={decisionReport.primaryTradeoffs} />
          <NoteList title="Runner-up" items={formatRunnerUp(decisionReport.runnerUp, decisionReport.whyRunnerUpLost, runnerUpLoss)} />
          <NoteList title="Why Runner-up Lost" items={[runnerUpLoss]} />
          <NoteList title="Assumptions" items={formatAssumptions(decisionReport.assumptions)} />
          <NoteList title="Estimated Fields" items={estimatedFields} />
          <NoteList title="Missing Information" items={missingInformation} />
          <ProvenanceList provenance={recommendation.fieldProvenance} />
        </div>
      </details>
    </div>
  );
}

function VehicleImage({ vehicle }: { vehicle: ScoredVehicle }) {
  return (
    <div className="relative min-h-[220px] overflow-hidden bg-slate-900 md:min-h-[300px] lg:min-h-[470px]">
      {vehicle.imageUrl ? (
        <img
          alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          className="h-full min-h-[220px] w-full object-cover md:min-h-[300px] lg:min-h-[470px]"
          src={vehicle.imageUrl}
        />
      ) : (
        <div aria-hidden="true" className="relative h-full min-h-[220px] bg-slate-900 md:min-h-[300px] lg:min-h-[470px]">
          <div className="absolute inset-x-[14%] bottom-[28%] h-[18%] rounded-t-full border border-white/10 bg-white/[0.05]" />
          <div className="absolute bottom-[24%] left-1/2 h-3 w-36 -translate-x-1/2 rounded-full bg-cyan-300/20" />
          <div className="absolute bottom-[22%] left-[31%] h-8 w-8 rounded-full border border-white/15 bg-slate-950" />
          <div className="absolute bottom-[22%] right-[31%] h-8 w-8 rounded-full border border-white/15 bg-slate-950" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
      <div className="absolute bottom-4 left-4 right-4">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">
          {vehicle.year} {vehicle.bodyType} · {vehicle.drivetrain} · {vehicle.transmission}
        </p>
        <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-300">
          Data: {formatDataSources(vehicle.dataSources)} · Updated {formatDataDate(vehicle.dataUpdatedAt)}
        </p>
      </div>
    </div>
  );
}

function DecisionSignalCard({ signal }: { signal: DecisionSignal }) {
  return (
    <article className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{signal.title}</p>
      <h3 className="mt-2 text-lg font-black leading-tight text-white">{signal.conclusion}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{signal.support}</p>
    </article>
  );
}

function ConfidenceLine({
  label,
  score,
  level,
  note,
}: {
  label: string;
  score: number;
  level: "high" | "medium" | "low";
  note: string;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-black text-white">{label}</span>
        <span className="text-sm font-black capitalize text-cyan-100">{score}/100 {level}</span>
      </div>
      <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">{note}</p>
    </div>
  );
}

function BudgetHeadroom({ monthlyHeadroom, profile }: { monthlyHeadroom: number; profile: BuyerProfile }) {
  return (
    <div className={`rounded-lg border p-3 sm:col-span-2 xl:col-span-4 ${
      monthlyHeadroom >= 0 ? "border-emerald-300/20 bg-emerald-300/10" : "border-amber-300/25 bg-amber-300/10"
    }`}>
      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-300">
        {monthlyHeadroom >= 0 ? "Budget headroom" : "Budget conflict"}
      </span>
      <strong className="mt-1 block text-xl font-black text-white">
        {monthlyHeadroom >= 0 ? `${formatMoney(monthlyHeadroom)}/mo remaining` : `${formatMoney(Math.abs(monthlyHeadroom))}/mo over limit`}
      </strong>
      <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
        Based on your {formatMoney(profile.monthlyBudget)}/mo ownership budget and the deterministic ownership estimate.
      </p>
    </div>
  );
}

function ExpandIcon() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-xl font-black text-cyan-200 transition group-open:rotate-45">
      +
    </span>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black tracking-tight text-white md:text-2xl">{title}</h2>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <span className="block text-[0.68rem] font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <strong className="mt-1 block text-base font-black text-white">{value}</strong>
    </div>
  );
}

function PipelineStrip({ debug }: { debug: CandidatePipelineDebug }) {
  const steps = [
    { label: "Catalog loaded", value: debug.catalogCount },
    { label: "Valid candidates", value: debug.candidateCount },
    { label: "Excluded by requirements", value: debug.excludedCount },
    { label: "Qualified", value: debug.qualifiedCount },
    { label: "Compared by priorities", value: debug.filteredCount },
    { label: "Recommended", value: debug.topFive[0] ? 1 : 0 },
  ];

  return (
    <div className="grid gap-2 md:grid-cols-6">
      {steps.map((step, index) => (
        <div className="relative rounded-lg border border-white/10 bg-slate-950/35 p-3" key={step.label}>
          {index < steps.length - 1 ? <span className="absolute -right-2 top-1/2 z-10 hidden h-px w-4 bg-cyan-300/35 md:block" /> : null}
          <strong className="block text-2xl font-black text-white">{formatNumber(step.value)}</strong>
          <span className="mt-1 block text-[0.68rem] font-black uppercase leading-4 tracking-[0.1em] text-slate-400">{step.label}</span>
        </div>
      ))}
    </div>
  );
}

function PerspectiveCard({
  title,
  choice,
  recommendation,
}: {
  title: string;
  choice: DecisionReportChoice;
  recommendation?: RecommendationObject;
}) {
  const vehicleName = choice.vehicleId ? `${choice.year} ${choice.make} ${choice.model}` : "No qualified vehicle";

  return (
    <article className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
      <p className="text-xs font-black uppercase tracking-[0.13em] text-cyan-300">{title}</p>
      <h3 className="mt-2 text-lg font-black leading-tight text-white">{vehicleName}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{choice.reason}</p>
      {recommendation ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <InfoTile label="Match" value={`${recommendation.overallMatchScore}/100`} />
          <InfoTile label="Monthly" value={`${formatMoney(recommendation.ownershipSummary.estimatedMonthlyTotal)}/mo`} />
        </div>
      ) : null}
    </article>
  );
}

function ChangeFactors({ items }: { items: string[] }) {
  return (
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-100">Could change the recommendation</p>
      <ul className="mt-2 grid gap-2 text-sm font-semibold leading-6 text-cyan-50/90">
        {(items.length ? items : ["No deterministic change factors are available for this profile."]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function NoteList({ title, items, className = "" }: { title: string; items: string[]; className?: string }) {
  const visibleItems = items.length ? items : ["No entries for this recommendation."];
  return (
    <div className={`rounded-lg border border-white/10 bg-slate-950/35 p-3 ${className}`}>
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{title}</h3>
      <ul className="mt-2 grid gap-2 text-sm font-semibold leading-6 text-slate-300">
        {visibleItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ConstraintList({ title, constraints }: { title: string; constraints: HardConstraintResult[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{title}</h3>
      <div className="mt-2 grid gap-2">
        {constraints.length ? (
          constraints.map((constraint) => (
            <div className="rounded-md border border-white/10 bg-white/[0.035] px-3 py-2" key={`${constraint.code}-${constraint.label}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-black text-white">{constraint.label}</span>
                <span className={constraint.passed ? "text-xs font-black text-emerald-200" : "text-xs font-black text-amber-200"}>
                  {constraint.passed ? "Passed" : "Failed"}
                </span>
              </div>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                Required {formatConstraintValue(constraint.limit)} · Actual {formatConstraintValue(constraint.actual)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm font-semibold text-slate-300">No hard requirements were selected.</p>
        )}
      </div>
    </div>
  );
}

function TradeoffList({ tradeoffs }: { tradeoffs: RecommendationTradeoff[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Tradeoffs</h3>
      <ul className="mt-2 grid gap-2 text-sm font-semibold leading-6 text-slate-300">
        {tradeoffs.length ? (
          tradeoffs.map((tradeoff) => (
            <li key={`${tradeoff.code}-${tradeoff.field}`}>
              {formatFieldLabel(tradeoff.field)} is {String(tradeoff.vehicleValue)}
              {tradeoff.userPreference !== undefined ? ` versus ${String(tradeoff.userPreference)}` : ""}; severity {tradeoff.severity}.
            </li>
          ))
        ) : (
          <li>No major tradeoff was recorded.</li>
        )}
      </ul>
    </div>
  );
}

function ProvenanceList({ provenance }: { provenance: FieldProvenance[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Field Provenance</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {provenance.map((item) => (
          <div className="rounded-md border border-white/10 bg-white/[0.035] px-3 py-2" key={`${item.field}-${item.method}`}>
            <span className="block text-sm font-black text-white">{formatFieldLabel(item.field)}</span>
            <span className="mt-1 block text-xs font-semibold capitalize text-slate-400">
              {item.status} · {item.source} · {item.method}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getAdvisorText(recommendation: RecommendationObject, vehicle: ScoredVehicle) {
  const strongestReasons = recommendation.reasonsForRecommendation.slice(0, 2).map(formatSignalShort);
  const runner = strongestReasons.length
    ? `It is the most defensible shortlist choice because ${strongestReasons.join(" and ")}.`
    : `It has the highest qualified match score at ${recommendation.overallMatchScore}/100.`;
  return {
    headline: `I recommend the ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
    reason: runner,
  };
}

function getDecisionSignals(
  vehicle: ScoredVehicle,
  recommendation: RecommendationObject,
  profile: BuyerProfile,
  monthlyHeadroom: number,
): DecisionSignal[] {
  const lifestyleScore = Math.max(vehicle.matchSummary.practicality, vehicle.matchSummary.drivingPreferenceFit);
  const lifestyleConclusion =
    profile.bodyStyle === "any" && !profile.preferredMake && !profile.requiredMake
      ? "Design preference was not provided"
      : `${getStrengthLabel(lifestyleScore)} lifestyle fit`;
  const affordabilityConclusion =
    monthlyHeadroom >= 100 ? "Comfortably within budget" : monthlyHeadroom >= 0 ? "Fits, but watch the margin" : "Over your monthly budget";
  const reliabilityConclusion = `${getStrengthLabel(vehicle.reliabilityScore)} daily reliability`;

  return [
    {
      title: "Style and lifestyle fit",
      conclusion: lifestyleConclusion,
      support: `${vehicle.bodyType}, ${vehicle.seats} seats, ${vehicle.drivetrain}; practicality fit ${vehicle.matchSummary.practicality}/100.`,
    },
    {
      title: "Affordability",
      conclusion: affordabilityConclusion,
      support:
        monthlyHeadroom >= 0
          ? `${formatMoney(monthlyHeadroom)}/mo room after estimated ownership cost.`
          : `${formatMoney(Math.abs(monthlyHeadroom))}/mo above your current ownership budget.`,
    },
    {
      title: "Daily reliability",
      conclusion: reliabilityConclusion,
      support: `Reliability ${vehicle.reliabilityScore}/100; maintenance risk fit ${vehicle.matchSummary.maintenanceRisk}/100.`,
    },
  ];
}

function getStrengthLabel(score: number) {
  if (score >= 82) return "Strong";
  if (score >= 65) return "Moderate";
  return "Limited";
}

function getBiggestTradeoff(recommendation: RecommendationObject) {
  const tradeoff = [...recommendation.tradeoffs].sort((a, b) => b.penaltyPoints - a.penaltyPoints)[0];
  if (!tradeoff) return "no major compromise was recorded for the top recommendation.";
  return `${formatFieldLabel(tradeoff.field).toLowerCase()} is ${String(tradeoff.vehicleValue)}${
    tradeoff.userPreference !== undefined ? ` versus your target ${String(tradeoff.userPreference)}` : ""
  }.`;
}

function findRecommendation(decisionSet: RecommendationDecisionSet, choice: DecisionReportChoice) {
  if (!choice.vehicleId) return undefined;
  return decisionSet.primaryRecommendations.find((item) => item.vehicleId === choice.vehicleId);
}

function formatSignals(signals: RecommendationSignal[]) {
  return signals.map(formatSignalDetail);
}

function formatSignalShort(signal: RecommendationSignal) {
  return `${scoreWeightLabels[signal.category]} is ${signal.score ?? signal.vehicleValue}/100`;
}

function formatSignalDetail(signal: RecommendationSignal) {
  const weight = signal.weight !== undefined ? ` at ${signal.weight}% weight` : "";
  const contribution = signal.contribution !== undefined ? ` contributing ${signal.contribution} points` : "";
  return `${scoreWeightLabels[signal.category]}: ${signal.score ?? signal.vehicleValue}/100${weight}${contribution}.`;
}

function formatAssumptions(assumptions: RecommendationAssumption[]) {
  return assumptions.map((assumption) => {
    const value = assumption.value !== undefined ? ` (${String(assumption.value)})` : "";
    return `${formatFieldLabel(assumption.field)} uses ${assumption.method}${value}.`;
  });
}

function formatRunnerUp(choice: DecisionReportChoice | undefined, reportReason: string, pipelineReason: string) {
  if (!choice?.vehicleId) return [reportReason || pipelineReason];
  return [
    `${choice.year} ${choice.make} ${choice.model} scored ${choice.overallMatchScore}/100.`,
    reportReason,
    pipelineReason,
  ];
}

function formatConstraintValue(value: number | string | boolean | undefined) {
  if (value === undefined) return "not specified";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

function formatEstimateValue(value: number | string | boolean, unit: string) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (unit === "usd" || unit === "usd_per_month" || unit === "usd_per_year") return formatMoney(value);
  return formatNumber(value);
}

function formatFieldLabel(field: string) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDataSources(sources?: string[]) {
  if (!sources?.length) return "Seed catalog";
  return sources
    .map((source) => {
      if (source === "seed") return "Seed catalog";
      if (source === "listing-api") return "Listing API";
      if (source === "fueleconomy.gov") return "FuelEconomy.gov";
      if (source === "nhtsa") return "NHTSA";
      if (source === "csv-import") return "CSV import";
      return source;
    })
    .join(", ");
}

function formatDataDate(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
