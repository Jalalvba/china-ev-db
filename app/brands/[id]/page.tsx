import Link from "next/link";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import MoroccoListing from "@/models/MoroccoListing";
import type { IBrand, IModel } from "@/types";
import MoroccoPriceFetcher from "@/app/MoroccoPriceFetcher";
import MoroccoPriceChipLink from "@/app/MoroccoPriceChipLink";
import { SegmentLabel } from "@/lib/segmentDisplay";
import BrandAndModelDiscovery from "@/app/BrandAndModelDiscovery";
import WarrantyResearch from "@/app/WarrantyResearch";
import { formatRelativeTime } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

async function getData(
  id: string
): Promise<{ brand: IBrand; models: IModel[]; moteurMaByModelId: Record<string, { price: number; url?: string }> } | null> {
  await connectToDatabase();
  const brand = await Brand.findById(id).lean();
  if (!brand) return null;
  const models = await ModelSchema.find({ brand_id: id }).lean();
  // Cheapest-to-most-expensive by confirmed Morocco price, same ordering as
  // the homepage's brand cards — a model with no confirmed price (Infinity
  // sentinel) sorts last rather than first, which Mongo's own ascending
  // sort would otherwise do for a missing/null field.
  models.sort((a, b) => {
    const priceFor = (m: (typeof models)[number]) =>
      m.morocco_price_confirmed && m.morocco_price_dh != null ? m.morocco_price_dh : Infinity;
    return priceFor(a) - priceFor(b) || a.name.localeCompare(b.name);
  });

  const moteurMaListings = await MoroccoListing.find(
    { model_id: { $in: models.map((m) => m._id) }, moteur_ma_confirmed: true, moteur_ma_price_dh: { $exists: true } },
    { model_id: 1, moteur_ma_price_dh: 1, moteur_ma_url: 1 }
  ).lean();
  const moteurMaByModelId: Record<string, { price: number; url?: string }> = {};
  for (const listing of moteurMaListings) {
    if (!listing.model_id || !listing.moteur_ma_price_dh) continue;
    moteurMaByModelId[String(listing.model_id)] = { price: listing.moteur_ma_price_dh, url: listing.moteur_ma_url };
  }

  return JSON.parse(JSON.stringify({ brand, models, moteurMaByModelId }));
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { id } = await params;
  const { all } = await searchParams;
  const showAll = all === "1";
  const data = await getData(id);
  if (!data) notFound();
  const { brand, models: allModels, moteurMaByModelId } = data;
  // Same "hidden unless asked for" pattern as the homepage's brand list
  // (b798cec/c9c6ab1) — a model with no confirmed Morocco price is still on
  // file, just not shown by default, since this app's whole point is the
  // Morocco market. Already sorted cheapest-first above, so hiding the
  // unpriced tail just trims the list rather than needing a re-sort.
  const modelsWithMoroccoPrice = allModels.filter((m) => m.morocco_price_confirmed && m.morocco_price_dh != null);
  const models = showAll ? allModels : modelsWithMoroccoPrice;
  const hiddenModelCount = allModels.length - modelsWithMoroccoPrice.length;

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
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
        {brand.last_researched_at
          ? `Brand identity researched ${formatRelativeTime(brand.last_researched_at)}`
          : `Brand identity not yet researched${brand.createdAt ? ` (original import data, ${formatRelativeTime(brand.createdAt)})` : ""} — consider running "Research this brand" before discovering models, for more targeted results`}
      </p>

      <div className="flex flex-wrap items-start gap-4 mt-3">
        <BrandAndModelDiscovery brandId={brand._id as string} />
        <WarrantyResearch brandId={brand._id as string} />
      </div>

      <h2 className="text-lg font-semibold mt-6 mb-1">
        Models ({models.length}{showAll ? "" : " with a confirmed Morocco price"})
      </h2>
      {hiddenModelCount > 0 && (
        <p className="text-sm mb-3">
          <Link
            href={showAll ? `/brands/${id}` : `/brands/${id}?all=1`}
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            {showAll
              ? "Hide models with no Morocco price"
              : `Show ${hiddenModelCount} more model(s) (no confirmed Morocco price yet)`}
          </Link>
        </p>
      )}
      {models.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          {allModels.length > 0
            ? "No models with a confirmed Morocco price yet — use the link above to see all models on file."
            : 'No models on file yet for this brand — use "🔎 Research brand" above to find its lineup.'}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {models.map((m) => (
          <div
            key={m._id}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <Link href={`/models/${m._id}`} className="flex-1 min-w-0">
                <h3 className="font-semibold">
                  {m.name}
                  {m.generation ? ` (${m.generation})` : ""}
                </h3>
              </Link>
              {m.morocco_price_confirmed && m.morocco_price_dh && m.morocco_price_url && (
                <MoroccoPriceChipLink
                  href={m.morocco_price_url}
                  title={m.morocco_price_source}
                  priceDh={m.morocco_price_dh}
                />
              )}
            </div>
            <Link href={`/models/${m._id}`} className="block">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                <SegmentLabel model={m} /> · {m.body_type}
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
              {moteurMaByModelId[m._id as string] && (
                <div className="mt-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                    🇲🇦 moteur.ma: {moteurMaByModelId[m._id as string].price.toLocaleString()} DH
                  </span>
                </div>
              )}
            </Link>
            <div className="flex items-center gap-2 flex-wrap">
              <MoroccoPriceFetcher id={m._id as string} label="💰" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
