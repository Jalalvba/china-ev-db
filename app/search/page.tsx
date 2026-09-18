"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { IBrand, IModel, ProductionStatus, Segment } from "@/types";
import { SegmentLabel } from "@/lib/segmentDisplay";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };

// DB is scoped to PHEV SUVs only (2026-09-18) — only SUV segments have live data.
const SEGMENTS: Segment[] = ["SUV-compact", "SUV-mid", "SUV-full"];

const STATUSES: ProductionStatus[] = ["in production", "discontinued", "upcoming"];

export default function SearchPage() {
  const [models, setModels] = useState<PopulatedModel[]>([]);
  const [brands, setBrands] = useState<IBrand[]>([]);
  const [loading, setLoading] = useState(true);

  const [brandId, setBrandId] = useState("");
  const [segment, setSegment] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  useEffect(() => {
    fetch("/api/brands")
      .then((r) => r.json())
      .then(setBrands);
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (brandId) params.set("brand_id", brandId);
    if (segment) params.set("segment", segment);
    if (status) params.set("production_status", status);
    if (minPrice) params.set("min_price_usd", minPrice);
    if (maxPrice) params.set("max_price_usd", maxPrice);

    fetch(`/api/models?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setModels(data);
        setLoading(false);
      });
  }, [brandId, segment, status, minPrice, maxPrice]);

  const filtered = useMemo(() => {
    if (!query) return models;
    const q = query.toLowerCase();
    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.brand_id?.name?.toLowerCase().includes(q)
    );
  }, [models, query]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Search &amp; Filter Models</h1>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <input
          className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm"
          placeholder="Search by name or brand..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm"
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b._id} value={b._id}>
              {b.name}
            </option>
          ))}
        </select>
        <select
          className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
        >
          <option value="">All segments</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="number"
          className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm"
          placeholder="Min price (USD)"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
        />
        <input
          type="number"
          className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm"
          placeholder="Max price (USD)"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-zinc-500 dark:text-zinc-400">Loading...</p>
      ) : (
        <>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">{filtered.length} models found</p>
          <div className="overflow-x-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800 text-left text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="p-3">Model</th>
                  <th className="p-3">Brand</th>
                  <th className="p-3">Segment</th>
                  <th className="p-3">Body Type</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Price (USD)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={m._id}
                    className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <td className="p-3">
                      <Link href={`/models/${m._id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    <td className="p-3">{m.brand_id?.name}</td>
                    <td className="p-3">
                      <SegmentLabel model={m} />
                    </td>
                    <td className="p-3">{m.body_type}</td>
                    <td className="p-3">{m.production_status}</td>
                    <td className="p-3">
                      {m.price_range?.min_usd
                        ? `$${m.price_range.min_usd.toLocaleString()}–$${m.price_range.max_usd?.toLocaleString()}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
