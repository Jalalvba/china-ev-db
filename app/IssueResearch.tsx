"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  modelId: string;
  compact?: boolean;
}

type Phase = "idle" | "loading" | "review" | "applying" | "done" | "error";

interface IssueItem {
  issue_description: string;
  affected_systems: string[];
  frequency_signal?: string;
  source: string;
  confidence: string;
}

export default function IssueResearch({ modelId, compact }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<IssueItem[]>([]);
  const [selections, setSelections] = useState<boolean[]>([]);
  const [meta, setMeta] = useState<{ sourceCount: number; hasGrounding: boolean; dropped: { index: number; errors: string[] }[] } | null>(null);

  async function handleResearch() {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelId}/research-issues`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);

      const result = data.result;
      const found = (result.known_issues ?? []) as IssueItem[];
      if (result.status !== "found" || found.length === 0) {
        setErrorMessage(result.status === "found" ? "No known issues found in Chinese sources for this model." : result.errorMessage ?? "Research failed.");
        setMeta({ sourceCount: result.sourceUrls?.length ?? 0, hasGrounding: !!result.hasGrounding, dropped: result.dropped ?? [] });
        setItems([]);
        setPhase("review");
        return;
      }

      setItems(found);
      setSelections(found.map(() => true));
      setMeta({ sourceCount: result.sourceUrls?.length ?? 0, hasGrounding: !!result.hasGrounding, dropped: result.dropped ?? [] });
      setPhase("review");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  function toggle(i: number) {
    setSelections((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  async function handleApply() {
    const selected = items.filter((_, i) => selections[i]);
    if (selected.length === 0) {
      setErrorMessage("Nothing selected — check at least one issue before applying.");
      return;
    }
    setPhase("applying");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelId}/apply-issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region: "china", known_issues: selected }),
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
      {compact ? (
        <button
          onClick={(e) => {
            e.preventDefault();
            handleResearch();
          }}
          disabled={phase === "loading"}
          title="Research known issues — China (Chinese sources only, prioritizing 车质网/汽车投诉网)"
          className="relative z-10 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm disabled:opacity-60"
        >
          {phase === "loading" ? <Spinner /> : "⚠️"}
        </button>
      ) : (
        <button
          onClick={handleResearch}
          disabled={phase === "loading"}
          className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition inline-flex items-center gap-2"
        >
          {phase === "loading" && <Spinner />}
          ⚠️ Research known issues (China)
        </button>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div
            className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Known issues (China) research (车质网/汽车投诉网 prioritized, Chinese sources only)</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>

            {meta && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                {meta.sourceCount} allowlisted Chinese source{meta.sourceCount === 1 ? "" : "s"}
                {!meta.hasGrounding && " — no Chinese-language citations found, all marked unconfirmed"}
              </p>
            )}

            {meta && meta.dropped.length > 0 && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                {meta.dropped.length} item{meta.dropped.length === 1 ? "" : "s"} rejected as not about this exact model: {meta.dropped.map((d) => d.errors.join(", ")).join(" | ")}
              </p>
            )}

            {errorMessage && phase !== "done" && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>}

            {phase === "done" ? (
              <div className="text-sm text-green-700 dark:text-green-400">
                <p className="font-medium">Applied.</p>
                <button onClick={close} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">Close</button>
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No known issues found to add.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {items.map((item, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded p-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    >
                      <input type="checkbox" checked={!!selections[i]} onChange={() => toggle(i)} className="mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-zinc-700 dark:text-zinc-300">{item.issue_description}</p>
                        <p className="text-zinc-500 dark:text-zinc-400">
                          {item.affected_systems.join(", ")}
                          {item.frequency_signal ? ` · ${item.frequency_signal}` : ""} · {item.source} ·{" "}
                          <span className={item.confidence === "confirmed" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                            {item.confidence}
                          </span>
                        </p>
                      </div>
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
