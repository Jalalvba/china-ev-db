// Shared "distinct spec groups" logic — a model can have many Powertrain
// trims that are spec-identical apart from a trim badge/model-year (model-
// year re-releases, equipment-only variants). Grouping them collapses that
// noise into "N trims share this exact spec."
//
// Originally built for the model detail page's summary panel
// (app/models/[id]/page.tsx); the Compare page's trim picker reuses the same
// grouping so the two pages can't drift on what counts as "the same trim" —
// see the price-formatting drift (lib/priceDisplay.ts) this project already
// hit once for the same reason (duplicated per-page logic silently diverging).

import type { IPowertrain } from "@/types";
import { kwToHp } from "@/lib/units";

/** The subset of IPowertrain these functions actually touch — deliberately excludes "model_id", so callers whose IPowertrain-shaped type overrides model_id (e.g. the Compare page's PopulatedPowertrain, which replaces it with a populated model object) can pass their type through without a cast. */
type SpecFields = Pick<IPowertrain, "trim_name" | "energy_type" | "engine" | "motor" | "battery" | "transmission">;

/** True if `block` has at least one populated field among `keys` — a block that's merely `{ confidence: "confirmed" }` or `{}` (no meaningful data, e.g. an ICE-only trim's motor/battery) should render as absent, not as a row full of "?" placeholders. */
export function hasFields<T extends object>(block: T | undefined | null, keys: (keyof T)[]): boolean {
  if (!block) return false;
  return keys.some((k) => block[k] !== undefined && block[k] !== null && block[k] !== "");
}

/** Substantive fields only from one block — excludes "confidence" (trust metadata about the value, not the value itself) and free-text "note"/"battery_variant" fields, which can differ in wording between two trims whose actual spec numbers are identical (seen in practice: two Dongfeng Huge HEV trims with the same motor spec but differently-worded motor.note text). */
function engineSpecFields(e: IPowertrain["engine"]) {
  if (!e) return null;
  const { displacement_l, cylinders, aspiration, fuel_type, is_range_extender, power_kw, torque_nm } = e;
  return { displacement_l, cylinders, aspiration, fuel_type, is_range_extender, power_kw, torque_nm };
}
function motorSpecFields(m: IPowertrain["motor"]) {
  if (!m) return null;
  const { type, power_kw, torque_nm, count, drive } = m;
  return { type, power_kw, torque_nm, count, drive };
}
function batterySpecFields(b: IPowertrain["battery"]) {
  if (!b) return null;
  const { chemistry, capacity_total_kwh, capacity_usable_kwh, supplier, dc_charge_kw, ac_charge_kw, ev_range_km, ev_range_standard } = b;
  return { chemistry, capacity_total_kwh, capacity_usable_kwh, supplier, dc_charge_kw, ac_charge_kw, ev_range_km, ev_range_standard };
}
function transmissionSpecFields(t: IPowertrain["transmission"]) {
  if (!t) return null;
  const { type, speed_count } = t;
  return { type, speed_count };
}

/** Equality key across Energy Type + Engine + Motor + Battery + Gearbox (substantive fields only) — two trims with the same key are the same car mechanically, whatever their trim badge/model-year says. */
export function specGroupKey(p: SpecFields): string {
  return JSON.stringify({
    energy_type: p.energy_type,
    engine: engineSpecFields(p.engine),
    motor: motorSpecFields(p.motor),
    battery: batterySpecFields(p.battery),
    transmission: transmissionSpecFields(p.transmission),
  });
}

/** kW with hp in parens, e.g. "150 kW (201 hp)" — same dual-unit convention already used on the model detail and Compare pages (lib/units.ts's kwToHp), so power never displays as a bare, unfamiliar kW figure on its own. */
function powerWithHp(kw: number | null | undefined): string {
  if (kw == null) return "?";
  const hp = kwToHp(kw);
  return hp !== undefined ? `${kw} kW (${hp} hp)` : `${kw} kW`;
}

