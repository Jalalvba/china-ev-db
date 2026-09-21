"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SourceRef from "@/app/SourceRef";
import { TierList } from "@/app/WarrantyTiers";
import type { IWarrantyTier } from "@/types/warrantyTiers";
import { AFTER_SALES_SECTION_KEYS } from "@/types/afterSalesProcess";

// dealership-ops-manual-v1 panel: copy prompt -> paste reply -> validate -> review each of the three sections
// separately (accept/skip) -> apply each accepted section through its OWN existing apply route. A section that fails
// validation, or that the paste left null, never blocks the others. No AI/search provider is called anywhere.

type Status = "not_researched" | "ok" | "invalid";
interface SectionResult<T> { status: Status; errors: string[]; value: T | null; downgrade_reason?: string }
type Fact = { value: string; source_url: string; market?: string };
interface Validated {
  valid: boolean;
  errors: string[];
  warranty_terms: SectionResult<Record<string, unknown>>;
  workshop_profile: SectionResult<Record<string, unknown>>;
  after_sales_process: SectionResult<{ sections: Record<string, Record<string, Fact>>; confidence: string; downgrade_reason?: string; not_found: string[] }>;
  existing_after_sales_process: Record<string, Record<string, Fact> | undefined> | null;
  notes: string | null;
}
type SectionKey = "warranty_terms" | "workshop_profile" | "after_sales_process";
const SECTION_LABEL: Record<SectionKey, string> = {
  warranty_terms: "Warranty terms",
  workshop_profile: "Workshop profile",
  after_sales_process: "After-sales process",
};
const APPLY_ROUTE: Record<SectionKey, string> = {
  warranty_terms: "apply-warranty",
  workshop_profile: "apply-workshop-profile",
  after_sales_process: "apply-after-sales-process",
};
const pretty = (k: string) => k.replace(/_/g, " ");

