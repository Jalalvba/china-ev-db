"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** Base API path for this entity, e.g. `/api/models/${modelId}` or `/api/brands/${brandId}`. The route itself is `${basePath}/morocco-info` (PATCH). */
  basePath: string;
  currentMoroccoName?: string | null;
  /** Omit entirely at Brand level — brands have no single Morocco price, only Models/Trims do. */
  currentMoroccoPriceDh?: number | null;
  showPrice?: boolean;
  fallbackName: string;
}

type Phase = "idle" | "editing" | "saving" | "error";

/**
 * Direct manual edit of Morocco-market name/price — NOT the export-prompt/paste-response research
 * flow (see app/SingleObjectManualPanel.tsx for that). This is a plain form: the person editing
 * knows the fact themselves and wants to enter or correct it immediately, no Kimi round-trip.
 * Bypasses every research-pipeline guard on purpose (see app/api/models/[id]/morocco-info/route.ts).
 */
export default function MoroccoInfoEditor({ basePath, currentMoroccoName, currentMoroccoPriceDh, showPrice = true, fallbackName }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [nameInput, setNameInput] = useState(currentMoroccoName ?? "");
  const [priceInput, setPriceInput] = useState(currentMoroccoPriceDh != null ? String(currentMoroccoPriceDh) : "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function open(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setNameInput(currentMoroccoName ?? "");
    setPriceInput(currentMoroccoPriceDh != null ? String(currentMoroccoPriceDh) : "");
    setErrorMessage(null);
    setPhase("editing");
  }

  function close(e?: React.MouseEvent) {
    e?.stopPropagation();
    setPhase("idle");
    setErrorMessage(null);
  }

  async function patch(body: Record<string, unknown>) {
    setPhase("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(`${basePath}/morocco-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      setPhase("idle");
      router.refresh();
    } catch (err) {
      setErrorMessage((err as Error).message);
      setPhase("editing");
    }
  }

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation();
    const trimmedName = nameInput.trim();
    const body: Record<string, unknown> = {
      morocco_name: trimmedName === "" ? null : trimmedName,
    };
    if (showPrice) {
      if (priceInput.trim() === "") {
        body.morocco_price_dh = null;
      } else {
        const n = Number(priceInput);
        if (!Number.isFinite(n) || n < 0) {
          setErrorMessage("Price must be a non-negative number, or blank to clear it.");
          return;
        }
        body.morocco_price_dh = n;
      }
    }
    await patch(body);
  }

  async function handleClearName(e: React.MouseEvent) {
    e.stopPropagation();
    setNameInput("");
    await patch({ morocco_name: null });
  }

  async function handleClearPrice(e: React.MouseEvent) {
    e.stopPropagation();
    setPriceInput("");
    await patch({ morocco_price_dh: null });
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <button
        onClick={open}
        title="Edit Morocco info"
        className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
      >
        🇲🇦 Edit Morocco info
      </button>

      {phase !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div
            className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Morocco market info</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>

            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Morocco name <span className="font-normal">(falls back to &quot;{fallbackName}&quot; if blank)</span>
            </label>
            <div className="flex gap-1.5 mb-3">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={fallbackName}
                className="flex-1 text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-950"
              />
              {currentMoroccoName && (
                <button
                  onClick={handleClearName}
                  disabled={phase === "saving"}
                  title="Clear the Morocco name — falls back to the default name, not the same as leaving it blank and saving"
                  className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60"
                >
                  Clear
                </button>
              )}
            </div>

            {showPrice && (
              <>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Morocco price (DH)</label>
                <div className="flex gap-1.5 mb-3">
                  <input
                    type="number"
                    min={0}
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    placeholder="e.g. 289900"
                    className="flex-1 text-sm border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-zinc-950"
                  />
                  {currentMoroccoPriceDh != null && (
                    <button
                      onClick={handleClearPrice}
                      disabled={phase === "saving"}
                      title="Clear the price entirely — distinct from setting it to 0, which would mean 'free'"
                      className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">
                  Saving here marks the price confirmed immediately — you&apos;re asserting a fact you know, not submitting something for review.
                </p>
              </>
            )}

            {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{errorMessage}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={close} disabled={phase === "saving"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={phase === "saving"}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {phase === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
