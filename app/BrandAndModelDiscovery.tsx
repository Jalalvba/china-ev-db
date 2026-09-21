"use client";

// Tier-2 model-discovery trigger for the brand detail page (2026-09-21: the
// Tier-1 automated brand-identity call this used to chain in front of model
// discovery was removed — brand identity now goes through the manual
// export/import panel, app/BrandResearch.tsx. This still calls
// /api/brands/[id]/discover-models directly, which is a separate automated
// AI feature out of scope for that removal pass; see CLAUDE.md's 2026-09-21
// entry). Review screen shows discovered models; "Apply all" creates them
// via create-models.
//
// This intentionally does NOT cover per-model spec research ("🔄 Update
// technical info") — that stays its own explicit, one-model-at-a-time
// action, not folded into this batch.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelDiscoveryResult } from "@/lib/modelDiscovery";

interface Props {
  brandId: string;
}

type Phase = "idle" | "discovering" | "review" | "applying" | "done" | "error";

interface EditableModel {
  key: string;
  name: string;
  name_cn: string;
  name_en: string;
  regional_name_note: string;
  generation: string;
  segment: string;
  body_type: string;
  production_status: string;
  price_min: string;
  price_max: string;
  confidence: string;
  selected: boolean;
}

const SEGMENTS = [
  "A-segment/City",
  "B-segment/Compact",
  "C-segment/Mid-size",
  "D-segment/Large",
  "SUV-compact",
  "SUV-mid",
  "SUV-full",
  "MPV",
  "Pickup",
  "Sports",
];
const PRODUCTION_STATUSES = ["in production", "discontinued", "upcoming"];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): string {
  return typeof v === "number" ? String(v) : "";
}

