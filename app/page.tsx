import Link from "next/link";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import MoroccoListing from "@/models/MoroccoListing";
import { groupBrands } from "@/lib/brandGrouping";
import { MOROCCO_BRAND_ALIAS } from "@/lib/moroccoBrandAlias";
import BrandGroupList from "./BrandGroupList";
import type { IBrand } from "@/types";

export const dynamic = "force-dynamic";

async function getBrands(): Promise<IBrand[]> {
  await connectToDatabase();
  const brands = await Brand.find().sort({ name: 1 }).lean();
  return JSON.parse(JSON.stringify(brands));
}

// One aggregation for all brand cards, rather than a per-card query: builds
// brand_en -> distinct confirmed dealer name(s), then resolves each brand_en
// through MOROCCO_BRAND_ALIAS (Haval/ORA/WEY/Tank/GWM -> GWM (Great Wall
// Motor), Omoda -> Chery) so sub-brand listings roll up to the parent Brand
// card they actually render under.
async function getMoroccoDealersByBrandName(): Promise<Record<string, string>> {
  await connectToDatabase();
  const listings = await MoroccoListing.find(
    { dealer_confidence: "confirmed", dealer_morocco: { $exists: true, $ne: null } },
    { brand_en: 1, dealer_morocco: 1 }
  ).lean();

  const dealersByBrandName = new Map<string, Set<string>>();
  for (const listing of listings) {
    const brandName = MOROCCO_BRAND_ALIAS[listing.brand_en] ?? listing.brand_en;
    if (!listing.dealer_morocco) continue;
    const set = dealersByBrandName.get(brandName) ?? new Set<string>();
    set.add(listing.dealer_morocco);
    dealersByBrandName.set(brandName, set);
  }

  const result: Record<string, string> = {};
  for (const [brandName, dealers] of dealersByBrandName) {
    // Multiple distinct dealers for one brand shouldn't normally happen;
    // take the first rather than concatenating an unreadable card badge.
    // Keyed lower-cased since MoroccoListing.brand_en and Brand.name casing
    // aren't guaranteed to match exactly (import-morocco.ts itself matches
    // Brand names case-insensitively for the same reason).
    result[brandName.toLowerCase()] = [...dealers][0];
  }
  return result;
}

/** Brand _ids (as strings) with at least one Model carrying a confirmed Morocco price — used to hide brands with no Morocco pricing data by default, same "hidden unless asked for" pattern as discontinued/bankrupt brands below. */
async function getBrandIdsWithMoroccoPrice(): Promise<Set<string>> {
  await connectToDatabase();
  const brandIds = await ModelSchema.distinct("brand_id", { morocco_price_confirmed: true });
  return new Set(brandIds.map((id) => String(id)));
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showAll = all === "1";
  const [allBrands, moroccoDealersByBrandName, brandIdsWithMoroccoPrice] = await Promise.all([
    getBrands(),
    getMoroccoDealersByBrandName(),
    getBrandIdsWithMoroccoPrice(),
  ]);
  const activeBrands = allBrands.filter((b) => !b.status || b.status === "active");
  const activeBrandsWithMoroccoPrice = activeBrands.filter((b) => b._id && brandIdsWithMoroccoPrice.has(b._id));
  const brands = showAll ? allBrands : activeBrandsWithMoroccoPrice;
  const hiddenCount = allBrands.length - activeBrandsWithMoroccoPrice.length;

  const { groups, standalone } = groupBrands(brands);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Chinese Automotive Brands</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-1">
        Browse {brands.length} Chinese automotive brands{showAll ? "" : " with a confirmed Morocco price"}, grouped by
        manufacturer.
      </p>
      {hiddenCount > 0 && (
        <p className="text-sm mb-6">
          <Link href={showAll ? "/" : "/?all=1"} className="text-blue-600 dark:text-blue-400 hover:underline">
            {showAll
              ? "Hide brands with no Morocco price / discontinued brands"
              : `Show ${hiddenCount} more brand(s) (no confirmed Morocco price yet, or discontinued/bankrupt)`}
          </Link>
        </p>
      )}
      <div className="mt-6">
        <BrandGroupList groups={groups} standalone={standalone} moroccoDealersByBrandName={moroccoDealersByBrandName} />
      </div>
    </div>
  );
}
