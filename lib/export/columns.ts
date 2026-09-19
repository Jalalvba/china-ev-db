// Column mapping for the Excel export: human-readable headers, widths, number formats and the flattening of nested Model/Powertrain
// documents into one cell per column. Pure (no DB access) so it can be unit-checked and reused by the route and the sample script.
// Missing values are null -> a truly EMPTY cell (never "—" or 0), so Excel's SUM/AVERAGE/COUNT/pivots behave.

import { kwToHp } from "@/lib/units";

export type Cell = string | number | boolean | null;
export interface ColumnSpec<T> { header: string; width: number; /** Excel number format; omit for text. */ fmt?: string; get: (row: T) => Cell }

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- lean Mongoose docs, flattened field-by-field below

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const yn = (v: unknown): string | null => (v === true ? "Yes" : v === false ? "No" : null);
const hp = (kw: unknown): number | null => { const x = kwToHp(n(kw) ?? undefined); return x === undefined ? null : Math.round(x); };
/** Model names in the DB often repeat the brand ("Dongfeng Mage" under Dongfeng); the Brand column already carries it, so strip it for cleaner pivots. Never strips to empty. */
const modelLabel = (name: unknown, brand: string): string | null => {
  const m = s(name);
  if (!m) return null;
  const rest = m.slice(brand.length).trim();
  return brand && m.toLowerCase().startsWith(brand.toLowerCase() + " ") && rest ? rest : m;
};
const conf = (v: unknown): string | null => (v === "confirmed" ? "Confirmed" : v === "unconfirmed" ? "Unconfirmed" : null);

const INT = "#,##0";
const DEC1 = "#,##0.0";
const DEC2 = "#,##0.00";

export interface ModelRow { model: Rec; brandName: string; trimCount: number; /** Names of this model's exported trims. */ trimNames: string[] }
export interface TrimRow { trim: Rec; model: Rec; brandName: string }
export interface BrandRow { brand: Rec; modelCount: number; trimCount: number; cheapestMoroccoDh: number | null }

export const MODEL_COLUMNS: ColumnSpec<ModelRow>[] = [
  { header: "Brand", width: 16, get: (r) => r.brandName },
  { header: "Model", width: 22, get: (r) => modelLabel(r.model.name, r.brandName) },
  { header: "Chinese name", width: 16, get: (r) => s(r.model.name_cn) },
  { header: "Generation", width: 14, get: (r) => s(r.model.generation) },
  { header: "Model year", width: 11, get: (r) => n(r.model.year) },
  { header: "Segment", width: 14, get: (r) => s(r.model.segment) },
  { header: "Segment confidence", width: 18, get: (r) => s(r.model.segment_confidence) },
  { header: "Body type", width: 14, get: (r) => s(r.model.body_type) },
  { header: "Production status", width: 18, get: (r) => s(r.model.production_status) },
  { header: "Powertrain category", width: 19, get: (r) => s(r.model.powertrain_category) },
  { header: "China price min (local)", width: 20, fmt: INT, get: (r) => n(r.model.price_range?.min) },
  { header: "China price max (local)", width: 20, fmt: INT, get: (r) => n(r.model.price_range?.max) },
  { header: "Price currency", width: 14, get: (r) => s(r.model.price_range?.currency_local) },
  { header: "China price min (USD)", width: 20, fmt: INT, get: (r) => n(r.model.price_range?.min_usd) },
  { header: "China price max (USD)", width: 20, fmt: INT, get: (r) => n(r.model.price_range?.max_usd) },
  { header: "China price status", width: 18, get: (r) => (r.model.price_range ? (r.model.price_range.unverified ? "Unverified" : "Verified") : null) },
  { header: "Unverified reason", width: 30, get: (r) => s(r.model.price_range?.flag_reason) },
  { header: "Morocco price (DH)", width: 18, fmt: INT, get: (r) => n(r.model.morocco_price_dh) },
  { header: "Morocco price status", width: 20, get: (r) => (n(r.model.morocco_price_dh) === null ? null : r.model.morocco_price_confirmed ? "Confirmed" : "Unconfirmed") },
  { header: "Morocco price source", width: 20, get: (r) => s(r.model.morocco_price_source) },
  { header: "Morocco / China price ratio", width: 24, fmt: DEC2, get: (r) => n(r.model.morocco_to_china_price_ratio) },
  { header: "Trim count", width: 11, fmt: "0", get: (r) => r.trimCount },
  { header: "Trim names", width: 45, get: (r) => (r.trimNames.length ? r.trimNames.join("; ") : null) },
];

