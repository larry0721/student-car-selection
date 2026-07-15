"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyAdvisorIntent,
  buildHumanAdvisorNarrative,
  createInitialAdvisorSession,
  getRelevantAdvisorActions,
  resetAdvisorSession,
  type AdvisorAction,
  type AdvisorContext,
  type AdvisorIntent,
  type AdvisorSessionState,
} from "@/lib/advisorConversation";
import type { BuyerProfile } from "@/types/buyer";
import type { DecisionReport, RecommendationDecisionSet } from "@/types/vehicle";

type AdvisorConversationPanelProps = {
  decisionSet: RecommendationDecisionSet;
  decisionReport: DecisionReport;
  profile: BuyerProfile;
};

export function AdvisorConversationPanel({ decisionSet, decisionReport, profile }: AdvisorConversationPanelProps) {
  const context = useMemo<AdvisorContext>(() => ({ decisionSet, decisionReport, profile }), [decisionSet, decisionReport, profile]);
  const [session, setSession] = useState<AdvisorSessionState>(() => createInitialAdvisorSession(context));
  const actions = useMemo(() => getRelevantAdvisorActions(context), [context]);
  const latestAdvisorEntry = [...session.entries].reverse().find((entry) => entry.role === "advisor");
  const latestPlan = latestAdvisorEntry?.plan;
  const narrative = latestPlan?.narrative || buildHumanAdvisorNarrative(context);

  useEffect(() => {
    setSession(createInitialAdvisorSession(context));
  }, [context]);

  function chooseAction(action: AdvisorAction) {
    setSession((current) => applyAdvisorIntent(current, action.intent, context, action.label));
  }

  function recordPreferenceDiscovery(intent: AdvisorIntent, label: string) {
    setSession((current) => applyAdvisorIntent(current, intent, context, label));
  }

  function clearConversation() {
    setSession(resetAdvisorSession(context));
  }

  return (
    <section className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.04] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.2)] md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">Advisor conversation</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-white md:text-2xl">A calmer look at the recommendation.</h2>
        </div>
        <button
          className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-black uppercase tracking-[0.1em] text-slate-300 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
          onClick={clearConversation}
          type="button"
        >
          Clear
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)]">
        <div className="rounded-lg border border-white/10 bg-slate-950/40 p-4 md:p-5">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Advisor view</p>
          <p className="mt-3 text-lg font-black leading-7 text-white md:text-xl">{narrative.openingRecommendation}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">{narrative.buyerContextAcknowledgment}</p>
          <div className="mt-4 grid gap-2">
            {narrative.strongestReasons.slice(0, 2).map((reason) => (
              <p className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-semibold leading-6 text-slate-200" key={reason}>
                {reason}
              </p>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-amber-200/15 bg-amber-200/10 px-3 py-3">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-100/80">Main concern</p>
            <p className="mt-1 text-sm font-bold leading-6 text-amber-50">{narrative.mainConcern}</p>
          </div>
          <p className="mt-4 text-sm font-semibold leading-6 text-slate-300">{narrative.advisorOpinion}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">{narrative.uncertaintyDisclosure}</p>
        </div>

        <div className="grid gap-3">
          <div className="rounded-lg border border-white/10 bg-slate-950/30 p-4">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">What I considered</p>
            <ol className="mt-3 grid gap-2">
              {narrative.whatIConsidered.slice(0, 4).map((step, index) => (
                <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 text-sm font-semibold leading-6 text-slate-200" key={step}>
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-cyan-300/25 bg-cyan-300/10 text-xs font-black text-cyan-100">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {narrative.nearWinner ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">The car that almost won</p>
              <p className="mt-2 text-sm font-bold leading-6 text-white">{narrative.nearWinner.vehicleName} was close.</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
                {narrative.nearWinner.strongestAdvantage}, but {narrative.whyNearWinnerLost}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-400">{narrative.nearWinner.whatCouldMakeItWin}</p>
            </div>
          ) : null}

          <div className="rounded-lg border border-cyan-200/15 bg-cyan-200/[0.07] p-4">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-100/80">One question</p>
            <p className="mt-2 text-sm font-bold leading-6 text-cyan-50">{narrative.curiosityPrompt}</p>
          </div>
        </div>

        {latestPlan?.preferenceLed && latestPlan.recalculationRequired ? (
          <div className="rounded-lg border border-amber-200/20 bg-amber-200/10 p-3 lg:col-span-2">
            <p className="text-sm font-bold leading-6 text-amber-50">
              This is preference-led exploration. The official recommendation has not changed.
            </p>
            {latestPlan.nextAction?.includes("Would you accept") ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="min-h-10 rounded-lg border border-amber-200/30 bg-amber-200 px-3 text-xs font-black text-slate-950 transition hover:bg-amber-100"
                  onClick={() => recordPreferenceDiscovery("record_preference_discovery", "Yes, I would accept that tradeoff")}
                  type="button"
                >
                  Yes, accept that
                </button>
                <button
                  className="min-h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-amber-50 transition hover:border-amber-200/35 hover:bg-amber-200/10"
                  onClick={() => recordPreferenceDiscovery("record_preference_discovery", "No, keep costs controlled")}
                  type="button"
                >
                  No, keep costs controlled
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="lg:col-span-2">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">What would you like to explore?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                className="min-h-10 rounded-lg border border-white/10 bg-white/[0.045] px-3 text-sm font-black text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
                key={action.intent}
                onClick={() => chooseAction(action)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {session.entries.length > 1 ? (
          <details className="group rounded-lg border border-white/10 bg-slate-950/25 p-3 lg:col-span-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Conversation history</span>
              <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 text-sm font-black text-cyan-200 transition group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="mt-3 grid gap-2 border-t border-white/10 pt-3">
              {session.entries.map((entry, index) => (
                <article
                  className={`rounded-lg border px-3 py-2 ${
                    entry.role === "user"
                      ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-50"
                      : "border-white/10 bg-white/[0.035] text-slate-300"
                  }`}
                  key={`${entry.role}-${entry.label || entry.rendered.title}-${index}`}
                >
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.12em] opacity-70">
                    {entry.role === "user" ? "You" : "Advisor"}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-6">{entry.rendered.paragraphs[0]}</p>
                </article>
              ))}
            </div>
          </details>
        ) : null}

        {session.preferenceDiscoveries.length ? (
          <div className="rounded-lg border border-white/10 bg-slate-950/25 p-3 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Session-only note</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">{session.preferenceDiscoveries.at(-1)}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
