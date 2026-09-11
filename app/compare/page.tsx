"use client";

import { useEffect, useState } from "react";
import type { IBrand, IModel, IPowertrain } from "@/types";

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
        p?.engine_details
          ? `${p.engine_details.displacement_l ?? "?"}L, ${p.engine_details.max_power_hp ?? "?"} hp, ${p.engine_details.max_torque_nm ?? "?"} Nm`
          : "—",
    },
    {
      label: "Motor",
      get: (p) =>
        p?.electric_motor_details
          ? `${p.electric_motor_details.motor_power_kw ?? "?"} kW, ${p.electric_motor_details.motor_torque_nm ?? "?"} Nm, ${p.electric_motor_details.drive_type ?? "?"}`
          : "—",
    },
    {
      label: "Battery",
      get: (p) =>
        p?.battery_details
          ? `${p.battery_details.battery_capacity_total_kwh ?? "?"} kWh ${p.battery_details.battery_chemistry ?? ""}${
              p.battery_details.battery_variant ? ` (${p.battery_details.battery_variant})` : ""
            }`
          : "—",
    },
    {
      label: "Electric Range",
      get: (p) =>
        p?.battery_details?.electric_range_km
          ? `${p.battery_details.electric_range_km} km (${p.battery_details.range_standard ?? "?"})`
          : "—",
    },
    { label: "Gearbox", get: (p) => p?.gearbox ?? "—" },
    { label: "Combined Range", get: (p) => (p?.combined_range_km ? `${p.combined_range_km} km` : "—") },
    { label: "0–100 km/h", get: (p) => (p?.accel_0_100_kmh_s ? `${p.accel_0_100_kmh_s} s` : "—") },
    { label: "Top Speed", get: (p) => (p?.top_speed_kmh ? `${p.top_speed_kmh} km/h` : "—") },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Compare Powertrains</h1>
      <p className="text-zinc-600 mb-4">Select 2–4 model variants to compare side by side.</p>

      <input
        className="border rounded px-3 py-2 text-sm w-full mb-3"
        placeholder="Search brand, model, or trim..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="max-h-48 overflow-y-auto border border-zinc-200 rounded-lg bg-white mb-6 divide-y divide-zinc-100">
        {filteredOptions.map((p) => (
          <label key={p._id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 cursor-pointer">
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
        <p className="text-zinc-500">Select at least 2 variants to compare.</p>
      ) : (
        <div className="overflow-x-auto bg-white border border-zinc-200 rounded-lg">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-zinc-100">
                  <td className="p-3 font-medium text-zinc-600 whitespace-nowrap">{row.label}</td>
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
