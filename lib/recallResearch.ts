// Model-level recall research — deliberately NOT source-restricted, unlike every other
// research category here. Recalls are published by regulators (China's SAMR 缺陷产品
// 召回 database, NHTSA and equivalents), by manufacturer press releases, and by
// international coverage; restricting to Chinese sources would miss real recall data
// for export markets. Grounding is therefore "any real search result", not an
// allowlist — the confidence gate still forces "unconfirmed" when the search returned
// nothing at all, and a source_url is required on every item.
//
// required_tools is a LINK to existing workshop data, not a tools schema (see
// IRecallRequiredTools). Research only sets uses_brand_diagnostic_interface / an
// extra_tool_note where the remedy text itself indicates it; special_tool_names is
// left for manual entry/import, since matching names against the model's resolved
// workshop tool list needs that list, which this research pass does not see.

import { normalizeRecall } from "@/lib/categoryValidators";
import { commonFormatRules, runCategoryResearch } from "@/lib/categoryResearch";
import type { CategoryResearchInput, CategoryResearchResult } from "@/lib/categoryResearch";
import { AFFECTED_SYSTEMS } from "@/types/researchCategories";
import type { IRecall } from "@/types/researchCategories";

export const RECALL_ITEM_TEMPLATE = {
  recall_id: "string | null (regulator/manufacturer recall or campaign number if shown)",
  issue_description: "string (the defect, translated to English)",
  affected_component: `one of: ${AFFECTED_SYSTEMS.join(", ")}`,
  component_detail: "string | null (specific part, e.g. 'high-voltage battery pack cell insulation')",
  recall_date: "string | null (YYYY-MM-DD, or YYYY-MM if the day isn't given)",
  remedy_description: "string (what the manufacturer will do to fix it, e.g. 'free software update' / 'replace battery pack')",
  affected_scope: "string | null (model years / VIN range / unit count if stated)",
  issuing_body: "string | null (e.g. 'SAMR', 'NHTSA', 'manufacturer press release')",
  required_tools: "object | null — null unless the remedy text itself indicates tooling: { uses_brand_diagnostic_interface: boolean (true if the remedy is a software update/reflash/coding that needs the brand's dealer diagnostic tool), special_tool_names: [] (leave empty), extra_tool_note: string | null (ONLY tooling beyond a standard workshop's diagnostic tool, if the source names it) }",
  source_url: "string (the actual page URL — required)",
  confidence: "confirmed | unconfirmed",
};

export function buildRecallKickoffPrompt(input: CategoryResearchInput): string {
  const { brandName, modelName, brandNameCn, modelNameCn } = input;
  const cnName = modelNameCn ?? (brandNameCn ? `${brandNameCn} ${modelName}` : undefined);
  return `You are a researcher documenting official vehicle recalls for a specific vehicle model, for an after-sales (SAV) operation that needs to know which recall campaigns exist and what each remedy requires in the workshop.

Model to research: "${brandName} ${modelName}"${cnName ? ` (${cnName})` : ""}

Sources are NOT restricted by language or country. Use regulator recall databases (China's SAMR 国家市场监督管理总局 缺陷产品召回, NHTSA and equivalent bodies in other markets), manufacturer recall press releases, and credible international or Chinese motoring-press coverage of a recall. Recalls in export markets count.

Only report a genuine recall campaign (a manufacturer/regulator-announced safety or compliance recall) — NOT a general complaint, an owner-forum grievance, or a technical service bulletin. If the search results below contain no actual recall for this model, report an empty list — do NOT invent a recall or use general knowledge. For each recall found note: the recall/campaign number if shown, the defect, the affected component, the recall date, the remedy, the affected scope (model years / VIN range / units), who issued it, whether the remedy needs the brand's diagnostic tool (e.g. a software reflash) or any tooling beyond that, and the source URL.

Report your findings in plain prose with citations (the actual URL for each recall) — do not format as JSON yet.`;
}

export function buildRecallFormatPrompt(): string {
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape ("recalls" is an array — each element describes the type each field must have, not a literal example value; return an empty array if no genuine recall was found):
${JSON.stringify({ recalls: [RECALL_ITEM_TEMPLATE] }, null, 2)}

${commonFormatRules([
  "Every recall must come from a source you actually found in the search results provided — do not invent one.",
  `"affected_component" must be exactly one of: ${AFFECTED_SYSTEMS.join(", ")}.`,
  '"source_url" and "remedy_description" are required on every item; drop an item you cannot cite. "confidence" is "confirmed" only if the recall was directly stated at that URL.',
])}`;
}

export async function researchRecalls(model: string, input: CategoryResearchInput): Promise<CategoryResearchResult<IRecall>> {
  const name = `${input.brandName} ${input.modelName}`;
  const cn = input.modelNameCn ?? (input.brandNameCn ? `${input.brandNameCn} ${input.modelName}` : name);
  return runCategoryResearch<IRecall>({
    model,
    label: "research-recalls",
    input,
    kickoffPrompt: buildRecallKickoffPrompt(input),
    formatPrompt: buildRecallFormatPrompt(),
    searchQueries: [`${name} recall`, `${cn} 召回`, `${cn} 召回 市场监管总局 缺陷产品`, `${name} recall NHTSA OR safety campaign`],
    responseKey: "recalls",
    shape: "array",
    groundingFilter: (urls) => urls,
    normalize: (raw) => normalizeRecall(raw),
    forceUnconfirmed: (item) => {
      item.confidence = "unconfirmed";
    },
  });
}
