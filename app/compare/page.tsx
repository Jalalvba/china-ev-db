"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { IBrand, IModel, IPowertrain } from "@/types";
import { kwToHp } from "@/lib/units";
import { groupBrands } from "@/lib/brandGrouping";
import { formatChinaPriceCny, formatChinaPriceUsd } from "@/lib/priceDisplay";
import { groupBySpec, compactSpecLabel } from "@/lib/specGrouping";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };
type PopulatedPowertrain = Omit<IPowertrain, "model_id"> & {
  model_id: PopulatedModel;
};

function modelLabel(m: PopulatedModel) {
  return `${m.brand_id?.name ?? "?"} ${m.name}${m.generation ? ` (${m.generation})` : ""}`;
}

function powertrainsForModel(
  model_id: string,
  powertrains: PopulatedPowertrain[],
) {
  return powertrains.filter((p) => p.model_id?._id === model_id);
}

type Row = {
  label: string;
  get: (
    m: PopulatedModel | undefined,
    p: PopulatedPowertrain | undefined,
  ) => string;
  /** true if the two values should be flagged as a meaningful difference. */
  diff?: (a: string, b: string) => boolean;
  /** Skip rendering this row entirely when BOTH sides resolved to "N/A" — for fields (like a Model-level price range) where showing two "N/A" cells is just table noise, not a real comparison point. A row without this flag always renders, "N/A" cells included, same as before. */
  hideIfBothEmpty?: boolean;
};

function numDiffOver10Pct(a: string, b: string) {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (Number.isNaN(na) || Number.isNaN(nb))
    return a !== b && a !== "N/A" && b !== "N/A";
  if (na === 0 && nb === 0) return false;
  const base = Math.max(Math.abs(na), Math.abs(nb));
  return Math.abs(na - nb) / base > 0.1;
}

function simpleDiff(a: string, b: string) {
  return a !== b;
}

