import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import type { IBrand } from "@/types";
import WarrantyResearch from "@/app/WarrantyResearch";
import SourceRef from "@/app/SourceRef";
import WarrantyTiers from "@/app/WarrantyTiers";
import { formatRelativeTime } from "@/lib/relativeTime";

async function getBrands(): Promise<IBrand[]> {
  await connectToDatabase();
  const brands = await Brand.find().sort({ name: 1 }).lean();
  return JSON.parse(JSON.stringify(brands));
}

/** Warranty tab of /technical — derived from the old /warranty page; `brandId` narrows to one brand. */
export default async function WarrantyTab({ brandId }: { brandId?: string }) {
  const brands = (await getBrands()).filter((b) => !brandId || b._id === brandId);
  const researched = brands.filter((b) => b.warranty_terms);
  const unresearched = brands.filter((b) => !b.warranty_terms);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Warranty terms</h2>
      <p className="text-zinc-600 dark:text-zinc-400 mb-6">
        Warranty terms — tiered (whole-vehicle, core, special, consumables…) where the policy defines them, legacy ICE / battery / motor figures otherwise — sourced only from Chinese-language 质保政策/三包政策 pages —
        see CLAUDE.md&apos;s PHEV split-warranty convention. {researched.length} of {brands.length} brands researched.
      </p>

      {brands.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No brands in the database yet.</p>
      ) : researched.length === 0 ? (
        <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 text-center">
          <p className="text-zinc-600 dark:text-zinc-400 mb-3">
            No brand has confirmed warranty terms yet. Use &quot;Research warranty terms&quot; on any brand below to pull
            split ICE/battery/motor warranty data from official Chinese manufacturer pages.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {researched.map((b) => (
            <div key={b._id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <a href={`/brands/${b._id}`} className="font-semibold hover:underline">
                  {b.name}
                </a>
                <span
                  className={
                    b.warranty_terms!.confidence === "unconfirmed"
                      ? "text-xs text-amber-600 dark:text-amber-400"
                      : "text-xs text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {b.warranty_terms!.confidence ?? "—"}
                </span>
              </div>
              <WarrantyTiers w={b.warranty_terms!} />
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                {b.warranty_terms!.source ? <>Source:<SourceRef source={b.warranty_terms!.source} /> · </> : null}
                Researched {formatRelativeTime(b.warranty_terms_last_researched_at) || "—"}
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
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg">
            {unresearched.map((b) => (
              <div key={b._id} className="flex items-center justify-between px-4 py-2.5">
                <a href={`/brands/${b._id}`} className="text-sm hover:underline">
                  {b.name}
                </a>
                <WarrantyResearch brandId={b._id as string} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
