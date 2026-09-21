import Link from "next/link";
import type { IBrand, IBrandPhevSuvWorkshopProfile } from "@/types";
import type { IRecall } from "@/types/researchCategories";
import type { IBrandAfterSalesProcess } from "@/types/afterSalesProcess";
import { AFTER_SALES_SECTIONS, AFTER_SALES_SECTION_KEYS } from "@/types/afterSalesProcess";
import WorkshopProfileFields from "@/app/WorkshopProfileFields";
import SourceRef from "@/app/SourceRef";
import WarrantyTiers from "@/app/WarrantyTiers";
import { formatRelativeTime } from "@/lib/relativeTime";

// The brand page's unified dealership after-sales view: warranty terms + PHEV SUV workshop profile + after-sales process
// + the brand's recalls. The first three are brand-level and entered through dealership-ops-manual-v1 (or their own
// panels). Recalls are DISPLAY-ONLY here: they are model-level data (Model.recalls[]) behind the exact-model identity
// guard, aggregated by a read query — never entered or imported through this view.

export interface BrandRecallGroup {
  model_id: string;
  model_name: string;
  recalls: IRecall[];
}

const pretty = (k: string) => k.replace(/_/g, " ");
const Badge = ({ confidence }: { confidence?: string }) => (
  <span
    className={`px-2 py-0.5 rounded-full text-xs ${
      confidence === "confirmed"
        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
    }`}
  >
    {confidence ?? "unconfirmed"}
  </span>
);
const Card = ({ title, badge, note, children }: { title: string; badge?: string; note?: string; children: React.ReactNode }) => (
  <section className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm">
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {badge !== undefined && <Badge confidence={badge} />}
      {note && <span className="text-xs text-zinc-400 dark:text-zinc-500">{note}</span>}
    </div>
    {children}
  </section>
);

export default function DealershipOpsSection({
  brand,
  workshopProfile,
  afterSales,
  recallGroups,
}: {
  brand: IBrand;
  workshopProfile: IBrandPhevSuvWorkshopProfile | null;
  afterSales: IBrandAfterSalesProcess | null;
  recallGroups: BrandRecallGroup[];
}) {
  const w = brand.warranty_terms;
  const recallCount = recallGroups.reduce((n, g) => n + g.recalls.length, 0);
  return (
    <>
      {w && (
        <Card
          title="Warranty terms"
          badge={w.confidence}
          note={brand.warranty_terms_last_researched_at ? `researched ${formatRelativeTime(brand.warranty_terms_last_researched_at)}` : undefined}
        >
          <WarrantyTiers w={w} />
          {w.source && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
              Source:<SourceRef source={w.source} />
            </p>
          )}
        </Card>
      )}

      {workshopProfile && (
        <Card
          title="PHEV SUV workshop profile"
          badge={workshopProfile._confidence}
          note={workshopProfile._last_researched_at ? `researched ${formatRelativeTime(workshopProfile._last_researched_at)}` : undefined}
        >
          <WorkshopProfileFields profile={workshopProfile} />
        </Card>
      )}

      {afterSales && (
        <Card
          title="After-sales process"
          badge={afterSales._confidence}
          note={afterSales._last_researched_at ? `researched ${formatRelativeTime(afterSales._last_researched_at)}` : undefined}
        >
          <div className="space-y-3 text-xs">
            {AFTER_SALES_SECTION_KEYS.filter((s) => afterSales[s]).map((s) => (
              <div key={s}>
                <p className="text-zinc-500 dark:text-zinc-400 font-medium mb-0.5 capitalize">{pretty(s)}</p>
                <ul className="space-y-0.5">
                  {AFTER_SALES_SECTIONS[s].filter((k) => afterSales[s]?.[k]).map((k) => {
                    const f = afterSales[s]![k]!;
                    return (
                      <li key={k}>
                        <span className="text-zinc-400 dark:text-zinc-500">{pretty(k)}:</span> {f.value}
                        {f.market && <span className="text-zinc-400 dark:text-zinc-500"> [{f.market}]</span>}
                        <SourceRef source={f.source_url} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {!AFTER_SALES_SECTION_KEYS.some((s) => afterSales[s]) && <p className="text-zinc-400 dark:text-zinc-600">Not found</p>}
          </div>
        </Card>
      )}

      {recallCount > 0 && (
        <Card title="Recalls" note={`${recallCount} across ${recallGroups.length} model(s) — read-only; recorded per model, not through the dealership-ops import`}>
          <div className="space-y-3 text-xs">
            {recallGroups.map((g) => (
              <div key={g.model_id}>
                <Link href={`/models/${g.model_id}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                  {g.model_name}
                </Link>
                <ul className="space-y-1 mt-0.5">
                  {g.recalls.map((r, i) => (
                    <li key={i}>
                      {r.recall_date && <span className="text-zinc-400 dark:text-zinc-500">{r.recall_date} · </span>}
                      {r.issue_description}
                      <span className="text-zinc-500 dark:text-zinc-400"> — remedy: {r.remedy_description}</span>
                      {r.issuing_body && <span className="text-zinc-400 dark:text-zinc-500"> ({r.issuing_body})</span>}
                      <SourceRef source={r.source_url} />
                      {r.confidence !== "confirmed" && <span className="text-amber-600 dark:text-amber-400"> · unconfirmed</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
