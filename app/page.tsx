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

export default async function Home() {
  const brands = await getBrands();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Chinese Automotive Brands</h1>
      <p className="text-zinc-600 mb-6">
        Browse {brands.length} major Chinese automotive brands and their model lineups.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {brands.map((brand) => (
          <Link
            key={brand._id}
            href={`/brands/${brand._id}`}
            className="block bg-white border border-zinc-200 rounded-lg p-4 hover:border-zinc-400 hover:shadow-sm transition"
          >
            <h2 className="font-semibold text-lg">{brand.name}</h2>
            {brand.parent_group && (
              <p className="text-sm text-zinc-500">{brand.parent_group}</p>
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
