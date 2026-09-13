export type Segment =
  | "A-segment/City"
  | "B-segment/Compact"
  | "C-segment/Mid-size"
  | "D-segment/Large"
  | "SUV-compact"
  | "SUV-mid"
  | "SUV-full"
  | "MPV"
  | "Pickup"
  | "Sports";

export type ProductionStatus = "in production" | "discontinued" | "upcoming";

export type EnergyType = "ICE" | "HEV" | "PHEV" | "BEV" | "REEV/EREV" | "MHEV";

export type DriveType = "FWD" | "RWD" | "AWD" | "4WD";

/** Coarser, hybrid-specific classification some sources use — distinct from (and expected to overlap heavily with) EnergyType, the powertrain's fundamental architecture. Kept as its own field per an explicit request for it as a separate filterable axis, not folded into EnergyType. */
export type HybridType = "HEV" | "PHEV" | "EREV" | "Mild hybrid" | "Not applicable";

export type EmissionsStandard = "Euro 5" | "Euro 6" | "Euro 6d" | "China 5" | "China 6";

/** Powertrain-mechanism classification for a hybrid/PHEV/EREV trim — distinct from HybridType (a coarser HEV/PHEV/EREV/Mild-hybrid label) and from EnergyType. Derived primarily from hybridSystemName via a lookup table (see lib/hybridArchitecture.ts), NOT from battery size (a large battery does not imply series_erev — e.g. Denza D9's DM-i is power_split despite a 66.5 kWh pack). Null until sourced; never guess-defaulted to "parallel". */
export type HybridArchitecture = "parallel" | "series_erev" | "power_split" | "mild";

export type MotorCount = "single" | "dual" | "tri-motor" | "quad-motor";

export type GearboxType =
  | "single-speed reducer"
  | "CVT"
  | "DCT"
  | "AT"
  | "MT"
  | "AMT"
  | "multi-speed EV transmission"
  /** A hybrid transaxle (planetary/power-split gearset with no belt or discrete ratios) sold under the "E-CVT" name — distinct from a conventional belt-driven "CVT". Common on BYD DM-i and similar power-split PHEV systems. */
  | "E-CVT";

export type RangeStandard = "CLTC" | "WLTP" | "WLTC" | "NEDC";

/** "n/a" covers BEVs and any other trim with no `engine` block. */
export type AspirationType = "turbo" | "naturally-aspirated" | "supercharged" | "twin-charged" | "n/a";

/** Deliberately excludes a "range-extender" value — REEV/EREV is captured orthogonally by `ICanonicalEngine.is_range_extender`, not bundled into this enum, so a price-prediction model sees them as independent features. */
export type FuelType = "gasoline" | "diesel" | "n/a";

/** "other" covers a real but rare/novel chemistry (e.g. sodium-ion) until it's common enough to earn its own value — proprietary product names (e.g. "Blade") go in `ICanonicalBattery.chemistry_variant`, not here. */
export type BatteryChemistry = "LFP" | "NMC" | "LTO" | "semi-solid-state" | "other";

export type BrandStatus = "active" | "discontinued" | "bankrupt" | "merged";

/**
 * "confirmed" vs "unconfirmed" describes whether the block's claim — whatever
 * it actually is, including a free-text `note` when structured numeric
 * fields are null — is backed by an actual citation. It is NOT a measure of
 * how many structured fields are populated. A motor block that reports only
 * `note: "2,448 hp, ~23,000 N·m wheel torque"` with every numeric field null
 * can legitimately be "confirmed" if that claim came from a real source
 * (e.g. a press release for a concept car reporting hp/wheel-torque instead
 * of the standard kW/motor-torque_nm shape) — don't downgrade confidence
 * just because the numbers didn't fit the structured fields. Conversely, a
 * block with every structured field populated is "unconfirmed" if nothing
 * backs it (the zero-citation gate forces this regardless of self-report).
 * Field emptiness is already visible in the data itself; confidence answers
 * a different question ("is this sourced?"), so it stays a single field
 * rather than splitting into "structured-completeness" + "source-backing".
 */
export type Confidence = "confirmed" | "unconfirmed";

/** Nature of the parent_group relationship (ownership/control) — distinct from tech_partner, which is about technology/co-development rather than equity. */
export type BrandRelationshipType =
  | "equity_subsidiary"
  | "jv_brand"
  | "technology_partner"
  | "minority_controlling"
  | "contract_manufactured"
  | "independent";

