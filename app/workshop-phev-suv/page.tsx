import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import BrandPhevSuvWorkshopProfile from "@/models/BrandPhevSuvWorkshopProfile";
import type { IBrandPhevSuvWorkshopProfile } from "@/types";
import WorkshopProfileFields from "@/app/WorkshopProfileFields";

export const dynamic = "force-dynamic";

// Same threshold used by scripts/research-phev-suv-workshop.ts for this run — brands
// with 1+ PHEV SUV models in the catalog (lowered from 2 on 2026-09-21 — the higher
// threshold hid low-model-count brands like Chery and Lepas). Kept in sync manually; if the threshold
// changes there, change it here too so the scope list this page shows matches what was
// actually (or will be) researched.
const MIN_MODEL_COUNT = 1;

interface ProfileWithBrand extends Omit<IBrandPhevSuvWorkshopProfile, "brand_id"> {
  brand_id: { _id: string; name: string } | string;
}

async function getData() {
  await connectToDatabase();

  const grouped = await ModelSchema.aggregate([
    { $match: { powertrain_category: "PHEV", segment: { $in: ["SUV-compact", "SUV-mid", "SUV-full"] } } },
    { $group: { _id: "$brand_id", count: { $sum: 1 } } },
    { $match: { count: { $gte: MIN_MODEL_COUNT } } },
    { $sort: { count: -1 } },
  ]);

  const brands = await Brand.find({ _id: { $in: grouped.map((g) => g._id) } })
    .select("name")
    .lean();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));

  const scope = grouped
    .map((g) => ({ brand: brandById.get(String(g._id)), count: g.count as number }))
    .filter((t): t is { brand: { _id: unknown; name: string }; count: number } => Boolean(t.brand));

  const profilesRaw = await BrandPhevSuvWorkshopProfile.find({
    brand_id: { $in: scope.map((s) => s.brand._id) },
  })
    .populate("brand_id", "name")
    .lean();
  const profiles = JSON.parse(JSON.stringify(profilesRaw)) as ProfileWithBrand[];
  const profileByBrandId = new Map(
    profiles.map((p) => [typeof p.brand_id === "string" ? p.brand_id : p.brand_id._id, p])
  );

  return {
    scope: scope.map((s) => ({ brandId: String(s.brand._id), brandName: s.brand.name, count: s.count })),
    profileByBrandId,
  };
}

export default async function WorkshopPhevSuvPage() {
  const { scope, profileByBrandId } = await getData();

  const researchedCount = scope.filter((s) => profileByBrandId.has(s.brandId)).length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">PHEV SUV Workshop Profiles</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-2 max-w-3xl">
        Real, brand-specific after-sales infrastructure requirements for servicing PHEV SUV models — diagnostic
        interface, lift spec, PPE, technician prerequisites, and dealer audit checklist. Chinese-source-only
        research, scoped to brands with {MIN_MODEL_COUNT}+ PHEV SUV models in the catalog. Deliberately separate
        from the generic Workshop Organization page — nothing here falls back to the industry-generic standard; a
        field shown as &quot;Not found&quot; means brand-specific research turned up nothing, not that data was omitted.
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
        {researchedCount} of {scope.length} in-scope brands researched.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {scope.map(({ brandId, brandName, count }) => {
          const profile = profileByBrandId.get(brandId);

          return (
            <div key={brandId} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-baseline justify-between mb-3">
                <p className="font-semibold">{brandName}</p>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {count} PHEV SUV model{count === 1 ? "" : "s"}
                </span>
              </div>

              {!profile ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-600">Not yet researched.</p>
              ) : (
                <WorkshopProfileFields profile={profile} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
