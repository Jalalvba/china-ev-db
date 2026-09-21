import Link from "next/link";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import BrandPicker from "./BrandPicker";
import WarrantyTab from "./WarrantyTab";
import WorkshopTab from "./WorkshopTab";
import IssuesTab from "./IssuesTab";

export const dynamic = "force-dynamic";

// /technical — the merged Warranty / Workshop / Known issues page. Two units live here, so they are NOT mixed:
// Warranty and Workshop are BRAND-level, Known issues is MODEL-level. Three independent tabs share one URL and one
// brand picker: the picker narrows brand-level tabs to that brand's row(s) and the Known-issues tab to that brand's
// models. Single-brand deep view stays on /brands/[id]. State lives in the URL: ?tab=warranty|workshop|issues&brand=<id>.

const TABS = [
  { key: "warranty", label: "Warranty" },
  { key: "workshop", label: "Workshop" },
  { key: "issues", label: "Known issues" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function TechnicalPage({ searchParams }: { searchParams: Promise<{ tab?: string; brand?: string }> }) {
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "warranty";

  await connectToDatabase();
  const brands = (await Brand.find({}, { name: 1 }).sort({ name: 1 }).lean()).map((b) => ({ _id: String(b._id), name: b.name }));
  // Ignore a malformed or unknown ?brand= rather than erroring — the picker then shows "All brands".
  const brandId = sp.brand && Types.ObjectId.isValid(sp.brand) && brands.some((b) => b._id === sp.brand) ? sp.brand : undefined;
  const brandName = brands.find((b) => b._id === brandId)?.name;

  const href = (t: TabKey) => `/technical?tab=${t}${brandId ? `&brand=${brandId}` : ""}`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Technical</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-4 max-w-3xl">
        Warranty and workshop requirements are per brand; known issues are per model. The brand picker narrows every tab
        {brandName && (
          <>
            {" "}
            — showing <span className="font-medium">{brandName}</span> (
            <Link href={`/brands/${brandId}`} className="underline">
              brand page
            </Link>
            )
          </>
        )}
        .
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 mb-6">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={t.key === tab ? "page" : undefined}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                t.key === tab
                  ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                  : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <div className="pb-2">
          <BrandPicker brands={brands} brandId={brandId} tab={tab} />
        </div>
      </div>

      {tab === "warranty" && <WarrantyTab brandId={brandId} />}
      {tab === "workshop" && <WorkshopTab brandId={brandId} />}
      {tab === "issues" && <IssuesTab brandId={brandId} />}
    </div>
  );
}