export interface IBrand {
  _id?: string;
  name: string;
  /** Original-language (typically Chinese) name, kept alongside the canonical English `name`. */
  name_cn?: string;
  /** English name — usually identical to `name`, kept as an explicit canonical field per the DeepSeek schema. */
  name_en?: string;
  logo_url?: string;
  parent_group?: string;
  /** Nature of the parent_group relationship (ownership/control), not the tech_partner relationship. */
  relationship_type?: BrandRelationshipType;
  /** Parent's equity/control stake in this brand, 0-100. */
  stake_percentage?: number;
  tech_partner?: string;
  country_origin: string;
  founded_year?: number;
  website?: string;
  status?: BrandStatus;
  status_note?: string;
  /** Whether this brand is confirmed to sell/export outside mainland China. Undefined/uncertain is distinct from `false` — only set false on positive evidence of domestic-only status. */
  export_relevant?: boolean;
  /** Set only by the Tier-1 "Research this brand" write path, only when verified as actually applied — same convention as IPowertrain.last_researched_at / IModel.notable_facts_last_researched_at. Undefined means this brand's identity facts have never been touched by the research pipeline. */
  last_researched_at?: string;
  /** Flags a brand whose real-world existence as a currently-operating entity could not be confirmed by audit. */
  data_quality_flag?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IPriceRange {
  min?: number;
  max?: number;
  currency_local: string;
  min_usd?: number;
  max_usd?: number;
  unverified?: boolean;
  /** Why unverified was set true — e.g. a mislabeled-currency or wrong-model-match finding from a data audit. Free text, not required whenever unverified is true (some unverified records just predate the flag). */
  flag_reason?: string;
  /** CNY-per-USD rate used to derive min_usd/max_usd, from getCnyPerUsdRate() (lib/deepseekNormalize.ts) at import time. Undefined for records imported before the hardcoded 7.2 constant was replaced with a live fetch. */
  exchange_rate_used?: number;
  /** Date the exchange_rate_used value was published for (Frankfurter's `data.date`), not the import run's own date. */
  exchange_rate_date?: string;
}

export interface IModel {
  _id?: string;
  brand_id: string;
  name: string;
  /** Original-language (typically Chinese) model name. */
  name_cn?: string;
  /** English model name — usually identical to `name`. */
  name_en?: string;
  generation?: string;
  year?: number;
  segment: Segment;
  body_type: string;
  price_range?: IPriceRange;
  production_status: ProductionStatus;
  unverified?: boolean;
  /** Free-text prose noting anything genuinely unusual about this model as a whole — e.g. battery-swap capability, an award, a production milestone, a controversy, a first-in-class feature. Model-level (not per-trim), and deliberately separate from the structured canonical Powertrain fields. Optional — omitted when nothing stands out. */
  notable_facts?: string;
  /** Same source-citation rule as every other researched field: "confirmed" only when backed by an actual citation, "unconfirmed" otherwise. */
  notable_facts_confidence?: Confidence;
  /** Set by lib/applySpecUpdates.ts only when a notable_facts write is verified as actually applied (re-fetched and confirmed) — distinct from `updatedAt`, which changes on any write attempt regardless of whether it succeeded. Undefined means notable_facts has never been touched by the research pipeline (or there is none). */
  notable_facts_last_researched_at?: string;
  /** Set only by app/api/models/[id]/fetch-morocco-price/route.ts — a deterministic HTTP scrape of moteur.ma/wandaloo.com (see lib/moteurMaScraper.ts, lib/wandalooScraper.ts), never AI research. Undefined/false means this model has never been checked, or was checked and isn't listed on either site — the UI should omit the price chip in that case, not show an empty one. */
  morocco_price_dh?: number;
  morocco_price_source?: "moteur.ma" | "wandaloo.com";
  morocco_price_url?: string;
  morocco_price_confirmed?: boolean;
  /** morocco_price_dh / price_range.min, only ever computed for models where price_range.unverified is not true — see scripts/backfill-morocco-china-ratio.ts. Undefined means never computed (missing inputs, or excluded by the unverified guard). */
  morocco_to_china_price_ratio?: number;
  /** When morocco_to_china_price_ratio was last (re)computed. */
  morocco_to_china_price_ratio_computed_at?: string;
  /** Set by mongoose (`timestamps: true`); not touched by the research pipeline. Used as the "Original import data" fallback timestamp when last_researched_at/notable_facts_last_researched_at is unset. */
  createdAt?: string;
  updatedAt?: string;
}

export type {
  ICanonicalEngine as IEngineDetails,
  ICanonicalMotor as IElectricMotorDetails,
  ICanonicalBattery as IBatteryDetails,
  ICanonicalTransmission as ITransmission,
  ICanonicalPerformance as IPerformance,
} from "./canonicalPowertrain";

import type { ICanonicalPowertrain } from "./canonicalPowertrain";

/**
 * The canonical AI-facing Powertrain shape, plus operational fields that are
 * never part of the Gemini prompt/response (see CANONICAL_POWERTRAIN_FIELD_TEMPLATE's
 * drift guard in canonicalPowertrain.ts) — they're set directly by our own
 * write path, not researched.
 */
export type IPowertrain = ICanonicalPowertrain & {
  /** Set by lib/applySpecUpdates.ts only when a write to this document is verified as actually applied (re-fetched and confirmed) — distinct from `updatedAt`, which changes on any write attempt regardless of whether it succeeded. Undefined means this document has never been touched by the research pipeline (still original seed/import data). */
  last_researched_at?: string;
  /** Set by mongoose (`timestamps: true`); not touched by the research pipeline. Used as the "Original import data" fallback timestamp when last_researched_at is unset. */
  createdAt?: string;
  updatedAt?: string;
};

/**
 * A per-model market listing for an export market (currently Morocco only).
 * Deliberately a separate collection rather than a Model sub-document: it's
 * a different currency/market concern, and many listings won't match any
 * Model we have yet — the row is still worth keeping (model_id left unset)
 * so the sourced data isn't lost while the China-side lineup catches up.
 */
export interface IMoroccoListing {
  _id?: string;
  model_id?: string;
  brand_en: string;
  model_en: string;
  price_mad?: number;
  price_mad_max?: number;
  autonomie_km?: number;
  powertrain?: string;
  dealer_morocco?: string;
  dealer_confidence?: Confidence;
  /** Free-text caveat about dealer_morocco, e.g. dual distribution, corporate-structure clarification, or a source discrepancy pending verification. */
  note?: string;
  source?: string;
  /** This specific model's listed price on moteur.ma (Morocco's automotive reference site) — distinct from price_mad/price_mad_max, which may come from other Moroccan sources. */
  moteur_ma_price_dh?: number;
  /** True only if a moteur.ma listing was actually found for this model (not just the general Morocco distributor). */
  moteur_ma_confirmed?: boolean;
  moteur_ma_url?: string;
  matched: boolean;
  last_updated: string;
}
