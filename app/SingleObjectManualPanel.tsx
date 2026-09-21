"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "exporting" | "validating" | "review" | "applying" | "done" | "error";

export interface SingleObjectManualPanelProps {
  /** Base API path for this entity, e.g. `/api/models/${modelId}` or `/api/brands/${brandId}`. */
  basePath: string;
  /** Path segment for export/validate, e.g. "manual-positioning". */
  segment: string;
  /** Path segment for the existing apply-* route, e.g. "apply-positioning". */
  applySegment: string;
  /** Key the validate response uses for the payload object, e.g. "market_positioning" or "brand". */
  dataKey: string;
  /** Key the apply-* route expects the payload under, if different from dataKey (e.g. apply-brand-research expects "fields"). */
  applyBodyKey?: string;
  title: string;
  triggerLabel: string;
  triggerEmoji: string;
  compact?: boolean;
  /** Renders the validated object for review before applying. */
  renderPreview: (data: Record<string, unknown>) => React.ReactNode;
}

interface ValidateResponse {
  valid: boolean;
  errors: string[];
  [key: string]: unknown;
}

/**
 * Generic manual export-prompt / paste-JSON-import panel for the four brand/model
 * single-object research categories (positioning, brand identity, warranty, workshop) —
 * same underlying pattern as ManualCategoryExportButton/ManualCategoryImporter (which
 * handle the list-shaped categories), collapsed into one panel since there's no list to
 * diff, just one object to review and apply via the category's existing apply-* route.
 */
export default function SingleObjectManualPanel({
  basePath,
  segment,
  applySegment,
  dataKey,
  applyBodyKey,
  title,
  triggerLabel,
  triggerEmoji,
  compact,
  renderPreview,
}: SingleObjectManualPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rawText, setRawText] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">("idle");
  const [validated, setValidated] = useState<ValidateResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCopy() {
    setCopyState("copying");
    setErrorMessage(null);
    try {
      const res = await fetch(`${basePath}/${segment}/export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      await navigator.clipboard.writeText(data.text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      setErrorMessage((err as Error).message);
      setCopyState("idle");
    }
  }

  async function handleValidate() {
    setPhase("validating");
    setErrorMessage(null);
    try {
      const res = await fetch(`${basePath}/${segment}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: rawText }),
      });
      const data: ValidateResponse = await res.json();
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? `Request failed with status ${res.status}`);
      setValidated(data);
      setPhase("review");
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("error");
    }
  }

  async function handleApply() {
    if (!validated) return;
    setPhase("applying");
    setErrorMessage(null);
    try {
      const payload = { [applyBodyKey ?? dataKey]: validated[dataKey] };
      const res = await fetch(`${basePath}/${applySegment}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    setOpen(false);
    setPhase("idle");
    setRawText("");
    setValidated(null);
    setErrorMessage(null);
  }

  const dataValue = validated ? (validated[dataKey] as Record<string, unknown> | null) : null;

  return (
    <span onClick={(e) => e.stopPropagation()}>
      {compact ? (
        <button
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          title={title}
          className="relative z-10 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm"
        >
          {triggerEmoji}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
        >
          {triggerEmoji} {triggerLabel}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">{title}</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>

            {phase === "done" ? (
              <div className="text-sm text-green-700 dark:text-green-400">
                <p className="font-medium">Applied.</p>
                <button onClick={close} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">Close</button>
              </div>
            ) : (phase === "review" || phase === "applying") && validated ? (
              <div className="space-y-2">
                {!validated.valid ? (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    <p className="font-medium">Not importable:</p>
                    <ul className="list-disc pl-4 text-xs">{validated.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  </div>
                ) : !dataValue ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Researched — nothing found, no change.</p>
                ) : (
                  <div className="text-xs border border-zinc-200 dark:border-zinc-800 rounded p-2 space-y-1">{renderPreview(dataValue)}</div>
                )}
                {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={close} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">Cancel</button>
                  {validated.valid && dataValue && (
                    <button onClick={handleApply} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60">
                      {phase === "applying" ? "Applying…" : "Apply"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">1. Copy the research prompt, paste it into an external AI chat (Kimi, Gemini, Claude, DeepSeek…).</p>
                  <button onClick={handleCopy} disabled={copyState === "copying"} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60">
                    {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied!" : "📋 Copy prompt"}
                  </button>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">2. Paste its JSON reply here.</p>
                  <textarea
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    rows={8}
                    placeholder='{ "schema_version": "…", … }'
                    className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 rounded p-2 bg-white dark:bg-zinc-950"
                  />
                </div>
                {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
                <button
                  onClick={handleValidate}
                  disabled={phase === "validating" || rawText.trim() === ""}
                  className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {phase === "validating" ? "Validating…" : "Validate & preview"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
