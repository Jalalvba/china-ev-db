"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** The model _id. */
  id: string;
  label?: string;
}

type Phase = "idle" | "loading" | "done" | "error";

// Deterministic scrape, not AI research — no review step needed like
// TechSpecUpdater: the write happens server-side and this just reports the
// outcome, then refreshes the page to show it.
export default function MoroccoPriceFetcher({ id, label }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleRun() {
    setPhase("loading");
    setMessage(null);
    try {
      const res = await fetch(`/api/models/${id}/fetch-morocco-price`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);

      setMessage(
        data.found
          ? `Found: ${data.morocco_price_dh?.toLocaleString()} DH (${data.morocco_price_source})`
          : "Not listed on moteur.ma or wandaloo.com."
      );
      setPhase("done");
      router.refresh();
    } catch (err) {
      setMessage((err as Error).message);
      setPhase("error");
    }
  }

  const idleLabel = label ?? "💰 Fetch Morocco price";

  if (phase === "loading") {
    return (
      <button
        disabled
        className="mt-2 px-3 py-1.5 rounded-md bg-blue-600/60 text-white text-sm font-medium cursor-wait inline-flex items-center gap-2"
      >
        <Spinner /> Checking moteur.ma / wandaloo.com…
      </button>
    );
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleRun}
        className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
      >
        {idleLabel}
      </button>
      {phase === "done" && message && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{message}</p>}
      {phase === "error" && message && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{message}</p>}
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
