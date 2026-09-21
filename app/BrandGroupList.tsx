"use client";

import { useState } from "react";
import Link from "next/link";
import type { BrandGroup } from "@/lib/brandGrouping";
import type { IBrand } from "@/types";
import BrandResearch from "@/app/BrandResearch";
import BrandGroupExport from "@/app/BrandGroupExport";
import BrandDiscoveryExport from "@/app/BrandDiscoveryExport";

const STATUS_STYLES: Record<string, string> = {
  discontinued: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  bankrupt: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  merged: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
};

function BrandCard({
  brand,
  moroccoDealer,
  cheapestMoroccoPriceDh,
}: {
  brand: IBrand;
  moroccoDealer?: string;
  cheapestMoroccoPriceDh?: number;
}) {
  return (
    <Link
      href={`/brands/${brand._id}`}
      className="block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h3 className="font-semibold truncate">{brand.name}</h3>
          {brand.tech_partner && (
            <span
              title={`Technology partner: ${brand.tech_partner}`}
              className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            >
              ⚡ {brand.tech_partner}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {brand.status && brand.status !== "active" && (
            <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[brand.status] ?? ""}`}>
              {brand.status}
            </span>
          )}
          <BrandResearch brandId={brand._id as string} compact />
        </div>
      </div>
      {brand.parent_group && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{brand.parent_group}</p>
      )}
      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 flex gap-3">
        <span>{brand.country_origin}</span>
        {brand.founded_year && <span>Founded {brand.founded_year}</span>}
      </div>
      {cheapestMoroccoPriceDh !== undefined ? (
        <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          from {cheapestMoroccoPriceDh.toLocaleString()} DH
        </p>
      ) : (
        <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500 italic">no confirmed Morocco price</p>
      )}
      {moroccoDealer && (
        <p className="mt-2 text-xs text-green-600 dark:text-green-400">
          🇲🇦 {moroccoDealer}
        </p>
      )}
    </Link>
  );
}

function GroupSection({
  group,
  moroccoDealersByBrandName,
  cheapestMoroccoPriceByBrandId,
}: {
  group: BrandGroup;
  moroccoDealersByBrandName: Record<string, string>;
  cheapestMoroccoPriceByBrandId: Record<string, number>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left flex-wrap"
      >
        <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
          <h2 className="text-lg font-bold truncate text-zinc-900 dark:text-zinc-100">{group.label}</h2>
          <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-full px-2 py-0.5">
            {group.brands.length} brands
          </span>
          <BrandGroupExport
            groupKey={group.key}
            brandNamesById={Object.fromEntries(group.brands.map((b) => [String(b._id), b.name]))}
          />
          <BrandDiscoveryExport groupKey={group.key} />
        </div>
        <svg
          className={`shrink-0 w-5 h-5 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {group.brands.map((brand) => (
            <BrandCard
              key={brand._id}
              brand={brand}
              moroccoDealer={moroccoDealersByBrandName[brand.name.toLowerCase()]}
              cheapestMoroccoPriceDh={brand._id ? cheapestMoroccoPriceByBrandId[brand._id] : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function BrandGroupList({
  groups,
  standalone,
  moroccoDealersByBrandName,
  cheapestMoroccoPriceByBrandId,
}: {
  groups: BrandGroup[];
  standalone: IBrand[];
  moroccoDealersByBrandName: Record<string, string>;
  cheapestMoroccoPriceByBrandId: Record<string, number>;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <GroupSection
          key={group.key}
          group={group}
          moroccoDealersByBrandName={moroccoDealersByBrandName}
          cheapestMoroccoPriceByBrandId={cheapestMoroccoPriceByBrandId}
        />
      ))}

      {standalone.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
            Independent brands ({standalone.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standalone.map((brand) => (
              <BrandCard
                key={brand._id}
                brand={brand}
                moroccoDealer={moroccoDealersByBrandName[brand.name.toLowerCase()]}
                cheapestMoroccoPriceDh={brand._id ? cheapestMoroccoPriceByBrandId[brand._id] : undefined}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
