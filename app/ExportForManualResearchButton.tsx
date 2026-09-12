"use client";

import { useState } from "react";

interface Props {
  modelDbId: string;
}

type State = "idle" | "exporting" | "copied" | "error";

/**
 * Sits in the same action row as "Research this model" / "Fetch Morocco
 * price" on the model page. Fetches the combined prompt+JSON export text
 * from /api/models/[id]/manual-export and copies it straight to the
 * clipboard — one thing to paste into Kimi/DeepSeek's chat, not a
 * downloaded file plus a separate JSON file to juggle.
 */
export default function ExportForManualResearchButton({ modelDbId }: Props) {
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleClick() {
    setState("exporting");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelDbId}/manual-export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      await navigator.clipboard.writeText(data.text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setErrorMessage((err as Error).message);
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === "exporting"}
      title={errorMessage ?? undefined}
      className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 transition"
    >
      {state === "exporting"
        ? "Exporting…"
        : state === "copied"
          ? "Copied!"
          : state === "error"
            ? "Copy failed — retry"
            : "📋 Export for Kimi/DeepSeek"}
    </button>
  );
}
