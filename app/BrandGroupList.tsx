"use client";

import { useState } from "react";
import Link from "next/link";
import type { BrandGroup, NormalizedBrand } from "@/lib/brandGrouping";

const STATUS_STYLES: Record<string, string> = {
  discontinued: "bg-zinc-200 text-zinc-600",
  bankrupt: "bg-red-100 text-red-700",
  merged: "bg-amber-100 text-amber-700",
};

function BrandCard({ brand }: { brand: NormalizedBrand }) {
  return (
    <Link
      href={`/brands/${brand._id}`}
      className="block bg-white border border-zinc-200 rounded-lg p-4 hover:border-zinc-400 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{brand.name}</h3>
        {brand.status && brand.status !== "active" && (
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs ${STATUS_STYLES[brand.status] ?? ""}`}>
            {brand.status}
          </span>
        )}
      </div>
      {(brand.displayParentGroup || brand.displayTechPartner) && (
        <p className="text-sm text-zinc-500">
          {brand.displayParentGroup}
          {brand.displayParentGroup && brand.displayTechPartner && " · "}
          {brand.displayTechPartner && `powered by ${brand.displayTechPartner}`}
        </p>
      )}
      <div className="mt-2 text-xs text-zinc-500 flex gap-3">
        <span>{brand.country_origin}</span>
        {brand.founded_year && <span>Founded {brand.founded_year}</span>}
      </div>
    </Link>
  );
}

function GroupSection({ group }: { group: BrandGroup }) {
  const [open, setOpen] = useState(true);

  return (
    <section className={`rounded-xl border ${group.isEcosystem ? "border-indigo-200 bg-indigo-50/40" : "border-zinc-200 bg-zinc-50/60"}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className={`text-lg font-bold truncate ${group.isEcosystem ? "text-indigo-900" : "text-zinc-900"}`}>
            {group.label}
          </h2>
          <span className="shrink-0 text-xs font-medium text-zinc-500 bg-white border border-zinc-200 rounded-full px-2 py-0.5">
            {group.brands.length} brands
          </span>
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
            <BrandCard key={brand._id} brand={brand} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function BrandGroupList({
  groups,
  standalone,
}: {
  groups: BrandGroup[];
  standalone: NormalizedBrand[];
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <GroupSection key={group.key} group={group} />
      ))}

      {standalone.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            Independent brands ({standalone.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {standalone.map((brand) => (
              <BrandCard key={brand._id} brand={brand} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
