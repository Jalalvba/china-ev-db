"use client";

import { useRouter } from "next/navigation";

/** Shared brand picker for every /technical tab. State lives in the URL (?tab=…&brand=…); "" = all brands. */
export default function BrandPicker({ brands, brandId, tab }: { brands: { _id: string; name: string }[]; brandId?: string; tab: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">Brand</span>
      <select
        value={brandId ?? ""}
        onChange={(e) => router.push(`/technical?tab=${tab}${e.target.value ? `&brand=${e.target.value}` : ""}`)}
        className="text-sm border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900"
      >
        <option value="">All brands</option>
        {brands.map((b) => (
          <option key={b._id} value={b._id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