const ROWS: Row[] = [
  { label: "Brand / Model", get: (m) => (m ? modelLabel(m) : "N/A") },
  { label: "Segment", get: (m) => m?.segment ?? "N/A", diff: simpleDiff },
  { label: "Body Type", get: (m) => m?.body_type ?? "N/A", diff: simpleDiff },
  {
    label: "Production Status",
    get: (m) => m?.production_status ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Price Range (CNY)",
    get: (m) => formatChinaPriceCny(m?.price_range) ?? "N/A",
    hideIfBothEmpty: true,
  },
  {
    label: "China Price (USD)",
    get: (m) => formatChinaPriceUsd(m?.price_range) ?? "N/A",
    hideIfBothEmpty: true,
  },
  { label: "Trim", get: (_m, p) => p?.trim_name ?? "N/A" },
  {
    label: "Energy Type",
    get: (_m, p) => p?.energy_type ?? "N/A",
    diff: simpleDiff,
  },

  // Engine block
  {
    label: "Engine Displacement",
    get: (_m, p) =>
      p?.engine?.displacement_l ? `${p.engine.displacement_l} L` : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "Engine Cylinders",
    get: (_m, p) => (p?.engine?.cylinders ? String(p.engine.cylinders) : "N/A"),
    diff: simpleDiff,
  },
  {
    label: "Aspiration",
    get: (_m, p) => p?.engine?.aspiration ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Fuel Type",
    get: (_m, p) => p?.engine?.fuel_type ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Range Extender",
    get: (_m, p) =>
      p?.engine ? (p.engine.is_range_extender ? "Yes" : "No") : "N/A",
    diff: simpleDiff,
  },
  {
    label: "Engine Power",
    get: (_m, p) =>
      p?.engine?.power_kw
        ? `${p.engine.power_kw} kW (${kwToHp(p.engine.power_kw) ?? "?"} hp)`
        : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "Engine Torque",
    get: (_m, p) => (p?.engine?.torque_nm ? `${p.engine.torque_nm} Nm` : "N/A"),
    diff: numDiffOver10Pct,
  },

  // Motor block
  {
    label: "Motor Type",
    get: (_m, p) => p?.motor?.type ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Motor Power",
    get: (_m, p) =>
      p?.motor?.power_kw
        ? `${p.motor.power_kw} kW (${kwToHp(p.motor.power_kw) ?? "?"} hp)`
        : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "Motor Torque",
    get: (_m, p) => (p?.motor?.torque_nm ? `${p.motor.torque_nm} Nm` : "N/A"),
    diff: numDiffOver10Pct,
  },
  {
    label: "Motor Count",
    get: (_m, p) => p?.motor?.count ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Drive Type",
    get: (_m, p) => p?.motor?.drive ?? "N/A",
    diff: simpleDiff,
  },

  // Battery block
  {
    label: "Battery Chemistry",
    get: (_m, p) => p?.battery?.chemistry ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Battery Variant",
    get: (_m, p) => p?.battery?.battery_variant ?? "N/A",
  },
  {
    label: "Battery Capacity (total)",
    get: (_m, p) =>
      p?.battery?.capacity_total_kwh
        ? `${p.battery.capacity_total_kwh} kWh`
        : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "Battery Capacity (usable)",
    get: (_m, p) =>
      p?.battery?.capacity_usable_kwh
        ? `${p.battery.capacity_usable_kwh} kWh`
        : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "Battery Supplier",
    get: (_m, p) => p?.battery?.supplier ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "DC Charge Rate",
    get: (_m, p) =>
      p?.battery?.dc_charge_kw ? `${p.battery.dc_charge_kw} kW` : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "AC Charge Rate",
    get: (_m, p) =>
      p?.battery?.ac_charge_kw ? `${p.battery.ac_charge_kw} kW` : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "EV Range",
    get: (_m, p) =>
      p?.battery?.ev_range_km
        ? `${p.battery.ev_range_km} km (${p.battery.ev_range_standard ?? "?"})`
        : "N/A",
    diff: numDiffOver10Pct,
  },

  // Transmission
  {
    label: "Transmission Type",
    get: (_m, p) => p?.transmission?.type ?? "N/A",
    diff: simpleDiff,
  },
  {
    label: "Speed Count",
    get: (_m, p) =>
      p?.transmission?.speed_count ? String(p.transmission.speed_count) : "N/A",
    diff: simpleDiff,
  },

  // Combined / performance
  {
    label: "Combined Range",
    get: (_m, p) =>
      p?.combined_range_km ? `${p.combined_range_km} km` : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "0–100 km/h",
    get: (_m, p) =>
      p?.performance?.accel_0_100_s
        ? `${p.performance.accel_0_100_s} s`
        : "N/A",
    diff: numDiffOver10Pct,
  },
  {
    label: "Top Speed",
    get: (_m, p) =>
      p?.performance?.top_speed_kmh
        ? `${p.performance.top_speed_kmh} km/h`
        : "N/A",
    diff: numDiffOver10Pct,
  },
  { label: "Source", get: (_m, p) => p?.source ?? "N/A" },
];

/**
 * Morocco DH price is always a single confirmed scrape (never min/max — see IModel.morocco_price_dh),
 * so "starting price" here is just that number; the delta is what makes two prices comparable at a
 * glance instead of making the reader subtract two DH figures themselves.
 */
function PriceComparison({
  modelA,
  modelB,
}: {
  modelA: PopulatedModel;
  modelB: PopulatedModel;
}) {
  const priceA = modelA.morocco_price_dh;
  const priceB = modelB.morocco_price_dh;
  if (!priceA || !priceB) return null;

  const delta = priceB - priceA;
  const pct = (Math.abs(delta) / Math.min(priceA, priceB)) * 100;
  const cheaper = delta === 0 ? null : delta > 0 ? "A" : "B";

  return (
    <div className="mb-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            {modelLabel(modelA)} — starting price
          </div>
          <div
            className={`text-2xl font-bold ${cheaper === "A" ? "text-emerald-600 dark:text-emerald-400" : ""}`}
          >
            {priceA.toLocaleString()} DH
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
            {modelLabel(modelB)} — starting price
          </div>
          <div
            className={`text-2xl font-bold ${cheaper === "B" ? "text-emerald-600 dark:text-emerald-400" : ""}`}
          >
            {priceB.toLocaleString()} DH
          </div>
        </div>
      </div>
      {delta !== 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-sm">
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {modelLabel(cheaper === "A" ? modelB : modelA)} is{" "}
            {Math.abs(delta).toLocaleString()} DH ({pct.toFixed(1)}%) more
            expensive
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {" "}
            than {modelLabel(cheaper === "A" ? modelA : modelB)}.
          </span>
        </div>
      )}
    </div>
  );
}