export default function BrandAndModelDiscovery({ brandId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [modelResult, setModelResult] = useState<ModelDiscoveryResult | null>(null);
  const [modelRows, setModelRows] = useState<EditableModel[]>([]);

  const [applySummary, setApplySummary] = useState<{
    modelsCreated: number;
    modelErrors: number;
  } | null>(null);

  async function handleRun() {
    setPhase("discovering");
    setErrorMessage(null);
    setModelResult(null);
    setModelRows([]);

    try {
      const res = await fetch(`/api/brands/${brandId}/discover-models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandContext: {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);

      const r: ModelDiscoveryResult = data.result;
      setModelResult(r);
      const editable: EditableModel[] = r.discovered
        .filter((d) => d.valid)
        .map((d, idx) => {
          const m = d.model;
          const segment = str(m.segment);
          const bodyType = str(m.body_type);
          const priceRange = (m.price_range && typeof m.price_range === "object" ? m.price_range : {}) as Record<
            string,
            unknown
          >;
          return {
            key: `${idx}`,
            name: str(m.name),
            name_cn: str(m.name_cn),
            name_en: str(m.name_en),
            regional_name_note: str(m.regional_name_note),
            generation: str(m.generation),
            segment,
            body_type: bodyType,
            production_status: str(m.production_status) || "in production",
            price_min: num(priceRange.min),
            price_max: num(priceRange.max),
            confidence: str(m.confidence) || "unconfirmed",
            selected: !!(segment && bodyType),
          };
        });
      setModelRows(editable);
      setPhase("review");
    } catch (err) {
      setErrorMessage(`Model discovery failed: ${(err as Error).message}`);
      setPhase("error");
    }
  }

  function updateModelRow(key: string, patch: Partial<EditableModel>) {
    setModelRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleApplyAll() {
    setPhase("applying");
    setErrorMessage(null);

    const modelsToCreate = modelRows.filter((r) => r.selected && r.segment && r.body_type && r.name);

    if (modelsToCreate.length === 0) {
      setErrorMessage("Nothing selected — check at least one model before applying.");
      setPhase("review");
      return;
    }

    let modelsCreated = 0;
    let modelErrors = 0;
    const errs: string[] = [];

    if (modelsToCreate.length > 0) {
      try {
        const res = await fetch(`/api/brands/${brandId}/create-models`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            models: modelsToCreate.map((r) => ({
              name: r.name,
              name_cn: r.name_cn || undefined,
              name_en: r.name_en || undefined,
              generation: r.generation || undefined,
              segment: r.segment,
              body_type: r.body_type,
              production_status: r.production_status,
              price_range:
                r.price_min || r.price_max
                  ? { min: r.price_min ? Number(r.price_min) : undefined, max: r.price_max ? Number(r.price_max) : undefined }
                  : undefined,
              confidence: r.confidence,
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
        modelsCreated = data.created ?? 0;
        modelErrors = (data.errors ?? []).length;
      } catch (err) {
        errs.push(`Models: ${(err as Error).message}`);
      }
    }

    if (errs.length > 0) {
      setErrorMessage(errs.join(" — "));
    }
    setApplySummary({ modelsCreated, modelErrors });
    setPhase("done");
    router.refresh();
  }

  function reset() {
    setPhase("idle");
    setErrorMessage(null);
    setModelResult(null);
    setModelRows([]);
    setApplySummary(null);
  }

  return (
    <div className="mt-6">
      {phase === "idle" && (
        <button
          onClick={handleRun}
          className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
        >
          🔎 Discover models
        </button>
      )}

      {phase === "discovering" && (
        <button
          disabled
          className="px-3 py-1.5 rounded-md bg-indigo-600/60 text-white text-sm font-medium cursor-wait inline-flex items-center gap-2"
        >
          <Spinner />
          Discovering models…
        </button>
      )}

      {phase === "error" && (
        <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-400 max-w-xl">
          <p className="font-medium">Research failed</p>
          <p className="mt-1">{errorMessage}</p>
          <button onClick={reset} className="mt-2 text-xs underline">
            Try again
          </button>
        </div>
      )}

      {phase === "done" && applySummary && (
        <div className="rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-sm text-green-700 dark:text-green-400 max-w-xl">
          <p className="font-medium">
            Created {applySummary.modelsCreated} model(s)
            {applySummary.modelErrors > 0 ? `, ${applySummary.modelErrors} error(s)` : ""}.
          </p>
          {errorMessage && <p className="text-xs mt-1 text-red-600 dark:text-red-400">{errorMessage}</p>}
          <p className="text-xs mt-1 text-zinc-500 dark:text-zinc-400">
            Use &quot;🔄&quot; on each new model to fill in its powertrain specs.
          </p>
          <button onClick={reset} className="mt-2 text-xs underline">
            Run again
          </button>
        </div>
      )}

      {(phase === "review" || phase === "applying") && (
        <div className="mt-2 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="font-semibold">Review discovered models</h3>
            <div className="flex gap-2">
              <button
                onClick={reset}
                disabled={phase === "applying"}
                className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyAll}
                disabled={phase === "applying"}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {phase === "applying" ? "Applying…" : "Apply all"}
              </button>
            </div>
          </div>
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{errorMessage}</p>}

          <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
            <section>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Discovered models
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  {modelRows.length} found, {modelResult?.sourceUrls.length ?? 0} source
                  {modelResult?.sourceUrls.length === 1 ? "" : "s"}
                </span>
              </h4>
              {modelResult && !modelResult.hasGrounding && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  No search citations were found for this run — every model below is marked unconfirmed.
                </p>
              )}
              <div className="space-y-2">
                {modelRows.length === 0 && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">No new models found (or none passed schema validation).</p>
                )}
                {modelRows.map((r) => {
                  const ready = !!(r.segment && r.body_type);
                  return (
                    <div key={r.key} className="border border-zinc-200 dark:border-zinc-800 rounded-md p-2">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={r.selected && ready}
                          disabled={!ready}
                          onChange={() => updateModelRow(r.key, { selected: !r.selected })}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{r.name}</span>
                            {r.generation && <span className="text-xs text-zinc-500 dark:text-zinc-400">({r.generation})</span>}
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                r.confidence === "confirmed"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                  : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                              }`}
                            >
                              {r.confidence === "confirmed" ? "confirmed" : "unconfirmed"}
                            </span>
                            {!ready && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                needs segment + body type to include
                              </span>
                            )}
                          </div>
                          {(r.name_cn || r.regional_name_note) && (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {r.name_cn && <>Domestic name: {r.name_cn}</>}
                              {r.name_cn && r.regional_name_note && " — "}
                              {r.regional_name_note}
                            </p>
                          )}

                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <label className="flex flex-col gap-0.5">
                              <span className="text-zinc-500 dark:text-zinc-400">Segment*</span>
                              <select
                                value={r.segment}
                                onChange={(e) => updateModelRow(r.key, { segment: e.target.value })}
                                className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded px-1.5 py-1"
                              >
                                <option value="">— select —</option>
                                {SEGMENTS.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-zinc-500 dark:text-zinc-400">Body type*</span>
                              <input
                                value={r.body_type}
                                onChange={(e) => updateModelRow(r.key, { body_type: e.target.value })}
                                placeholder="e.g. 5-door SUV"
                                className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded px-1.5 py-1"
                              />
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-zinc-500 dark:text-zinc-400">Status</span>
                              <select
                                value={r.production_status}
                                onChange={(e) => updateModelRow(r.key, { production_status: e.target.value })}
                                className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded px-1.5 py-1"
                              >
                                {PRODUCTION_STATUSES.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-zinc-500 dark:text-zinc-400">Price (local)</span>
                              <div className="flex gap-1">
                                <input
                                  value={r.price_min}
                                  onChange={(e) => updateModelRow(r.key, { price_min: e.target.value })}
                                  placeholder="min"
                                  className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded px-1.5 py-1"
                                />
                                <input
                                  value={r.price_max}
                                  onChange={(e) => updateModelRow(r.key, { price_max: e.target.value })}
                                  placeholder="max"
                                  className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded px-1.5 py-1"
                                />
                              </div>
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
