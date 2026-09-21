import { connectToDatabase } from "@/lib/db";
// Side-effect import only: registers "Brand" so BrandWorkshopOverride's
// .populate("brand_id") below can resolve it — see the identical comment in
// app/api/models/[id]/route.ts.
import "@/models/Brand";
import WorkshopStandard from "@/models/WorkshopStandard";
import BrandWorkshopOverride from "@/models/BrandWorkshopOverride";
import ModelSchema, { POWERTRAIN_CATEGORIES } from "@/models/Model";
import type { IWorkshopStandard, IBrandWorkshopOverride, PowertrainCategory, ServiceTier } from "@/types";
import { resolveWorkshopRequirements } from "@/lib/workshopResolution";

const CATEGORY_LABELS: Record<PowertrainCategory, string> = {
  ICE: "ICE (internal combustion)",
  HEV: "HEV (hybrid, no plug)",
  PHEV: "PHEV / REEV (plug-in hybrid, range extender)",
  BEV: "BEV (battery electric)",
};

const TIER_LABELS: Record<ServiceTier, string> = {
  routine: "Routine service",
  major_repair: "Major repair",
  hv_battery: "HV battery service",
};

const TIERS: ServiceTier[] = ["routine", "major_repair", "hv_battery"];

interface OverrideWithBrand extends Omit<IBrandWorkshopOverride, "brand_id"> {
  brand_id: { _id: string; name: string } | string;
}

async function getData() {
  await connectToDatabase();

  const [standardsRaw, overridesRaw, totalModels, categoryCountsRaw] = await Promise.all([
    WorkshopStandard.find().lean(),
    BrandWorkshopOverride.find().populate("brand_id", "name").lean(),
    ModelSchema.countDocuments(),
    ModelSchema.aggregate([{ $group: { _id: "$powertrain_category", count: { $sum: 1 } } }]),
  ]);

  const standards = JSON.parse(JSON.stringify(standardsRaw)) as IWorkshopStandard[];
  const overrides = JSON.parse(JSON.stringify(overridesRaw)) as OverrideWithBrand[];

  const categoryCounts: Record<string, number> = {};
  for (const row of categoryCountsRaw as { _id: string | null; count: number }[]) {
    if (row._id) categoryCounts[row._id] = row.count;
  }
  const classifiedCount = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  const unclassifiedCount = totalModels - classifiedCount;

  return { standards, overrides, totalModels, categoryCounts, classifiedCount, unclassifiedCount };
}

