import { formatMoney, formatNumber } from "@/lib/affordability";
import { defaultScoreWeights, scoreWeightLabels } from "@/lib/recommendations";
import type { ScoreWeights } from "@/types/buyer";
import type { AiRecommendation, ScoredVehicle } from "@/types/vehicle";

type RecommendationCardProps = {
  vehicle: ScoredVehicle;
  aiRecommendation?: AiRecommendation;
  isCompared?: boolean;
  onToggleCompare?: (vehicleId: string) => void;
};

export function RecommendationCard({
  vehicle,
  aiRecommendation,
  isCompared = false,
  onToggleCompare,
}: RecommendationCardProps) {
  const reasons = aiRecommendation?.reasons.length ? aiRecommendation.reasons : vehicle.reasons;
  const cons = aiRecommendation?.watchouts.length ? aiRecommendation.watchouts : vehicle.watchouts;
  const hasVerifiedImage = Boolean(vehicle.imageUrl && vehicle.imageVerified);
  const imageLabel = vehicle.imageSource === "csv-import" ? "Uploaded vehicle photo" : "Verified listing photo";

  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.055] shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur">
      <div className="relative aspect-[16/9] overflow-hidden bg-slate-900">
        {hasVerifiedImage ? (
          <img
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            className="h-full w-full object-cover transition duration-500 hover:scale-105"
            src={vehicle.imageUrl}
          />
        ) : (
          <div className="grid h-full place-items-center bg-slate-900 px-5 text-center">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Verified photo pending</p>
              <p className="mt-2 text-lg font-black text-slate-200">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </p>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                Listing/API images appear here only after the source matches the suggested car.
              </p>
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/25 to-transparent" />
        {hasVerifiedImage ? (
          <span className="absolute left-3 top-3 rounded-full border border-emerald-300/30 bg-emerald-300/15 px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-[0.1em] text-emerald-100">
            {imageLabel}
          </span>
        ) : null}
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-200/90">
              {vehicle.year} {vehicle.bodyType} · {vehicle.drivetrain}
            </p>
            <h3 className="mt-1 text-2xl font-black leading-tight text-white">
              {vehicle.make} {vehicle.model}
            </h3>
          </div>
          <ScoreBadge value={vehicle.score} />
        </div>
      </div>

      <div className="grid gap-4 p-4">
        {aiRecommendation?.summary ? (
          <p className="rounded-lg border border-cyan-300/15 bg-cyan-300/10 p-3 text-sm font-semibold leading-6 text-cyan-50">
            {aiRecommendation.summary}
          </p>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          <ScoreTile label="Overall" value={`${vehicle.score}/100`} />
          <ScoreTile label="Reliability" value={`${vehicle.reliabilityScore}/100`} />
          <ScoreTile label="Safety" value={`${vehicle.safetyScore}/100`} />
        </div>

        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Price" value={formatMoney(vehicle.price)} />
          <Stat label="Mileage" value={formatNumber(vehicle.mileage)} />
          <Stat label="Insurance" value={`${formatMoney(vehicle.ownership.insuranceMonthly)}/mo`} />
          <Stat label="Maintenance" value={`${formatMoney(vehicle.ownership.maintenanceMonthly)}/mo`} />
          <Stat label="Fuel" value={`${formatMoney(vehicle.ownership.fuelMonthly)}/mo`} />
          <Stat label="Depreciation" value={`${formatMoney(vehicle.ownership.depreciationAnnual)}/yr`} />
        </dl>

        <div>
          <h4 className="mb-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
            Weighted score breakdown
          </h4>
          <div className="grid gap-2">
            {(Object.keys(defaultScoreWeights) as Array<keyof ScoreWeights>).map((field) => (
              <ScoreBreakdownRow
                categoryScore={vehicle.scoreBreakdown[field]}
                contribution={vehicle.weightedContributions[field]}
                key={field}
                label={scoreWeightLabels[field]}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <NoteList title="Pros" items={vehicle.pros} />
          <NoteList title="Cons" items={cons} />
        </div>

        <NoteList title="Why it matches" items={reasons} />
        <NoteList title="Common issues" items={vehicle.commonIssues} />
        <NoteList title="Similar alternatives" items={vehicle.similarAlternatives} />
        <NoteList title="Buying tips" items={vehicle.buyingTips} />

        {onToggleCompare ? (
          <button
            className={`min-h-11 rounded-lg border px-4 text-sm font-black transition ${
              isCompared
                ? "border-cyan-300 bg-cyan-300 text-slate-950"
                : "border-white/10 bg-white/5 text-slate-100 hover:border-cyan-300/60 hover:bg-cyan-300/10"
            }`}
            onClick={() => onToggleCompare(vehicle.id)}
            type="button"
          >
            {isCompared ? "In comparison" : "Add to comparison"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ScoreBadge({ value }: { value: number }) {
  return (
    <div className="grid min-w-20 place-items-center rounded-lg border border-cyan-300/30 bg-slate-950/75 px-3 py-2 text-cyan-100 shadow-lg backdrop-blur">
      <span className="text-xl font-black">{value}</span>
      <small className="text-center text-[0.62rem] font-black uppercase leading-tight text-slate-300">
        match
      </small>
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
      <span className="block text-[0.66rem] font-black uppercase tracking-[0.1em] text-slate-400">{label}</span>
      <strong className="mt-1 block text-sm font-black text-white">{value}</strong>
    </div>
  );
}

function ScoreBreakdownRow({
  label,
  categoryScore,
  contribution,
}: {
  label: string;
  categoryScore: number;
  contribution: number;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.08em] text-slate-400">
        <span>{label}</span>
        <span className="text-slate-300">
          {categoryScore}/100 · +{contribution}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300"
          style={{ width: `${Math.max(0, Math.min(100, categoryScore))}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <dt className="text-[0.66rem] font-black uppercase tracking-[0.1em] text-slate-400">{label}</dt>
      <dd className="mt-1 font-black text-slate-50">{value}</dd>
    </div>
  );
}

function NoteList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-black uppercase tracking-[0.1em] text-slate-400">{title}</h4>
      <ul className="space-y-1.5 pl-4 text-sm font-medium leading-5 text-slate-300">
        {items.map((item, index) => (
          <li className="list-disc" key={`${item}-${index}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
