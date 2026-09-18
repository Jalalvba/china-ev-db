"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { IBrand, IModel, IPowertrain } from "@/types";
import { hpToKw, kwToHp } from "@/lib/units";
import { bestMatchScores } from "@/lib/bestMatchScore";
import { formatChinaPriceUsd, formatTrimPrice } from "@/lib/priceDisplay";
import { compactSpecLabel } from "@/lib/specGrouping";
import { SegmentLabel } from "@/lib/segmentDisplay";
import type { Segment } from "@/types";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };
type PopulatedPowertrain = Omit<IPowertrain, "model_id"> & { model_id: PopulatedModel };

// DB is scoped to PHEV SUVs only (2026-09-18) — options below are pruned to what's
// actually present across the 252 remaining trims (verified live, not assumed):
// diesel/n/a fuel, supercharged/twin-charged aspiration, MT gearbox, HEV/Mild
// hybrid/Not applicable hybrid type, and "mild" hybrid architecture have zero
// matches now (all were ICE/HEV/MHEV-only trims, deleted in the same cleanup).
// Drive type (FWD/RWD/AWD/4WD) needed no pruning — all four are still live.
const FUEL_TYPES = ["gasoline"];
const ASPIRATIONS = ["turbo", "naturally-aspirated"];
const GEARBOX_TYPES = ["single-speed reducer", "CVT", "DCT", "AT", "AMT", "multi-speed EV transmission", "E-CVT"];
const DRIVE_TYPES = ["FWD", "RWD", "AWD", "4WD"];
// Hybrid type (PHEV vs EREV) dropdown removed 2026-09-18 — all 52 REEV/EREV
// trims were deleted that day (along with the 32 models whose only PHEV-family
// trim was REEV/EREV), leaving hybrid_type at a genuine 149/149 PHEV, zero
// exceptions — a true no-op filter, same bar energy_type was held to earlier.
const HYBRID_ARCHITECTURES = ["parallel", "power_split", "series_erev"];

// Displacement is a small, closed catalog rather than a min/max range like every
// other spec field here (2026-09-18 audit: at the time, only 4 real engine sizes
// existed across the PHEV-SUV-scoped DB — 22 other range-filter fields checked
// the same way all had 22-87 distinct values, genuinely continuous). The raw
// stored values include float-precision noise (1.498/1.499 alongside 1.5) for
// what's really one "1.5L" engine family — bucketed here so the UI shows a clean
// option while the API still matches every raw variant.
// 3.0L dropped 2026-09-18 (scope tightened to a 2.0L ceiling, Tank 700's 4
// oversized trims deleted); then the ceiling tightened again same day to 1.5L
// only — every >1.5L trim across the DB was deleted (confirmed 1.8L and 2.0L
// trims alike; a handful of WEY 05/Tank 500 trims with never-researched
// displacement were deliberately left alone rather than deleted for lack of
// proof — see CLAUDE.md's known-gaps note). 1.8L and 2.0L are both dead now —
// verified zero trims for either before removing their buttons, not assumed.
const DISPLACEMENT_BUCKETS: { label: string; values: number[] }[] = [{ label: "1.5L", values: [1.498, 1.499, 1.5] }];
// Same client-safe local copy pattern as app/search/page.tsx and
// app/compare/page.tsx — models/Model.ts pulls in mongoose, which must
// never end up in a client bundle.
// DB is scoped to PHEV SUVs only (2026-09-18) — only SUV segments have live data.
const SEGMENTS: Segment[] = ["SUV-compact", "SUV-mid", "SUV-full"];
const HYBRID_ARCHITECTURE_LABELS: Record<string, string> = {
  parallel: "Parallel",
  power_split: "Power-split",
  series_erev: "EREV",
  mild: "Mild hybrid",
};

type SortMode = "best_match" | "price" | "hp" | "range" | "battery";