/** Generic (industry-baseline) workshop reference, collapsed under the Workshop tab of /technical. Standards are not brand-specific; `brandId` only narrows the per-brand overrides. */
export default async function GenericWorkshopReference({ brandId }: { brandId?: string }) {
  const data = await getData();
  const { standards, totalModels, categoryCounts, classifiedCount, unclassifiedCount } = data;
  const overrides = data.overrides.filter((o) => !brandId || (typeof o.brand_id === "string" ? o.brand_id : o.brand_id._id) === brandId);

  const standardsByCategory = new Map<string, IWorkshopStandard[]>();
  for (const s of standards) {
    const list = standardsByCategory.get(s.powertrain_category) ?? [];
    list.push(s);
    standardsByCategory.set(s.powertrain_category, list);
  }

  // Overrides grouped by brand — a brand can have an override for more than one
  // powertrain_category (e.g. both its ICE and BEV lineups), so group per brand
  // and render each category's delta as its own row underneath.
  const overridesByBrand = new Map<string, { brandName: string; entries: OverrideWithBrand[] }>();
  for (const o of overrides) {
    const brand = typeof o.brand_id === "string" ? { _id: o.brand_id, name: "Unknown brand" } : o.brand_id;
    const key = brand._id;
    const existing = overridesByBrand.get(key);
    if (existing) existing.entries.push(o);
    else overridesByBrand.set(key, { brandName: brand.name, entries: [o] });
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Generic workshop baseline</h2>
      <p className="text-zinc-600 dark:text-zinc-400 mb-2">
        Technician certification, lift, and special-tooling requirements — derived from powertrain category and
        service tier, not researched per model. {classifiedCount} of {totalModels} models are classified
        {unclassifiedCount > 0 && (
          <>
            {" "}
            ({unclassifiedCount} not yet classified — no Powertrain spec data researched yet; run{" "}
            <code className="text-xs">npm run backfill-powertrain-category</code> after spec research fills in).
          </>
        )}
        .
      </p>

      <div className="space-y-8 mb-10">
        {POWERTRAIN_CATEGORIES.map((category) => {
          const catStandards = standardsByCategory.get(category) ?? [];
          const modelCount = categoryCounts[category] ?? 0;
          // Only render categories with at least one surviving model — the DB was
          // scoped to PHEV SUVs only (2026-09-18), so ICE/HEV standards rows still
          // exist in workshop_standards (kept as reference data, not deleted) but
          // have zero models behind them now; showing them as live sections would
          // present dead categories as selectable/browsable.
          if (catStandards.length === 0 || modelCount === 0) return null;

          return (
            <section key={category}>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category as PowertrainCategory]}</h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {modelCount} model{modelCount === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {TIERS.map((tier) => {
                  const standard = catStandards.find((s) => s.service_tier === tier);
                  if (!standard) {
                    return (
                      <div
                        key={tier}
                        className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-xs text-zinc-400 dark:text-zinc-600"
                      >
                        <p className="font-medium mb-1">{TIER_LABELS[tier]}</p>
                        <p>Not applicable</p>
                      </div>
                    );
                  }
                  const resolved = resolveWorkshopRequirements(standard);
                  return (
                    <div key={tier} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                      <p className="font-medium text-sm mb-2">{TIER_LABELS[tier]}</p>

                      <div className="space-y-2 text-xs">
                        <div>
                          <p className="text-zinc-500 dark:text-zinc-400 font-medium mb-0.5">Certification</p>
                          <p>{resolved.technician_certification?.level ?? "—"}</p>
                          {resolved.technician_certification?.body && (
                            <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">{resolved.technician_certification.body}</p>
                          )}
                          {resolved.technician_certification?.retraining_interval_months && (
                            <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                              Retraining every {resolved.technician_certification.retraining_interval_months} months
                            </p>
                          )}
                        </div>

                        <div>
                          <p className="text-zinc-500 dark:text-zinc-400 font-medium mb-0.5">Lift</p>
                          <p>{resolved.lift_requirements?.type ?? "—"}</p>
                          {resolved.lift_requirements?.min_capacity_kg && (
                            <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                              Min {resolved.lift_requirements.min_capacity_kg} kg
                              {resolved.lift_requirements.battery_removal_capable ? " · battery-removal capable" : ""}
                            </p>
                          )}
                        </div>

                        <div>
                          <p className="text-zinc-500 dark:text-zinc-400 font-medium mb-0.5">Special tools</p>
                          {resolved.special_tools?.length ? (
                            <ul className="space-y-0.5">
                              {resolved.special_tools.map((t) => (
                                <li key={t.name}>
                                  {t.name}
                                  {t.mandatory === false && <span className="text-zinc-400 dark:text-zinc-600"> (recommended)</span>}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>—</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {overridesByBrand.size > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
          <h2 className="text-lg font-semibold mb-1">Brand-specific overrides</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            Only shown where real brand-specific research found something beyond the generic standard above.
          </p>
          <div className="space-y-3">
            {Array.from(overridesByBrand.entries()).map(([brandId, { brandName, entries }]) => (
              <div key={brandId} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <p className="font-semibold mb-2">{brandName}</p>
                <div className="space-y-2">
                  {entries.map((o) => (
                    <div key={o.powertrain_category} className="text-sm">
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {CATEGORY_LABELS[o.powertrain_category as PowertrainCategory]}:
                      </span>{" "}
                      {o.overrides.technician_certification?.level && <>Cert: {o.overrides.technician_certification.level}. </>}
                      {o.overrides.lift_requirements?.type && <>Lift: {o.overrides.lift_requirements.type}. </>}
                      {o.overrides.special_tools?.length ? <>Tools: {o.overrides.special_tools.map((t) => t.name).join(", ")}.</> : null}
                      {o._source_url && (
                        <a href={o._source_url} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline ml-1">
                          source
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* No empty-state "N of M brands researched" here on purpose — most brands
          genuinely have zero brand-specific override data, and that's expected
          (generic workshop_standards already covers them), not a gap to fill. */}
    </div>
  );
}
