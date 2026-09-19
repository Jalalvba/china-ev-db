"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// One button + review modal for the four newer research categories, same visual
// pattern and same research → review → apply flow as IssueResearch.tsx /
// PositioningResearch.tsx (those two predate this and stay as their own components).
// Nothing is written until "Apply selected" — the apply routes re-validate every item
// server-side, so what's shown here is a preview, not the thing that gets trusted.

export type ResearchCategoryButton = "market_trend" | "known_issues_global" | "technical_bulletins" | "recalls";

interface Config {
  buttonLabel: string;
  title: string;
  scopeNote: string;
  emptyMessage: string;
  researchPath: string;
  applyPath: string;
  buildApplyBody: (items: ResearchItem[]) => Record<string, unknown>;
}

// Loose on purpose: the shape differs per category and the server re-validates on apply.
type ResearchItem = Record<string, unknown> & { confidence?: string };

const CONFIGS: Record<ResearchCategoryButton, Config> = {
  market_trend: {
    buttonLabel: "📈 Research market trend",
    title: "Market trend research (Chinese sources only)",
    scopeNote: "Chinese-language sales/ranking sources only.",
    emptyMessage: "No sales trend found in Chinese sources for this model.",
    researchPath: "research-market-trend",
    applyPath: "apply-market-trend",
    buildApplyBody: (items) => ({ market_trend: items[0] }),
  },
  known_issues_global: {
    buttonLabel: "🌍 Research known issues (Global)",
    title: "Known issues — global / export-market research",
    scopeNote: "International owner & press sources. Chinese complaint platforms are excluded — that population is the (China) button.",
    emptyMessage: "No international known issues found for this model.",
    researchPath: "research-global-issues",
    applyPath: "apply-issues",
    buildApplyBody: (items) => ({ region: "global", known_issues: items }),
  },
  technical_bulletins: {
    buttonLabel: "📄 Research technical bulletins",
    title: "Technical bulletins research (Chinese + manufacturer service sources)",
    scopeNote: "Chinese-language and manufacturer service sites. Empty results are common — most TSBs are dealer-portal-only.",
    emptyMessage: "No technical bulletins found — expected for many models (TSBs are rarely public).",
    researchPath: "research-bulletins",
    applyPath: "apply-bulletins",
    buildApplyBody: (items) => ({ technical_bulletins: items }),
  },
  recalls: {
    buttonLabel: "🚨 Research recalls",
    title: "Recalls research (not source-restricted)",
    scopeNote: "Regulators, manufacturer releases and press in any language or country.",
    emptyMessage: "No recalls found for this model.",
    researchPath: "research-recalls",
    applyPath: "apply-recalls",
    buildApplyBody: (items) => ({ recalls: items }),
  },
};

type Phase = "idle" | "loading" | "review" | "applying" | "done" | "error";

