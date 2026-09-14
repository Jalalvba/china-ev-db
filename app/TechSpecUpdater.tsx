"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ModelResearchResult, ResearchedVariant } from "@/lib/techSpecResearch";
import { matchTrimName } from "@/lib/trimMatching";

interface Props {
  /** "brand" loops over every model in that brand needing research; "model" researches exactly one model, unconditionally. */
  scope: "brand" | "model";
  /** The brand _id or model _id, matching `scope`. */
  id: string;
  /** Button label — defaults to a scope-appropriate copy. */
  label?: string;
}

type Phase = "idle" | "loading" | "review" | "applying" | "done" | "error";

interface PreviousModelData {
  variantsByTrim: Record<string, Record<string, unknown>>;
  notableFacts?: { text?: string; confidence?: string };
}

function variantSelectionKey(modelDbId: string, index: number): string {
  return `variant:${modelDbId}:${index}`;
}

function notableFactsSelectionKey(modelDbId: string): string {
  return `notable_facts:${modelDbId}`;
}

export default function TechSpecUpdater({ scope, id, label }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<ModelResearchResult[]>([]);
  const [previousDataByModel, setPreviousDataByModel] = useState<Record<string, PreviousModelData>>({});
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [applySummary, setApplySummary] = useState<{
    applied: number;
    notableFactsApplied: number;
    errors: number;
  } | null>(null);

  const updateUrl = `/api/${scope}s/${id}/update-specs`;
  const applyUrl = `/api/${scope}s/${id}/apply-specs`;

  async function handleRun() {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(updateUrl, { method: "POST" });
      const data = await res.json();

      // A 502 from the route still carries partial results (fatal
      // model-not-found mid-run) — show those instead of just an error.
      if (!res.ok && !Array.isArray(data?.results)) {
        throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      }

      const fetchedResults: ModelResearchResult[] = data.results ?? [];
      setResults(fetchedResults);
      setPreviousDataByModel(data.previousDataByModel ?? {});

      const initialSelections: Record<string, boolean> = {};
      fetchedResults.forEach((r) => {
        r.variants.forEach((v, idx) => {
          if (v.valid) initialSelections[variantSelectionKey(r.modelDbId, idx)] = true;
        });
        if (r.notableFacts?.valid && r.notableFacts.notableFacts) {
          initialSelections[notableFactsSelectionKey(r.modelDbId)] = true;
        }
      });
      setSelections(initialSelections);

      if (!res.ok) {
        // Partial run (fatal error mid-way) — show results but surface the error too.
        setErrorMessage(data?.error ?? "The research run stopped early.");
      }
      setPhase("review");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  function toggle(key: string) {
    setSelections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleApply() {
    setPhase("applying");
    setErrorMessage(null);

    const updates: { modelDbId: string; variant: Record<string, unknown> }[] = [];
    const notableFacts: { modelDbId: string; text: string; confidence?: string }[] = [];

    results.forEach((r) => {
      r.variants.forEach((v, idx) => {
        if (v.valid && selections[variantSelectionKey(r.modelDbId, idx)]) {
          updates.push({ modelDbId: r.modelDbId, variant: v.variant });
        }
      });
      const nf = r.notableFacts?.notableFacts;
      const text = nf && typeof nf.text === "string" ? nf.text : undefined;
      if (text && selections[notableFactsSelectionKey(r.modelDbId)]) {
        notableFacts.push({
          modelDbId: r.modelDbId,
          text,
          confidence: typeof nf?.confidence === "string" ? nf.confidence : undefined,
        });
      }
    });

    if (updates.length === 0 && notableFacts.length === 0) {
      setErrorMessage("Nothing selected — check at least one item before applying.");
      setPhase("review");
      return;
    }

    try {
      const res = await fetch(applyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, notableFacts }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      }
      setApplySummary({
        applied: data.applied ?? 0,
        notableFactsApplied: data.notableFactsApplied ?? 0,
        errors: (data.errors ?? []).length,
      });
      setPhase("done");
      // Re-run the server component's data fetch in place (RSC soft
      // refresh) so the page reflects what was just written without the
      // user having to manually reload. The page itself already fetches
      // directly from MongoDB with no caching (force-dynamic, no fetch()
      // calls), so this is guaranteed to pick up the new data.
      router.refresh();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("review");
    }
  }

  function reset() {
    setPhase("idle");
    setResults([]);
    setPreviousDataByModel({});
    setSelections({});
    setApplySummary(null);
    setErrorMessage(null);
  }

  const idleLabel = label ?? (scope === "brand" ? "🔄 Update technical info" : "🔄 Research this model");
  const loadingLabel =
    scope === "brand"
      ? "Researching models… this can take a while (each model is a separate search)"
      : "Researching this model…";

  return (
    <div className="mt-6">
      {phase === "idle" && (
        <button
          onClick={handleRun}
          className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
        >
          {idleLabel}
        </button>
      )}

      {phase === "loading" && (
        <button
          disabled
          className="px-3 py-1.5 rounded-md bg-blue-600/60 text-white text-sm font-medium cursor-wait inline-flex items-center gap-2"
        >
          <Spinner /> {loadingLabel}
        </button>
      )}

      {phase === "error" && (
        <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-400 max-w-xl">
          <p className="font-medium">Update failed</p>
          <p className="mt-1">{errorMessage}</p>
          <button onClick={reset} className="mt-2 text-xs underline">
            Try again
          </button>
        </div>
      )}

      {phase === "done" && applySummary && (
        <div className="rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-sm text-green-700 dark:text-green-400 max-w-xl">
          <p className="font-medium">
            Applied {applySummary.applied} variant update(s)
            {applySummary.notableFactsApplied > 0 ? `, ${applySummary.notableFactsApplied} notable-facts update(s)` : ""}
            {applySummary.errors > 0 ? `, ${applySummary.errors} error(s)` : ""}.
          </p>
          <p className="text-xs mt-1 text-zinc-500 dark:text-zinc-400">The page above has been refreshed with the new data.</p>
          <button onClick={reset} className="mt-2 text-xs underline">
            Run again
          </button>
        </div>
      )}

      {(phase === "review" || phase === "applying") && (
        <div className="mt-2 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="font-semibold">Review researched specs ({results.length} model(s) queried)</h3>
            <div className="flex gap-2">
              <button
                onClick={reset}
                disabled={phase === "applying"}
                className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={phase === "applying"}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {phase === "applying" ? "Applying…" : "Apply these updates"}
              </button>
            </div>
          </div>
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>}

          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {results.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No models needed research (everything is already confirmed and complete).
              </p>
            )}
            {results.map((r) => (
              <ModelResultCard
                key={r.modelDbId}
                result={r}
                previousData={previousDataByModel[r.modelDbId]}
                selections={selections}
                onToggle={toggle}
              />
            ))}
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

function ModelResultCard({
  result,
  previousData,
  selections,
  onToggle,
}: {
  result: ModelResearchResult;
  previousData?: PreviousModelData;
  selections: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  if (result.status === "error") {
    return (
      <div className="border border-red-200 dark:border-red-900 rounded-md p-3">
        <p className="font-medium text-sm">{result.modelName}</p>
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Error: {result.errorMessage}</p>
      </div>
    );
  }

  const rejectedCount = result.variants.filter((v) => !v.valid).length;
  const hasNotableFacts = !!(result.notableFacts?.valid && result.notableFacts.notableFacts);

  if (result.variants.length === 0 && !hasNotableFacts) {
    return (
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-md p-3">
        <p className="font-medium text-sm">{result.modelName}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Not found{result.errorMessage ? ` — ${result.errorMessage}` : ""}
        </p>
      </div>
    );
  }

  const validEntries = result.variants
    .map((v, idx) => ({ v, idx }))
    .filter((entry): entry is { v: ResearchedVariant; idx: number } => entry.v.valid);

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-md p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="font-medium text-sm">
          {result.modelName}{" "}
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal">
            ({result.sourceUrls.length} source{result.sourceUrls.length === 1 ? "" : "s"})
          </span>
        </p>
        {rejectedCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            {rejectedCount} rejected (schema mismatch)
          </span>
        )}
      </div>
      <div className="mt-2 space-y-2">
        {validEntries.map(({ v, idx }) => {
          const trimName = typeof v.variant.trim_name === "string" ? v.variant.trim_name : undefined;
          const existingTrimNames = Object.keys(previousData?.variantsByTrim ?? {});
          // the AI doesn't reliably reproduce an existing trim name
          // character-for-character across research passes — resolve the
          // SAME way the write path (lib/applySpecUpdates.ts) will, so what's
          // shown here is exactly what applying it will do: update an
          // existing trim, or (if genuinely no match) create a new one.
          const match = trimName ? matchTrimName(trimName, existingTrimNames) : { matchedTrimName: null, exact: true };
          const previousVariant = match.matchedTrimName ? previousData?.variantsByTrim[match.matchedTrimName] : undefined;
          // Only a real concern when this model already has existing trims
          // to potentially match against — a brand-new model's first trim
          // has nothing to match, and that's not a failure.
          const noMatchFound = !match.matchedTrimName && existingTrimNames.length > 0;
          return (
            <VariantRow
              key={variantSelectionKey(result.modelDbId, idx)}
              variantKey={variantSelectionKey(result.modelDbId, idx)}
              variant={v}
              previousVariant={previousVariant}
              matchedTrimName={match.matchedTrimName}
              fuzzyMatch={!match.exact && !!match.matchedTrimName}
              noMatchFound={noMatchFound}
              checked={!!selections[variantSelectionKey(result.modelDbId, idx)]}
              onToggle={onToggle}
            />
          );
        })}
        {hasNotableFacts && (
          <NotableFactsRow
            modelDbId={result.modelDbId}
            notableFacts={result.notableFacts!.notableFacts!}
            previousText={previousData?.notableFacts?.text}
            checked={!!selections[notableFactsSelectionKey(result.modelDbId)]}
            onToggle={onToggle}
          />
        )}
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: unknown }) {
  const isConfirmed = confidence === "confirmed";
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
        isConfirmed
          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
      }`}
    >
      {isConfirmed ? "confirmed" : "unconfirmed"}
    </span>
  );
}

function FieldGroup({ label, block, previousBlock }: { label: string; block: unknown; previousBlock?: unknown }) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const { confidence, ...fields } = block as Record<string, unknown>;
  const entries = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  const isConfirmed = confidence === "confirmed";
  const prev =
    previousBlock && typeof previousBlock === "object" && !Array.isArray(previousBlock)
      ? (previousBlock as Record<string, unknown>)
      : undefined;

  return (
    <div
      className={`rounded border px-2 py-1 text-xs ${
        isConfirmed
          ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30"
          : "border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <ConfidenceBadge confidence={confidence} />
      </div>
      <div className="mt-1 text-zinc-600 dark:text-zinc-400">
        {entries
          .map(([k, val]) => {
            const prevVal = prev?.[k];
            const changed = prevVal !== undefined && prevVal !== null && prevVal !== val;
            return changed ? (
              <span key={k}>
                {k}: <span className="line-through text-zinc-400 dark:text-zinc-500">{String(prevVal)}</span>{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">→ {String(val)}</span>
              </span>
            ) : (
              <span key={k}>
                {k}: {String(val)}
              </span>
            );
          })
          .reduce<ReactNode[]>((acc, node, i) => (i === 0 ? [node] : [...acc, " · ", node]), [])}
      </div>
    </div>
  );
}

function VariantRow({
  variantKey,
  variant,
  previousVariant,
  matchedTrimName,
  fuzzyMatch,
  noMatchFound,
  checked,
  onToggle,
}: {
  variantKey: string;
  variant: ResearchedVariant;
  previousVariant?: Record<string, unknown>;
  matchedTrimName: string | null;
  fuzzyMatch: boolean;
  noMatchFound: boolean;
  checked: boolean;
  onToggle: (key: string) => void;
}) {
  const v = variant.variant;
  const trimName = typeof v.trim_name === "string" ? v.trim_name : "(unnamed trim)";
  const energyType = typeof v.energy_type === "string" ? v.energy_type : "?";
  const isReResearch = !!previousVariant;

  return (
    <label className="block border border-zinc-200 dark:border-zinc-800 rounded-md p-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={() => onToggle(variantKey)} className="mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{trimName}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
              {energyType}
            </span>
            <ConfidenceBadge confidence={v.confidence} />
            {isReResearch && !fuzzyMatch && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                re-researched — changes highlighted below
              </span>
            )}
            {fuzzyMatch && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                matched to existing trim &quot;{matchedTrimName}&quot; — changes highlighted below
              </span>
            )}
            {noMatchFound && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                no match — will create a new trim
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <FieldGroup label="Engine" block={v.engine} previousBlock={previousVariant?.engine} />
            <FieldGroup label="Motor" block={v.motor} previousBlock={previousVariant?.motor} />
            <FieldGroup label="Battery" block={v.battery} previousBlock={previousVariant?.battery} />
            <FieldGroup label="Transmission" block={v.transmission} previousBlock={previousVariant?.transmission} />
            <FieldGroup label="Performance" block={v.performance} previousBlock={previousVariant?.performance} />
          </div>
        </div>
      </div>
    </label>
  );
}

function NotableFactsRow({
  modelDbId,
  notableFacts,
  previousText,
  checked,
  onToggle,
}: {
  modelDbId: string;
  notableFacts: Record<string, unknown>;
  previousText?: string;
  checked: boolean;
  onToggle: (key: string) => void;
}) {
  const text = typeof notableFacts.text === "string" ? notableFacts.text : "";
  if (!text) return null;
  const key = notableFactsSelectionKey(modelDbId);
  const changed = !!previousText && previousText !== text;

  return (
    <label className="block border border-zinc-200 dark:border-zinc-800 rounded-md p-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={() => onToggle(key)} className="mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">Notable facts</span>
            <ConfidenceBadge confidence={notableFacts.confidence} />
            {changed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                changed
              </span>
            )}
          </div>
          {changed && (
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 line-through">{previousText}</p>
          )}
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{text}</p>
        </div>
      </div>
    </label>
  );
}
