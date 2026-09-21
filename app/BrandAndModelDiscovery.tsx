"use client";

// Tier-2 model-discovery panel for the brand detail page (2026-09-21: the
// Tier-1 automated brand-identity call this used to chain in front of model
// discovery was removed earlier — brand identity now goes through the manual
// export/import panel, app/BrandResearch.tsx. This component itself used to
// call /api/brands/[id]/discover-models directly — it was the LAST remaining
// automated-AI-call button anywhere in the app; see CLAUDE.md's 2026-09-21
// entries. Now: "Export prompt" builds a model-discovery-manual-v1 prompt,
// "Import response" validates a pasted reply (flagging likely duplicates
// against models already on file) into the same per-row review table this
// component already had — "Apply selected" creates only the checked rows via
// the existing create-models route, which re-checks the exact name and
// re-verifies on write.
//
// This intentionally does NOT cover per-model spec research ("🔄 Update
// technical info") — that stays its own explicit, one-model-at-a-time
// action, not folded into this batch.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelDiscoveryManualImportResult } from "@/lib/modelDiscovery";

interface Props {
  brandId: string;
}

type Phase = "idle" | "exporting" | "pasting" | "validating" | "review" | "applying" | "done" | "error";

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
  duplicate: boolean;
  existingModelId: string | null;
  invalid: boolean;
  itemErrors: string[];
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

  const [exportText, setExportText] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);
  const [hasGrounding, setHasGrounding] = useState(true);

  const [modelRows, setModelRows] = useState<EditableModel[]>([]);

  const [applySummary, setApplySummary] = useState<{
    modelsCreated: number;
    modelErrors: number;
  } | null>(null);

  async function handleExport() {
    setPhase("exporting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/manual-discover-models/export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      setExportText(data.text);
      setCopied(false);
      setPhase("pasting");
    } catch (err) {
      setErrorMessage(`Building export prompt failed: ${(err as Error).message}`);
      setPhase("error");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
    } catch {
      setErrorMessage("Could not copy automatically — select and copy the text manually.");
    }
  }

  async function handleValidate() {
    setPhase("validating");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/manual-discover-models/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: pasteText }),
      });
      const data: ModelDiscoveryManualImportResult & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      if (!data.valid) throw new Error(data.errors.join(" — "));

      // Manual paste carries no separate citation list — "grounding" here just means the
      // response cited at least one confirmed item; each row's own confidence is authoritative.
      const anyConfirmed = data.items.some((it) => it.valid && it.model.confidence === "confirmed");
      setHasGrounding(anyConfirmed);

      const editable: EditableModel[] = data.items.map((it, idx) => {
        const m = it.model;
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
          selected: it.valid && !it.duplicate && !!(segment && bodyType),
          duplicate: it.duplicate,
          existingModelId: it.existingModelId,
          invalid: !it.valid,
          itemErrors: it.errors,
        };
      });
      setModelRows(editable);
      setPhase("review");
    } catch (err) {
      setErrorMessage(`Import failed: ${(err as Error).message}`);
      setPhase("pasting");
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
    setExportText("");
    setPasteText("");
    setCopied(false);
    setModelRows([]);
    setApplySummary(null);
  }

  return (
    <div className="mt-6">
      {phase === "idle" && (
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
          >
            📋 Export prompt for model discovery
          </button>
          <button
            onClick={() => setPhase("pasting")}
            className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
          >
            📥 Import response
          </button>
        </div>
      )}

      {phase === "exporting" && (
        <button
          disabled
          className="px-3 py-1.5 rounded-md bg-indigo-600/60 text-white text-sm font-medium cursor-wait inline-flex items-center gap-2"
        >
          <Spinner />
          Building prompt…
        </button>
      )}

      {(phase === "pasting" || phase === "validating") && (
        <div className="mt-2 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900 max-w-xl">
          {exportText && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Export prompt — paste into Kimi/Gemini/DeepSeek chat
                </span>
                <button onClick={handleCopy} className="text-xs underline">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <textarea
                readOnly
                value={exportText}
                rows={6}
                className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 rounded p-2"
              />
            </div>
          )}
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            Paste the AI&apos;s JSON response here
          </label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            placeholder="Paste the model-discovery-manual-v1 JSON response…"
            className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded p-2"
          />
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{errorMessage}</p>}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleValidate}
              disabled={phase === "validating" || pasteText.trim() === ""}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
            >
              {phase === "validating" ? "Validating…" : "Validate"}
            </button>
            <button onClick={reset} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-400 max-w-xl">
          <p className="font-medium">Something went wrong</p>
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
            Start over
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
                {phase === "applying" ? "Applying…" : `Apply selected (${modelRows.filter((r) => r.selected).length})`}
              </button>
            </div>
          </div>
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{errorMessage}</p>}

          <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4">
            <section>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Discovered models
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  {modelRows.length} in response, {modelRows.filter((r) => r.duplicate).length} look like duplicates
                </span>
              </h4>
              {!hasGrounding && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  No confirmed items in this response — every model below is marked unconfirmed.
                </p>
              )}
              <div className="space-y-2">
                {modelRows.length === 0 && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">No models in the pasted response (or none passed schema validation).</p>
                )}
                {modelRows.map((r) => {
                  const ready = !!(r.segment && r.body_type) && !r.invalid;
                  return (
                    <div
                      key={r.key}
                      className={`border rounded-md p-2 ${
                        r.invalid
                          ? "border-red-300 dark:border-red-800"
                          : r.duplicate
                          ? "border-amber-300 dark:border-amber-800"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
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
                            {r.duplicate && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                already exists — deselected by default
                              </span>
                            )}
                            {!r.invalid && !ready && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                needs segment + body type to include
                              </span>
                            )}
                          </div>
                          {r.invalid && r.itemErrors.length > 0 && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{r.itemErrors.join(" — ")}</p>
                          )}
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
