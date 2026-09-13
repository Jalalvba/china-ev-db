"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { IBrand, IModel, IPowertrain } from "@/types";
import { hpToKw, kwToHp } from "@/lib/units";
import { bestMatchScores } from "@/lib/bestMatchScore";
import { formatChinaPriceUsd } from "@/lib/priceDisplay";
import { compactSpecLabel } from "@/lib/specGrouping";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };
type PopulatedPowertrain = Omit<IPowertrain, "model_id"> & { model_id: PopulatedModel };

const ENERGY_TYPES = ["ICE", "HEV", "PHEV", "BEV", "REEV/EREV", "MHEV"];
const FUEL_TYPES = ["gasoline", "diesel", "n/a"];
const ASPIRATIONS = ["turbo", "naturally-aspirated", "supercharged", "twin-charged", "n/a"];
const GEARBOX_TYPES = ["single-speed reducer", "CVT", "DCT", "AT", "MT", "AMT", "multi-speed EV transmission", "E-CVT"];
const DRIVE_TYPES = ["FWD", "RWD", "AWD", "4WD"];
const HYBRID_TYPES = ["HEV", "PHEV", "EREV", "Mild hybrid", "Not applicable"];
const HYBRID_ARCHITECTURES = ["parallel", "power_split", "series_erev", "mild"];
const EMISSIONS_STANDARDS = ["Euro 5", "Euro 6", "Euro 6d", "China 5", "China 6"];
const HYBRID_ARCHITECTURE_LABELS: Record<string, string> = {
  parallel: "Parallel",
  power_split: "Power-split",
  series_erev: "EREV",
  mild: "Mild hybrid",
};

type SortMode = "best_match" | "price" | "hp" | "range" | "battery";

/** Manufacturer-published combined-system hp when available, else the ICE engine's or the motor's own hp — never a summed engine+motor figure (see combinedSystemHp's schema comment: that sum is mathematically wrong for parallel/power-split systems). Used for the "HP" sort and as the Best Match combinedHp input. */
function effectiveHp(pt: PopulatedPowertrain): number | undefined {
  if (pt.combined_system_power_kw != null) return kwToHp(pt.combined_system_power_kw);
  if (pt.engine?.power_kw != null) return kwToHp(pt.engine.power_kw);
  if (pt.motor?.power_kw != null) return kwToHp(pt.motor.power_kw);
  return undefined;
}

