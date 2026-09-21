"use client";

// Manufacturer-group manual export/import — same two-action discipline as every other research
// category in this app (export prompt / paste-and-validate / review / apply), scoped to an entire
// ownership group at once (all sub-brands + their models) rather than one brand. Sits in the
// GroupSection header, so every click here must stopPropagation/preventDefault against the
// header's own onClick (expand/collapse) — same nested-clickable fix SingleObjectManualPanel
// already uses for the per-brand-card icon.
//
// group_relationships / group_positioning are DISPLAY-ONLY (see lib/brandGroupResearch.ts's file
// header for why) — this panel shows them for the person to note down manually, it does not write
// them anywhere.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BrandGroupManualImportResult,
  BrandGroupModelItem,
} from "@/lib/brandGroupResearch";
import type { DiscoveredBrandItem } from "@/lib/brandDiscoveryResearch";

interface Props {
  groupKey: string;
  brandNamesById: Record<string, string>;
}

type Phase = "idle" | "exporting" | "pasting" | "validating" | "review" | "applying" | "done" | "error";

interface EditableBrand {
  brandId: string;
  fields: Record<string, unknown>;
  valid: boolean;
  errors: string[];
  selected: boolean;
}

interface EditableModel extends BrandGroupModelItem {
  key: string;
  selected: boolean;
}

interface EditableDiscoveredBrand extends DiscoveredBrandItem {
  selected: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  name_cn: "Chinese name",
  parent_group: "Parent group",
  relationship_type: "Relationship type",
  stake_percentage: "Stake %",
  tech_partner: "Tech partner",
  country_origin: "Country of origin",
  founded_year: "Founded",
  status: "Status",
  status_note: "Status note",
};