interface Meta {
  sourceCount: number;
  hasGrounding: boolean;
  warnings: string[];
  dropped: { index: number; errors: string[] }[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function ConfidenceTag({ value }: { value?: string }) {
  return <span className={value === "confirmed" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{value ?? "unconfirmed"}</span>;
}

function SourceLink({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline text-zinc-500 dark:text-zinc-400 break-all">
      source
    </a>
  );
}

function ItemBody({ category, item }: { category: ResearchCategoryButton; item: ResearchItem }) {
  const meta = "text-zinc-500 dark:text-zinc-400";
  if (category === "market_trend") {
    return (
      <div className="flex-1 min-w-0">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          {str(item.sales_trend) ?? "trend unknown"}
          {str(item.market_share_segment) ? ` · ${item.market_share_segment}` : ""}
        </p>
        {str(item.trend_evidence) && <p className={meta}>{String(item.trend_evidence)}</p>}
        <p className={meta}>
          <ConfidenceTag value={item.confidence} /> · <SourceLink url={str(item.source_url)} />
        </p>
      </div>
    );
  }
  if (category === "known_issues_global") {
    const systems = Array.isArray(item.affected_systems) ? (item.affected_systems as string[]).join(", ") : "";
    return (
      <div className="flex-1 min-w-0">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">{String(item.issue_description ?? "")}</p>
        <p className={meta}>
          {systems}
          {str(item.frequency_signal) ? ` · ${item.frequency_signal}` : ""} · {String(item.source ?? "")} · <ConfidenceTag value={item.confidence} /> · <SourceLink url={str(item.source_url)} />
        </p>
      </div>
    );
  }
  if (category === "technical_bulletins") {
    return (
      <div className="flex-1 min-w-0">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          {str(item.bulletin_id) ? `${item.bulletin_id} — ` : ""}
          {String(item.issue_description ?? "")}
        </p>
        <p className={meta}>
          {String(item.affected_component ?? "")}
          {str(item.component_detail) ? ` (${item.component_detail})` : ""}
          {str(item.issued_date) ? ` · ${item.issued_date}` : ""} · <ConfidenceTag value={item.confidence} /> · <SourceLink url={str(item.source_url)} />
        </p>
      </div>
    );
  }
  const tools = item.required_tools as { uses_brand_diagnostic_interface?: boolean; special_tool_names?: string[]; extra_tool_note?: string } | undefined;
  return (
    <div className="flex-1 min-w-0">
      <p className="font-medium text-zinc-700 dark:text-zinc-300">
        {str(item.recall_id) ? `${item.recall_id} — ` : ""}
        {String(item.issue_description ?? "")}
      </p>
      <p className={meta}>
        {String(item.affected_component ?? "")}
        {str(item.component_detail) ? ` (${item.component_detail})` : ""}
        {str(item.recall_date) ? ` · ${item.recall_date}` : ""}
        {str(item.issuing_body) ? ` · ${item.issuing_body}` : ""}
      </p>
      <p className={meta}>Remedy: {String(item.remedy_description ?? "")}</p>
      {str(item.affected_scope) && <p className={meta}>Scope: {String(item.affected_scope)}</p>}
      {tools && (
        <p className={meta}>
          Tools: {tools.uses_brand_diagnostic_interface ? "brand diagnostic interface" : "no diagnostic tool"}
          {tools.special_tool_names?.length ? ` · ${tools.special_tool_names.join(", ")}` : ""}
          {tools.extra_tool_note ? ` · extra: ${tools.extra_tool_note}` : ""}
        </p>
      )}
      <p className={meta}>
        <ConfidenceTag value={item.confidence} /> · <SourceLink url={str(item.source_url)} />
      </p>
    </div>
  );
}

export default function CategoryResearch({ modelId, category }: { modelId: string; category: ResearchCategoryButton }) {
  const cfg = CONFIGS[category];
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [selections, setSelections] = useState<boolean[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);

  async function handleResearch() {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelId}/${cfg.researchPath}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);

      const result = data.result;
      const found = (result.items ?? []) as ResearchItem[];
      setMeta({
        sourceCount: result.sourceUrls?.length ?? 0,
        hasGrounding: !!result.hasGrounding,
        warnings: result.warnings ?? [],
        dropped: result.dropped ?? [],
      });
      if (result.status === "error") {
        setErrorMessage(result.errorMessage ?? "Research failed.");
        setItems([]);
      } else if (found.length === 0) {
        setErrorMessage(cfg.emptyMessage);
        setItems([]);
      } else {
        setItems(found);
        setSelections(found.map(() => true));
      }
      setPhase("review");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  async function handleApply() {
    const selected = items.filter((_, i) => selections[i]);
    if (selected.length === 0) {
      setErrorMessage("Nothing selected — check at least one item before applying.");
      return;
    }
    setPhase("applying");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelId}/${cfg.applyPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg.buildApplyBody(selected)),
      });
      const data = await res.json();
      if (!res.ok || data.applied === false) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      setPhase("done");
      router.refresh();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("review");
    }
  }

  function close() {
    setPhase("idle");
    setItems([]);
    setSelections([]);
    setMeta(null);
    setErrorMessage(null);
  }

  const isModalOpen = phase === "review" || phase === "applying" || phase === "done" || (phase === "error" && meta !== null);

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleResearch}
        disabled={phase === "loading"}
        className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition inline-flex items-center gap-2"
      >
        {phase === "loading" && <Spinner />}
        {cfg.buttonLabel}
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div
            className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{cfg.title}</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{cfg.scopeNote}</p>

            {meta && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                {meta.sourceCount} qualifying source{meta.sourceCount === 1 ? "" : "s"}
                {!meta.hasGrounding && " — no qualifying citations found, all marked unconfirmed"}
              </p>
            )}
            {meta && meta.warnings.length > 0 && (
              <ul className="text-xs text-amber-700 dark:text-amber-400 mb-2 list-disc pl-4">
                {meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {meta && meta.dropped.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                {meta.dropped.length} item{meta.dropped.length === 1 ? "" : "s"} rejected as invalid: {meta.dropped.map((d) => d.errors.join(", ")).join(" | ")}
              </p>
            )}

            {errorMessage && phase !== "done" && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>}

            {phase === "done" ? (
              <div className="text-sm text-green-700 dark:text-green-400">
                <p className="font-medium">Applied.</p>
                <button onClick={close} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">Close</button>
              </div>
            ) : items.length === 0 ? null : (
              <>
                <div className="space-y-1.5">
                  {items.map((item, i) => (
                    <label key={i} className="flex items-start gap-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded p-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <input
                        type="checkbox"
                        checked={!!selections[i]}
                        onChange={() => setSelections((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
                        className="mt-0.5"
                      />
                      <ItemBody category={category} item={item} />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={close} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">Cancel</button>
                  <button onClick={handleApply} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 transition">
                    {phase === "applying" ? "Applying…" : "Apply selected"}
                  </button>
                </div>
              </>
            )}
            {phase !== "done" && items.length === 0 && (
              <div className="mt-3 flex justify-end">
                <button onClick={close} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs">Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
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
