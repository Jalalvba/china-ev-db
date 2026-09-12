"use client";

import { useEffect, useState } from "react";
import type { IBrand, IModel, IPowertrain } from "@/types";
import { kwToHp } from "@/lib/units";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };
type PopulatedPowertrain = Omit<IPowertrain, "model_id"> & { model_id: PopulatedModel };

function specLabel(pt: PopulatedPowertrain) {
  const model = pt.model_id;
  return `${model.brand_id?.name} ${model.name} — ${pt.trim_name}`;
}

export default function ComparePage() {
  const [allPowertrains, setAllPowertrains] = useState<PopulatedPowertrain[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/powertrains")
      .then((r) => r.json())
      .then(setAllPowertrains);
  }, []);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const selected = allPowertrains.filter((p) => p._id && selectedIds.includes(p._id));
  const filteredOptions = allPowertrains.filter((p) =>
    specLabel(p).toLowerCase().includes(query.toLowerCase())
  );

  const rows: { label: string; get: (p: PowertrainOrEmpty) => string }[] = [
    { label: "Brand / Model", get: (p) => (p ? `${p.model_id.brand_id?.name} ${p.model_id.name}` : "") },
    { label: "Trim", get: (p) => p?.trim_name ?? "" },
    { label: "Energy Type", get: (p) => p?.energy_type ?? "" },
    { label: "Segment", get: (p) => p?.model_id.segment ?? "" },
    {
      label: "Engine",
      get: (p) =>
        p?.engine
          ? `${p.engine.displacement_l ?? "?"}L, ${kwToHp(p.engine.power_kw) ?? "?"} hp, ${p.engine.torque_nm ?? "?"} Nm`
          : "—",
    },
    {
      label: "Motor",
      get: (p) =>
        p?.motor
          ? `${p.motor.power_kw ?? "?"} kW, ${p.motor.torque_nm ?? "?"} Nm, ${p.motor.drive ?? "?"}`
          : "—",
    },
    {
      label: "Battery",
      get: (p) =>
        p?.battery
          ? `${p.battery.capacity_total_kwh ?? "?"} kWh ${p.battery.chemistry ?? ""}${
              p.battery.battery_variant ? ` (${p.battery.battery_variant})` : ""
            }`
          : "—",
    },
    {
      label: "Electric Range",
      get: (p) =>
        p?.battery?.ev_range_km
          ? `${p.battery.ev_range_km} km (${p.battery.ev_range_standard ?? "?"})`
          : "—",
    },
    { label: "Gearbox", get: (p) => p?.transmission?.type ?? "—" },
    { label: "Combined Range", get: (p) => (p?.combined_range_km ? `${p.combined_range_km} km` : "—") },
    { label: "0–100 km/h", get: (p) => (p?.performance?.accel_0_100_s ? `${p.performance.accel_0_100_s} s` : "—") },
    { label: "Top Speed", get: (p) => (p?.performance?.top_speed_kmh ? `${p.performance.top_speed_kmh} km/h` : "—") },
    { label: "Source", get: (p) => p?.source ?? "—" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Compare Powertrains</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-4">Select 2–4 model variants to compare side by side.</p>

      <input
        className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm w-full mb-3"
        placeholder="Search brand, model, or trim..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="max-h-48 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 mb-6 divide-y divide-zinc-100 dark:divide-zinc-800">
        {filteredOptions.map((p) => (
          <label
            key={p._id}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={!!p._id && selectedIds.includes(p._id)}
              onChange={() => p._id && toggle(p._id)}
              disabled={!selectedIds.includes(p._id ?? "") && selectedIds.length >= 4}
            />
            {specLabel(p)}
          </label>
        ))}
      </div>

      {selected.length < 2 ? (
        <p className="text-zinc-500 dark:text-zinc-400">Select at least 2 variants to compare.</p>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="p-3 font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{row.label}</td>
                  {selected.map((p) => (
                    <td key={p._id} className="p-3">
                      {row.get(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type PowertrainOrEmpty = PopulatedPowertrain | undefined;
