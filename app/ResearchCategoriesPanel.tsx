import type { IModel } from "@/types";
import { formatRelativeTime } from "@/lib/relativeTime";

interface Props {
  model: Pick<
    IModel,
    | "market_trend"
    | "known_issues"
    | "known_issues_china_last_researched_at"
    | "known_issues_global_last_researched_at"
    | "technical_bulletins"
    | "technical_bulletins_last_researched_at"
    | "recalls"
    | "recalls_last_researched_at"
  >;
  /** The brand's IBrandPhevSuvWorkshopProfile.diagnostic_interface.tool_name, when researched — what a recall's `uses_brand_diagnostic_interface` flag points at. */
  brandDiagnosticTool?: string;
}

const muted = "text-zinc-500 dark:text-zinc-400";

function Conf({ value }: { value: string }) {
  return <span className={value === "confirmed" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{value}</span>;
}

function Src({ url }: { url?: string }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline break-all">
      source
    </a>
  ) : null;
}

/**
 * Read-only display of the four newer research categories on the model page. Renders
 * nothing when a model has none of them yet — the research/import buttons above are the
 * entry point. Known issues are shown as two separate groups (China / Global) by design:
 * they're different populations and never merged. An item with no `region` predates the
 * field and counts as China.
 */
export default function ResearchCategoriesPanel({ model, brandDiagnosticTool }: Props) {
  const trend = model.market_trend;
  const issues = model.known_issues ?? [];
  const chinaIssues = issues.filter((i) => (i.region ?? "china") === "china");
  const globalIssues = issues.filter((i) => i.region === "global");
  const bulletins = model.technical_bulletins ?? [];
  const recalls = model.recalls ?? [];
  if (!trend && issues.length === 0 && bulletins.length === 0 && recalls.length === 0) return null;

  const box = "p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm";
  return (
    <div className="mt-4 grid gap-3 max-w-3xl">
      {trend && (
        <div className={box}>
          <p className="font-medium">
            Market trend: {trend.sales_trend ?? "unknown"}
            {trend.market_share_segment ? ` · ${trend.market_share_segment}` : ""} <Conf value={trend._confidence} />
          </p>
          {trend.trend_evidence && <p className={`text-xs mt-1 ${muted}`}>{trend.trend_evidence}</p>}
          <p className={`text-xs mt-1 ${muted}`}>
            <Src url={trend.source_url} /> {trend._last_researched_at ? `· Researched ${formatRelativeTime(trend._last_researched_at)}` : ""}
          </p>
        </div>
      )}

      {([["China", chinaIssues, model.known_issues_china_last_researched_at], ["Global", globalIssues, model.known_issues_global_last_researched_at]] as const).map(
        ([label, list, ts]) =>
          list.length > 0 && (
            <div key={label} className={box}>
              <p className="font-medium mb-1">
                Known issues — {label} <span className={`text-xs font-normal ${muted}`}>{ts ? `Researched ${formatRelativeTime(ts)}` : ""}</span>
              </p>
              <ul className="space-y-1">
                {list.map((i, idx) => (
                  <li key={idx} className="text-xs">
                    {i.issue_description}
                    <span className={muted}>
                      {" "}· {i.affected_systems.join(", ")} · {i.source} · <Conf value={i.confidence} /> · <Src url={i.source_url} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
      )}

      {bulletins.length > 0 && (
        <div className={box}>
          <p className="font-medium mb-1">
            Technical bulletins{" "}
            <span className={`text-xs font-normal ${muted}`}>{model.technical_bulletins_last_researched_at ? `Researched ${formatRelativeTime(model.technical_bulletins_last_researched_at)}` : ""}</span>
          </p>
          <ul className="space-y-1">
            {bulletins.map((b, idx) => (
              <li key={idx} className="text-xs">
                {b.bulletin_id ? `${b.bulletin_id} — ` : ""}
                {b.issue_description}
                <span className={muted}>
                  {" "}· {b.affected_component}
                  {b.component_detail ? ` (${b.component_detail})` : ""}
                  {b.issued_date ? ` · ${b.issued_date}` : ""} · <Conf value={b.confidence} /> · <Src url={b.source_url} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recalls.length > 0 && (
        <div className={box}>
          <p className="font-medium mb-1">
            Recalls{" "}
            <span className={`text-xs font-normal ${muted}`}>{model.recalls_last_researched_at ? `Researched ${formatRelativeTime(model.recalls_last_researched_at)}` : ""}</span>
          </p>
          <ul className="space-y-2">
            {recalls.map((r, idx) => (
              <li key={idx} className="text-xs">
                <p>
                  {r.recall_id ? `${r.recall_id} — ` : ""}
                  {r.issue_description}
                </p>
                <p className={muted}>
                  {r.affected_component}
                  {r.component_detail ? ` (${r.component_detail})` : ""}
                  {r.recall_date ? ` · ${r.recall_date}` : ""}
                  {r.issuing_body ? ` · ${r.issuing_body}` : ""} · <Conf value={r.confidence} /> · <Src url={r.source_url} />
                </p>
                <p className={muted}>Remedy: {r.remedy_description}{r.affected_scope ? ` · Scope: ${r.affected_scope}` : ""}</p>
                {r.required_tools && (
                  <p className={muted}>
                    Tools:{" "}
                    {r.required_tools.uses_brand_diagnostic_interface
                      ? `brand diagnostic interface${brandDiagnosticTool ? ` (${brandDiagnosticTool})` : " (brand tool not yet researched)"}`
                      : "no diagnostic tool"}
                    {r.required_tools.special_tool_names?.length ? ` · ${r.required_tools.special_tool_names.join(", ")}` : ""}
                    {r.required_tools.extra_tool_note ? ` · beyond standard kit: ${r.required_tools.extra_tool_note}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
