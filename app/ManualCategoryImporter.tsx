"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "validating" | "review" | "applying" | "done" | "error";

interface Dropped {
  index: number;
  errors: string[];
}
interface ListPreview {
  newItems: Record<string, unknown>[];
  duplicateCount: number;
  dropped: Dropped[];
  warnings: string[];
}
interface MarketTrendPreview {
  proposed: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
}
interface ParseResult {
  valid: boolean;
  errors: string[];
  categoriesPresent: string[];
  hasChanges: boolean;
  market_trend?: MarketTrendPreview;
  known_issues?: ListPreview;
  technical_bulletins?: ListPreview;
  recalls?: ListPreview;
}
interface ApplyResponse {
  outcomes: { category: string; applied: boolean; added?: number; error?: string }[];
}

const LABELS: Record<string, string> = {
  market_trend: "Market trend",
  known_issues: "Known issues",
  technical_bulletins: "Technical bulletins",
  recalls: "Recalls",
};

function itemSummary(category: string, item: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  if (category === "known_issues") return `[${s(item.region)}] ${s(item.issue_description)} — ${s(item.source)} (${s(item.confidence)})`;
  if (category === "technical_bulletins") return `${s(item.bulletin_id) ? s(item.bulletin_id) + " — " : ""}${s(item.issue_description)} · ${s(item.affected_component)} (${s(item.confidence)})`;
  return `${s(item.recall_id) ? s(item.recall_id) + " — " : ""}${s(item.issue_description)} · ${s(item.affected_component)} · remedy: ${s(item.remedy_description)} (${s(item.confidence)})`;
}

function ListSection({ category, p }: { category: string; p: ListPreview }) {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded p-2">
      <p className="text-xs font-semibold mb-1">
        {LABELS[category]} — {p.newItems.length} new, {p.duplicateCount} already present{p.dropped.length > 0 ? `, ${p.dropped.length} rejected` : ""}
      </p>
      {p.newItems.length > 0 && (
        <ul className="text-xs list-disc pl-4 space-y-0.5 text-emerald-700 dark:text-emerald-400">
          {p.newItems.map((it, i) => <li key={i}>{itemSummary(category, it)}</li>)}
        </ul>
      )}
      {p.warnings.length > 0 && (
        <ul className="text-xs list-disc pl-4 mt-1 text-amber-700 dark:text-amber-400">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {p.dropped.length > 0 && (
        <ul className="text-xs list-disc pl-4 mt-1 text-red-600 dark:text-red-400">
          {p.dropped.map((d, i) => <li key={i}>item {d.index}: {d.errors.join("; ")}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * Paste-in counterpart to ManualCategoryExportButton — validates a pasted
 * research-categories-v1 JSON reply (from any external AI tool) against the ONE
 * canonical schema, shows a per-category preview (new / already present / rejected,
 * with normalization warnings), and only writes on "Apply". Separate from
 * ManualResearchImporter.tsx, which handles the spec/powertrain round-trip.
 */
export default function ManualCategoryImporter({ modelDbId }: { modelDbId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rawText, setRawText] = useState("");
  const [parse, setParse] = useState<ParseResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function post(path: string) {
    const res = await fetch(`/api/models/${modelDbId}/manual-categories/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: rawText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
    return data;
  }

  async function handleValidate() {
    setPhase("validating");
    setErrorMessage(null);
    try {
      setParse(await post("validate"));
      setPhase("review");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  async function handleApply() {
    setPhase("applying");
    setErrorMessage(null);
    try {
      setApplyResult(await post("apply"));
      setPhase("done");
      router.refresh();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("review");
    }
  }

  function reset() {
    setPhase("idle");
    setRawText("");
    setParse(null);
    setApplyResult(null);
    setErrorMessage(null);
  }

  return (
    <div className="mt-4 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900 max-w-3xl">
      <h3 className="font-semibold mb-2">Manual research import — market trend, known issues, bulletins, recalls</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
        Click &quot;📋 Export categories for any AI tool&quot;, paste the prompt into Kimi / Qwen / Gemini / Claude / DeepSeek, then paste its JSON reply
        here (schema <code>research-categories-v1</code>). New items are appended and de-duplicated; nothing is deleted.
      </p>

      {(phase === "idle" || phase === "validating" || phase === "error") && (
        <>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={8}
            placeholder='{ "schema_version": "research-categories-v1", "model_id": "…", … }'
            className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 rounded p-2 bg-white dark:bg-zinc-950"
          />
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{errorMessage}</p>}
          <button
            onClick={handleValidate}
            disabled={phase === "validating" || rawText.trim() === ""}
            className="mt-2 px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
          >
            {phase === "validating" ? "Validating…" : "Validate & preview"}
          </button>
        </>
      )}

      {(phase === "review" || phase === "applying") && parse && (
        <div className="space-y-2">
          {!parse.valid ? (
            <div className="text-sm text-red-600 dark:text-red-400">
              <p className="font-medium">Not importable:</p>
              <ul className="list-disc pl-4 text-xs">{parse.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          ) : (
            <>
              {parse.market_trend && (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded p-2">
                  <p className="text-xs font-semibold mb-1">Market trend</p>
                  {parse.market_trend.proposed ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {String(parse.market_trend.proposed.sales_trend ?? "trend unknown")}
                      {parse.market_trend.proposed.market_share_segment ? ` · ${String(parse.market_trend.proposed.market_share_segment)}` : ""} (
                      {String(parse.market_trend.proposed.confidence ?? parse.market_trend.proposed._confidence ?? "unconfirmed")})
                      {parse.market_trend.current ? " — replaces the existing assessment" : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{parse.market_trend.errors.length ? "Rejected" : "Researched — nothing found, no change."}</p>
                  )}
                  {[...parse.market_trend.errors].map((e, i) => <p key={`e${i}`} className="text-xs text-red-600 dark:text-red-400">{e}</p>)}
                  {parse.market_trend.warnings.map((w, i) => <p key={`w${i}`} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
                </div>
              )}
              {parse.known_issues && <ListSection category="known_issues" p={parse.known_issues} />}
              {parse.technical_bulletins && <ListSection category="technical_bulletins" p={parse.technical_bulletins} />}
              {parse.recalls && <ListSection category="recalls" p={parse.recalls} />}
              {!parse.hasChanges && <p className="text-xs text-zinc-500 dark:text-zinc-400">Nothing to apply — no new valid items.</p>}
            </>
          )}
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={reset} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">Start over</button>
            {parse.valid && parse.hasChanges && (
              <button onClick={handleApply} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60">
                {phase === "applying" ? "Applying…" : "Apply"}
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "done" && applyResult && (
        <div className="text-sm">
          <ul className="text-xs space-y-0.5">
            {applyResult.outcomes.map((o) => (
              <li key={o.category} className={o.applied ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                {LABELS[o.category]}: {o.applied ? `applied${o.added != null ? ` (+${o.added})` : ""}` : `FAILED — ${o.error}`}
              </li>
            ))}
            {applyResult.outcomes.length === 0 && <li className="text-zinc-500 dark:text-zinc-400">Nothing was written.</li>}
          </ul>
          <button onClick={reset} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">Import another</button>
        </div>
      )}
    </div>
  );
}
