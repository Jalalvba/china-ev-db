import Link from "next/link";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import BrandPhevSuvWorkshopProfile from "@/models/BrandPhevSuvWorkshopProfile";
import WorkshopProfileFields from "@/app/WorkshopProfileFields";
import MoroccoListing from "@/models/MoroccoListing";
import type { IBrand, IModel, IBrandPhevSuvWorkshopProfile } from "@/types";
import MoroccoPriceFetcher from "@/app/MoroccoPriceFetcher";
import MoroccoPriceChipLink from "@/app/MoroccoPriceChipLink";
import { SegmentLabel } from "@/lib/segmentDisplay";
import BrandAndModelDiscovery from "@/app/BrandAndModelDiscovery";
import BrandResearch from "@/app/BrandResearch";
import WarrantyResearch from "@/app/WarrantyResearch";
import WorkshopResearch from "@/app/WorkshopResearch";
import MoroccoInfoEditor from "@/app/MoroccoInfoEditor";
import { formatRelativeTime } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

async function getData(
  id: string
): Promise<{
  brand: IBrand;
  models: IModel[];
  moteurMaByModelId: Record<string, { price: number; url?: string }>;
  workshopProfile: IBrandPhevSuvWorkshopProfile | null;
} | null> {
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

  const workshopProfile = await BrandPhevSuvWorkshopProfile.findOne({ brand_id: id }).lean();

  return JSON.parse(JSON.stringify({ brand, models, moteurMaByModelId, workshopProfile }));
}

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();
  // 2026-09-21: this used to hide models with no confirmed Morocco price by default behind an
  // `?all=1` toggle (same pattern as the homepage's old brand list) — removed per an explicit
  // decision that an unpriced model is still real, valid data and should be visible, just clearly
  // marked "no confirmed Morocco price" instead of tucked away. Already sorted cheapest-first
  // above, with unpriced models naturally trailing via the Infinity sentinel.
  const { brand, models, moteurMaByModelId, workshopProfile } = data;

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
      {brand.morocco_name && brand.morocco_name !== brand.name && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">🇲🇦 Marketed in Morocco as: {brand.morocco_name}</p>
      )}
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
        {brand.last_researched_at
          ? `Brand identity researched ${formatRelativeTime(brand.last_researched_at)}`
          : `Brand identity not yet researched${brand.createdAt ? ` (original import data, ${formatRelativeTime(brand.createdAt)})` : ""} — consider using "Brand identity: export/import" before discovering models, for more targeted results`}
      </p>

      <div className="flex flex-wrap items-start gap-4 mt-3">
        <BrandAndModelDiscovery brandId={brand._id as string} />
        <BrandResearch brandId={brand._id as string} />
        <WarrantyResearch brandId={brand._id as string} />
        <WorkshopResearch brandId={brand._id as string} />
        <MoroccoInfoEditor
          basePath={`/api/brands/${brand._id}`}
          currentMoroccoName={brand.morocco_name}
          showPrice={false}
          fallbackName={brand.name}
        />
      </div>

      {workshopProfile && (
        <section className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h2 className="text-base font-semibold">PHEV SUV workshop profile</h2>
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                workshopProfile._confidence === "confirmed"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              }`}
            >
              {workshopProfile._confidence}
            </span>
            {workshopProfile._last_researched_at && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                researched {formatRelativeTime(workshopProfile._last_researched_at)}
              </span>
            )}
          </div>
          <WorkshopProfileFields profile={workshopProfile} />
        </section>
      )}

      {brand.workshop_requirements && (
        <section className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold">Workshop requirements (legacy)</h2>
            {brand.workshop_requirements.confidence && (
              <span
                className={`px-2 py-0.5 rounded-full text-xs ${
                  brand.workshop_requirements.confidence === "confirmed"
                    ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                }`}
              >
                {brand.workshop_requirements.confidence}
              </span>
            )}
            {brand.workshop_requirements_last_researched_at && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                researched {formatRelativeTime(brand.workshop_requirements_last_researched_at)}
              </span>
            )}
          </div>
          <dl className="mt-2 space-y-2">
            {brand.workshop_requirements.diagnostic_software_name && (
              <div>
                <dt className="font-medium">Diagnostic software</dt>
                <dd className="text-zinc-600 dark:text-zinc-400">{brand.workshop_requirements.diagnostic_software_name}</dd>
              </div>
            )}
            {!!brand.workshop_requirements.special_tools_list?.length && (
              <div>
                <dt className="font-medium">Special tools</dt>
                <dd>
                  <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                    {brand.workshop_requirements.special_tools_list.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {brand.workshop_requirements.hv_safety_requirements && (
              <div>
                <dt className="font-medium">HV safety requirements</dt>
                <dd className="text-zinc-600 dark:text-zinc-400">{brand.workshop_requirements.hv_safety_requirements}</dd>
              </div>
            )}
            {brand.workshop_requirements.technician_certification_required && (
              <div>
                <dt className="font-medium">Technician certification</dt>
                <dd className="text-zinc-600 dark:text-zinc-400">{brand.workshop_requirements.technician_certification_required}</dd>
              </div>
            )}
            {brand.workshop_requirements.source && (
              <div>
                <dt className="font-medium">Source</dt>
                <dd className="text-zinc-500 dark:text-zinc-400 break-words">{brand.workshop_requirements.source}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <h2 className="text-lg font-semibold mt-6 mb-1">Models ({models.length})</h2>
      {models.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          No models on file yet for this brand — use &quot;📋 Export prompt for model discovery&quot; above to find its
          lineup.
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
              {m.morocco_price_confirmed && m.morocco_price_dh && m.morocco_price_url ? (
                <MoroccoPriceChipLink
                  href={m.morocco_price_url}
                  title={m.morocco_price_source}
                  priceDh={m.morocco_price_dh}
                />
              ) : (
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500 italic">no confirmed Morocco price</span>
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
