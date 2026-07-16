"use client";

import { type ChangeEvent, useState } from "react";
import { parseVehicleScoreCsv } from "@/lib/data/csvImport";
import type { DataProviderStatus, VehicleDataOverlay } from "@/types/data";

type DataImportPanelProps = {
  importedCount: number;
  onlineCount: number;
  isLoadingOnlineData: boolean;
  onImport: (overlays: VehicleDataOverlay[], warnings: string[]) => void;
  onLoadOnlineData: () => void;
  providerStatus: DataProviderStatus[];
  warnings: string[];
};

export function DataImportPanel({
  importedCount,
  onlineCount,
  isLoadingOnlineData,
  onImport,
  onLoadOnlineData,
  providerStatus,
  warnings,
}: DataImportPanelProps) {
  const [status, setStatus] = useState("Optional: add online data or your own CSV.");

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const result = parseVehicleScoreCsv(text);
    onImport(result.overlays, result.warnings);
    setStatus(
      result.overlays.length
        ? `Imported ${result.overlays.length} score rows${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ""}.`
        : result.warnings[0] || "No rows were imported.",
    );
  }

  return (
    <section className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.24)] backdrop-blur">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-black text-white">Where this information came from</h2>
          <p className="text-sm font-semibold text-slate-400">{status}</p>
        </div>
        <button
          className="min-h-10 rounded-lg border border-cyan-300/30 bg-cyan-300 px-3 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-default disabled:opacity-65"
          disabled={isLoadingOnlineData}
          onClick={onLoadOnlineData}
          type="button"
        >
          {isLoadingOnlineData ? "Loading online data" : "Load online data"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
        <label className="grid gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-400">
          <span>Want to add your own scores?</span>
          <input
            accept=".csv,text/csv"
            className="rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm font-extrabold text-slate-100 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:font-black file:text-slate-950"
            onChange={handleFileChange}
            type="file"
          />
        </label>
        <DataBadge label="Rows you added" value={importedCount} />
        <DataBadge label="Online rows added" value={onlineCount} />
      </div>

      {providerStatus.length ? (
        <div className="grid gap-2 md:grid-cols-3">
          {providerStatus.map((provider) => (
            <ProviderBadge key={provider.source} provider={provider} />
          ))}
        </div>
      ) : null}

      {warnings.length ? (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-3 text-xs font-semibold leading-5 text-amber-50/85">
          {warnings.join(" ")}
        </div>
      ) : null}

      <p className="text-xs font-semibold leading-5 text-slate-500">
        CSV columns supported: make, model, year, reliability, safety, insurance, maintenance, mpg,
        commonIssues, imageUrl, listingUrl. Import is optional; unanswered data falls back to the built-in car list.
      </p>
    </section>
  );
}

function ProviderBadge({ provider }: { provider: DataProviderStatus }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        provider.configured ? "border-emerald-300/25 bg-emerald-300/10" : "border-white/10 bg-slate-950/35"
      }`}
    >
      <strong className={`block text-sm font-black ${provider.configured ? "text-emerald-100" : "text-slate-200"}`}>
        {provider.configured ? "Connected" : "Needs setup"}
      </strong>
      <span className="mt-1 block text-xs font-black uppercase tracking-[0.1em] text-slate-400">{provider.source}</span>
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-400">{provider.message}</p>
    </div>
  );
}

function DataBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <strong className="block text-lg font-black text-white">{value}</strong>
      <span className="text-xs font-black uppercase tracking-[0.1em] text-slate-400">{label}</span>
    </div>
  );
}
