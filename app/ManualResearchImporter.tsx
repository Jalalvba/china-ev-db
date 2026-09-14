"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  modelDbId: string;
}

type Phase = "idle" | "validating" | "review" | "applying" | "done" | "error";

interface FieldDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
  sourceNote?: string;
}

interface PowertrainImportResult {
  status: "update" | "new";
  existingId?: string;
  trimName?: string;
  diff: FieldDiffEntry[];
  valid: boolean;
  errors: string[];
}

interface ValidateResponse {
  valid: boolean;
  errors: string[];
  modelDiff: FieldDiffEntry[];
  powertrainResults: PowertrainImportResult[];
}

interface ApplyResponse {
  modelApplied: boolean;
  powertrainOutcomes: { trimName?: string; status: string; applied: boolean; error?: string }[];
  errors: string[];
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function DiffTable({ entries }: { entries: FieldDiffEntry[] }) {
  if (entries.length === 0) return <p className="text-xs text-zinc-500 dark:text-zinc-400">No changes.</p>;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-left text-zinc-500 dark:text-zinc-400">
          <th className="pr-2 py-1 font-medium">Field</th>
          <th className="pr-2 py-1 font-medium">Before</th>
          <th className="pr-2 py-1 font-medium">After</th>
          <th className="pr-2 py-1 font-medium">Source</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.path} className="border-t border-zinc-100 dark:border-zinc-800">
            <td className="pr-2 py-1 font-mono">{e.path}</td>
            <td className="pr-2 py-1 text-red-600 dark:text-red-400">{formatValue(e.before)}</td>
            <td className="pr-2 py-1 text-emerald-600 dark:text-emerald-400">{formatValue(e.after)}</td>
            <td className="pr-2 py-1 text-zinc-500 dark:text-zinc-400">{e.sourceNote ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The manual Kimi/DeepSeek round-trip counterpart to TechSpecUpdater.tsx —
 * deliberately a separate component rather than a shared one: the input here
 * is hand-pasted text diffed against the current DB state (including
 * genuinely new trims and _id-based matching), not a live AI research
 * result keyed by array index, so the two don't share a data shape worth
 * forcing into one component.
 */
export default function ManualResearchImporter({ modelDbId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rawText, setRawText] = useState("");
  const [source, setSource] = useState<"manual-kimi-import" | "manual-deepseek-import">("manual-deepseek-import");
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleValidate() {
    setPhase("validating");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/models/${modelDbId}/manual-import/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: rawText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      setValidation(data);
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
      const res = await fetch(`/api/models/${modelDbId}/manual-import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: rawText, source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      setApplyResult(data);
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
    setValidation(null);
    setApplyResult(null);
    setErrorMessage(null);
  }

  return (
    <div className="mt-6 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 bg-white dark:bg-zinc-900 max-w-3xl">
      <h3 className="font-semibold mb-2">Manual research import (Kimi / DeepSeek)</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
        Click &quot;📋 Export for Kimi/DeepSeek&quot; above to copy the research prompt, paste it into Kimi or DeepSeek&apos;s own chat,
        then paste its JSON response below.
      </p>

      {(phase === "idle" || phase === "validating" || phase === "error") && (
        <>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the JSON response from Kimi/DeepSeek here…"
            rows={8}
            className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 rounded-md p-2 bg-zinc-50 dark:bg-zinc-950"
          />
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{errorMessage}</p>}
          <button
            onClick={handleValidate}
            disabled={phase === "validating" || rawText.trim() === ""}
            className="mt-2 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {phase === "validating" ? "Validating…" : "Validate & preview diff"}
          </button>
        </>
      )}

      {(phase === "review" || phase === "applying") && validation && (
        <div>
          {!validation.valid && (
            <div className="rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-400 mb-3">
              <p className="font-medium">Validation failed — nothing can be applied until these are fixed:</p>
              <ul className="list-disc list-inside mt-1">
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-3">
            <p className="text-sm font-medium mb-1">Model fields</p>
            <DiffTable entries={validation.modelDiff} />
          </div>

          {validation.powertrainResults.map((pt, i) => (
            <div key={i} className="mb-3">
              <p className="text-sm font-medium mb-1">
                {pt.status === "new" ? "New trim" : `Trim: ${pt.trimName}`}
                {pt.status === "new" && !pt.existingId ? " (no matching _id found — will insert as new)" : ""}
                {!pt.valid && <span className="text-red-600 dark:text-red-400"> — invalid</span>}
              </p>
              {pt.errors.length > 0 ? (
                <ul className="list-disc list-inside text-xs text-red-600 dark:text-red-400">
                  {pt.errors.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              ) : (
                <DiffTable entries={pt.diff} />
              )}
            </div>
          ))}

          {validation.valid && (
            <div className="flex items-center gap-2 mt-3">
              <label className="text-sm">Source:</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
                className="text-sm border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-950"
              >
                <option value="manual-deepseek-import">DeepSeek</option>
                <option value="manual-kimi-import">Kimi</option>
              </select>
              <button
                onClick={handleApply}
                disabled={phase === "applying"}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {phase === "applying" ? "Applying…" : "Apply these changes"}
              </button>
              <button
                onClick={reset}
                disabled={phase === "applying"}
                className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          )}
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{errorMessage}</p>}
        </div>
      )}

      {phase === "done" && applyResult && (
        <div className="rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-sm text-green-700 dark:text-green-400">
          <p className="font-medium">
            Model fields {applyResult.modelApplied ? "applied" : "unchanged"}; {applyResult.powertrainOutcomes.filter((o) => o.applied).length}/
            {applyResult.powertrainOutcomes.length} trim(s) applied
            {applyResult.errors.length > 0 ? `, ${applyResult.errors.length} error(s)` : ""}.
          </p>
          {applyResult.errors.length > 0 && (
            <ul className="list-disc list-inside text-xs mt-1 text-red-600 dark:text-red-400">
              {applyResult.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <button onClick={reset} className="mt-2 text-xs underline">
            Import another
          </button>
        </div>
      )}
    </div>
  );
}