export default function BrandGroupExport({ groupKey, brandNamesById }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportText, setExportText] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);

  const [brandRows, setBrandRows] = useState<EditableBrand[]>([]);
  const [modelRows, setModelRows] = useState<EditableModel[]>([]);
  const [relationships, setRelationships] = useState<BrandGroupManualImportResult["relationships"]>([]);
  const [positioning, setPositioning] = useState<BrandGroupManualImportResult["positioning"]>(null);
  const [discoveredRows, setDiscoveredRows] = useState<EditableDiscoveredBrand[]>([]);

  const [applySummary, setApplySummary] = useState<{ brandsUpdated: number; modelsCreated: number; brandsDiscovered: number; errors: string[] } | null>(null);

  async function handleExport(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setPhase("exporting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/brand-groups/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_key: groupKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      setExportText(data.text);
      setCopied(false);
      setPhase("pasting");
    } catch (err) {
      setErrorMessage(`Building export prompt failed: ${(err as Error).message}`);
      setPhase("error");
    }
  }

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
    } catch {
      setErrorMessage("Could not copy automatically — select and copy the text manually.");
    }
  }

  async function handleValidate(e: React.MouseEvent) {
    e.stopPropagation();
    setPhase("validating");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/brand-groups/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_key: groupKey, json: pasteText }),
      });
      const data: BrandGroupManualImportResult & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      if (!data.valid) throw new Error(data.errors.join(" — "));

      setBrandRows(
        data.brands
          .filter((b) => b.brand && Object.keys(b.brand).length > 0)
          .map((b) => ({
            brandId: b.brand_id,
            fields: b.brand ?? {},
            valid: b.valid,
            errors: b.errors,
            selected: b.valid,
          }))
      );
      setModelRows(
        data.models.map((m, idx) => ({
          ...m,
          key: `${idx}`,
          selected: m.valid && !m.duplicate,
        }))
      );
      setRelationships(data.relationships);
      setPositioning(data.positioning);
      setDiscoveredRows(
        (data.discoveredBrands ?? []).map((b) => ({
          ...b,
          selected: b.valid && !b.duplicate && !b.duplicateInDifferentGroup,
        }))
      );
      setPhase("review");
    } catch (err) {
      setErrorMessage(`Import failed: ${(err as Error).message}`);
      setPhase("pasting");
    }
  }

  function toggleBrand(brandId: string) {
    setBrandRows((prev) => prev.map((r) => (r.brandId === brandId ? { ...r, selected: !r.selected } : r)));
  }
  function toggleModel(key: string) {
    setModelRows((prev) => prev.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));
  }
  function toggleDiscovered(key: string) {
    setDiscoveredRows((prev) => prev.map((r) => (r.key === key ? { ...r, selected: !r.selected } : r)));
  }

  async function handleApplySelected(e: React.MouseEvent) {
    e.stopPropagation();
    setPhase("applying");
    setErrorMessage(null);
    const errs: string[] = [];
    let brandsUpdated = 0;
    let modelsCreated = 0;
    let brandsDiscovered = 0;

    for (const row of brandRows.filter((r) => r.selected && r.valid)) {
      try {
        const res = await fetch(`/api/brands/${row.brandId}/apply-brand-research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: row.fields }),
        });
        const data = await res.json();
        if (!res.ok || data.applied === false) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
        brandsUpdated++;
      } catch (err) {
        errs.push(`${brandNamesById[row.brandId] ?? row.brandId}: ${(err as Error).message}`);
      }
    }

    const selectedModels = modelRows.filter((r) => r.selected && r.valid);
    const modelsByBrand = new Map<string, Record<string, unknown>[]>();
    for (const row of selectedModels) {
      const list = modelsByBrand.get(row.brand_id) ?? [];
      list.push(row.model);
      modelsByBrand.set(row.brand_id, list);
    }
    for (const [brandId, models] of modelsByBrand) {
      try {
        const res = await fetch(`/api/brands/${brandId}/create-models`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ models }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
        modelsCreated += data.created ?? 0;
        for (const e2 of data.errors ?? []) errs.push(`${brandNamesById[brandId] ?? brandId} — ${e2.name}: ${e2.message}`);
      } catch (err) {
        errs.push(`${brandNamesById[brandId] ?? brandId}: ${(err as Error).message}`);
      }
    }

    for (const row of discoveredRows.filter((r) => r.selected && r.valid)) {
      try {
        const res = await fetch(`/api/brands`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...row.fields, parent_group: groupKey }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
        brandsDiscovered++;
      } catch (err) {
        errs.push(`${String(row.fields.name ?? row.key)}: ${(err as Error).message}`);
      }
    }

    setApplySummary({ brandsUpdated, modelsCreated, brandsDiscovered, errors: errs });
    setPhase("done");
    router.refresh();
  }

  function reset(e?: React.MouseEvent) {
    e?.stopPropagation();
    setPhase("idle");
    setErrorMessage(null);
    setExportText("");
    setPasteText("");
    setCopied(false);
    setBrandRows([]);
    setModelRows([]);
    setRelationships([]);
    setPositioning(null);
    setDiscoveredRows([]);
    setApplySummary(null);
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      {phase === "idle" && (
        <div className="flex gap-1.5">
          <button
            onClick={handleExport}
            className="px-2 py-1 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition"
          >
            📦 Export group prompt
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setPhase("pasting");
            }}
            className="px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
          >
            📥 Import group response
          </button>
        </div>
      )}

      {phase === "exporting" && (
        <button disabled className="px-2 py-1 rounded-md bg-indigo-600/60 text-white text-xs font-medium cursor-wait">
          Building prompt…
        </button>
      )}

      {(phase === "pasting" || phase === "validating") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
        >
          <div
            className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Manufacturer group research — {groupKey}</h3>
              <button onClick={reset} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>
            {exportText && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Export prompt — paste into Kimi/Gemini/DeepSeek chat
                  </span>
                  <button onClick={handleCopy} className="text-xs underline">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={exportText}
                  rows={6}
                  className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 rounded p-2"
                />
              </div>
            )}
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Paste the AI&apos;s JSON response here
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder="Paste the brand-group-manual-v2 JSON response…"
              className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded p-2"
            />
            {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{errorMessage}</p>}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleValidate}
                disabled={phase === "validating" || pasteText.trim() === ""}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
              >
                {phase === "validating" ? "Validating…" : "Validate"}
              </button>
              <button onClick={reset} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
        >
          <div
            className="max-w-md rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-400"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1">{errorMessage}</p>
            <button onClick={reset} className="mt-2 text-xs underline">Try again</button>
          </div>
        </div>
      )}

      {phase === "done" && applySummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
        >
          <div
            className="max-w-md rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-3 text-sm text-green-700 dark:text-green-400"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-medium">
              Updated {applySummary.brandsUpdated} brand(s), created {applySummary.modelsCreated} model(s), discovered{" "}
              {applySummary.brandsDiscovered} new brand(s).
            </p>
            {applySummary.errors.length > 0 && (
              <ul className="mt-1 text-xs text-red-600 dark:text-red-400 list-disc pl-4">
                {applySummary.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            <button onClick={reset} className="mt-2 text-xs underline">Close</button>
          </div>
        </div>
      )}

      {(phase === "review" || phase === "applying") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h3 className="font-semibold text-sm">Review group research — {groupKey}</h3>
              <div className="flex gap-2">
                <button onClick={reset} disabled={phase === "applying"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">
                  Cancel
                </button>
                <button
                  onClick={handleApplySelected}
                  disabled={phase === "applying"}
                  className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {phase === "applying"
                    ? "Applying…"
                    : `Apply selected (${brandRows.filter((r) => r.selected).length} brand updates, ${
                        modelRows.filter((r) => r.selected).length
                      } models, ${discoveredRows.filter((r) => r.selected).length} new brands)`}
                </button>
              </div>
            </div>
            {errorMessage && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{errorMessage}</p>}

            <div className="space-y-4">
              <section>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Brand identity changes <span className="text-xs font-normal text-zinc-500">({brandRows.length})</span>
                </h4>
                {brandRows.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">No brand-level changes proposed.</p>}
                <div className="space-y-2">
                  {brandRows.map((r) => (
                    <div
                      key={r.brandId}
                      className={`border rounded-md p-2 ${r.valid ? "border-zinc-200 dark:border-zinc-800" : "border-red-300 dark:border-red-800"}`}
                    >
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={r.selected} disabled={!r.valid} onChange={() => toggleBrand(r.brandId)} className="mt-1" />
                        <div className="flex-1 min-w-0 text-xs">
                          <p className="font-medium text-sm">{brandNamesById[r.brandId] ?? r.brandId}</p>
                          {!r.valid && <p className="text-red-600 dark:text-red-400">{r.errors.join(" — ")}</p>}
                          {Object.entries(FIELD_LABELS)
                            .filter(([k]) => r.fields[k] !== undefined && r.fields[k] !== null && r.fields[k] !== "")
                            .map(([k, label]) => (
                              <p key={k} className="text-zinc-700 dark:text-zinc-300">
                                <span className="text-zinc-400 dark:text-zinc-500">{label}:</span> {String(r.fields[k])}
                              </p>
                            ))}
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Discovered models <span className="text-xs font-normal text-zinc-500">
                    ({modelRows.length}, {modelRows.filter((r) => r.duplicate).length} look like duplicates)
                  </span>
                </h4>
                {modelRows.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">No new models proposed.</p>}
                <div className="space-y-2">
                  {modelRows.map((r) => (
                    <div
                      key={r.key}
                      className={`border rounded-md p-2 ${
                        !r.valid ? "border-red-300 dark:border-red-800" : r.duplicate ? "border-amber-300 dark:border-amber-800" : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={r.selected} disabled={!r.valid} onChange={() => toggleModel(r.key)} className="mt-1" />
                        <div className="flex-1 min-w-0 text-xs">
                          <p className="font-medium text-sm">
                            {String(r.model.name ?? "(unnamed)")}{" "}
                            <span className="font-normal text-zinc-500 dark:text-zinc-400">— under {brandNamesById[r.brand_id] ?? r.brand_id}</span>
                          </p>
                          {r.duplicate && <p className="text-amber-700 dark:text-amber-400">Already exists — deselected by default.</p>}
                          {!r.valid && <p className="text-red-600 dark:text-red-400">{r.errors.join(" — ")}</p>}
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Cross-brand relationships <span className="text-xs font-normal text-zinc-500">({relationships.length}) — not saved, review manually</span>
                </h4>
                {relationships.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">None reported.</p>}
                <div className="space-y-1">
                  {relationships.map((r, i) => (
                    <div key={i} className={`text-xs border rounded-md p-2 ${r.valid ? "border-zinc-200 dark:border-zinc-800" : "border-red-300 dark:border-red-800"}`}>
                      {!r.valid ? (
                        <p className="text-red-600 dark:text-red-400">{r.errors.join(" — ")}</p>
                      ) : (
                        <>
                          <p className="text-zinc-700 dark:text-zinc-300">{r.description}</p>
                          <p className="text-zinc-500 dark:text-zinc-400">
                            {r.brands_involved.map((id) => brandNamesById[id] ?? id).join(", ")} · {r.confidence}
                            {r.source_url && <> · <a href={r.source_url} target="_blank" rel="noreferrer" className="underline">source</a></>}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Group positioning <span className="text-xs font-normal text-zinc-500">— not saved, review manually</span>
                </h4>
                {!positioning ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">None reported.</p>
                ) : (
                  <div className="text-xs border border-zinc-200 dark:border-zinc-800 rounded-md p-2">
                    <p className="text-zinc-700 dark:text-zinc-300">{positioning.summary}</p>
                    <p className="text-zinc-500 dark:text-zinc-400">{positioning.confidence}</p>
                  </div>
                )}
              </section>

              <section>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Discovered brands <span className="text-xs font-normal text-zinc-500">
                    ({discoveredRows.length}, {discoveredRows.filter((r) => r.duplicate || r.duplicateInDifferentGroup).length} look like duplicates)
                  </span>
                </h4>
                {discoveredRows.length === 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">No new brands proposed.</p>}
                <div className="space-y-2">
                  {discoveredRows.map((r) => (
                    <div
                      key={r.key}
                      className={`border rounded-md p-2 ${
                        !r.valid
                          ? "border-red-300 dark:border-red-800"
                          : r.duplicate || r.duplicateInDifferentGroup
                          ? "border-amber-300 dark:border-amber-800"
                          : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <label className="flex items-start gap-2">
                        <input type="checkbox" checked={r.selected} disabled={!r.valid} onChange={() => toggleDiscovered(r.key)} className="mt-1" />
                        <div className="flex-1 min-w-0 text-xs">
                          <p className="font-medium text-sm">{String(r.fields.name ?? "(unnamed)")}</p>
                          {r.duplicate && (
                            <p className="text-amber-700 dark:text-amber-400">Already exists in this group — deselected by default.</p>
                          )}
                          {r.duplicateInDifferentGroup && (
                            <p className="text-amber-700 dark:text-amber-400">
                              A brand with this name already exists under a DIFFERENT parent group — likely misattribution, deselected by default.
                            </p>
                          )}
                          {!r.valid && <p className="text-red-600 dark:text-red-400">{r.errors.join(" — ")}</p>}
                          {Object.entries(FIELD_LABELS)
                            .filter(([k]) => r.fields[k] !== undefined && r.fields[k] !== null && r.fields[k] !== "")
                            .map(([k, label]) => (
                              <p key={k} className="text-zinc-700 dark:text-zinc-300">
                                <span className="text-zinc-400 dark:text-zinc-500">{label}:</span> {String(r.fields[k])}
                              </p>
                            ))}
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