export const TRIM_COLUMNS: ColumnSpec<TrimRow>[] = [
  { header: "Brand", width: 16, get: (r) => r.brandName },
  { header: "Model", width: 22, get: (r) => modelLabel(r.model.name, r.brandName) },
  { header: "Trim name", width: 34, get: (r) => s(r.trim.trim_name) },
  { header: "Energy type", width: 12, get: (r) => s(r.trim.energy_type) },
  { header: "Hybrid type", width: 12, get: (r) => s(r.trim.hybrid_type) },
  { header: "Hybrid architecture", width: 18, get: (r) => s(r.trim.hybrid_architecture) },
  { header: "Hybrid system name", width: 20, get: (r) => s(r.trim.hybrid_system_name) },
  { header: "Engine displacement (L)", width: 22, fmt: DEC1, get: (r) => n(r.trim.engine?.displacement_l) },
  { header: "Engine cylinders", width: 16, fmt: "0", get: (r) => n(r.trim.engine?.cylinders) },
  { header: "Engine aspiration", width: 18, get: (r) => s(r.trim.engine?.aspiration) },
  { header: "Fuel type", width: 11, get: (r) => s(r.trim.engine?.fuel_type) },
  { header: "Range extender", width: 15, get: (r) => yn(r.trim.engine?.is_range_extender) },
  { header: "Engine power (kW)", width: 17, fmt: INT, get: (r) => n(r.trim.engine?.power_kw) },
  { header: "Engine power (hp)", width: 17, fmt: INT, get: (r) => hp(r.trim.engine?.power_kw) },
  { header: "Engine torque (Nm)", width: 18, fmt: INT, get: (r) => n(r.trim.engine?.torque_nm) },
  { header: "Motor type", width: 16, get: (r) => s(r.trim.motor?.type) },
  { header: "Motor count", width: 12, get: (r) => s(r.trim.motor?.count) },
  { header: "Drive", width: 9, get: (r) => s(r.trim.motor?.drive) },
  { header: "Motor power (kW)", width: 16, fmt: INT, get: (r) => n(r.trim.motor?.power_kw) },
  { header: "Motor power (hp)", width: 16, fmt: INT, get: (r) => hp(r.trim.motor?.power_kw) },
  { header: "Motor torque (Nm)", width: 17, fmt: INT, get: (r) => n(r.trim.motor?.torque_nm) },
  { header: "Combined system power (kW)", width: 26, fmt: INT, get: (r) => n(r.trim.combined_system_power_kw) },
  { header: "Combined system power (hp)", width: 26, fmt: INT, get: (r) => hp(r.trim.combined_system_power_kw) },
  { header: "Battery chemistry", width: 17, get: (r) => s(r.trim.battery?.chemistry) },
  { header: "Battery total (kWh)", width: 18, fmt: DEC2, get: (r) => n(r.trim.battery?.capacity_total_kwh) },
  { header: "Battery usable (kWh)", width: 19, fmt: DEC2, get: (r) => n(r.trim.battery?.capacity_usable_kwh) },
  { header: "Battery supplier", width: 18, get: (r) => s(r.trim.battery?.supplier) },
  { header: "DC charge (kW)", width: 14, fmt: INT, get: (r) => n(r.trim.battery?.dc_charge_kw) },
  { header: "AC charge (kW)", width: 14, fmt: DEC1, get: (r) => n(r.trim.battery?.ac_charge_kw) },
  { header: "EV range (km)", width: 13, fmt: INT, get: (r) => n(r.trim.battery?.ev_range_km) },
  { header: "EV range standard", width: 17, get: (r) => s(r.trim.battery?.ev_range_standard) },
  { header: "Combined range (km)", width: 19, fmt: INT, get: (r) => n(r.trim.combined_range_km) },
  { header: "Transmission type", width: 18, get: (r) => s(r.trim.transmission?.type) },
  { header: "Transmission speeds", width: 19, fmt: "0", get: (r) => n(r.trim.transmission?.speed_count) },
  { header: "0-100 km/h (s)", width: 14, fmt: DEC1, get: (r) => n(r.trim.performance?.accel_0_100_s) },
  { header: "Top speed (km/h)", width: 16, fmt: INT, get: (r) => n(r.trim.performance?.top_speed_kmh) },
  { header: "Liquid cooling", width: 14, get: (r) => yn(r.trim.thermal_management?.has_liquid_cooling) },
  { header: "Heat pump", width: 11, get: (r) => yn(r.trim.thermal_management?.has_heat_pump) },
  { header: "Cooling tier (0-4)", width: 17, fmt: "0", get: (r) => n(r.trim.thermal_management?.cooling_tier) },
  { header: "Morocco suitable", width: 16, get: (r) => yn(r.trim.thermal_management?.morocco_suitable) },
  { header: "Trim price min", width: 14, fmt: INT, get: (r) => n(r.trim.trim_price_min) },
  { header: "Trim price max", width: 14, fmt: INT, get: (r) => n(r.trim.trim_price_max) },
  { header: "Trim price currency", width: 18, get: (r) => s(r.trim.trim_price_currency) },
  { header: "Trim price min (USD)", width: 19, fmt: INT, get: (r) => n(r.trim.trim_price_min_usd) },
  { header: "Trim price max (USD)", width: 19, fmt: INT, get: (r) => n(r.trim.trim_price_max_usd) },
  { header: "Trim price confidence", width: 20, get: (r) => conf(r.trim.trim_price_confidence) },
  { header: "Engine confidence", width: 17, get: (r) => conf(r.trim.engine?.confidence) },
  { header: "Motor confidence", width: 16, get: (r) => conf(r.trim.motor?.confidence) },
  { header: "Battery confidence", width: 18, get: (r) => conf(r.trim.battery?.confidence) },
  { header: "Transmission confidence", width: 22, get: (r) => conf(r.trim.transmission?.confidence) },
  { header: "Performance confidence", width: 21, get: (r) => conf(r.trim.performance?.confidence) },
  { header: "Overall confidence", width: 18, get: (r) => conf(r.trim.confidence) },
  { header: "Source", width: 40, get: (r) => s(r.trim.source) },
];

export const BRAND_COLUMNS: ColumnSpec<BrandRow>[] = [
  { header: "Brand", width: 18, get: (r) => s(r.brand.name) },
  { header: "Chinese name", width: 16, get: (r) => s(r.brand.name_cn) },
  { header: "Parent group", width: 22, get: (r) => s(r.brand.parent_group) },
  { header: "Relationship type", width: 22, get: (r) => s(r.brand.relationship_type) },
  { header: "Tech partner", width: 16, get: (r) => s(r.brand.tech_partner) },
  { header: "Status", width: 12, get: (r) => s(r.brand.status) },
  { header: "Model count", width: 12, fmt: "0", get: (r) => r.modelCount },
  { header: "Trim count", width: 11, fmt: "0", get: (r) => r.trimCount },
  { header: "Cheapest confirmed Morocco price (DH)", width: 34, fmt: INT, get: (r) => r.cheapestMoroccoDh },
];