/** One-line human summary of a group's shared spec, e.g. "150 kW (201 hp)/305 Nm turbo gasoline, no battery, DCT 7-spd". */
export function specGroupLabel(p: SpecFields): string {
  const parts: string[] = [];
  if (hasFields(p.engine, ["power_kw", "torque_nm"])) {
    parts.push(
      `${powerWithHp(p.engine!.power_kw)}/${p.engine!.torque_nm ?? "?"} Nm ${p.engine!.aspiration ?? ""} ${p.engine!.fuel_type ?? ""}`
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  if (hasFields(p.motor, ["power_kw", "type", "count"])) {
    parts.push(
      `+ ${p.motor!.count ?? ""} ${p.motor!.type ?? "motor"} ${powerWithHp(p.motor!.power_kw)}/${p.motor!.torque_nm ?? "?"} Nm`
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  parts.push(
    hasFields(p.battery, ["capacity_total_kwh", "chemistry"])
      ? `${p.battery!.capacity_total_kwh ?? "?"} kWh ${p.battery!.chemistry ?? ""} battery`.trim()
      : "no battery"
  );
  if (p.transmission?.type) {
    parts.push(`${p.transmission.type}${p.transmission.speed_count ? ` ${p.transmission.speed_count}-spd` : ""}`);
  }
  return parts.join(", ");
}

/** Short fuel_type label for the compact picker format — full words ("gasoline") read fine in a table cell but waste width in a narrow <select>. */
const FUEL_ABBR: Record<string, string> = {
  gasoline: "Gas",
  diesel: "Diesel",
};

/**
 * Compact, always-the-same-shape canonical-field summary for a trim picker
 * option — e.g. "150 kW · Turbo Gas · DCT 7". Unlike specGroupLabel (a full
 * sentence meant for a comparison-table cell), this never varies in
 * structure between a single trim and a multi-trim group, and it never
 * falls back to trim_name — every option in the picker is built from the
 * same canonical engine/motor/battery/transmission fields, so two options
 * are visually comparable at a glance instead of one being a spec dump and
 * the other a bare (often Chinese) trim badge.
 */
export function compactSpecLabel(p: SpecFields): string {
  const parts: string[] = [];
  // Leads the label: an HEV/PHEV/BEV/REEV all combine engine+motor+battery
  // numbers in ways that otherwise look identical (a PHEV vs. an HEV can
  // have near-identical engine/motor kW) — energy_type is the one field
  // that actually tells them apart, so it has to be visible, not implied.
  if (p.energy_type) {
    parts.push(p.energy_type === "REEV/EREV" ? "REEV" : p.energy_type);
  }
  if (hasFields(p.engine, ["power_kw", "displacement_l"])) {
    const aspiration = p.engine!.aspiration === "turbo" ? "Turbo " : "";
    const fuel = p.engine!.fuel_type ? (FUEL_ABBR[p.engine!.fuel_type] ?? p.engine!.fuel_type) : "";
    const displacement = p.engine!.displacement_l != null ? `${p.engine!.displacement_l}L ` : "";
    // hp, not kW — every power figure in this app displays as hp (with kW
    // in parens where there's room, e.g. specGroupLabel below); this label
    // has no room for both and stays hp-only to fit a narrow mobile picker.
    const hp = p.engine!.power_kw != null ? `${kwToHp(p.engine!.power_kw)} hp ` : "";
    const torque = p.engine!.torque_nm != null ? `${p.engine!.torque_nm} Nm ` : "";
    parts.push(`${displacement}${hp}${torque}${aspiration}${fuel}`.replace(/\s+/g, " ").trim());
  }
  if (hasFields(p.motor, ["power_kw"])) {
    const hp = p.motor!.power_kw != null ? `${kwToHp(p.motor!.power_kw)} hp` : "";
    const torque = p.motor!.torque_nm != null ? ` ${p.motor!.torque_nm} Nm` : "";
    parts.push(`${hp}${torque} motor`.trim());
  }
  if (hasFields(p.battery, ["capacity_total_kwh"])) {
    parts.push(`${p.battery!.capacity_total_kwh} kWh`);
  }
  if (p.transmission?.type) {
    parts.push(`${p.transmission.type}${p.transmission.speed_count ? ` ${p.transmission.speed_count}` : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Spec unavailable";
}

export interface SpecGroup<T extends SpecFields = IPowertrain> {
  label: string;
  trims: T[];
}

/** Groups powertrains sharing an identical specGroupKey, preserving first-seen order. */
export function groupBySpec<T extends SpecFields>(powertrains: T[]): SpecGroup<T>[] {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const p of powertrains) {
    const key = specGroupKey(p);
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(p);
  }
  return order.map((key) => {
    const trims = byKey.get(key)!;
    return { label: specGroupLabel(trims[0]), trims };
  });
}
