// Tiered warranty structure for Brand.warranty_terms.tiers (dealership-ops-manual-v1's warranty section).
// Dependency-free (no mongoose) so the schema, validator, prompt and displays derive from one definition.
// ADDITIVE: the original 6 flat fields on warranty_terms stay as legacy; where tiers exist they win on display.
// A tier's traceability is `clause_ref` (a locator like "9.3"); the whole block keeps ONE brand-level `source`.
// Brand-level warranty facts, so BEV tiers are stored even though the Powertrain collection is PHEV-only.

export const WARRANTY_TIER_KINDS = ["whole_vehicle", "replacement_return", "core_components", "special_components", "consumables", "other"] as const;
export const WARRANTY_VEHICLE_USES = ["household", "commercial", "all"] as const;
export const WARRANTY_POWERTRAINS = ["PHEV", "BEV", "all"] as const;
export const WARRANTY_LIMIT_RULES = ["whichever_first", "time_only", "km_only"] as const;

export type WarrantyTierKind = (typeof WARRANTY_TIER_KINDS)[number];
export type WarrantyVehicleUse = (typeof WARRANTY_VEHICLE_USES)[number];
export type WarrantyPowertrain = (typeof WARRANTY_POWERTRAINS)[number];
export type WarrantyLimitRule = (typeof WARRANTY_LIMIT_RULES)[number];

export interface IWarrantyTier {
  /** e.g. "Core components (PHEV/EREV)". */
  tier_name: string;
  kind: WarrantyTierKind;
  vehicle_use: WarrantyVehicleUse;
  powertrain: WarrantyPowertrain;
  /** 8 years = 96. */
  duration_months?: number;
  duration_km?: number;
  /** Lifetime "three-electric" style claims — no numeric period. */
  is_lifetime?: boolean;
  /** Default whichever_first when both a time and km limit exist. */
  limit_rule?: WarrantyLimitRule;
  /** English part names as listed in the source; may be empty only for replacement_return / whole_vehicle. */
  covered_parts: string[];
  /** e.g. clause 9.2's conditions for replacement or return. */
  conditions?: string;
  /** Locator inside the single source document, e.g. "9.3". Not a source of its own. */
  clause_ref?: string;
}

/** "96 mo (8 yr) / 150,000 km" style label — shared by every display so tiers read the same everywhere. */
export function formatTierPeriod(t: Pick<IWarrantyTier, "duration_months" | "duration_km" | "is_lifetime" | "limit_rule">): string {
  if (t.is_lifetime) return "Lifetime";
  const parts: string[] = [];
  if (t.duration_months != null) {
    const yrs = t.duration_months % 12 === 0 ? ` (${t.duration_months / 12} yr)` : "";
    parts.push(`${t.duration_months} mo${yrs}`);
  }
  if (t.duration_km != null) parts.push(`${t.duration_km.toLocaleString("en-US")} km`);
  const joined = parts.join(" / ");
  if (parts.length === 2 && t.limit_rule === "time_only") return `${joined} (time limit only)`;
  if (parts.length === 2 && t.limit_rule === "km_only") return `${joined} (km limit only)`;
  return joined || "—";
}
