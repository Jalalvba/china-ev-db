"use client";

import { useState } from "react";
import Link from "next/link";
import type { IBrand, IModel, IPowertrain } from "@/types";
import { compactSpecLabel } from "@/lib/specGrouping";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };
type PopulatedPowertrain = Omit<IPowertrain, "model_id"> & { model_id: PopulatedModel };

const ENERGY_TYPES = ["ICE", "HEV", "PHEV", "BEV", "REEV/EREV", "MHEV"];
const FUEL_TYPES = ["gasoline", "diesel", "n/a"];
const ASPIRATIONS = ["turbo", "naturally-aspirated", "supercharged", "twin-charged", "n/a"];
const GEARBOX_TYPES = ["single-speed reducer", "CVT", "DCT", "AT", "MT", "AMT", "multi-speed EV transmission"];

const selectClass =
  "border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-3 py-2 text-sm w-full";

/**
 * Search by the exact fields compactSpecLabel() builds a trim's picker
 * label from (see lib/specGrouping.ts) — energy type, engine power/fuel/
 * aspiration, motor power, battery capacity, transmission — rather than by
 * model name/segment/price like the main /search page. Results are
 * individual trims (a model can appear more than once, once per matching
 * trim), each labeled the same compact way as the Compare page's trim
 * picker, so the same spec summary means the same thing everywhere in the
 * app.
 */
export default function SpecSearchPage() {
  const [energyType, setEnergyType] = useState("");
  const [fuelType, setFuelType] = useState("");
  const [aspiration, setAspiration] = useState("");
  const [gearbox, setGearbox] = useState("");
  const [minEnginePower, setMinEnginePower] = useState("");
  const [maxEnginePower, setMaxEnginePower] = useState("");
  const [minMotorPower, setMinMotorPower] = useState("");
  const [maxMotorPower, setMaxMotorPower] = useState("");
  const [minBattery, setMinBattery] = useState("");
  const [maxBattery, setMaxBattery] = useState("");

  const [results, setResults] = useState<PopulatedPowertrain[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyFilter =
    energyType || fuelType || aspiration || gearbox || minEnginePower || maxEnginePower || minMotorPower || maxMotorPower || minBattery || maxBattery;

  async function runSearch() {
    if (!hasAnyFilter) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (energyType) params.set("energy_type", energyType);
    if (fuelType) params.set("fuel_type", fuelType);
    if (aspiration) params.set("aspiration", aspiration);
    if (gearbox) params.set("gearbox", gearbox);
    if (minEnginePower) params.set("min_engine_power_kw", minEnginePower);
    if (maxEnginePower) params.set("max_engine_power_kw", maxEnginePower);
    if (minMotorPower) params.set("min_motor_power_kw", minMotorPower);
    if (maxMotorPower) params.set("max_motor_power_kw", maxMotorPower);
    if (minBattery) params.set("min_battery_kwh", minBattery);
    if (maxBattery) params.set("max_battery_kwh", maxBattery);

    try {
      const res = await fetch(`/api/powertrains?${params.toString()}`);
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Technical Spec Search</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-4">
        Search by engine, motor, battery, and transmission specs — not by name, brand, or price.
      </p>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <select className={selectClass} value={energyType} onChange={(e) => setEnergyType(e.target.value)}>
          <option value="">Energy type…</option>
          {ENERGY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={fuelType} onChange={(e) => setFuelType(e.target.value)}>
          <option value="">Fuel type…</option>
          {FUEL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={aspiration} onChange={(e) => setAspiration(e.target.value)}>
          <option value="">Aspiration…</option>
          {ASPIRATIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={gearbox} onChange={(e) => setGearbox(e.target.value)}>
          <option value="">Transmission…</option>
          {GEARBOX_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min engine kW"
            value={minEnginePower}
            onChange={(e) => setMinEnginePower(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max engine kW"
            value={maxEnginePower}
            onChange={(e) => setMaxEnginePower(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min motor kW"
            value={minMotorPower}
            onChange={(e) => setMinMotorPower(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max motor kW"
            value={maxMotorPower}
            onChange={(e) => setMaxMotorPower(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min battery kWh"
            value={minBattery}
            onChange={(e) => setMinBattery(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max battery kWh"
            value={maxBattery}
            onChange={(e) => setMaxBattery(e.target.value)}
            className={selectClass}
          />
        </div>
      </div>

      <button
        onClick={runSearch}
        disabled={!hasAnyFilter || loading}
        className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed mb-6"
      >
        {loading ? "Searching…" : "Search"}
      </button>
      {!hasAnyFilter && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-4 mb-6">
          Set at least one filter above to search.
        </p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}

      {results !== null && (
        <>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
            {results.length} trim(s) match.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((pt) => (
              <Link
                key={pt._id}
                href={`/models/${pt.model_id?._id}`}
                className="block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm transition"
              >
                <h3 className="font-semibold">
                  {pt.model_id?.brand_id?.name} {pt.model_id?.name}
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{pt.trim_name}</p>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{compactSpecLabel(pt)}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
