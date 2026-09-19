// Model-level sales/market-trend research — Chinese-source-only (same hard requirement
// and allowlist as lib/positioningResearch.ts, which this extends). Sales rankings and
// monthly volumes are Chinese-market figures reported on Chinese auto-media/sales
// trackers, so a non-Chinese source here would be someone else's summary of them.

import { filterToChineseSources } from "@/lib/chineseSourceGuard";
import { normalizeMarketTrend } from "@/lib/categoryValidators";
import { commonFormatRules, runCategoryResearch, searchName } from "@/lib/categoryResearch";
import type { CategoryResearchInput, CategoryResearchResult } from "@/lib/categoryResearch";
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

${commonFormatRules([
  "Everything must come from a Chinese-language source you actually found in the search results provided — do not use general knowledge.",
  '"sales_trend" must be exactly one of: growing, stable, declining, discontinued (or null if the sources do not support a direction).',
  '"confidence" is "confirmed" only if the trend/rank was directly stated in a fetched Chinese source.',
])}`;
}

export async function researchMarketTrend(model: string, input: CategoryResearchInput): Promise<CategoryResearchResult<MarketTrendItem>> {
  const cn = searchName(input);
  return runCategoryResearch<MarketTrendItem>({
    model,
    label: "research-market-trend",
    input,
    kickoffPrompt: buildMarketTrendKickoffPrompt(input),
    formatPrompt: buildMarketTrendFormatPrompt(),
    searchQueries: [`${cn} 销量`, `${cn} 月销量 排行`, `${cn} 销量 走势`, `${cn} 细分市场 排名`],
    responseKey: "market_trend",
    shape: "object",
    groundingFilter: (urls) => filterToChineseSources(urls),
    normalize: (raw) => {
      const r = normalizeMarketTrend(raw, { checkChineseSource: true });
      // Adapt to the { ..., confidence } item shape the generic runner gates on.
      return r.item ? { ...r, item: { ...r.item, confidence: r.item._confidence } } : { errors: r.errors, warnings: r.warnings };
    },
    forceUnconfirmed: (item) => {
      item.confidence = "unconfirmed";
      item._confidence = "unconfirmed";
    },
  });
}
