import { hpToKw } from "@/lib/units";

// Translates a Tech Search PAGE query string (/search/specs?segment=…&min_engine_power=…) into the /api/powertrains parameters the page itself
// sends (see runSearch in app/search/specs/page.tsx), so `/export?<same query string>` exports exactly the Tech Search result set. Power is
// entered in hp on the page and queried in kW. That page keeps its own inline copy of this mapping — if a filter is added there, add it here too.

// Same buckets as DISPLACEMENT_BUCKETS in app/search/specs/page.tsx (a client component, so it can't be imported).
const DISPLACEMENT_BUCKETS: Record<string, number[]> = { "1.5L": [1.498, 1.499, 1.5] };

const PASS_THROUGH = ["fuel_type", "aspiration", "gearbox", "drive", "hybrid_architecture", "segment", "min_ev_range", "max_ev_range", "min_battery", "max_battery", "min_price_usd", "max_price_usd", "min_engine_torque", "max_engine_torque", "min_motor_torque", "max_motor_torque"];
const RENAMED: Record<string, string> = { min_ev_range: "min_ev_range_km", max_ev_range: "max_ev_range_km", min_battery: "min_battery_kwh", max_battery: "max_battery_kwh", min_engine_torque: "min_engine_torque_nm", max_engine_torque: "max_engine_torque_nm", min_motor_torque: "min_motor_torque_nm", max_motor_torque: "max_motor_torque_nm" };
const HP_KEYS: Record<string, string> = { min_engine_power: "min_engine_power_kw", max_engine_power: "max_engine_power_kw", min_motor_power: "min_motor_power_kw", max_motor_power: "max_motor_power_kw", min_combined_power: "min_combined_system_power_kw", max_combined_power: "max_combined_system_power_kw" };

export interface TranslatedFilters { api: URLSearchParams; /** Human-readable "key = value" list of the filters that were applied, for the README sheet / page. */ described: string[]; /** Query keys that were present but not understood (reported, never silently dropped). */ ignored: string[] }

export function techSearchToApiParams(sp: URLSearchParams): TranslatedFilters {
  const api = new URLSearchParams();
  const described: string[] = [];
  const ignored: string[] = [];
  for (const [key, value] of sp.entries()) {
    if (!value) continue;
    if (PASS_THROUGH.includes(key)) { api.set(RENAMED[key] ?? key, value); described.push(`${key} = ${value}`); }
    else if (HP_KEYS[key]) { const kw = hpToKw(Number(value)); if (kw === undefined || Number.isNaN(kw)) ignored.push(key); else { api.set(HP_KEYS[key], String(kw)); described.push(`${key} = ${value} hp`); } }
    else if (key === "min_morocco_price") { api.set("min_morocco_price_dh", value); described.push(`${key} = ${value}`); }
    else if (key === "max_morocco_price") { api.set("max_morocco_price_dh", value); described.push(`${key} = ${value}`); }
    else if (key === "displacement") {
      const vals = value.split(",").flatMap((l) => DISPLACEMENT_BUCKETS[l] ?? []);
      if (vals.length) { api.set("displacement_l", vals.join(",")); described.push(`displacement = ${value}`); } else ignored.push(`${key}=${value}`);
    } else if (!["sort", "advanced", "all"].includes(key)) ignored.push(key); // sort/advanced are Tech Search view state, not filters
  }
  // Tech Search always pins energy_type to PHEV when any filter is active — mirror that so the export matches it.
  if (described.length > 0) api.set("energy_type", "PHEV");
  return { api, described, ignored };
}
