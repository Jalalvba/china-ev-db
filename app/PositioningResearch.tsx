"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  modelId: string;
  compact?: boolean;
}

type Phase = "idle" | "loading" | "review" | "applying" | "done" | "error";

export default function PositioningResearch({ modelId, compact }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [positioning, setPositioning] = useState<{ text?: string; source?: string; confidence?: string } | null>(null);
  const [meta, setMeta] = useState<{ sourceCount: number; hasGrounding: boolean } | null>(null);

  async function handleResearch() {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelId}/research-positioning`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);

      const result = data.result;
      if (result.status !== "found" || !result.market_positioning?.text) {
        setErrorMessage(result.errorMessage ?? "No Chinese-source positioning claim found for this model.");
        setMeta({ sourceCount: result.sourceUrls?.length ?? 0, hasGrounding: !!result.hasGrounding });
        setPositioning(null);
        setPhase("review");
        return;
      }

      setPositioning(result.market_positioning);
      setMeta({ sourceCount: result.sourceUrls?.length ?? 0, hasGrounding: !!result.hasGrounding });
      setPhase("review");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  async function handleApply() {
    if (!positioning) return;
    setPhase("applying");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelId}/apply-positioning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_positioning: positioning }),
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
    setPositioning(null);
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
          title="Research market positioning (Chinese sources only)"
          className="relative z-10 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm disabled:opacity-60"
        >
          {phase === "loading" ? <Spinner /> : "🎯"}
        </button>
      ) : (
        <button
          onClick={handleResearch}
          disabled={phase === "loading"}
          className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition inline-flex items-center gap-2"
        >
          {phase === "loading" && <Spinner />}
          🎯 Research market positioning
        </button>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Market positioning research (Chinese sources only)</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>

            {meta && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                {meta.sourceCount} allowlisted Chinese source{meta.sourceCount === 1 ? "" : "s"}
                {!meta.hasGrounding && " — no Chinese-language citations found, marked unconfirmed"}
              </p>
            )}

            {errorMessage && phase !== "done" && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>}

            {phase === "done" ? (
              <div className="text-sm text-green-700 dark:text-green-400">
                <p className="font-medium">Applied.</p>
                <button onClick={close} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">Close</button>
              </div>
            ) : !positioning?.text ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No positioning claim found to apply.</p>
            ) : (
              <>
                <div className="text-xs border border-zinc-200 dark:border-zinc-800 rounded p-2 space-y-1">
                  <p className="text-zinc-700 dark:text-zinc-300">{positioning.text}</p>
                  {positioning.source && <p className="text-zinc-400 dark:text-zinc-500">Source: {positioning.source}</p>}
                  {positioning.confidence === "unconfirmed" && (
                    <p className="text-amber-600 dark:text-amber-400">Marked unconfirmed — no verified Chinese-source citation.</p>
                  )}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={close} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">Cancel</button>
                  <button onClick={handleApply} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 transition">
                    {phase === "applying" ? "Applying…" : "Apply"}
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
