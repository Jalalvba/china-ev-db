import Link from "next/link";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import type { IBrand, IModel } from "@/types";

export const dynamic = "force-dynamic";

async function getData(id: string): Promise<{ brand: IBrand; models: IModel[] } | null> {
  await connectToDatabase();
  const brand = await Brand.findById(id).lean();
  if (!brand) return null;
  const models = await ModelSchema.find({ brand_id: id }).sort({ name: 1 }).lean();
  return JSON.parse(JSON.stringify({ brand, models }));
}

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();
  const { brand, models } = data;

  return (
    <div>
      <Link href="/" className="text-sm text-zinc-500 dark:text-zinc-400 hover:underline">
        ← All brands
      </Link>
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <h1 className="text-2xl font-bold">{brand.name}</h1>
        {brand.status && brand.status !== "active" && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300">
            {brand.status}
          </span>
        )}
      </div>
      <div className="text-sm text-zinc-600 dark:text-zinc-400 flex flex-wrap gap-x-4 gap-y-1 mt-1">
        {brand.parent_group && <span>Parent: {brand.parent_group}</span>}
        {brand.tech_partner && <span>Tech partner: {brand.tech_partner}</span>}
        <span>Origin: {brand.country_origin}</span>
        {brand.founded_year && <span>Founded: {brand.founded_year}</span>}
        {brand.website && (
          <a
            href={brand.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Website
          </a>
        )}
      </div>
      {brand.status_note && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 italic">{brand.status_note}</p>
      )}

      <h2 className="text-lg font-semibold mt-6 mb-3">Models ({models.length})</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {models.map((m) => (
          <Link
            key={m._id}
            href={`/models/${m._id}`}
            className="block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm transition"
          >
            <h3 className="font-semibold">
              {m.name}
              {m.generation ? ` (${m.generation})` : ""}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {m.segment} · {m.body_type}
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {m.production_status}
              </span>
              {m.unverified && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                  unverified
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