interface Manufacturer {
  key: string;
  label: string;
  brands: IBrand[];
}

/**
 * Manufacturer-level list: each ownership group from groupBrands(), plus every standalone brand
 * treated as its own singleton manufacturer (so e.g. NIO, Li Auto still appear as a pickable
 * top-level entry). Brands (and therefore manufacturers) with zero models in `qualifyingModels`
 * are dropped entirely, so the picker only ever offers a path down to a price-confirmed model.
 */
function buildManufacturers(
  brands: IBrand[],
  qualifyingModels: PopulatedModel[],
): Manufacturer[] {
  const brandIdsWithQualifyingModel = new Set(
    qualifyingModels.map((m) => m.brand_id?._id).filter(Boolean),
  );
  const { groups, standalone } = groupBrands(brands);
  const manufacturers: Manufacturer[] = [
    ...groups
      .map((g) => ({
        key: g.key,
        label: g.label,
        brands: g.brands.filter((b) => brandIdsWithQualifyingModel.has(b._id)),
      }))
      .filter((g) => g.brands.length > 0),
    ...standalone
      .filter((b) => brandIdsWithQualifyingModel.has(b._id))
      .map((b) => ({ key: b._id ?? b.name, label: b.name, brands: [b] })),
  ];
  manufacturers.sort((a, b) => a.label.localeCompare(b.label));
  return manufacturers;
}

