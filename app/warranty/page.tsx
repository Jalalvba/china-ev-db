import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import type { IBrand } from "@/types";
import WarrantyResearch from "@/app/WarrantyResearch";
import { formatRelativeTime } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

async function getBrands(): Promise<IBrand[]> {
  await connectToDatabase();
  const brands = await Brand.find().sort({ name: 1 }).lean();
  return JSON.parse(JSON.stringify(brands));
}

export default async function WarrantyPage() {
  const brands = await getBrands();
  const researched = brands.filter((b) => b.warranty_terms);
  const unresearched = brands.filter((b) => !b.warranty_terms);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Warranty Terms</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-6">
        Split ICE / battery / motor warranty terms, sourced only from Chinese-language 质保政策/三包政策 pages —
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400 text-xs">ICE component</p>
                  <p>
                    {b.warranty_terms!.ice_component_years ?? "—"} yr / {b.warranty_terms!.ice_component_km ?? "—"} km
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400 text-xs">Battery</p>
                  <p>
                    {b.warranty_terms!.battery_years ?? "—"} yr / {b.warranty_terms!.battery_km ?? "—"} km
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 dark:text-zinc-400 text-xs">Motor</p>
                  <p>
                    {b.warranty_terms!.motor_years ?? "—"} yr / {b.warranty_terms!.motor_km ?? "—"} km
                  </p>
                </div>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
                {b.warranty_terms!.source ? `Source: ${b.warranty_terms!.source} · ` : ""}
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
