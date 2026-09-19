// Model-level known-issues research for the GLOBAL (international / export-market)
// population — the counterpart to lib/issueResearch.ts's Chinese-market pass. Chinese
// 车质网/汽车投诉网 complaint data and export-market owner/consumer complaints are
// different populations and must not be silently merged, so this pass:
//   - is NOT restricted to Chinese sources (it's the opposite), and
//   - only counts NON-Chinese-allowlist URLs as grounding, so a Chinese complaint-
//     platform hit can't launder its way in as "global" evidence.
// Items are stamped region: "global" and written by ../apply-issues (region param).

import { isAllowedChineseSource } from "@/lib/chineseSourceGuard";
import { normalizeIssue } from "@/lib/categoryValidators";
import { filterIssueItems } from "@/lib/genericnessFilter";
import { commonFormatRules, exactModelRulePrompt, ISSUE_ATTESTATION_TEMPLATE, ISSUE_SPECIFICITY_TEMPLATE, POWERTRAIN_FORMAT_RULE, SPECIFICITY_FORMAT_RULE, runCategoryResearch, specificityRulePrompt, targetOf } from "@/lib/categoryResearch";
import type { CategoryResearchInput, CategoryResearchResult } from "@/lib/categoryResearch";
import { AFFECTED_SYSTEMS } from "@/types/researchCategories";
import type { IKnownIssue } from "@/types";

export const GLOBAL_ISSUE_ITEM_TEMPLATE = {
  issue_description: "string (concise description of the reported issue/failure pattern)",
  affected_systems: `array of one or more of: ${AFFECTED_SYSTEMS.join(", ")}`,
  frequency_signal: "string | null (e.g. 'recurring across owner-forum threads' / 'single review mention' — only what the source actually indicates)",
  source: "string (publication/site name, e.g. 'Autocar', 'Reddit r/cars', 'wandaloo.com')",
  source_url: "string (the actual page URL)",
  confidence: "confirmed | unconfirmed",
};

export function buildGlobalIssueKickoffPrompt(input: CategoryResearchInput): string {
  const { brandName, modelName } = input;
  return `You are a researcher documenting real-world reported failure patterns / common issues for a specific vehicle model as experienced by owners OUTSIDE mainland China (export markets), for an after-sales (SAV) operation in Morocco that wants to know what to expect in the workshop.

Model to research: "${brandName} ${modelName}"

${exactModelRulePrompt(input)}${specificityRulePrompt()}

This is the INTERNATIONAL / export-market pass. Use English, French or Arabic sources: owner forums and communities, independent long-term reviews and motoring-press reliability coverage, consumer/regulator complaint databases (e.g. NHTSA where the model is sold there), and importer/dealer-market coverage for markets such as Morocco, Europe, the Middle East, Australia, Southeast Asia or Latin America.
DO NOT use Chinese-market complaint platforms (车质网/12365auto.com, 汽车投诉网/tousu.99.com) or other Chinese-language sources — that population is covered by a separate, Chinese-only pass and must not be mixed in here. If a search result below is a Chinese-language or Chinese-platform source, IGNORE it.

Find specific, named reported issues — not generic statements like "some owners report problems." If nothing credible is found, report an empty list rather than inventing plausible-sounding issues or using general knowledge about the brand/segment. For each issue note what it is, which system(s) it affects, any frequency signal the source itself gives, and the source with its URL.

Report your findings in plain prose with citations (the actual URL for each issue) — do not format as JSON yet.`;
}

export function buildGlobalIssueFormatPrompt(): string {
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape ("known_issues" is an array — each element describes the type each field must have, not a literal example value; return an empty array if nothing was found):
${JSON.stringify({ known_issues: [{ ...GLOBAL_ISSUE_ITEM_TEMPLATE, ...ISSUE_ATTESTATION_TEMPLATE, ...ISSUE_SPECIFICITY_TEMPLATE }] }, null, 2)}

${commonFormatRules([
  "Every issue must come from a non-Chinese-market source you actually found in the search results provided (grounding is enabled) — do not invent an issue or use general knowledge.",
  POWERTRAIN_FORMAT_RULE,
  SPECIFICITY_FORMAT_RULE,
  'EXACT MODEL ONLY: include an item only if the source is about the exact target model. Never write "related variant"/"similar model" items — leave clearly off-model reports out. "source_model_name" must be copied from the source; if it is not the target model\'s own name, the item is dropped by code. "same_generation": use "not_stated" when the source names the right model but no year/generation — do NOT omit the item for that reason.',
  `"affected_systems" must be an array containing only values from: ${AFFECTED_SYSTEMS.join(", ")}.`,
  '"confidence" is "confirmed" only if the specific issue was directly stated in a fetched source and "source_url" is that page.',
])}`;
}

export async function researchGlobalIssues(model: string, input: CategoryResearchInput): Promise<CategoryResearchResult<IKnownIssue>> {
  const name = `${input.brandName} ${input.modelName}`;
  return runCategoryResearch<IKnownIssue>({
    model,
    label: "research-global-issues",
    input,
    kickoffPrompt: buildGlobalIssueKickoffPrompt(input),
    formatPrompt: buildGlobalIssueFormatPrompt(),
    searchQueries: [`${name} common problems`, `${name} reliability owner complaints`, `${name} problèmes fiabilité`, `${name} owners forum issues`],
    responseKey: "known_issues",
    shape: "array",
    verify: true,
    // Inverse of the Chinese guard: grounding must come from OUTSIDE the Chinese-market allowlist.
    groundingFilter: (urls) => urls.filter((u) => !isAllowedChineseSource(u)),
    preFilter: (raw) => filterIssueItems(raw, targetOf(input)),
    normalize: (raw) => normalizeIssue(raw, "global"),
    forceUnconfirmed: (item) => {
      item.confidence = "unconfirmed";
    },
  });
}
