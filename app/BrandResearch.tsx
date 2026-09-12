"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  brandId: string;
  /** Small icon-only trigger for list/card contexts, vs. the full labeled button on the brand detail page. Review always opens as a modal regardless. */
  compact?: boolean;
}

type Phase = "idle" | "loading" | "review" | "applying" | "done" | "error";

interface FieldRow {
  key: string;
  label: string;
  current?: unknown;
  next?: unknown;
}

const FIELD_LABELS: Record<string, string> = {
  name_cn: "Chinese name",
  parent_group: "Parent group",
  relationship_type: "Relationship type",
  stake_percentage: "Stake %",
  tech_partner: "Tech partner",
  country_origin: "Country of origin",
  founded_year: "Founded year",
  status: "Status",
  status_note: "Status note",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS);

function display(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  return String(v);
}

export default function BrandResearch({ brandId, compact }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [meta, setMeta] = useState<{ sourceCount: number; hasGrounding: boolean; confidence?: string } | null>(null);

  async function handleResearch() {
    setPhase("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/brands/${brandId}/research-brand`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);

      const result = data.result;
      const current = data.currentBrand ?? {};

      if (result.status !== "found" || !result.brand) {
        setErrorMessage(result.errorMessage ?? "No confident result found for this brand.");
        setMeta({ sourceCount: result.sourceUrls?.length ?? 0, hasGrounding: !!result.hasGrounding });
        setRows([]);
        setPhase("review");
        return;
      }

      const next = result.brand as Record<string, unknown>;
      const builtRows: FieldRow[] = FIELD_ORDER.filter((k) => next[k] !== undefined && next[k] !== null).map((k) => ({
        key: k,
        label: FIELD_LABELS[k],
        current: current[k],
        next: next[k],
      }));
      setRows(builtRows);
      setSelections(Object.fromEntries(builtRows.map((r) => [r.key, true])));
      setMeta({ sourceCount: result.sourceUrls?.length ?? 0, hasGrounding: !!result.hasGrounding, confidence: next.confidence as string });
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

    const fields: Record<string, unknown> = {};
    rows.forEach((r) => {
      if (selections[r.key]) fields[r.key] = r.next;
    });

    if (Object.keys(fields).length === 0) {
      setErrorMessage("Nothing selected — check at least one field before applying.");
      setPhase("review");
      return;
    }

    try {
      const res = await fetch(`/api/brands/${brandId}/apply-brand-research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const data = await res.json();
      if (!res.ok || data.applied === false) {
        throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      }
      setPhase("done");
      router.refresh();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("review");
    }
  }

  function close() {
    setPhase("idle");
    setRows([]);
    setSelections({});
    setMeta(null);
    setErrorMessage(null);
  }

  const isModalOpen = phase === "review" || phase === "applying" || phase === "done" || (phase === "error" && rows.length === 0 && meta !== null);

  return (
    // Stops every click anywhere in this subtree (trigger, modal backdrop,
    // modal panel) from bubbling up — this component is often rendered
    // inside a brand-card <Link>, and without this, dismissing the modal by
    // clicking the backdrop would also trigger the card's navigation.
    <span onClick={(e) => e.stopPropagation()}>
      {compact ? (
        <button
          onClick={(e) => {
            e.preventDefault();
            handleResearch();
          }}
          disabled={phase === "loading"}
          title="Research this brand"
          className="relative z-10 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm disabled:opacity-60"
        >
          {phase === "loading" ? <Spinner /> : "🔎"}
        </button>
      ) : (
        <button
          onClick={handleResearch}
          disabled={phase === "loading"}
          className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 transition inline-flex items-center gap-2"
        >
          {phase === "loading" && <Spinner />}
          🔎 Research this brand
        </button>
      )}

      {phase === "error" && !isModalOpen && (
        <div className="mt-2 text-xs text-red-600 dark:text-red-400 max-w-xs">{errorMessage}</div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Brand identity research</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">
                ×
              </button>
            </div>

            {meta && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                {meta.sourceCount} source{meta.sourceCount === 1 ? "" : "s"}
                {!meta.hasGrounding && " — no citations found, all fields marked unconfirmed"}
              </p>
            )}

            {errorMessage && phase !== "done" && (
              <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>
            )}

            {phase === "done" ? (
              <div className="text-sm text-green-700 dark:text-green-400">
                <p className="font-medium">Applied.</p>
                <button onClick={close} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">
                  Close
                </button>
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No fields found to update.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {rows.map((r) => {
                    const changed = r.current !== undefined && r.current !== null && String(r.current) !== String(r.next);
                    return (
                      <label
                        key={r.key}
                        className="flex items-start gap-2 text-xs border border-zinc-200 dark:border-zinc-800 rounded p-1.5 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      >
                        <input
                          type="checkbox"
                          checked={!!selections[r.key]}
                          onChange={() => toggle(r.key)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">{r.label}: </span>
                          {changed ? (
                            <>
                              <span className="line-through text-zinc-400 dark:text-zinc-500">{display(r.current)}</span>{" "}
                              <span className="text-zinc-700 dark:text-zinc-300">→ {display(r.next)}</span>
                            </>
                          ) : (
                            <span className="text-zinc-600 dark:text-zinc-400">{display(r.next)}</span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={close}
                    disabled={phase === "applying"}
                    className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleApply}
                    disabled={phase === "applying"}
                    className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
                  >
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