export default function DealershipOpsPanel({ brandId }: { brandId: string }) {
  const router = useRouter();
  const base = `/api/brands/${brandId}`;
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">("idle");
  const [busy, setBusy] = useState<"validating" | "applying" | null>(null);
  const [validated, setValidated] = useState<Validated | null>(null);
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>({ warranty_terms: false, workshop_profile: false, after_sales_process: false });
  const [results, setResults] = useState<Partial<Record<SectionKey, string>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    setCopyState("copying");
    setError(null);
    try {
      const res = await fetch(`${base}/manual-dealership-ops/export`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
      await navigator.clipboard.writeText(data.text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      setError((err as Error).message);
      setCopyState("idle");
    }
  }

  async function handleValidate() {
    setBusy("validating");
    setError(null);
    try {
      const res = await fetch(`${base}/manual-dealership-ops/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: rawText }),
      });
      const data: Validated = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error?: string })?.error ?? `Request failed with status ${res.status}`);
      setValidated(data);
      setSelected({
        warranty_terms: data.warranty_terms.status === "ok" && !!data.warranty_terms.value,
        workshop_profile: data.workshop_profile.status === "ok" && !!data.workshop_profile.value,
        after_sales_process: data.after_sales_process.status === "ok" && !!data.after_sales_process.value,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleApply() {
    if (!validated) return;
    setBusy("applying");
    setError(null);
    const out: Partial<Record<SectionKey, string>> = {};
    for (const key of Object.keys(SECTION_LABEL) as SectionKey[]) {
      if (!selected[key]) continue;
      const value = validated[key].value;
      const payload = key === "after_sales_process"
        ? { after_sales_process: { sections: (value as Validated["after_sales_process"]["value"])!.sections, confidence: (value as Validated["after_sales_process"]["value"])!.confidence } }
        : { [key]: value };
      try {
        const res = await fetch(`${base}/${APPLY_ROUTE[key]}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok || data.applied === false) out[key] = `FAILED — ${data?.error ?? `status ${res.status}`}`;
        else out[key] = data.overwritten?.length ? `Applied — replaced ${data.overwritten.length} existing fact(s): ${data.overwritten.join(", ")}` : "Applied";
      } catch (err) {
        out[key] = `FAILED — ${(err as Error).message}`;
      }
    }
    setResults(out);
    setBusy(null);
    router.refresh();
  }

  function close() {
    setOpen(false);
    setRawText("");
    setValidated(null);
    setResults(null);
    setError(null);
  }

  const line = "text-zinc-700 dark:text-zinc-300";
  const label = "text-zinc-400 dark:text-zinc-500";

  function renderSection(key: SectionKey, v: Validated) {
    const r = v[key];
    if (r.status === "not_researched") return <p className="text-xs text-zinc-500 dark:text-zinc-400">Not in the paste — nothing to apply.</p>;
    if (r.status === "invalid")
      return (
        <ul className="list-disc pl-4 text-xs text-red-600 dark:text-red-400">
          {r.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      );
    if (key === "warranty_terms") {
      const w = r.value as Record<string, unknown>;
      return (
        <div className="text-xs space-y-0.5">
          {Array.isArray(w.tiers) && w.tiers.length > 0 ? <TierList tiers={w.tiers as IWarrantyTier[]} /> : <p className="text-zinc-500 dark:text-zinc-400">No tiers in the paste.</p>}
          <p className="text-amber-600 dark:text-amber-400">Merged into the stored block: tiers are replaced as a unit; legacy flat figures on file are left untouched.</p>
          {Array.isArray(w.tiers) && w.tiers.some((t) => !(t as IWarrantyTier).clause_ref) && <p className="text-amber-600 dark:text-amber-400">A tier has no clause_ref — stored as unconfirmed.</p>}
          <p className={line}><span className={label}>Source:</span> {w.source ? <SourceRef source={String(w.source)} /> : "none"}</p>
          {w.confidence === "unconfirmed" && <p className="text-amber-600 dark:text-amber-400">Stored as unconfirmed.</p>}
        </div>
      );
    }
    if (key === "workshop_profile") {
      const w = r.value as Record<string, unknown>;
      const di = w.diagnostic_interface as Record<string, unknown> | undefined;
      const n = (k: string) => (Array.isArray(w[k]) ? (w[k] as unknown[]).length : 0);
      return (
        <div className="text-xs space-y-0.5">
          <p className={line}><span className={label}>Diagnostic tool:</span> {di ? [di.tool_name, di.tool_cost && `cost ${di.tool_cost}`, di.subscription_terms && `subscription ${di.subscription_terms}`].filter(Boolean).join(" · ") || "(no name)" : "not found"}{di && <SourceRef source={di.source_url as string} />}</p>
          <p className={line}><span className={label}>Lift:</span> {w.lift_spec ? "found" : "not found"} · <span className={label}>PPE:</span> {n("ppe_required")} · <span className={label}>Technician prerequisites:</span> {n("technician_prerequisites")} · <span className={label}>Audit checkpoints:</span> {n("audit_checklist")}</p>
          <p className="text-amber-600 dark:text-amber-400">Replaces the stored workshop profile entirely (fields absent from the paste are unset).</p>
          {r.downgrade_reason && <p className="text-amber-600 dark:text-amber-400">Stored as unconfirmed — {r.downgrade_reason}.</p>}
        </div>
      );
    }
    const a = (r as Validated["after_sales_process"]).value!;
    const existing = v.existing_after_sales_process;
    return (
      <div className="text-xs space-y-1.5">
        {AFTER_SALES_SECTION_KEYS.filter((s) => a.sections[s]).map((s) => (
          <div key={s}>
            <p className="font-medium text-zinc-600 dark:text-zinc-400">{pretty(s)}</p>
            {Object.entries(a.sections[s]).map(([k, f]) => {
              const cur = existing?.[s]?.[k];
              const replaces = cur && (cur.value !== f.value || cur.source_url !== f.source_url);
              return (
                <p key={k} className={line}>
                  <span className={label}>{pretty(k)}:</span> {f.value}
                  {f.market && <span className="text-zinc-400 dark:text-zinc-500"> [{f.market}]</span>}
                  <SourceRef source={f.source_url} />
                  {replaces && <span className="ml-1 text-red-600 dark:text-red-400">— REPLACES stored: “{cur.value}”</span>}
                </p>
              );
            })}
          </div>
        ))}
        <p className="text-zinc-400 dark:text-zinc-500">{a.not_found.length} fact(s) NOT FOUND — never erase stored facts.</p>
        {a.downgrade_reason && <p className="text-amber-600 dark:text-amber-400">Stored as unconfirmed — {a.downgrade_reason}.</p>}
      </div>
    );
  }

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition">
        🏭 Dealership ops: export/import
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={close}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Dealership after-sales operations (warranty · workshop · process)</h3>
              <button onClick={close} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">×</button>
            </div>

            {results ? (
              <div className="space-y-1 text-sm">
                {Object.entries(results).map(([k, msg]) => (
                  <p key={k} className={msg!.startsWith("FAILED") ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
                    <span className="font-medium">{SECTION_LABEL[k as SectionKey]}:</span> {msg}
                  </p>
                ))}
                <button onClick={close} className="mt-2 text-xs underline text-zinc-500 dark:text-zinc-400">Close</button>
              </div>
            ) : validated ? (
              <div className="space-y-3">
                {!validated.valid ? (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    <p className="font-medium">Not importable:</p>
                    <ul className="list-disc pl-4 text-xs">{validated.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  </div>
                ) : (
                  (Object.keys(SECTION_LABEL) as SectionKey[]).map((key) => {
                    const r = validated[key];
                    const canApply = r.status === "ok" && !!r.value;
                    return (
                      <div key={key} className="border border-zinc-200 dark:border-zinc-800 rounded p-2">
                        <label className="flex items-center gap-2 text-sm font-medium mb-1">
                          <input type="checkbox" disabled={!canApply} checked={selected[key]} onChange={(e) => setSelected((s) => ({ ...s, [key]: e.target.checked }))} />
                          {SECTION_LABEL[key]}
                          <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">{r.status === "ok" ? "" : r.status === "invalid" ? "invalid — not applicable" : "not researched"}</span>
                        </label>
                        {renderSection(key, validated)}
                      </div>
                    );
                  })
                )}
                {validated.notes && <p className="text-xs italic text-zinc-500 dark:text-zinc-400">Notes: {validated.notes}</p>}
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setValidated(null)} disabled={busy === "applying"} className="px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-xs disabled:opacity-60">Back</button>
                  {validated.valid && (
                    <button onClick={handleApply} disabled={busy === "applying" || !Object.values(selected).some(Boolean)} className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60">
                      {busy === "applying" ? "Applying…" : "Apply selected sections"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">1. Copy the research prompt, paste it into an external AI chat (attach the after-sales document there if you have one).</p>
                  <button onClick={handleCopy} disabled={copyState === "copying"} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60">
                    {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied!" : "📋 Copy prompt"}
                  </button>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">2. Paste its JSON reply here.</p>
                  <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={8} placeholder='{ "schema_version": "dealership-ops-manual-v1", … }' className="w-full text-xs font-mono border border-zinc-300 dark:border-zinc-700 rounded p-2 bg-white dark:bg-zinc-950" />
                </div>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <button onClick={handleValidate} disabled={busy === "validating" || rawText.trim() === ""} className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                  {busy === "validating" ? "Validating…" : "Validate & preview"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