function effectiveRangeKm(pt: PopulatedPowertrain): number | undefined {
  return pt.battery?.ev_range_km ?? pt.combined_range_km ?? undefined;
}

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
  const [driveType, setDriveType] = useState("");
  const [hybridType, setHybridType] = useState("");
  const [hybridArchitecture, setHybridArchitecture] = useState("");
  const [emissionsStandard, setEmissionsStandard] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("best_match");
  const [minEnginePower, setMinEnginePower] = useState("");
  const [maxEnginePower, setMaxEnginePower] = useState("");
  const [minMotorPower, setMinMotorPower] = useState("");
  const [maxMotorPower, setMaxMotorPower] = useState("");
  const [minEngineTorque, setMinEngineTorque] = useState("");
  const [maxEngineTorque, setMaxEngineTorque] = useState("");
  const [minMotorTorque, setMinMotorTorque] = useState("");
  const [maxMotorTorque, setMaxMotorTorque] = useState("");
  const [minDisplacement, setMinDisplacement] = useState("");
  const [maxDisplacement, setMaxDisplacement] = useState("");
  const [minEvRange, setMinEvRange] = useState("");
  const [maxEvRange, setMaxEvRange] = useState("");
  const [minCombinedPower, setMinCombinedPower] = useState("");
  const [maxCombinedPower, setMaxCombinedPower] = useState("");
  const [minBattery, setMinBattery] = useState("");
  const [maxBattery, setMaxBattery] = useState("");
  const [minPriceUsd, setMinPriceUsd] = useState("");
  const [maxPriceUsd, setMaxPriceUsd] = useState("");
  const [minMoroccoPrice, setMinMoroccoPrice] = useState("");
  const [maxMoroccoPrice, setMaxMoroccoPrice] = useState("");

  const [results, setResults] = useState<PopulatedPowertrain[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyFilter =
    energyType ||
    fuelType ||
    aspiration ||
    gearbox ||
    driveType ||
    hybridType ||
    hybridArchitecture ||
    emissionsStandard ||
    minEnginePower ||
    maxEnginePower ||
    minMotorPower ||
    maxMotorPower ||
    minEngineTorque ||
    maxEngineTorque ||
    minMotorTorque ||
    maxMotorTorque ||
    minDisplacement ||
    maxDisplacement ||
    minEvRange ||
    maxEvRange ||
    minCombinedPower ||
    maxCombinedPower ||
    minBattery ||
    maxBattery ||
    minPriceUsd ||
    maxPriceUsd ||
    minMoroccoPrice ||
    maxMoroccoPrice;

  /** Explicit confirmation of exactly which fields are constraining the search — an empty field is never silently treated as a real value (a blank select/number input never gets sent to the API at all, see runSearch below), but that's invisible without this: no visual difference otherwise between "this field is unset" and "I forgot what I set it to." */
  const activeFilters: string[] = [];
  if (energyType) activeFilters.push(`Energy type: ${energyType}`);
  if (fuelType) activeFilters.push(`Fuel type: ${fuelType}`);
  if (aspiration) activeFilters.push(`Aspiration: ${aspiration}`);
  if (gearbox) activeFilters.push(`Transmission: ${gearbox}`);
  if (driveType) activeFilters.push(`Drive type: ${driveType}`);
  if (hybridType) activeFilters.push(`Hybrid type: ${hybridType}`);
  if (hybridArchitecture) activeFilters.push(`Hybrid architecture: ${HYBRID_ARCHITECTURE_LABELS[hybridArchitecture] ?? hybridArchitecture}`);
  if (emissionsStandard) activeFilters.push(`Emissions standard: ${emissionsStandard}`);
  if (minEnginePower || maxEnginePower) activeFilters.push(`Engine power: ${minEnginePower || "0"}–${maxEnginePower || "∞"} hp`);
  if (minMotorPower || maxMotorPower) activeFilters.push(`Motor power: ${minMotorPower || "0"}–${maxMotorPower || "∞"} hp`);
  if (minEngineTorque || maxEngineTorque) activeFilters.push(`Engine torque: ${minEngineTorque || "0"}–${maxEngineTorque || "∞"} Nm`);
  if (minMotorTorque || maxMotorTorque) activeFilters.push(`Motor torque: ${minMotorTorque || "0"}–${maxMotorTorque || "∞"} Nm`);
  if (minDisplacement || maxDisplacement) activeFilters.push(`Displacement: ${minDisplacement || "0"}–${maxDisplacement || "∞"} L`);
  if (minEvRange || maxEvRange) activeFilters.push(`Electric-only range: ${minEvRange || "0"}–${maxEvRange || "∞"} km`);
  if (minCombinedPower || maxCombinedPower)
    activeFilters.push(`Combined system power: ${minCombinedPower || "0"}–${maxCombinedPower || "∞"} hp (hybrid only)`);
  if (minBattery || maxBattery) activeFilters.push(`Battery: ${minBattery || "0"}–${maxBattery || "∞"} kWh`);
  if (minPriceUsd || maxPriceUsd) activeFilters.push(`China price: $${minPriceUsd || "0"}–$${maxPriceUsd || "∞"}`);
  if (minMoroccoPrice || maxMoroccoPrice)
    activeFilters.push(`Morocco price: ${minMoroccoPrice || "0"}–${maxMoroccoPrice || "∞"} DH`);

  async function runSearch() {
    if (!hasAnyFilter) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (energyType) params.set("energy_type", energyType);
    if (fuelType) params.set("fuel_type", fuelType);
    if (aspiration) params.set("aspiration", aspiration);
    if (gearbox) params.set("gearbox", gearbox);
    if (driveType) params.set("drive", driveType);
    if (hybridType) params.set("hybrid_type", hybridType);
    if (hybridArchitecture) params.set("hybrid_architecture", hybridArchitecture);
    if (emissionsStandard) params.set("emissions_standard", emissionsStandard);
    // Power (engine/motor/combined-system) is entered in hp (matching how
    // it's displayed everywhere else in the app — see lib/units.ts) but
    // stored/queried in kW, so it's converted here rather than asking the
    // API to know about hp. Torque, displacement, and range are already in
    // the same units the DB stores them in (Nm, L, km) — no conversion.
    if (minEnginePower) params.set("min_engine_power_kw", String(hpToKw(Number(minEnginePower))));
    if (maxEnginePower) params.set("max_engine_power_kw", String(hpToKw(Number(maxEnginePower))));
    if (minMotorPower) params.set("min_motor_power_kw", String(hpToKw(Number(minMotorPower))));
    if (maxMotorPower) params.set("max_motor_power_kw", String(hpToKw(Number(maxMotorPower))));
    if (minCombinedPower) params.set("min_combined_system_power_kw", String(hpToKw(Number(minCombinedPower))));
    if (maxCombinedPower) params.set("max_combined_system_power_kw", String(hpToKw(Number(maxCombinedPower))));
    if (minEngineTorque) params.set("min_engine_torque_nm", minEngineTorque);
    if (maxEngineTorque) params.set("max_engine_torque_nm", maxEngineTorque);
    if (minMotorTorque) params.set("min_motor_torque_nm", minMotorTorque);
    if (maxMotorTorque) params.set("max_motor_torque_nm", maxMotorTorque);
    if (minDisplacement) params.set("min_displacement_l", minDisplacement);
    if (maxDisplacement) params.set("max_displacement_l", maxDisplacement);
    if (minEvRange) params.set("min_ev_range_km", minEvRange);
    if (maxEvRange) params.set("max_ev_range_km", maxEvRange);
    if (minBattery) params.set("min_battery_kwh", minBattery);
    if (maxBattery) params.set("max_battery_kwh", maxBattery);
    if (minPriceUsd) params.set("min_price_usd", minPriceUsd);
    if (maxPriceUsd) params.set("max_price_usd", maxPriceUsd);
    if (minMoroccoPrice) params.set("min_morocco_price_dh", minMoroccoPrice);
    if (maxMoroccoPrice) params.set("max_morocco_price_dh", maxMoroccoPrice);

    try {
      const res = await fetch(`/api/powertrains?${params.toString()}`);
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const data = await res.json();
      // A fresh search always defaults back to Best Match — the previous
      // sort choice was scoped to the previous result set.
      setSortBy("best_match");
      setResults(data);
    } catch (err) {
      setError((err as Error).message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  /** Recomputed whenever `results` or `sortBy` changes — Best Match scores are always relative to the CURRENTLY FILTERED set (Part 5), never a fixed global range, so this can't be cached across a different search. */
  const sortedResults = useMemo(() => {
    if (!results) return null;
    if (sortBy === "best_match") {
      const scores = bestMatchScores(results);
      return results
        .map((pt, i) => ({ pt, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.pt);
    }
    const copy = [...results];
    if (sortBy === "price") {
      copy.sort((a, b) => {
        const pa = a.model_id?.price_range?.min;
        const pb = b.model_id?.price_range?.min;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pa - pb;
      });
    } else if (sortBy === "hp") {
      copy.sort((a, b) => (effectiveHp(b) ?? -1) - (effectiveHp(a) ?? -1));
    } else if (sortBy === "range") {
      copy.sort((a, b) => (effectiveRangeKm(b) ?? -1) - (effectiveRangeKm(a) ?? -1));
    } else if (sortBy === "battery") {
      copy.sort((a, b) => (b.battery?.capacity_total_kwh ?? -1) - (a.battery?.capacity_total_kwh ?? -1));
    }
    return copy;
  }, [results, sortBy]);

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
        <select className={selectClass} value={driveType} onChange={(e) => setDriveType(e.target.value)}>
          <option value="">Drive type…</option>
          {DRIVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={hybridType} onChange={(e) => setHybridType(e.target.value)}>
          <option value="">Hybrid type…</option>
          {HYBRID_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={hybridArchitecture} onChange={(e) => setHybridArchitecture(e.target.value)}>
          <option value="">Hybrid architecture…</option>
          {HYBRID_ARCHITECTURES.map((t) => (
            <option key={t} value={t}>
              {HYBRID_ARCHITECTURE_LABELS[t]}
            </option>
          ))}
        </select>
        <select className={selectClass} value={emissionsStandard} onChange={(e) => setEmissionsStandard(e.target.value)}>
          <option value="">Emissions standard…</option>
          {EMISSIONS_STANDARDS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min engine hp"
            value={minEnginePower}
            onChange={(e) => setMinEnginePower(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max engine hp"
            value={maxEnginePower}
            onChange={(e) => setMaxEnginePower(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min engine torque Nm"
            value={minEngineTorque}
            onChange={(e) => setMinEngineTorque(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max engine torque Nm"
            value={maxEngineTorque}
            onChange={(e) => setMaxEngineTorque(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            step="0.1"
            placeholder="Min displacement L"
            value={minDisplacement}
            onChange={(e) => setMinDisplacement(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            step="0.1"
            placeholder="Max displacement L"
            value={maxDisplacement}
            onChange={(e) => setMaxDisplacement(e.target.value)}
            className={selectClass}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min motor hp"
            value={minMotorPower}
            onChange={(e) => setMinMotorPower(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max motor hp"
            value={maxMotorPower}
            onChange={(e) => setMaxMotorPower(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min motor torque Nm"
            value={minMotorTorque}
            onChange={(e) => setMinMotorTorque(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max motor torque Nm"
            value={maxMotorTorque}
            onChange={(e) => setMaxMotorTorque(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min combined system hp"
            value={minCombinedPower}
            onChange={(e) => setMinCombinedPower(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max combined system hp"
            value={maxCombinedPower}
            onChange={(e) => setMaxCombinedPower(e.target.value)}
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
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min EV-only range km"
            value={minEvRange}
            onChange={(e) => setMinEvRange(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max EV-only range km"
            value={maxEvRange}
            onChange={(e) => setMaxEvRange(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min China price $"
            value={minPriceUsd}
            onChange={(e) => setMinPriceUsd(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max China price $"
            value={maxPriceUsd}
            onChange={(e) => setMaxPriceUsd(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min Morocco price DH"
            value={minMoroccoPrice}
            onChange={(e) => setMinMoroccoPrice(e.target.value)}
            className={selectClass}
          />
          <span className="text-zinc-400 dark:text-zinc-500">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max Morocco price DH"
            value={maxMoroccoPrice}
            onChange={(e) => setMaxMoroccoPrice(e.target.value)}
            className={selectClass}
          />
        </div>
      </div>

      {activeFilters.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
          Filtering by: {activeFilters.join(" · ")}
          <span className="ml-1">— every other field above is unset and has no effect on results.</span>
        </p>
      )}

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

      {sortedResults !== null && (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{sortedResults.length} trim(s) match.</p>
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              Sort by
              <select
                className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded px-2 py-1 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortMode)}
              >
                <option value="best_match">Best match</option>
                <option value="price">Price</option>
                <option value="hp">HP</option>
                <option value="range">Range</option>
                <option value="battery">Battery</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedResults.map((pt) => {
              const priceRange = pt.model_id?.price_range;
              const chinaPriceUsdLabel = formatChinaPriceUsd(priceRange);

              return (
                <Link
                  key={pt._id}
                  href={`/models/${pt.model_id?._id}`}
                  className="block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm transition"
                >
                  <h3 className="font-semibold">
                    {pt.model_id?.brand_id?.name} {pt.model_id?.name}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{pt.trim_name}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-500 mb-2">{compactSpecLabel(pt)}</p>

                  <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {chinaPriceUsdLabel ? (
                      <p>
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{chinaPriceUsdLabel}</span>
                      </p>
                    ) : (
                      <p className="italic">Price not available</p>
                    )}
                    {pt.model_id?.morocco_price_dh != null && (
                      <p>
                        🇲🇦 {pt.model_id.morocco_price_dh.toLocaleString()} DH
                        {!pt.model_id.morocco_price_confirmed && " (unconfirmed)"}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
