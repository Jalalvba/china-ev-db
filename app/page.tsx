import Link from "next/link";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { groupBrands } from "@/lib/brandGrouping";
import BrandGroupList from "./BrandGroupList";
import type { IBrand } from "@/types";

export const dynamic = "force-dynamic";

async function getBrands(): Promise<IBrand[]> {
  await connectToDatabase();
  const brands = await Brand.find().sort({ name: 1 }).lean();
  return JSON.parse(JSON.stringify(brands));
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showAll = all === "1";
  const allBrands = await getBrands();
  const activeBrands = allBrands.filter((b) => !b.status || b.status === "active");
  const brands = showAll ? allBrands : activeBrands;
  const inactiveCount = allBrands.length - activeBrands.length;

  const { groups, standalone } = groupBrands(brands);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Chinese Automotive Brands</h1>
      <p className="text-zinc-600 mb-1">
        Browse {brands.length} {showAll ? "" : "active "}Chinese automotive brands, grouped by
        manufacturer.
      </p>
      {inactiveCount > 0 && (
        <p className="text-sm mb-6">
          <Link href={showAll ? "/" : "/?all=1"} className="text-blue-600 hover:underline">
            {showAll
              ? "Hide discontinued/bankrupt brands"
              : `Show ${inactiveCount} discontinued/bankrupt brands (kept for reference)`}
          </Link>
        </p>
      )}
      <div className="mt-6">
        <BrandGroupList groups={groups} standalone={standalone} />
      </div>
    </div>
  );
}
