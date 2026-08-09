import { buildHumanDecisionStory } from "@/lib/visibleThinking";
import type { VisibleThinkingSummary } from "@/types/vehicle";

type VisibleDecisionJourneyProps = {
  summary: VisibleThinkingSummary;
};

export function VisibleDecisionJourney({ summary }: VisibleDecisionJourneyProps) {
  const story = buildHumanDecisionStory(summary);

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 md:p-5">
      <div className="grid gap-2">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-200">Decision story</p>
        <div className="grid max-w-4xl gap-2 text-sm font-bold leading-6 text-slate-200 md:text-base">
          {story.defaultParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>

      <details className="group mt-4 rounded-lg border border-white/10 bg-slate-950/25 p-3">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
          <span className="text-sm font-black text-slate-200">Comparison details</span>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-black text-cyan-200 transition group-open:rotate-45">
            +
          </span>
        </summary>
        <div className="mt-3 grid gap-3 border-t border-white/10 pt-3">
          <ol className="grid gap-2">
            {story.expandedSteps.map((step, index) => (
              <li className="grid grid-cols-[1.65rem_minmax(0,1fr)] gap-2 text-sm font-semibold leading-6 text-slate-300" key={`${step.label}-${step.text}`}>
                <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border border-cyan-300/25 bg-cyan-300/10 text-xs font-black text-cyan-100">
                  {index + 1}
                </span>
                <span>
                  <strong className="block text-white">{step.label}</strong>
                  {step.text}
                  {step.evidenceCodes.length ? (
                    <span className="mt-1 block text-xs font-bold text-slate-500">
                      Evidence: {step.evidenceCodes.join(", ")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </section>
  );
}
