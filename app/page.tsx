import Link from "next/link";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import type { IBrand } from "@/types";

export const dynamic = "force-dynamic";

async function getBrands(): Promise<IBrand[]> {
  await connectToDatabase();
  const brands = await Brand.find().sort({ name: 1 }).lean();
  return JSON.parse(JSON.stringify(brands));
}

const STATUS_STYLES: Record<string, string> = {
  discontinued: "bg-zinc-200 text-zinc-600",
  bankrupt: "bg-red-100 text-red-700",
  merged: "bg-amber-100 text-amber-700",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showAll = all === "1";
  const allBrands = await getBrands();
  const brands = showAll ? allBrands : allBrands.filter((b) => !b.status || b.status === "active");
  const inactiveCount = allBrands.length - allBrands.filter((b) => !b.status || b.status === "active").length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Chinese Automotive Brands</h1>
      <p className="text-zinc-600 mb-1">
        Browse {brands.length} {showAll ? "" : "active "}Chinese automotive brands and their model lineups.
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
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
        {brands.map((brand) => (
          <Link
            key={brand._id}
            href={`/brands/${brand._id}`}
            className="block bg-white border border-zinc-200 rounded-lg p-4 hover:border-zinc-400 hover:shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold text-lg">{brand.name}</h2>
              {brand.status && brand.status !== "active" && (
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[brand.status] ?? ""}`}>
                  {brand.status}
                </span>
              )}
            </div>
            {brand.parent_group && (
              <p className="text-sm text-zinc-500">
                {brand.parent_group}
                {brand.tech_partner && ` · ${brand.tech_partner} tech`}
              </p>
            )}
            <div className="mt-2 text-xs text-zinc-500 flex gap-3">
              <span>{brand.country_origin}</span>
              {brand.founded_year && <span>Founded {brand.founded_year}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
