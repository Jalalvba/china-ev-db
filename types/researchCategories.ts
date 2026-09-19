// Shared enums/shapes for the four Model-level research categories added on top of
// market_positioning/known_issues: market_trend, known_issues' region tag,
// technical_bulletins, and recalls. Dependency-free on purpose (no mongoose, no
// lib/ imports) so models/Model.ts, the research libs, the apply routes, the manual
// importer and the UI can all import one source of truth for these enums.

import type { Confidence } from "./index";

/** Same list known_issues.affected_systems has always used — reused as-is for bulletins/recalls' `affected_component` so all three can be filtered/grouped the same way. */
export const AFFECTED_SYSTEMS = ["engine", "battery", "motor", "transmission", "electronics", "chassis", "body", "climate", "other"] as const;
export type AffectedSystem = (typeof AFFECTED_SYSTEMS)[number];

export const SALES_TRENDS = ["growing", "stable", "declining", "discontinued"] as const;
export type SalesTrend = (typeof SALES_TRENDS)[number];

/** "china" = Chinese-market complaint data (车质网 et al.); "global" = international/export-market data. Never silently merged — see IKnownIssue.region. */
export const ISSUE_REGIONS = ["china", "global"] as const;
export type IssueRegion = (typeof ISSUE_REGIONS)[number];

/** The four researchable categories, as named in the manual-import envelope (research-categories-v1) and the manual-export category picker. */
export const RESEARCH_CATEGORY_KEYS = ["market_trend", "known_issues", "technical_bulletins", "recalls"] as const;
export type ResearchCategoryKey = (typeof RESEARCH_CATEGORY_KEYS)[number];

export const RESEARCH_CATEGORIES_SCHEMA_VERSION = "research-categories-v1" as const;

export interface IMarketTrend {
  /** Qualitative (e.g. "top 3 in China PHEV compact SUV") — a hard number only when a source states one. */
  market_share_segment?: string;
  sales_trend?: SalesTrend;
  trend_evidence?: string;
  source_url?: string;
  _confidence: Confidence;
  /** Set only when a market_trend write is verified as actually applied. */
  _last_researched_at?: string;
}

export interface ITechnicalBulletin {
  /** Manufacturer TSB reference; undefined when the bulletin is unnumbered. */
  bulletin_id?: string;
  issue_description: string;
  affected_component: AffectedSystem;
  /** Free text under the enum, e.g. "3DHT clutch actuator". */
  component_detail?: string;
  /** "YYYY-MM-DD" or "YYYY-MM". */
  issued_date?: string;
  source_url: string;
  confidence: Confidence;
}

/**
 * Links a recall to tooling that ALREADY exists elsewhere — never a second tools
 * schema. `uses_brand_diagnostic_interface` points at the brand's
 * IBrandPhevSuvWorkshopProfile.diagnostic_interface (resolved at display time via
 * the model's brand_id); `special_tool_names` are names from the model's RESOLVED
 * workshop special_tools list (lib/workshopResolution.ts, ISpecialTool.name);
 * `extra_tool_note` is ONLY for tooling beyond the brand's standard toolkit.
 */
export interface IRecallRequiredTools {
  uses_brand_diagnostic_interface: boolean;
  special_tool_names?: string[];
  extra_tool_note?: string;
}

export interface IRecall {
  /** e.g. a SAMR recall number or NHTSA campaign number. */
  recall_id?: string;
  issue_description: string;
  affected_component: AffectedSystem;
  component_detail?: string;
  /** "YYYY-MM-DD" or "YYYY-MM". */
  recall_date?: string;
  remedy_description: string;
  /** Model years / VIN range / unit count when stated. */
  affected_scope?: string;
  /** e.g. "SAMR", "NHTSA", "manufacturer press release". */
  issuing_body?: string;
  required_tools?: IRecallRequiredTools;
  source_url: string;
  confidence: Confidence;
}
