import type { IMarketTrend, ITechnicalBulletin, IRecall, IssueRegion } from "./researchCategories";

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

/**
 * Confidence specifically for Model.segment — deliberately its own type
 * rather than reusing Confidence ("confirmed" | "unconfirmed"), because
 * segment is never allowed to be left null/unset (see IModel.segment):
 * "inferred" means the AI's own best-effort classification with no source
 * found, not "unconfirmed" in the sense of "attempted and failed" that
 * Confidence's other fields use. A model whose segment came from a real
 * search result is "confirmed"; everything else the research pipeline
 * produces for this field is "inferred".
 */
export type SegmentConfidence = "confirmed" | "inferred";

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
  /** The name this brand is actually marketed under in Morocco, if different from `name` — manual direct-entry only, never part of AI research. Falls back to `name` when unset. Brands have no single Morocco price (only Models/Trims do). */
  morocco_name?: string;
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
  /** Official warranty terms, Chinese-source-only research (lib/warrantyResearch.ts) — see CLAUDE.md's PHEV split-warranty convention. Undefined means never researched. */
  warranty_terms?: IWarrantyTerms;
  /** Set only when a warranty_terms write is verified as actually applied. */
  warranty_terms_last_researched_at?: string;
  /** Official after-sales workshop/tooling requirements, Chinese-source-only research (lib/workshopResearch.ts). Undefined means never researched. */
  workshop_requirements?: IWorkshopRequirements;
  /** Set only when a workshop_requirements write is verified as actually applied. */
  workshop_requirements_last_researched_at?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IWarrantyTerms {
  ice_component_years?: number;
  ice_component_km?: number;
  battery_years?: number;
  battery_km?: number;
  motor_years?: number;
  motor_km?: number;
  source?: string;
  confidence?: Confidence;
}

export interface IWorkshopRequirements {
  special_tools_list?: string[];
  hv_safety_requirements?: string;
  diagnostic_software_name?: string;
  technician_certification_required?: string;
  source?: string;
  confidence?: Confidence;
}

