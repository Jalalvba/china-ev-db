"use client";

import { useState } from "react";

const CATEGORY_OPTIONS: { key: string; label: string }[] = [
  { key: "market_trend", label: "Market trend" },
  { key: "known_issues", label: "Known issues (China + Global)" },
  { key: "technical_bulletins", label: "Technical bulletins" },
  { key: "recalls", label: "Recalls" },
];

type State = "idle" | "exporting" | "copied" | "error";

/**
 * Category-picker counterpart to ExportForManualResearchButton (which exports the
 * spec/powertrain prompt): copies a prompt + the research-categories-v1 envelope
 * template for the chosen categories, to paste into ANY external chat tool (Kimi, Qwen,
 * Gemini, Claude, DeepSeek…). The tool's JSON reply is pasted into ManualCategoryImporter.
 */
export default function ManualCategoryExportButton({ modelDbId }: { modelDbId: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({ market_trend: true, known_issues: true, technical_bulletins: true, recalls: true });
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCopy() {
    const categories = CATEGORY_OPTIONS.filter((c) => picked[c.key]).map((c) => c.key);
    setState("exporting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelDbId}/manual-categories/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      await navigator.clipboard.writeText(data.text);
      setState("copied");
      setTimeout(() => {
        setState("idle");
        setOpen(false);
      }, 1500);
    } catch (err) {
      setErrorMessage((err as Error).message);
      setState("error");
    }
  }

  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
      >
        📋 Export categories for any AI tool
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-3 text-sm">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Categories to include in the prompt:</p>
          {CATEGORY_OPTIONS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 py-0.5">
              <input type="checkbox" checked={!!picked[c.key]} onChange={() => setPicked((p) => ({ ...p, [c.key]: !p[c.key] }))} />
              {c.label}
            </label>
          ))}
          {errorMessage && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{errorMessage}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs">Cancel</button>
            <button
              onClick={handleCopy}
              disabled={state === "exporting" || !CATEGORY_OPTIONS.some((c) => picked[c.key])}
              className="px-2 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {state === "exporting" ? "Copying…" : state === "copied" ? "Copied!" : "Copy prompt"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
