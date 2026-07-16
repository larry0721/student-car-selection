import { type ReactNode, useMemo, useState } from "react";
import { formatMoney, formatNumber } from "@/lib/affordability";
import { buildHumanAdvisorNarrative } from "@/lib/advisorConversation";
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
  const narrative = useMemo(
    () => buildHumanAdvisorNarrative({ decisionSet, decisionReport, profile }),
    [decisionReport, decisionSet, profile],
  );

  if (!topVehicle || !recommendation) return null;

  const monthlyHeadroom = profile.monthlyBudget - recommendation.ownershipSummary.estimatedMonthlyTotal;
  const biggestTradeoff = getBiggestTradeoff(recommendation);
  const primaryReasons = getPrimaryReasons(recommendation);
  const conversationalReasons = getConversationalReasons(narrative.strongestReasons, primaryReasons);
  const verificationNote = getVerificationNote(recommendation);
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
        <div className="grid gap-6 p-5 md:p-7 lg:grid-cols-[minmax(0,1.12fr)_minmax(240px,0.88fr)] lg:items-start">
          <div className="grid gap-5">
            <div className="max-w-4xl">
              <h2 className="text-3xl font-black leading-tight tracking-tight text-white md:text-5xl">
                Based on everything you’ve told me, I’d start by looking at the {topVehicle.year} {topVehicle.make} {topVehicle.model}.
              </h2>
              <div className="mt-5 grid gap-3 text-base font-semibold leading-7 text-slate-200 md:text-lg">
                <p>{narrative.buyerContextAcknowledgment}</p>
                <p>{narrative.advisorOpinion}</p>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-200">Why I chose it</p>
                <ol className="mt-3 grid gap-3">
                  {conversationalReasons.map((reason, index) => (
                    <li className="flex gap-3 text-sm font-bold leading-6 text-slate-100 md:text-base" key={reason}>
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-300 text-xs font-black text-slate-950">
                        {index + 1}
                      </span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid gap-4">
                <div className="rounded-lg border border-amber-200/30 bg-amber-200/[0.1] p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-100">The biggest tradeoff</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-amber-50 md:text-base">{biggestTradeoff}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-300">One thing I’d verify before buying</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{verificationNote}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                className="min-h-11 rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200"
                onClick={() => setShowChangeFactors((current) => !current)}
                type="button"
              >
                What would change this recommendation?
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

          <aside className="grid gap-3">
            <VehicleImage vehicle={topVehicle} compact />
            <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-200">My recommendation</p>
              <h3 className="mt-2 text-2xl font-black leading-tight text-white">
                {topVehicle.year} {topVehicle.make} {topVehicle.model}
              </h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{advisorText.reason}</p>
            </div>
          </aside>
        </div>
      </section>

      <DisclosureSection eyebrow="Cars I seriously considered" title="What did you compare before choosing?">
        <div className="grid gap-5">
          <PipelineStrip debug={decisionSet.pipelineDebug} />
          <div>
            <SectionHeader eyebrow="What if I care about something else?" title="Which car wins from another angle?" />
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <PerspectiveCard title="What’s the best overall fit?" choice={decisionReport.bestOverall} recommendation={findRecommendation(decisionSet, decisionReport.bestOverall)} />
              <PerspectiveCard title="What’s the best value?" choice={decisionReport.bestValue} recommendation={findRecommendation(decisionSet, decisionReport.bestValue)} />
              <PerspectiveCard title="What’s the safest pick?" choice={decisionReport.safestChoice} recommendation={findRecommendation(decisionSet, decisionReport.safestChoice)} />
              <PerspectiveCard title="What best matches my preferences?" choice={decisionReport.userPreferredChoice} recommendation={findRecommendation(decisionSet, decisionReport.userPreferredChoice)} />
            </div>
          </div>
        </div>
      </DisclosureSection>

      <SuggestedFollowUps prompt={narrative.curiosityPrompt} suggestions={narrative.suggestedActions} />

      <DisclosureSection eyebrow="Why did you choose this?" title="What made you choose it?">
        <NoteList title="What weighed in its favor?" items={formatSignals(recommendation.reasonsForRecommendation)} />
      </DisclosureSection>

      <DisclosureSection eyebrow="Which car came closest?" title="Why didn’t the runner-up win?">
        <NoteList title="Which car almost won?" items={formatRunnerUp(decisionReport.runnerUp, decisionReport.whyRunnerUpLost, runnerUpLoss)} />
      </DisclosureSection>

      <DisclosureSection eyebrow="How confident are you?" title="How much should I trust this?">
        <div className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-4">
          <ConfidenceLine
            label="How sure I am"
            score={recommendation.recommendationConfidence.score}
            level={recommendation.recommendationConfidence.level}
            note="How comfortable I am recommending this car for your stated needs."
          />
          <ConfidenceLine
            label="How solid the facts are"
            score={recommendation.dataQualityConfidence.score}
            level={recommendation.dataQualityConfidence.level}
            note="How complete and trustworthy the vehicle facts are right now."
          />
          {needsDataDisclosure ? (
            <p className="text-sm font-semibold leading-6 text-slate-300">
              I’d verify the live price, mileage, and condition before treating this as more than a shortlist choice.
            </p>
          ) : null}
        </div>
      </DisclosureSection>

      <DisclosureSection eyebrow="What will ownership cost?" title="What should I budget each month?">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="Purchase price" value={formatMoney(topVehicle.price)} />
          <InfoTile label="Monthly ownership" value={`${formatMoney(recommendation.ownershipSummary.estimatedMonthlyTotal)}/mo`} />
          <InfoTile label="Insurance" value={`${formatMoney(recommendation.ownershipSummary.insuranceMonthly)}/mo`} />
          <InfoTile label="Fuel" value={`${formatMoney(recommendation.ownershipSummary.fuelMonthly)}/mo`} />
          <InfoTile label="Maintenance" value={`${formatMoney(recommendation.ownershipSummary.maintenanceMonthly)}/mo`} />
          <InfoTile label="First-year ownership" value={formatMoney(recommendation.firstYearOwnershipEstimate.total)} />
          <BudgetHeadroom monthlyHeadroom={monthlyHeadroom} profile={profile} />
        </div>
      </DisclosureSection>

      <DisclosureSection eyebrow="Supporting evidence" title="What facts are you relying on?">
        <div className="grid gap-4 xl:grid-cols-2">
          <NoteList title="What priorities did you use?" items={formatSignals(decisionReport.userPriorities)} />
          <ConstraintList title="What requirements had to pass?" constraints={decisionReport.hardRequirements} />
          <TradeoffList tradeoffs={decisionReport.primaryTradeoffs} />
          <NoteList title="What are you assuming?" items={formatAssumptions(decisionReport.assumptions)} />
          <NoteList title="What numbers are estimated?" items={estimatedFields} />
          <NoteList title="What information is still missing?" items={missingInformation} />
          <ProvenanceList provenance={recommendation.fieldProvenance} />
        </div>
      </DisclosureSection>
    </div>
  );
}

function VehicleImage({ compact = false, vehicle }: { compact?: boolean; vehicle: ScoredVehicle }) {
  const wrapperClass = compact
    ? "relative min-h-[190px] overflow-hidden rounded-lg bg-slate-900 md:min-h-[230px] lg:min-h-[260px]"
    : "relative min-h-[200px] overflow-hidden bg-slate-900 md:min-h-[260px] lg:min-h-[360px]";
  const mediaClass = compact
    ? "h-full min-h-[190px] w-full object-cover md:min-h-[230px] lg:min-h-[260px]"
    : "h-full min-h-[200px] w-full object-cover md:min-h-[260px] lg:min-h-[360px]";

  return (
    <div className={wrapperClass}>
      {vehicle.imageUrl ? (
        <img
          alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
          className={mediaClass}
          src={vehicle.imageUrl}
        />
      ) : (
        <div aria-hidden="true" className={`relative h-full bg-slate-900 ${compact ? "min-h-[190px] md:min-h-[230px] lg:min-h-[260px]" : "min-h-[200px] md:min-h-[260px] lg:min-h-[360px]"}`}>
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
        Using your {formatMoney(profile.monthlyBudget)}/mo ownership budget and my current ownership estimate.
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

function DisclosureSection({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.05] p-4 md:p-5">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4">
        <SectionHeader eyebrow={eyebrow} title={title} />
        <ExpandIcon />
      </summary>
      <div className="mt-5 border-t border-white/10 pt-5">{children}</div>
    </details>
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
    { label: "Cars I looked at", value: debug.catalogCount },
    { label: "Cars worth checking", value: debug.candidateCount },
    { label: "Ruled out", value: debug.excludedCount },
    { label: "Still a fit", value: debug.qualifiedCount },
    { label: "Compared closely", value: debug.filteredCount },
    { label: "My recommendation", value: debug.topFive[0] ? 1 : 0 },
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

function SuggestedFollowUps({ prompt, suggestions }: { prompt: string; suggestions: string[] }) {
  const visibleSuggestions = suggestions.length ? suggestions.slice(0, 4) : ["What would make this a bad choice?", "Is there a cheaper responsible alternative?"];

  return (
    <section className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.055] p-4 md:p-5">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">What should I ask next?</p>
      <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-cyan-50">{prompt}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {visibleSuggestions.map((suggestion) => (
          <span className="rounded-full border border-white/10 bg-slate-950/35 px-3 py-2 text-sm font-bold text-slate-200" key={suggestion}>
            {suggestion}
          </span>
        ))}
      </div>
    </section>
  );
}

function ChangeFactors({ items }: { items: string[] }) {
  return (
    <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-100">What would change your advice?</p>
      <ul className="mt-2 grid gap-2 text-sm font-semibold leading-6 text-cyan-50/90">
        {(items.length ? items : ["I don’t see a clear change factor from the current profile."]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function NoteList({ title, items, className = "" }: { title: string; items: string[]; className?: string }) {
  const visibleItems = items.length ? items : ["I don’t have anything else to add here."];
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
          <p className="text-sm font-semibold text-slate-300">You did not mark any requirements as mandatory.</p>
        )}
      </div>
    </div>
  );
}

function TradeoffList({ tradeoffs }: { tradeoffs: RecommendationTradeoff[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">What are the tradeoffs?</h3>
      <ul className="mt-2 grid gap-2 text-sm font-semibold leading-6 text-slate-300">
        {tradeoffs.length ? (
          tradeoffs.map((tradeoff) => (
            <li key={`${tradeoff.code}-${tradeoff.field}`}>
              {formatFieldLabel(tradeoff.field)} is {String(tradeoff.vehicleValue)}
              {tradeoff.userPreference !== undefined ? ` versus ${String(tradeoff.userPreference)}` : ""}; severity {tradeoff.severity}.
            </li>
          ))
        ) : (
          <li>I don’t see a major tradeoff under the current priorities.</li>
        )}
      </ul>
    </div>
  );
}

function ProvenanceList({ provenance }: { provenance: FieldProvenance[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <h3 className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Where did the facts come from?</h3>
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
  const sentenceReasons = strongestReasons.map(lowerFirst).join(" and ");
  const runner = strongestReasons.length
    ? `I’d recommend it because ${sentenceReasons}.`
    : `I’d recommend it because it has the strongest qualified match at ${recommendation.overallMatchScore}/100.`;
  return {
    headline: `I’d recommend the ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
    reason: runner,
  };
}

function getPrimaryReasons(recommendation: RecommendationObject) {
  const reasons = recommendation.reasonsForRecommendation.slice(0, 3).map(formatSignalShort);
  if (reasons.length >= 3) return reasons;
  return [
    ...reasons,
    `Overall fit is ${recommendation.overallMatchScore}/100`,
    `My recommendation confidence is ${recommendation.recommendationConfidence.level} at ${recommendation.recommendationConfidence.score}/100`,
  ].slice(0, 3);
}

function getConversationalReasons(narrativeReasons: string[], fallbackReasons: string[]) {
  const reasons = narrativeReasons.filter(Boolean).slice(0, 3);
  if (reasons.length >= 3) return reasons;
  return [...reasons, ...fallbackReasons].slice(0, 3);
}

function getBiggestTradeoff(recommendation: RecommendationObject) {
  const tradeoff = [...recommendation.tradeoffs].sort((a, b) => b.penaltyPoints - a.penaltyPoints)[0];
  if (!tradeoff) {
    if (recommendation.dataQualityConfidence.level !== "high" || recommendation.missingInformation.length) {
      return "I’d still want the live listing condition verified.";
    }
    return "I don’t see a major tradeoff under your current priorities.";
  }
  return `${formatFieldLabel(tradeoff.field).toLowerCase()} is ${String(tradeoff.vehicleValue)}${
    tradeoff.userPreference !== undefined ? ` versus your target ${String(tradeoff.userPreference)}` : ""
  }.`;
}

function getVerificationNote(recommendation: RecommendationObject) {
  const highImpactMissing = recommendation.missingInformation.find((item) => item.impact === "high");
  if (highImpactMissing) {
    return `I’d verify ${formatFieldLabel(highImpactMissing.field).toLowerCase()} with ${highImpactMissing.expectedSource} before treating this as a purchase target.`;
  }
  if (recommendation.estimatedFields.length) {
    const field = recommendation.estimatedFields[0];
    return `I’d verify the ${formatFieldLabel(field.field).toLowerCase()} because that number is currently estimated.`;
  }
  if (recommendation.dataQualityConfidence.level !== "high") {
    return "I’d verify the live price, mileage, title history, and condition before treating this as more than a shortlist choice.";
  }
  return "I’d still check the live price, mileage, title history, and inspection results before buying.";
}

function findRecommendation(decisionSet: RecommendationDecisionSet, choice: DecisionReportChoice) {
  if (!choice.vehicleId) return undefined;
  return decisionSet.primaryRecommendations.find((item) => item.vehicleId === choice.vehicleId);
}

function formatSignals(signals: RecommendationSignal[]) {
  return signals.map(formatSignalDetail);
}

function lowerFirst(text: string) {
  return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
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
  if (!sources?.length) return "Built-in car list";
  return sources
    .map((source) => {
      if (source === "seed") return "Built-in car list";
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
