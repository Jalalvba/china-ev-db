// Model-level sales/market-trend research prompt/template — Chinese-source-only (same hard
// requirement and allowlist as lib/positioningResearch.ts, which this extends). Sales rankings
// and monthly volumes are Chinese-market figures reported on Chinese auto-media/sales
// trackers, so a non-Chinese source here would be someone else's summary of them.
//
// The live automated-call path (researchMarketTrend, which used to call runCategoryResearch
// here) was removed 2026-09-21 — see CLAUDE.md's "Automated research calls removed" entry.
// MARKET_TREND_TEMPLATE is still shared with the manual export/import round-trip
// (lib/researchCategoriesImport.ts), which is now the only way this category's data enters
// the DB — keep it in sync with that shape.

import type { CategoryResearchInput } from "@/lib/categoryResearch";
import type { IMarketTrend } from "@/types/researchCategories";

export type MarketTrendItem = Omit<IMarketTrend, "_last_researched_at"> & { confidence?: string };

export const MARKET_TREND_TEMPLATE = {
  market_share_segment: "string | null (qualitative, e.g. 'top 3 in China PHEV compact SUV' — a hard number ONLY if a source states one)",
  sales_trend: "growing | stable | declining | discontinued | null",
  trend_evidence: "string | null (the specific sales figures/ranking movement this is based on, e.g. 'monthly sales rose from 6,200 (Mar) to 9,800 (Aug)')",
  source_url: "string | null (the actual Chinese-source URL)",
  confidence: "confirmed | unconfirmed",
};

export function buildMarketTrendKickoffPrompt(input: CategoryResearchInput): string {
  const { brandName, modelName, brandNameCn, modelNameCn } = input;
  const cnName = modelNameCn ?? (brandNameCn ? `${brandNameCn} ${modelName}` : undefined);
  return `You are a researcher documenting how a specific Chinese-market vehicle is actually selling — its sales trend and its rank/share in its own segment.

Model to research: "${brandName} ${modelName}"${cnName ? ` (${cnName})` : ""}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language auto-media/sales-tracking sources (懂车帝, 汽车之家, 易车, 太平洋汽车网, 乘联会-derived coverage). If a search result below is in English or from a non-Chinese site, IGNORE it completely. If no Chinese source reports on this model's sales, report null rather than estimating.

Find, from the search results provided:
- The model's recent sales direction over roughly the last 6–12 months, based on actual monthly/quarterly/annual figures or rank movement a source reports (growing, stable, declining) — or whether a source says it has been discontinued/stopped selling.
- Its rank or share within its segment as the source itself states it (e.g. "PHEV compact SUV 销量榜 第3名"). Qualitative is fine; give a hard number only if the source does.

Do NOT infer a trend from a single data point, and do not use your own knowledge of the model's sales. Report your findings in plain prose with citations (the actual URL for each claim) — do not format as JSON yet.`;
}

export function buildMarketTrendFormatPrompt(): string {
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object describes the type each field must have, not a literal example value). If nothing was found, return {"market_trend": null}:
${JSON.stringify({ market_trend: MARKET_TREND_TEMPLATE }, null, 2)}

Everything must come from a Chinese-language source you actually found — do not use general knowledge.
"sales_trend" must be exactly one of: growing, stable, declining, discontinued (or null if the sources do not support a direction).
"confidence" is "confirmed" only if the trend/rank was directly stated in a fetched Chinese source.`;
}