interface Bound {
  min: number | null;
  max: number | null;
}
interface RangeBounds {
  enginePowerKw: Bound;
  motorPowerKw: Bound;
  combinedPowerKw: Bound;
  engineTorque: Bound;
  motorTorque: Bound;
  batteryKwh: Bound;
  evRangeKm: Bound;
  priceMinUsd: Bound;
  priceMaxUsd: Bound;
  moroccoDh: Bound;
}

/**
 * "<label> (94–194)" as an always-visible line above a Min/Max input pair —
 * not placeholder text, which truncates in these narrow inputs and disappears
 * the moment the field has a value typed into it. Falls back to the plain
 * label with no range while bounds haven't loaded yet or a field genuinely
 * has no data. kwToHpFn converts the bound to hp first, matching how these
 * power fields are entered (see the hp/kW conversion comment on runSearch
 * below).
 */
function rangeLabel(label: string, bound: Bound | undefined, kwToHpFn?: (kw: number | null | undefined) => number | undefined): string {
  if (!bound || bound.min == null || bound.max == null) return label;
  const min = kwToHpFn ? kwToHpFn(bound.min) : bound.min;
  const max = kwToHpFn ? kwToHpFn(bound.max) : bound.max;
  return `${label} (${min}–${max})`;
}

/**
 * Display-only fallback — shows the live bound in the input when the URL has
 * no value for this field, WITHOUT writing anything to the URL. `urlValue` (the
 * actual filter state hasAnyFilter/activeFilters/runSearch all key off) stays
 * whatever the URL says regardless of what's displayed here; typing overwrites
 * both. This is what keeps a pre-filled bound from silently registering as an
 * active filter the user never actually set — see the comment on
 * hasAnyFilter below for the other half of that guarantee.
 */
function displayValue(
  urlValue: string,
  which: "min" | "max",
  bound: Bound | undefined,
  kwToHpFn?: (kw: number | null | undefined) => number | undefined
): string {
  if (urlValue) return urlValue;
  if (!bound) return "";
  const raw = which === "min" ? bound.min : bound.max;
  if (raw == null) return "";
  const value = kwToHpFn ? kwToHpFn(raw) : raw;
  return value != null ? String(value) : "";
}

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