function ManufacturerBrandModelPicker({
  label,
  manufacturers,
  models,
  value,
  onChange,
}: {
  label: string;
  manufacturers: Manufacturer[];
  models: PopulatedModel[];
  value: string;
  onChange: (id: string) => void;
}) {
  const selectedModel = models.find((m) => m._id === value);

  // Step 1/2 are "derived" from the selected model (e.g. on initial load
  // from a shared ?a=/?b= URL, so the picker opens already scoped to the
  // right manufacturer/brand) UNLESS the user has explicitly started a new
  // drill-down that hasn't produced a model selection yet — tracked here
  // instead of an effect, since it's the user's in-progress choice, not a
  // value mirrored from props.
  const [manualManufacturerKey, setManualManufacturerKey] = useState<
    string | null
  >(null);
  const [manualBrandId, setManualBrandId] = useState<string | null>(null);

  const derivedManufacturerKey = useMemo(() => {
    if (!selectedModel?.brand_id) return "";
    const m = manufacturers.find((man) =>
      man.brands.some((b) => b._id === selectedModel.brand_id._id),
    );
    return m?.key ?? "";
  }, [selectedModel, manufacturers]);

  const manufacturerKey = manualManufacturerKey ?? derivedManufacturerKey;
  const brandId = manualBrandId ?? selectedModel?.brand_id?._id ?? "";

  const manufacturer = manufacturers.find((m) => m.key === manufacturerKey);
  const brand = manufacturer?.brands.find((b) => b._id === brandId);
  const brandModels = brand
    ? models
        .filter((m) => m.brand_id?._id === brand._id)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const selectClass =
    "border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm w-full";

  return (
    <div className="flex-1">
      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
        {label}
      </label>
      <div className="flex flex-col gap-2">
        <select
          className={selectClass}
          value={manufacturerKey}
          onChange={(e) => {
            setManualManufacturerKey(e.target.value);
            setManualBrandId("");
            onChange("");
          }}
        >
          <option value="">Manufacturer…</option>
          {manufacturers.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={brandId}
          disabled={!manufacturer}
          onChange={(e) => {
            setManualBrandId(e.target.value);
            onChange("");
          }}
        >
          <option value="">Brand…</option>
          {manufacturer?.brands.map((b) => (
            <option key={b._id} value={b._id}>
              {b.name}
            </option>
          ))}
        </select>

        <select
          className={selectClass}
          value={value}
          disabled={!brand}
          onChange={(e) => {
            setManualManufacturerKey(null);
            setManualBrandId(null);
            onChange(e.target.value);
          }}
        >
          <option value="">Model…</option>
          {brandModels.map((m) => (
            <option key={m._id} value={m._id}>
              {m.name}
              {m.generation ? ` (${m.generation})` : ""}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Per-model trim selector, shown once a model is picked. Options are the
 * model's DISTINCT SPEC GROUPS (see lib/specGrouping.ts), not one row per
 * raw Powertrain doc — a model with a dozen model-year/badge re-releases
 * that are mechanically identical collapses to a handful of real choices,
 * same simplification as the model detail page's spec-group summary. Each
 * option's value is one representative trim's _id from that group (any
 * member would render identical spec data, by construction of the group).
 */
function TrimPicker({
  label,
  powertrains,
  value,
  onChange,
}: {
  label: string;
  powertrains: PopulatedPowertrain[];
  value: string;
  onChange: (trimId: string) => void;
}) {
  const groups = useMemo(() => groupBySpec(powertrains), [powertrains]);
  if (groups.length === 0) return null;

  const selectClass =
    "border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm w-full overflow-hidden text-ellipsis whitespace-nowrap";

  return (
    <div className="flex-1">
      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
        {label}
      </label>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g) => {
          const repId = g.trims[0]._id as string;
          // Always the same shape — compact canonical fields, never a raw
          // trim_name — so a single trim and a multi-trim group render as
          // visually comparable options instead of two different styles.
          const spec = compactSpecLabel(g.trims[0]);
          const optionLabel = g.trims.length > 1 ? `${g.trims.length} trims · ${spec}` : spec;
          return (
            <option key={repId} value={repId} title={optionLabel}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function CompareInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [allModels, setAllModels] = useState<PopulatedModel[]>([]);
  const [allPowertrains, setAllPowertrains] = useState<PopulatedPowertrain[]>(
    [],
  );
  const [allBrands, setAllBrands] = useState<IBrand[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const idA = searchParams.get("a") ?? "";
  const idB = searchParams.get("b") ?? "";
  const trimIdAParam = searchParams.get("ta") ?? "";
  const trimIdBParam = searchParams.get("tb") ?? "";

  // Only the two dropdown pickers need data up front — powertrains (the
  // heaviest of the three, and double-populated: model_id -> brand_id) are
  // fetched separately, per selected model, below. Fetching all ~200
  // powertrains unconditionally on every page load was needless weight on a
  // slow connection for a page that starts with nothing selected.
  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([
      fetch("/api/models").then((r) => r.json()),
      fetch("/api/brands").then((r) => r.json()),
    ])
      .then(([models, brands]) => {
        if (cancelled) return;
        setAllModels(models);
        setAllBrands(brands);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // A dropped/failed request on a flaky connection used to leave this
        // page stuck on "Loading…" forever with no way to recover short of
        // a hard refresh — surface it and let the user retry instead.
        console.error("Compare page data load failed:", err);
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  // Fetch trims for whichever side(s) have a model selected, merging into
  // the existing set (never dropping the other side's already-fetched
  // trims) and skipping a re-fetch for a model already present.
  useEffect(() => {
    const idsToFetch = [idA, idB].filter(
      (id) => id && !allPowertrains.some((p) => p.model_id?._id === id),
    );
    if (idsToFetch.length === 0) return;
    let cancelled = false;
    Promise.all(
      idsToFetch.map((id) =>
        fetch(`/api/powertrains?model_id=${id}`).then((r) => r.json()),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const fetched: PopulatedPowertrain[] = results.flat();
        setAllPowertrains((prev) => [
          ...prev,
          ...fetched.filter((p) => !prev.some((existing) => existing._id === p._id)),
        ]);
      })
      .catch((err) => {
        console.error("Compare page trim load failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [idA, idB, allPowertrains]);

  /** Model change clears that side's trim selection ("ta"/"tb") too — a trim id from the old model doesn't mean anything once the model changes, and leaving a stale one in the URL would silently apply to whatever model replaces it. */
  const setModelSelection = (which: "a" | "b", id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set(which, id);
    else params.delete(which);
    params.delete(which === "a" ? "ta" : "tb");
    router.replace(`/compare?${params.toString()}`);
  };

  const setTrimSelection = (which: "a" | "b", trimId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const key = which === "a" ? "ta" : "tb";
    if (trimId) params.set(key, trimId);
    else params.delete(key);
    router.replace(`/compare?${params.toString()}`);
  };

  /** Only models with a confirmed Morocco price are pickable — comparing anything else means at least one side is guesswork. */
  const priceConfirmedModels = useMemo(
    () =>
      allModels.filter((m) => m.morocco_price_confirmed && m.morocco_price_dh),
    [allModels],
  );

  const manufacturers = useMemo(
    () => buildManufacturers(allBrands, priceConfirmedModels),
    [allBrands, priceConfirmedModels],
  );

  const modelA = allModels.find((m) => m._id === idA);
  const modelB = allModels.find((m) => m._id === idB);

  const trimsA = idA ? powertrainsForModel(idA, allPowertrains) : [];
  const trimsB = idB ? powertrainsForModel(idB, allPowertrains) : [];

  // Visible default: the first distinct spec group's representative trim —
  // shown (and changeable) in the TrimPicker below, not a hidden choice.
  // Falls back to this whenever the URL doesn't name a trim, or names one
  // that no longer belongs to the currently-selected model.
  const defaultTrimIdA = groupBySpec(trimsA)[0]?.trims[0]._id as string | undefined;
  const defaultTrimIdB = groupBySpec(trimsB)[0]?.trims[0]._id as string | undefined;

  const trimIdA = trimsA.some((p) => p._id === trimIdAParam) ? trimIdAParam : defaultTrimIdA;
  const trimIdB = trimsB.some((p) => p._id === trimIdBParam) ? trimIdBParam : defaultTrimIdB;

  const ptA = allPowertrains.find((p) => p._id === trimIdA);
  const ptB = allPowertrains.find((p) => p._id === trimIdB);

  const showTable = modelA && modelB;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Compare Models</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-4">
        Pick any two models to see their full specs side by side. Rows with a
        meaningful difference are highlighted.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <ManufacturerBrandModelPicker
          label="Model A"
          manufacturers={manufacturers}
          models={priceConfirmedModels}
          value={idA}
          onChange={(id) => setModelSelection("a", id)}
        />
        <ManufacturerBrandModelPicker
          label="Model B"
          manufacturers={manufacturers}
          models={priceConfirmedModels}
          value={idB}
          onChange={(id) => setModelSelection("b", id)}
        />
      </div>

      {(modelA || modelB) && (
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {modelA ? (
            <TrimPicker
              label="Trim A"
              powertrains={trimsA}
              value={trimIdA ?? ""}
              onChange={(id) => setTrimSelection("a", id)}
            />
          ) : (
            <div className="flex-1" />
          )}
          {modelB ? (
            <TrimPicker
              label="Trim B"
              powertrains={trimsB}
              value={trimIdB ?? ""}
              onChange={(id) => setTrimSelection("b", id)}
            />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      )}

      {loadError ? (
        <div className="text-zinc-500 dark:text-zinc-400">
          <p>Couldn&apos;t load model data — check your connection.</p>
          <button
            onClick={() => setRetryCount((n) => n + 1)}
            className="mt-2 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      ) : !loaded ? (
        <p className="text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : !showTable ? (
        <p className="text-zinc-500 dark:text-zinc-400">
          Select two models to compare.
        </p>
      ) : (
        <>
          <PriceComparison modelA={modelA!} modelB={modelB!} />
          <div className="overflow-x-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="p-3 text-left text-zinc-500 dark:text-zinc-400 font-medium">
                    Spec
                  </th>
                  <th className="p-3 text-left">
                    {modelLabel(modelA!)}
                    {ptA?.trim_name && (
                      <div className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{ptA.trim_name}</div>
                    )}
                  </th>
                  <th className="p-3 text-left">
                    {modelLabel(modelB!)}
                    {ptB?.trim_name && (
                      <div className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{ptB.trim_name}</div>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const valA = row.get(modelA, ptA);
                  const valB = row.get(modelB, ptB);
                  if (row.hideIfBothEmpty && valA === "N/A" && valB === "N/A") return null;
                  const isDiff = row.diff?.(valA, valB) ?? false;
                  return (
                    <tr
                      key={row.label}
                      className={`border-b border-zinc-100 dark:border-zinc-800 ${
                        isDiff ? "bg-amber-50 dark:bg-amber-950/30" : ""
                      }`}
                    >
                      <td className="p-3 font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {row.label}
                      </td>
                      <td className="p-3">{valA}</td>
                      <td className="p-3">{valB}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={<p className="text-zinc-500 dark:text-zinc-400">Loading…</p>}
    >
      <CompareInner />
    </Suspense>
  );
}
