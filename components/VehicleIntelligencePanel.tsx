import { type ReactNode, useMemo } from "react";
import { buildVehicleIntelligenceViewModel } from "@/lib/demoVehicleIntelligence";
import type { BuyerProfile } from "@/types/buyer";

type VehicleIntelligencePanelProps = {
  vehicleId: string;
  profile: BuyerProfile;
  reasons: readonly string[];
};

export function VehicleIntelligencePanel({
  vehicleId,
  profile,
  reasons,
}: VehicleIntelligencePanelProps) {
  const intelligence = useMemo(
    () => buildVehicleIntelligenceViewModel({ vehicleId, profile }),
    [profile, vehicleId],
  );

  return (
    <details
      className="group min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4 md:p-5"
      data-testid="vehicle-intelligence-panel"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">Car Info</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-white md:text-2xl">
            Trusted facts and ownership evidence
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-400">
            Safety, reliability watch, and source confidence.
          </p>
        </div>
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-xl font-black text-cyan-200 transition group-open:rotate-45"
        >
          +
        </span>
      </summary>

      <div className="mt-5 min-w-0 border-t border-white/10 pt-5">
        {!intelligence.available ? (
          <div data-testid="vehicle-intelligence-unavailable">
            <h3 className="text-base font-black text-white">Detailed information is still being added</h3>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-300">
              {intelligence.message}
            </p>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-400">
              The recommendation is still available, but this expanded evidence view is not ready for this vehicle.
            </p>
          </div>
        ) : (
          <div className="grid min-w-0 gap-6" data-testid="vehicle-intelligence-available">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words text-lg font-black text-white">{intelligence.displayName}</h3>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
                  {intelligence.publicationLabel}
                </p>
              </div>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-100">
                Source-backed details available
              </span>
            </div>

            <PanelSection title="Why this fits">
              <ol className="grid gap-2 md:grid-cols-3">
                {reasons.slice(0, 3).map((reason, index) => (
                  <li
                    className="flex min-w-0 gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-3 text-sm font-semibold leading-6 text-slate-200"
                    key={`${index}-${reason}`}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-300 text-xs font-black text-slate-950">
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words">{reason}</span>
                  </li>
                ))}
              </ol>
            </PanelSection>

            <PanelSection title="Trusted vehicle facts">
              {intelligence.trustedFacts.length ? (
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {intelligence.trustedFacts.map((fact) => (
                    <div className="min-w-0 rounded-lg border border-white/10 bg-slate-950/35 p-3" key={fact.label}>
                      <dt className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">{fact.label}</dt>
                      <dd className="mt-1 break-words text-base font-black text-white">{fact.value}</dd>
                      <dd className="mt-1 text-xs font-semibold capitalize text-slate-400">
                        {fact.confidence} confidence
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm font-semibold leading-6 text-slate-400">
                  No source-backed configuration facts are available for this record.
                </p>
              )}
            </PanelSection>

            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <PanelSection title="Safety">
                <div data-safety-state={intelligence.safety.state}>
                  <p className="text-sm font-semibold leading-6 text-slate-300">{intelligence.safety.statusText}</p>
                  {intelligence.safety.ratingRows.length ? (
                    <dl className="mt-3 grid grid-cols-2 gap-2">
                      {intelligence.safety.ratingRows.map((rating) => (
                        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3" key={rating.label}>
                          <dt className="text-xs font-black text-slate-400">{rating.label}</dt>
                          <dd className="mt-1 text-lg font-black text-white">{rating.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {intelligence.safety.technology.length ? (
                    <ul className="mt-3 grid gap-1 text-sm font-semibold leading-6 text-slate-300">
                      {intelligence.safety.technology.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  ) : null}
                  <p className="mt-3 text-xs font-semibold leading-5 text-slate-400">
                    {intelligence.safety.confidenceText}
                  </p>
                </div>
              </PanelSection>

              <PanelSection title="Reliability watch">
                <div data-reliability-concern={intelligence.reliability.concernLabel}>
                  <p className="text-lg font-black text-white">{intelligence.reliability.concernLabel}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-300">{intelligence.reliability.framing}</p>
                  {intelligence.reliability.primaryConcerns.length ? (
                    <div className="mt-3">
                      <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">Areas to inspect</p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {intelligence.reliability.primaryConcerns.map((concern) => (
                          <li className="rounded-full border border-amber-200/20 bg-amber-200/[0.08] px-3 py-1 text-xs font-bold text-amber-50" key={concern}>
                            {concern}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="mt-3 text-xs font-semibold leading-5 text-slate-400">
                    {intelligence.reliability.confidenceText}
                  </p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">{intelligence.reliability.scopeText}</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-amber-100/80">{intelligence.reliability.limitation}</p>
                </div>
              </PanelSection>
            </div>

            <PanelSection title="Data confidence">
              <dl className="grid gap-2 md:grid-cols-3">
                {intelligence.confidenceItems.map((item) => (
                  <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3" key={item.label}>
                    <dt className="text-sm font-black text-white">{item.label}</dt>
                    <dd className="mt-1 text-xs font-semibold leading-5 text-slate-400">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </PanelSection>

            <PanelSection title="What we don’t know">
              <ul className="grid gap-2 text-sm font-semibold leading-6 text-slate-300">
                {intelligence.limitations.map((limitation) => (
                  <li className="rounded-lg border border-white/10 bg-slate-950/35 p-3" key={limitation}>{limitation}</li>
                ))}
              </ul>
            </PanelSection>

            <PanelSection title="Sources">
              <ul className="grid min-w-0 gap-2 md:grid-cols-2">
                {intelligence.sources.map((source) => (
                  <li className="min-w-0 rounded-lg border border-white/10 bg-slate-950/35 p-3" key={`${source.providerName}-${source.sourceRecordId}`}>
                    <a
                      className="break-words text-sm font-black text-cyan-200 underline decoration-cyan-300/30 underline-offset-4 hover:text-cyan-100"
                      href={source.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.providerName}
                    </a>
                    <p className="mt-1 break-all text-xs font-semibold text-slate-400">Record {source.sourceRecordId}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Retrieved {formatDate(source.retrievedAt)}</p>
                  </li>
                ))}
              </ul>
            </PanelSection>
          </div>
        )}
      </div>
    </details>
  );
}

function PanelSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="min-w-0">
      <h3 className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">{title}</h3>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "date unavailable"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