// Every filter field's URL query-string key, in one place so the read side
// (searchParams.get) and the write side (updateFilter) never drift apart.
const FILTER_KEYS = [
  "fuel_type",
  "aspiration",
  "gearbox",
  "drive",
  "hybrid_architecture",
  "segment",
  "min_engine_power",
  "max_engine_power",
  "min_motor_power",
  "max_motor_power",
  "min_engine_torque",
  "max_engine_torque",
  "min_motor_torque",
  "max_motor_torque",
  "displacement",
  "min_ev_range",
  "max_ev_range",
  "min_combined_power",
  "max_combined_power",
  "min_battery",
  "max_battery",
  "min_price_usd",
  "max_price_usd",
  "min_morocco_price",
  "max_morocco_price",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * Search by the exact fields compactSpecLabel() builds a trim's picker
 * label from (see lib/specGrouping.ts) — energy type, engine power/fuel/
 * aspiration, motor power, battery capacity, transmission — rather than by
 * model name/segment/price like the main /search page. Results are
 * individual trims (a model can appear more than once, once per matching
 * trim), each labeled the same compact way as the Compare page's trim
 * picker, so the same spec summary means the same thing everywhere in the
 * app.
 *
 * Every filter lives in the URL query string (not local component state) —
 * same "state lives in the URL" pattern as the Compare page — so browser
 * back/forward restores the exact filtered view instead of resetting to
 * empty, and the filtered view is bookmarkable/shareable as a side benefit.
 */
function SpecSearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const get = (key: FilterKey) => searchParams.get(key) ?? "";

  const fuelType = get("fuel_type");
  const aspiration = get("aspiration");
  const gearbox = get("gearbox");
  const driveType = get("drive");
  const hybridArchitecture = get("hybrid_architecture");
  const segmentParam = get("segment");
  const selectedSegments = segmentParam ? segmentParam.split(",") : [];

  function toggleSegment(value: string) {
    const next = selectedSegments.includes(value)
      ? selectedSegments.filter((s) => s !== value)
      : [...selectedSegments, value];
    updateFilter("segment", next.join(","));
  }
  const minEnginePower = get("min_engine_power");
  const maxEnginePower = get("max_engine_power");
  const minMotorPower = get("min_motor_power");
  const maxMotorPower = get("max_motor_power");
  const minEngineTorque = get("min_engine_torque");
  const maxEngineTorque = get("max_engine_torque");
  const minMotorTorque = get("min_motor_torque");
  const maxMotorTorque = get("max_motor_torque");
  const displacementParam = get("displacement");
  const validDisplacementLabels = new Set(DISPLACEMENT_BUCKETS.map((b) => b.label));
  const rawSelectedDisplacements = displacementParam ? displacementParam.split(",") : [];
  // Drops any value no longer offered as a button (e.g. "3.0L" after the ceiling
  // tightened and that bucket was removed) — never trust the URL to only ever
  // contain currently-valid values; a bookmarked/shared link or a leftover value
  // from before an option list changed could carry a stale one.
  const selectedDisplacements = rawSelectedDisplacements.filter((l) => validDisplacementLabels.has(l));
  const hasStaleDisplacement = rawSelectedDisplacements.length !== selectedDisplacements.length;

  // Rewrites the URL to drop the stale value(s) as soon as one is detected,
  // rather than leaving the invalid selection sitting in the URL/active-filters
  // summary indefinitely — same "don't leave a stale selected-but-invalid
  // state" rule the segment/hybrid-type option prunes were held to.
  useEffect(() => {
    if (hasStaleDisplacement) {
      const params = new URLSearchParams(searchParams.toString());
      if (selectedDisplacements.length > 0) params.set("displacement", selectedDisplacements.join(","));
      else params.delete("displacement");
      router.replace(`/search/specs?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStaleDisplacement]);

  function toggleDisplacement(label: string) {
    const next = selectedDisplacements.includes(label)
      ? selectedDisplacements.filter((l) => l !== label)
      : [...selectedDisplacements, label];
    updateFilter("displacement", next.join(","));
  }
  const minEvRange = get("min_ev_range");
  const maxEvRange = get("max_ev_range");
  const minCombinedPower = get("min_combined_power");
  const maxCombinedPower = get("max_combined_power");
  const minBattery = get("min_battery");
  const maxBattery = get("max_battery");
  const minPriceUsd = get("min_price_usd");
  const maxPriceUsd = get("max_price_usd");
  const minMoroccoPrice = get("min_morocco_price");
  const maxMoroccoPrice = get("max_morocco_price");

  // Cheapest-first is the app-wide default sort convention (see the
  // Listing-conventions rule in CLAUDE.md for the same "cheapest first"
  // posture on the homepage/brand pages) — Best Match is still available,
  // just not the default anymore. Sort mode and the Advanced-filters toggle
  // are view state, not filters, so they stay out of the URL.
  const sortByParam = searchParams.get("sort") as SortMode | null;
  const sortBy: SortMode = sortByParam ?? "price";
  const advancedOpen = searchParams.get("advanced") === "1";

  /** Single write path for every filter field — merges into whatever's already in the URL and replaces (not pushes) history, so typing across several filters doesn't pile up back-button stops. */
  function updateFilter(key: FilterKey, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/search/specs?${params.toString()}`);
  }

  function setSortBy(value: SortMode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", value);
    router.replace(`/search/specs?${params.toString()}`);
  }

  function setAdvancedOpen(value: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("advanced", "1");
    else params.delete("advanced");
    router.replace(`/search/specs?${params.toString()}`);
  }

  const [bounds, setBounds] = useState<RangeBounds | null>(null);

  // Fetched once on mount, from live data (see app/api/powertrains/bounds/route.ts's
  // comment on why this isn't computed at build time instead) — purely for
  // the range labels/pre-fill values below; a failed/slow fetch just leaves
  // the plain label in place; it never blocks or changes actual filtering.
  // Re-fetches whenever the segment selection changes, same trigger as the
  // results list itself — a SUV-compact-only bound is a different, smaller
  // range than the all-segments one, and should reflect that immediately.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (selectedSegments.length > 0) params.set("segment", selectedSegments.join(","));
    fetch(`/api/powertrains/bounds?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setBounds(data);
      })
      .catch(() => {
        // Deliberately silent — see comment above.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentParam]);

  const [rawResults, setRawResults] = useState<PopulatedPowertrain[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyFilter = Boolean(
    fuelType ||
      aspiration ||
      gearbox ||
      driveType ||
      hybridArchitecture ||
      selectedSegments.length > 0 ||
      minEnginePower ||
      maxEnginePower ||
      minMotorPower ||
      maxMotorPower ||
      minEngineTorque ||
      maxEngineTorque ||
      minMotorTorque ||
      maxMotorTorque ||
      selectedDisplacements.length > 0 ||
      minEvRange ||
      maxEvRange ||
      minCombinedPower ||
      maxCombinedPower ||
      minBattery ||
      maxBattery ||
      minPriceUsd ||
      maxPriceUsd ||
      minMoroccoPrice ||
      maxMoroccoPrice
  );

  /** Explicit confirmation of exactly which fields are constraining the search — an empty field is never silently treated as a real value (a blank select/number input never gets sent to the API at all, see runSearch below), but that's invisible without this: no visual difference otherwise between "this field is unset" and "I forgot what I set it to." */
  const activeFilters: string[] = [];
  if (fuelType) activeFilters.push(`Fuel type: ${fuelType}`);
  if (aspiration) activeFilters.push(`Aspiration: ${aspiration}`);
  if (gearbox) activeFilters.push(`Transmission: ${gearbox}`);
  if (driveType) activeFilters.push(`Drive type: ${driveType}`);
  if (hybridArchitecture) activeFilters.push(`Hybrid architecture: ${HYBRID_ARCHITECTURE_LABELS[hybridArchitecture] ?? hybridArchitecture}`);
  if (selectedSegments.length > 0) activeFilters.push(`Segment: ${selectedSegments.join(", ")}`);
  if (minEnginePower || maxEnginePower) activeFilters.push(`Engine power: ${minEnginePower || "0"}–${maxEnginePower || "∞"} hp`);
  if (minMotorPower || maxMotorPower) activeFilters.push(`Motor power: ${minMotorPower || "0"}–${maxMotorPower || "∞"} hp`);
  if (minEngineTorque || maxEngineTorque) activeFilters.push(`Engine torque: ${minEngineTorque || "0"}–${maxEngineTorque || "∞"} Nm`);
  if (minMotorTorque || maxMotorTorque) activeFilters.push(`Motor torque: ${minMotorTorque || "0"}–${maxMotorTorque || "∞"} Nm`);
  if (selectedDisplacements.length > 0) activeFilters.push(`Displacement: ${selectedDisplacements.join(", ")}`);
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
    // Every kept model is PHEV-SUV scoped (2026-09-18), but a model can still carry
    // a non-PHEV trim doc alongside its PHEV one (e.g. Soueast S06's ICE trim next to
    // its S06 DM/PHEV trim) — energy_type isn't a user-facing filter axis anymore, but
    // it must still be sent, fixed, so those non-PHEV trims never surface here.
    // "REEV/EREV" dropped from this fixed value 2026-09-18 — every REEV/EREV trim in
    // the DB was deleted that same day, so it's dead weight, not a live case to match.
    params.set("energy_type", "PHEV");
    if (fuelType) params.set("fuel_type", fuelType);
    if (aspiration) params.set("aspiration", aspiration);
    if (gearbox) params.set("gearbox", gearbox);
    if (driveType) params.set("drive", driveType);
    if (hybridArchitecture) params.set("hybrid_architecture", hybridArchitecture);
    if (selectedSegments.length > 0) params.set("segment", selectedSegments.join(","));
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
    if (selectedDisplacements.length > 0) {
      const rawValues = selectedDisplacements.flatMap(
        (label) => DISPLACEMENT_BUCKETS.find((b) => b.label === label)?.values ?? []
      );
      params.set("displacement_l", rawValues.join(","));
    }
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
      setRawResults(data);
    } catch (err) {
      setError((err as Error).message);
      setRawResults(null);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Auto-apply — every filter (primary or behind the Advanced toggle)
   * re-runs the search automatically, debounced 300ms after the last
   * change, so there's no explicit "Search" button to click for any filter
   * anymore. Clears results back to the empty state when every filter is
   * cleared, since nothing would otherwise re-trigger that now that there's
   * no button click left to notice the stale results on. Filter values now
   * come from the URL (see FILTER_KEYS above) rather than local state, but
   * the debounce/auto-apply behavior is otherwise unchanged.
   */
  useEffect(() => {
    if (!hasAnyFilter) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRawResults(null);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      runSearch();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fuelType,
    aspiration,
    gearbox,
    driveType,
    hybridArchitecture,
    segmentParam,
    minEnginePower,
    maxEnginePower,
    minMotorPower,
    maxMotorPower,
    minEngineTorque,
    maxEngineTorque,
    minMotorTorque,
    maxMotorTorque,
    displacementParam,
    minEvRange,
    maxEvRange,
    minCombinedPower,
    maxCombinedPower,
    minBattery,
    maxBattery,
    minPriceUsd,
    maxPriceUsd,
    minMoroccoPrice,
    maxMoroccoPrice,
  ]);

  /** Recomputed whenever `results` or `sortBy` changes — Best Match scores are always relative to the CURRENTLY FILTERED set (Part 5), never a fixed global range, so this can't be cached across a different search. */
  const sortedResults = useMemo(() => {
    if (!rawResults) return null;
    if (sortBy === "best_match") {
      const scores = bestMatchScores(rawResults);
      return rawResults
        .map((pt, i) => ({ pt, score: scores[i] }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.pt);
    }
    const copy = [...rawResults];
    if (sortBy === "price") {
      // USD, not raw CNY — CNY is never shown anywhere in the app (see
      // formatChinaPriceUsd), so sorting by it would rank trims by a
      // currency the user never even sees.
      copy.sort((a, b) => {
        const pa = a.model_id?.price_range?.min_usd;
        const pb = b.model_id?.price_range?.min_usd;
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pa - pb;
      });
    } else if (sortBy === "hp") {
      copy.sort((a, b) => {
        const ha = effectiveHp(a);
        const hb = effectiveHp(b);
        if (ha == null && hb == null) return 0;
        if (ha == null) return 1;
        if (hb == null) return -1;
        return ha - hb;
      });
    } else if (sortBy === "range") {
      copy.sort((a, b) => {
        const ra = effectiveRangeKm(a);
        const rb = effectiveRangeKm(b);
        if (ra == null && rb == null) return 0;
        if (ra == null) return 1;
        if (rb == null) return -1;
        return ra - rb;
      });
    } else if (sortBy === "battery") {
      copy.sort((a, b) => {
        const ba = a.battery?.capacity_total_kwh;
        const bb = b.battery?.capacity_total_kwh;
        if (ba == null && bb == null) return 0;
        if (ba == null) return 1;
        if (bb == null) return -1;
        return ba - bb;
      });
    }
    return copy;
  }, [rawResults, sortBy]);

  /**
   * Set of Powertrain _ids whose card needs a trim_name subtitle: two or
   * more results for the SAME Model rendering the exact same
   * compactSpecLabel() string. Without trim_name shown, those cards are
   * pixel-identical and read as a duplicate/bug rather than as two real,
   * different trims that happen to share identical canonical specs — this
   * is deliberately keyed off the rendered label (not raw spec fields) so
   * it stays in sync with whatever compactSpecLabel actually displays.
   */
  const ambiguousTrimIds = useMemo(() => {
    if (!sortedResults) return new Set<string>();
    const groups = new Map<string, string[]>();
    for (const pt of sortedResults) {
      const key = `${pt.model_id?._id}::${compactSpecLabel(pt)}`;
      const ids = groups.get(key) ?? [];
      ids.push(pt._id as string);
      groups.set(key, ids);
    }
    const ambiguous = new Set<string>();
    for (const ids of groups.values()) {
      if (ids.length > 1) ids.forEach((id) => ambiguous.add(id));
    }
    return ambiguous;
  }, [sortedResults]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Technical Spec Search</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-4">
        Search by engine, motor, battery, and transmission specs — not by name, brand, or price.
      </p>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-1">Segment</span>
        {SEGMENTS.map((t) => {
          const active = selectedSegments.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() => toggleSegment(t)}
              className={
                active
                  ? "px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm font-medium transition"
                  : "px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-medium hover:border-zinc-400 dark:hover:border-zinc-600 transition"
              }
            >
              {t}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-3 flex items-center gap-1"
        aria-expanded={advancedOpen}
      >
        Advanced filters {advancedOpen ? "▴" : "▾"}
      </button>

      {advancedOpen && (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <select className={selectClass} value={fuelType} onChange={(e) => updateFilter("fuel_type", e.target.value)}>
          <option value="">Fuel type…</option>
          {FUEL_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={aspiration} onChange={(e) => updateFilter("aspiration", e.target.value)}>
          <option value="">Aspiration…</option>
          {ASPIRATIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={gearbox} onChange={(e) => updateFilter("gearbox", e.target.value)}>
          <option value="">Transmission…</option>
          {GEARBOX_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className={selectClass} value={driveType} onChange={(e) => updateFilter("drive", e.target.value)}>
          <option value="">Drive type…</option>
          {DRIVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={hybridArchitecture}
          onChange={(e) => updateFilter("hybrid_architecture", e.target.value)}
        >
          <option value="">Hybrid architecture…</option>
          {HYBRID_ARCHITECTURES.map((t) => (
            <option key={t} value={t}>
              {HYBRID_ARCHITECTURE_LABELS[t]}
            </option>
          ))}
        </select>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Engine hp", bounds?.enginePowerKw, kwToHp)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minEnginePower, "min", bounds?.enginePowerKw, kwToHp)}
              onChange={(e) => updateFilter("min_engine_power", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxEnginePower, "max", bounds?.enginePowerKw, kwToHp)}
              onChange={(e) => updateFilter("max_engine_power", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Engine torque Nm", bounds?.engineTorque)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minEngineTorque, "min", bounds?.engineTorque)}
              onChange={(e) => updateFilter("min_engine_torque", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxEngineTorque, "max", bounds?.engineTorque)}
              onChange={(e) => updateFilter("max_engine_torque", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 mr-1">Displacement</span>
          {DISPLACEMENT_BUCKETS.map((b) => {
            const active = selectedDisplacements.includes(b.label);
            return (
              <button
                key={b.label}
                type="button"
                aria-pressed={active}
                onClick={() => toggleDisplacement(b.label)}
                className={
                  active
                    ? "px-2.5 py-1 rounded-md bg-indigo-600 text-white text-sm font-medium transition"
                    : "px-2.5 py-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-sm font-medium hover:border-zinc-400 dark:hover:border-zinc-600 transition"
                }
              >
                {b.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Motor hp", bounds?.motorPowerKw, kwToHp)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minMotorPower, "min", bounds?.motorPowerKw, kwToHp)}
              onChange={(e) => updateFilter("min_motor_power", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxMotorPower, "max", bounds?.motorPowerKw, kwToHp)}
              onChange={(e) => updateFilter("max_motor_power", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Motor torque Nm", bounds?.motorTorque)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minMotorTorque, "min", bounds?.motorTorque)}
              onChange={(e) => updateFilter("min_motor_torque", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxMotorTorque, "max", bounds?.motorTorque)}
              onChange={(e) => updateFilter("max_motor_torque", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Combined system hp", bounds?.combinedPowerKw, kwToHp)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minCombinedPower, "min", bounds?.combinedPowerKw, kwToHp)}
              onChange={(e) => updateFilter("min_combined_power", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxCombinedPower, "max", bounds?.combinedPowerKw, kwToHp)}
              onChange={(e) => updateFilter("max_combined_power", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Battery kWh", bounds?.batteryKwh)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minBattery, "min", bounds?.batteryKwh)}
              onChange={(e) => updateFilter("min_battery", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxBattery, "max", bounds?.batteryKwh)}
              onChange={(e) => updateFilter("max_battery", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("EV-only range km", bounds?.evRangeKm)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minEvRange, "min", bounds?.evRangeKm)}
              onChange={(e) => updateFilter("min_ev_range", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxEvRange, "max", bounds?.evRangeKm)}
              onChange={(e) => updateFilter("max_ev_range", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{`China price $ (${bounds?.priceMinUsd?.min ?? "?"}–${bounds?.priceMaxUsd?.max ?? "?"})`}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minPriceUsd, "min", bounds?.priceMinUsd)}
              onChange={(e) => updateFilter("min_price_usd", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxPriceUsd, "max", bounds?.priceMaxUsd)}
              onChange={(e) => updateFilter("max_price_usd", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mb-1">{rangeLabel("Morocco price DH", bounds?.moroccoDh)}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="Min"
              value={displayValue(minMoroccoPrice, "min", bounds?.moroccoDh)}
              onChange={(e) => updateFilter("min_morocco_price", e.target.value)}
              className={selectClass}
            />
            <span className="text-zinc-400 dark:text-zinc-500">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="Max"
              value={displayValue(maxMoroccoPrice, "max", bounds?.moroccoDh)}
              onChange={(e) => updateFilter("max_morocco_price", e.target.value)}
              className={selectClass}
            />
          </div>
        </div>
      </div>
      )}

      {activeFilters.length > 0 && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
          Filtering by: {activeFilters.join(" · ")}
          <span className="ml-1">— every other field above is unset and has no effect on results.</span>
        </p>
      )}

      {/* Results update automatically (debounced) as filters change above —
          no Search button. loading only shows a brief inline indicator. */}
      {loading && <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">Searching…</p>}
      {!hasAnyFilter && !loading && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-6">Set at least Segment or another filter above to see results.</p>
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
              const trimPriceLabel = formatTrimPrice(pt);

              return (
                <Link
                  key={pt._id}
                  href={`/models/${pt.model_id?._id}`}
                  className="block bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-sm transition"
                >
                  <h3 className="font-semibold">
                    {pt.model_id?.brand_id?.name} {pt.model_id?.name}
                  </h3>
                  {pt.model_id?.segment && (
                    <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-0.5">
                      <SegmentLabel model={pt.model_id} />
                    </p>
                  )}
                  <p
                    className={`text-sm text-zinc-500 dark:text-zinc-400 ${
                      ambiguousTrimIds.has(pt._id as string) && pt.trim_name ? "mb-0.5" : "mb-2"
                    }`}
                  >
                    {compactSpecLabel(pt)}
                  </p>
                  {ambiguousTrimIds.has(pt._id as string) && pt.trim_name && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2 italic">{pt.trim_name}</p>
                  )}

                  <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {chinaPriceUsdLabel ? (
                      <p>
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{chinaPriceUsdLabel}</span>
                      </p>
                    ) : (
                      <p className="italic">Price not available</p>
                    )}
                    {trimPriceLabel && (
                      <p>
                        This trim: <span className="font-medium text-zinc-800 dark:text-zinc-200">{trimPriceLabel}</span>
                      </p>
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

export default function SpecSearchPage() {
  return (
    <Suspense fallback={null}>
      <SpecSearchInner />
    </Suspense>
  );
}
