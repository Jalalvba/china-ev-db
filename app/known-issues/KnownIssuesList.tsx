"use client";

import { useMemo, useState } from "react";
import IssueResearch from "@/app/IssueResearch";

interface IssueRow {
  modelId: string;
  modelName: string;
  brandName: string;
  /** "china" | "global" — different populations, filterable and always labeled, never silently merged. Items predating the field arrive here already resolved to "china". */
  region: "china" | "global";
  issue_description: string;
  affected_systems: string[];
  frequency_signal?: string;
  source: string;
  source_url?: string;
  confidence: string;
  lastResearchedAt?: string;
}

interface UnresearchedModel {
  modelId: string;
  modelName: string;
  brandName: string;
}

function relativeLabel(input: string | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  const diffDay = Math.round((Date.now() - date.getTime()) / 86400000);
  if (diffDay < 1) return "today";
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function KnownIssuesList({
  rows,
  unresearched,
}: {
  rows: IssueRow[];
  unresearched: UnresearchedModel[];
}) {
  const [brandFilter, setBrandFilter] = useState("all");
  const [systemFilter, setSystemFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");

  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.brandName))).sort(), [rows]);
  const systems = useMemo(
    () => Array.from(new Set(rows.flatMap((r) => r.affected_systems))).sort(),
    [rows]
  );

  const filtered = rows.filter(
    (r) =>
      (brandFilter === "all" || r.brandName === brandFilter) &&
      (systemFilter === "all" || r.affected_systems.includes(systemFilter)) &&
      (regionFilter === "all" || r.region === regionFilter)
  );

  return (
    <div>
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="text-sm border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900"
          >
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            value={systemFilter}
            onChange={(e) => setSystemFilter(e.target.value)}
            className="text-sm border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900"
          >
            <option value="all">All affected systems</option>
            {systems.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="text-sm border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900"
          >
            <option value="all">All regions</option>
            <option value="china">China</option>
            <option value="global">Global</option>
          </select>
          {(brandFilter !== "all" || systemFilter !== "all" || regionFilter !== "all") && (
            <button
              onClick={() => {
                setBrandFilter("all");
                setSystemFilter("all");
                setRegionFilter("all");
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Clear filters
            </button>
          )}
          <span className="text-xs text-zinc-500 dark:text-zinc-400 self-center ml-auto">
            {filtered.length} of {rows.length} issues
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 text-center mb-8">
          <p className="text-zinc-600 dark:text-zinc-400 mb-3">
            No model has known-issue data yet. Use &quot;Research known issues&quot; on any model below — this
            category prioritizes 车质网 (China&apos;s official vehicle quality complaint platform) and 汽车投诉网 as
            the strongest signal for real-world failure patterns.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {filtered.map((r, i) => (
            <div key={i} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-2">
                  <a href={`/models/${r.modelId}`} className="font-semibold hover:underline text-sm">
                    {r.brandName} {r.modelName}
                  </a>
                  <span className="px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                    {r.region === "global" ? "Global" : "China"}
                  </span>
                </span>
                <span
                  className={
                    r.confidence === "unconfirmed"
                      ? "text-xs text-amber-600 dark:text-amber-400"
                      : "text-xs text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {r.confidence}
                </span>
              </div>
              <p className="text-sm text-zinc-800 dark:text-zinc-200">{r.issue_description}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {r.affected_systems.join(", ")}
                {r.frequency_signal ? ` · ${r.frequency_signal}` : ""} · Source: {r.source_url ? <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="underline">{r.source}</a> : r.source} · Researched{" "}
                {relativeLabel(r.lastResearchedAt)}
              </p>
            </div>
          ))}
        </div>
      )}

      {unresearched.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
            Not yet researched ({unresearched.length})
          </h2>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg max-h-[32rem] overflow-y-auto">
            {unresearched.map((m) => (
              <div key={m.modelId} className="flex items-center justify-between px-4 py-2.5">
                <a href={`/models/${m.modelId}`} className="text-sm hover:underline">
                  {m.brandName} {m.modelName}
                </a>
                <IssueResearch modelId={m.modelId} compact />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