export interface IKnownIssue {
  /** "china" = Chinese-market complaint data (车质网 et al.), "global" = international/export-market data — deliberately different populations, never silently merged; dedupe is per (region, issue_description). Undefined on items written before this field existed — treat as "china" (every such item came from the Chinese-source-only pipeline; scripts/backfill-known-issue-region.ts tags them explicitly). */
  region?: IssueRegion;
  issue_description: string;
  affected_systems: string[];
  frequency_signal?: string;
  source: string;
  /** The specific page the issue came from, when known. Optional — items written before this field existed only carry the site name in `source`. */
  source_url?: string;
  confidence: Confidence;
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
  /** The name this model is actually marketed under in Morocco, if different from `name` — manual direct-entry only, never part of AI research. Falls back to `name` when unset. */
  morocco_name?: string;
  generation?: string;
  year?: number;
  segment: Segment;
  /** "confirmed" when backed by an actual search result, "inferred" when it's the AI's own best-effort classification with no source found — segment itself is never left null (see lib/modelDiscovery.ts), so this is what actually tells a "real fact" segment apart from a "best guess" one. Undefined only for legacy records written before this field existed. */
  segment_confidence?: SegmentConfidence;
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
  /** How Chinese auto-media sources themselves frame this model's competitive position (e.g. "positioned against the Honda CR-V") — pulled directly from source framing, not our own inference. Chinese-source-only research (lib/positioningResearch.ts). */
  market_positioning?: string;
  market_positioning_source?: string;
  market_positioning_confidence?: Confidence;
  /** Set only when a market_positioning write is verified as actually applied. */
  market_positioning_last_researched_at?: string;
  /** Reported real-world failure patterns, sourced from 车质网/汽车投诉网 and similar Chinese-source-only complaint/quality sites (lib/issueResearch.ts). */
  known_issues?: IKnownIssue[];
  /** Set only when a known_issues write (either region) is verified as actually applied. */
  known_issues_last_researched_at?: string;
  /** Per-region timestamps — set only when a write of that region's items is verified as actually applied. */
  known_issues_china_last_researched_at?: string;
  known_issues_global_last_researched_at?: string;
  /** Sales/market-position trend, Chinese-source-only research (lib/marketTrendResearch.ts). Undefined means never researched. */
  market_trend?: IMarketTrend;
  /** Manufacturer technical service bulletins; Chinese + manufacturer-service-site sources only (lib/bulletinResearch.ts). Often sparse/empty — TSBs are rarely public. */
  technical_bulletins?: ITechnicalBulletin[];
  /** Set only when a technical_bulletins write is verified as actually applied. */
  technical_bulletins_last_researched_at?: string;
  /** Recalls — deliberately NOT source-restricted (lib/recallResearch.ts): recalls are reported by regulators, manufacturer press releases and international coverage, not just Chinese sources. */
  recalls?: IRecall[];
  /** Set only when a recalls write is verified as actually applied. */
  recalls_last_researched_at?: string;
  /** Set only by app/api/models/[id]/fetch-morocco-price/route.ts — a deterministic HTTP scrape of moteur.ma/wandaloo.com (see lib/moteurMaScraper.ts, lib/wandalooScraper.ts), never AI research. Undefined/false means this model has never been checked, or was checked and isn't listed on either site — the UI should omit the price chip in that case, not show an empty one. */
  morocco_price_dh?: number;
  /** "manual" = direct human entry via app/api/models/[id]/morocco-info/route.ts, bypassing the scraper/research pipeline entirely — see that route's comment for why a manual entry is marked confirmed without a source_url. */
  morocco_price_source?: "moteur.ma" | "wandaloo.com" | "manual";
  morocco_price_url?: string;
  morocco_price_confirmed?: boolean;
  /** morocco_price_dh / price_range.min, only ever computed for models where price_range.unverified is not true — see scripts/backfill-morocco-china-ratio.ts. Undefined means never computed (missing inputs, or excluded by the unverified guard). */
  morocco_to_china_price_ratio?: number;
  /** When morocco_to_china_price_ratio was last (re)computed. */
  morocco_to_china_price_ratio_computed_at?: string;
  /** Coarse powertrain bucket used to resolve workshop_standards (see lib/workshopResolution.ts) — deliberately coarser than Powertrain.energy_type: REEV/EREV folds into "PHEV" and MHEV folds into "HEV" for workshop-tooling purposes (both carry a comparable HV-safety/tooling profile to their bucket-mate), see PowertrainCategory's own comment. Derived from this model's Powertrain documents (highest-complexity one wins: BEV > PHEV > HEV > ICE) by scripts/backfill-powertrain-category.ts; never guessed when a model has no Powertrain docs yet. */
  powertrain_category?: PowertrainCategory;
  /** Set by mongoose (`timestamps: true`); not touched by the research pipeline. Used as the "Original import data" fallback timestamp when last_researched_at/notable_facts_last_researched_at is unset. */
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Coarse workshop-tooling bucket, distinct from Powertrain.energy_type (which has 6
 * values: ICE/HEV/PHEV/BEV/REEV-EREV/MHEV). workshop_standards is seeded at this
 * coarser 4-value grain because tooling/cert/lift requirements don't meaningfully
 * differ between REEV/EREV and PHEV (both: ICE + traction battery + HV service needs)
 * or between MHEV and HEV (both: low-voltage-assist, no HV battery service). Mapping:
 * REEV/EREV -> "PHEV", MHEV -> "HEV". See CLAUDE.md before changing this mapping.
 */
export type PowertrainCategory = "ICE" | "HEV" | "PHEV" | "BEV";

export const SERVICE_TIERS = ["routine", "major_repair", "hv_battery"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export interface ITechnicianCertification {
  level?: string;
  body?: string;
  required_for?: string[];
  retraining_interval_months?: number;
}

export interface ILiftRequirements {
  type?: string;
  min_capacity_kg?: number;
  lift_points_note?: string;
  battery_removal_capable?: boolean;
}

export interface ISpecialTool {
  name: string;
  category?: string;
  mandatory?: boolean;
  notes?: string;
}

/** Generic (non-brand-specific) reference doc: what a workshop needs for a given powertrain_category + service_tier combination, sourced from published industry/national standards rather than any one brand. See lib/workshopResolution.ts for how brand_workshop_overrides merges on top of this. */
export interface IWorkshopStandard {
  _id?: string;
  powertrain_category: PowertrainCategory;
  service_tier: ServiceTier;
  technician_certification?: ITechnicianCertification;
  lift_requirements?: ILiftRequirements;
  special_tools?: ISpecialTool[];
  /** "industry_standard" = generic national/industry-standard sourcing (this collection's default); "brand_specific" reserved for a doc seeded from one brand's published spec that turned out to generalize — expected to stay rare here, most brand-specific data belongs in brand_workshop_overrides instead. */
  _source: "industry_standard" | "brand_specific";
  _confidence: Confidence;
  createdAt?: string;
  updatedAt?: string;
}

/** Sparse, brand-specific deltas on top of the matching workshop_standards doc — only created where real brand-specific research (lib/workshopResearch.ts) actually found something beyond the generic standard. A brand+powertrain_category combination with no override here just uses workshop_standards as-is. */
export interface IBrandWorkshopOverride {
  _id?: string;
  brand_id: string;
  powertrain_category: PowertrainCategory;
  /** Partial shape of IWorkshopStandard's researchable fields (technician_certification/lift_requirements/special_tools) — a field present here wins over workshop_standards field-by-field; special_tools is list-replace, not merged item-by-item (see lib/workshopResolution.ts). */
  overrides: Partial<Pick<IWorkshopStandard, "technician_certification" | "lift_requirements" | "special_tools">>;
  _source_url?: string;
  _last_researched_at?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One brand's real (not generic-industry) PHEV/REEV-SUV-specific service infrastructure profile —
 *  see lib/phevSuvWorkshopResearch.ts and CLAUDE.md-adjacent instructions for this narrowly-scoped
 *  pipeline. Deliberately separate from IWorkshopStandard/IBrandWorkshopOverride: those are the
 *  generic cross-category workshop-tooling baseline; this collection exists because a buyer needed
 *  actual manufacturer-specific data for PHEV/REEV SUVs specifically, not the industry baseline. Never
 *  inherits/falls back to workshop_standards — a field genuinely not found stays null, it is not
 *  filled from the generic doc. */
export interface IBrandPhevSuvWorkshopProfile {
  _id?: string;
  brand_id: string;
  diagnostic_interface?: {
    tool_name?: string;
    connector_type?: string;
    software_platform?: string;
    requires_dealer_account?: boolean;
    source_url?: string;
  };
  lift_spec?: {
    type?: string;
    min_capacity_kg?: number;
    battery_removal_capable?: boolean;
    lift_point_notes?: string;
    source_url?: string;
  };
  ppe_required?: Array<{
    item: string;
    spec?: string;
    mandatory?: boolean;
    source_url?: string;
  }>;
  technician_prerequisites?: Array<{
    certification_name_cn?: string;
    certification_name_en?: string;
    issuing_body?: string;
    minimum_grade?: string;
    hv_endorsement_required?: boolean;
    source_url?: string;
  }>;
  audit_checklist?: Array<{
    check_point: string;
    category?: "tooling" | "certification" | "facility" | "documentation";
    source_url?: string;
  }>;
  _source: "brand_specific";
  _confidence: Confidence;
  _last_researched_at?: string;
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
 * never part of the AI prompt/response (see CANONICAL_POWERTRAIN_FIELD_TEMPLATE's
 * drift guard in canonicalPowertrain.ts) — they're set directly by our own
 * write path, not researched.
 */
export type IPowertrain = ICanonicalPowertrain & {
  /** Set by lib/applySpecUpdates.ts only when a write to this document is verified as actually applied (re-fetched and confirmed) — distinct from `updatedAt`, which changes on any write attempt regardless of whether it succeeded. Undefined means this document has never been touched by the research pipeline (still original seed/import data). */
  last_researched_at?: string;
  /** The name this trim is actually marketed under in Morocco, if different from `trim_name` — manual direct-entry only, never part of AI research. Falls back to `trim_name` when unset. */
  morocco_name?: string;
  /** Trim-level Morocco price — distinct from trim_price_min/max (the China-domestic canonical price) and from the parent Model's own morocco_price_dh (that model's headline/cheapest-trim price). Manual direct-entry only; "manual" is currently the only source value since no scraper populates this at trim level. */
  morocco_price_dh?: number;
  morocco_price_source?: "manual";
  morocco_price_confirmed?: boolean;
  /**
   * USD conversion of trim_price_min/trim_price_max — computed server-side
   * at write time (lib/applySpecUpdates.ts, same lib/deepseekNormalize.ts
   * getCnyPerUsdRate() the Model.price_range.min_usd/max_usd conversion
   * already uses) from whatever currency trim_price_currency says, never
   * researched/set by the AI directly — same exclusion-from-the-canonical-
   * template convention as IPriceRange.min_usd/max_usd. This is the ONLY
   * form the UI is ever allowed to display for a trim's own price: raw CNY
   * trim_price_min/max must never be rendered directly anywhere (see
   * lib/priceDisplay.ts's formatTrimPrice, which reads only these _usd
   * fields) — the app shows USD everywhere except the explicitly-flagged
   * Morocco DH figure.
   */
  trim_price_min_usd?: number;
  trim_price_max_usd?: number;
  /** CNY-per-USD rate used for the conversion above, from getCnyPerUsdRate() at write time — same convention as IPriceRange.exchange_rate_used. */
  trim_price_exchange_rate_used?: number;
  /** Date the exchange_rate_used value was published for (Frankfurter's `data.date`), not the write's own date — same convention as IPriceRange.exchange_rate_date. */
  trim_price_exchange_rate_date?: string;
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
