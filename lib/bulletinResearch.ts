// Model-level technical service bulletin (TSB) research — Chinese sources plus
// manufacturer official service sites (chineseSourceGuard's `includeManufacturer`
// option). TSBs are published on the maker's own after-sales portals and often
// mirrored on Chinese auto-media forums; without the manufacturer domains this
// category would almost always come back empty. Even WITH them it is expected to
// return sparse/empty results often — most bulletins are dealer-portal-only and
// never publicly indexed. An empty result is the correct outcome then, not an error.

import { filterToChineseSources } from "@/lib/chineseSourceGuard";
import { normalizeBulletin } from "@/lib/categoryValidators";
import { commonFormatRules, runCategoryResearch, searchName } from "@/lib/categoryResearch";
import type { CategoryResearchInput, CategoryResearchResult } from "@/lib/categoryResearch";
import { AFFECTED_SYSTEMS } from "@/types/researchCategories";
import type { ITechnicalBulletin } from "@/types/researchCategories";

export const BULLETIN_ITEM_TEMPLATE = {
  bulletin_id: "string | null (the manufacturer's TSB/技术通告 reference number if one is shown; null if unnumbered)",
  issue_description: "string (what the bulletin addresses, translated to English)",
  affected_component: `one of: ${AFFECTED_SYSTEMS.join(", ")}`,
  component_detail: "string | null (specific part/subsystem, e.g. '3DHT clutch actuator')",
  issued_date: "string | null (YYYY-MM-DD, or YYYY-MM if the day isn't given)",
  source_url: "string (the actual page URL — required)",
  confidence: "confirmed | unconfirmed",
};

export function buildBulletinKickoffPrompt(input: CategoryResearchInput): string {
  const { brandName, modelName, brandNameCn, modelNameCn } = input;
  const cnName = modelNameCn ?? (brandNameCn ? `${brandNameCn} ${modelName}` : undefined);
  return `You are a researcher looking for manufacturer technical service bulletins (TSBs, 技术通告 / 技术服务通报 / 服务通知) for a specific Chinese-market vehicle model, for an after-sales (SAV) operation that wants to know about known, manufacturer-acknowledged technical issues and their service procedures.

Model to research: "${brandName} ${modelName}"${cnName ? ` (${cnName})` : ""}

CHINESE-LANGUAGE SOURCES ONLY — this is a hard requirement: use Chinese auto-media/forum coverage and the manufacturer's own official after-sales/service pages. If a search result below is in English or from a non-Chinese, non-manufacturer site, IGNORE it completely.

Be realistic: most TSBs are dealer-portal-only and not publicly indexed. If the search results contain no actual bulletin (a specific manufacturer notice about a technical issue/procedure), report an empty list — do NOT present a general complaint, a recall notice, or an owner's forum post as a TSB, and do NOT invent a bulletin number or use general knowledge. An empty result is a correct answer.

For each genuine bulletin found note: its reference number (if shown), what it addresses, the affected component, the issue date, and the source URL.

Report your findings in plain prose with citations (the actual URL for each bulletin) — do not format as JSON yet.`;
}

export function buildBulletinFormatPrompt(): string {
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape ("technical_bulletins" is an array — each element describes the type each field must have, not a literal example value; return an empty array if no genuine bulletin was found):
${JSON.stringify({ technical_bulletins: [BULLETIN_ITEM_TEMPLATE] }, null, 2)}

${commonFormatRules([
  "Every bulletin must come from a Chinese-language or official-manufacturer source you actually found in the search results provided — do not invent one.",
  `"affected_component" must be exactly one of: ${AFFECTED_SYSTEMS.join(", ")}.`,
  '"source_url" is required on every item; drop an item you cannot cite. "confidence" is "confirmed" only if the bulletin itself was directly seen at that URL.',
])}`;
}

export async function researchBulletins(model: string, input: CategoryResearchInput): Promise<CategoryResearchResult<ITechnicalBulletin>> {
  const cn = searchName(input);
  return runCategoryResearch<ITechnicalBulletin>({
    model,
    label: "research-bulletins",
    input,
    kickoffPrompt: buildBulletinKickoffPrompt(input),
    formatPrompt: buildBulletinFormatPrompt(),
    searchQueries: [`${cn} 技术通告`, `${cn} 技术服务通报 TSB`, `${cn} 服务通知 售后 维修`, `${input.brandName} ${input.modelName} 技术通告 官方`],
    responseKey: "technical_bulletins",
    shape: "array",
    groundingFilter: (urls) => filterToChineseSources(urls, { includeManufacturer: true }),
    normalize: (raw) => normalizeBulletin(raw, { checkChineseSource: true }),
    forceUnconfirmed: (item) => {
      item.confidence = "unconfirmed";
    },
  });
}
