// Model-level known-issues / failure-pattern research — Chinese-source-only.
// See lib/warrantyResearch.ts's header for the shared Chinese-source-only
// reasoning and lib/chineseSourceGuard.ts for the allowlist. Unlike the other
// three categories, this one is an ARRAY of items (each with its own
// per-item confidence, per the user's spec), so the grounding gate applies
// per-item rather than to a single top-level confidence field.
//
// 车质网 (12365auto.com) and 汽车投诉网 (the official/semi-official vehicle
// quality complaint platforms) are explicitly prioritized in the prompt —
// per the user's instruction, this is the single most valuable Chinese
// source for real-world failure data, so the search queries and kickoff
// prompt call it out by name rather than leaving it as one option among
// several generic auto-media sites.

import { ModelNotFoundError, SearchProviderError, sleep } from "@/lib/techSpecResearch";
import { runGroundedResearch } from "@/lib/groundedResearch";
import { filterToChineseSources } from "@/lib/chineseSourceGuard";
import { filterIssuesToTargetModel } from "@/lib/categoryValidators";
import { exactModelRulePrompt, ISSUE_ATTESTATION_TEMPLATE } from "@/lib/categoryResearch";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
const AFFECTED_SYSTEMS = ["engine", "battery", "motor", "transmission", "electronics", "chassis", "body", "climate", "other"];
const AFFECTED_SYSTEMS_SET = new Set(AFFECTED_SYSTEMS);

export interface IssueResearchInput {
  brandName: string;
  modelName: string;
  brandNameCn?: string;
  modelNameCn?: string;
  generation?: string;
  modelYear?: number;
}

const ISSUE_ITEM_TEMPLATE = {
  issue_description: "string (concise description of the reported issue/failure pattern)",
  affected_systems: `array of one or more of: ${AFFECTED_SYSTEMS.join(", ")}`,
  frequency_signal: "string | null (e.g. complaint volume/rank on 车质网 if stated, or 'multiple reports' / 'isolated report' if volume isn't quantified)",
  source: "string (which Chinese source this came from, e.g. '车质网' or '汽车投诉网')",
  source_url: "string | null (the actual page URL for this issue, if known)",
  confidence: [...CONFIDENCE_SET].join(" | "),
};

export function buildIssueKickoffPrompt(input: IssueResearchInput): string {
  const { brandName, modelName, brandNameCn, modelNameCn } = input;
  const cnName = modelNameCn ?? (brandNameCn ? `${brandNameCn} ${modelName}` : undefined);
  return `You are a researcher documenting real-world reported failure patterns / common issues for a specific Chinese-market vehicle model, for an after-sales (SAV) operation that wants to know what to expect in the workshop.

Model to research: "${brandName} ${modelName}"${cnName ? ` (${cnName})` : ""}

${exactModelRulePrompt(input)}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language sources. PRIORITIZE 车质网 (12365auto.com, China's official vehicle-quality complaint platform) and 汽车投诉网 (tousu.99.com) above any other source — these are the single most valuable sources for real-world failure data because they aggregate actual owner complaints, not marketing copy. 汽车之家/懂车帝 forum or review coverage of known issues is acceptable as a secondary source. If a search result below is in English or from a non-Chinese site, IGNORE it completely. If nothing is found in Chinese sources, report an empty list rather than inventing plausible-sounding issues or using general knowledge about the brand/segment.

Find specific, named reported issues/failure patterns for this model — not generic statements like "some owners report problems." For each issue found, note:
- What the issue is
- Which vehicle system(s) it affects (engine, battery, motor, transmission, electronics, chassis, body, climate control, or other)
- Any frequency signal — e.g. a complaint count/ranking shown on 车质网, or whether the source describes it as a widespread vs. isolated report
- Which specific Chinese source reported it, and the page URL

Report your findings in plain prose with citations (include the actual URL for each issue) — do not format as JSON yet.`;
}

export function buildIssueFormatPrompt(): string {
  const templateJson = JSON.stringify({ known_issues: [{ ...ISSUE_ITEM_TEMPLATE, ...ISSUE_ATTESTATION_TEMPLATE }] }, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape ("known_issues" is an array — each element is a field-by-field description of the type each field must have, not a literal example value; return an empty array if nothing was found):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese source text before writing it), except do not translate a specific site's proper name if quoting it directly in "source" (e.g. "车质网" is fine).
- Every issue must come from a Chinese-language source you actually found in the search results provided (grounding is enabled) — do not invent an issue or use general knowledge.
- "affected_systems" must be an array containing only values from: ${AFFECTED_SYSTEMS.join(", ")}.
- "confidence" is required on every item — mark "confirmed" only if the specific issue was directly stated in a fetched Chinese source.
- EXACT MODEL ONLY: include an item only if the source is about the exact target model and generation. Never write "related variant"/"similar model" items — leave them out. "source_model_name" must be copied from the source (e.g. the model name as 车质网 or 汽车之家 lists it); if it is not the target model's own name, the item is dropped by code.
- Return an empty array for "known_issues" if nothing was found — do NOT pad the list with generic/plausible-sounding issues.
- Do NOT add, rename, or omit any field from the item shape above.`;
}

export interface ResearchedIssue {
  issue_description?: string;
  affected_systems?: string[];
  frequency_signal?: string;
  source?: string;
  confidence?: string;
}

/** Validates the array shape + each item's fields (extra/renamed keys, bad enum values, wrong types). */
export function validateResearchedIssues(raw: unknown): { valid: boolean; errors: string[] } {
  if (!Array.isArray(raw)) return { valid: false, errors: ["known_issues is not an array"] };
  const errors: string[] = [];
  const allowed = new Set(Object.keys(ISSUE_ITEM_TEMPLATE));
  raw.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`[${i}]: not an object`);
      return;
    }
    const v = item as Record<string, unknown>;
    for (const key of Object.keys(v)) {
      if (!allowed.has(key)) errors.push(`[${i}].${key}: unexpected field, not in canonical shape`);
    }
    if (typeof v.issue_description !== "string" || v.issue_description.trim() === "") {
      errors.push(`[${i}].issue_description: required non-empty string`);
    }
    if (!Array.isArray(v.affected_systems) || v.affected_systems.length === 0 || v.affected_systems.some((s) => typeof s !== "string" || !AFFECTED_SYSTEMS_SET.has(s))) {
      errors.push(`[${i}].affected_systems: must be a non-empty array of valid system values`);
    }
    if (v.frequency_signal !== undefined && v.frequency_signal !== null && typeof v.frequency_signal !== "string") {
      errors.push(`[${i}].frequency_signal: must be a string or null`);
    }
    if (typeof v.source !== "string" || v.source.trim() === "") {
      errors.push(`[${i}].source: required non-empty string`);
    }
    if (v.source_url !== undefined && v.source_url !== null && typeof v.source_url !== "string") {
      errors.push(`[${i}].source_url: must be a string or null`);
    }
    if (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence)) {
      errors.push(`[${i}].confidence: invalid value ${JSON.stringify(v.confidence)}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

/**
 * Per-item grounding gate — zero (post-allowlist) grounding citations means
 * every item's confidence is forced to "unconfirmed", regardless of
 * self-report. Mutates and returns the array.
 */
export function applyIssuesGroundingGate(issues: Record<string, unknown>[], hasGrounding: boolean): Record<string, unknown>[] {
  if (!hasGrounding) issues.forEach((i) => (i.confidence = "unconfirmed"));
  return issues;
}

interface IssueAgentResponse {
  known_issues?: unknown;
}

function extractJson(text: string): IssueAgentResponse | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) return null;
  try {
    return JSON.parse(candidate.slice(braceStart, braceEnd + 1));
  } catch {
    return null;
  }
}

async function queryIssueResearch(
  model: string,
  input: IssueResearchInput
): Promise<{ parsed: IssueAgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildIssueKickoffPrompt(input);
  const formatPrompt = buildIssueFormatPrompt();
  const cnName = input.modelNameCn ?? (input.brandNameCn ? `${input.brandNameCn} ${input.modelName}` : `${input.brandName} ${input.modelName}`);
  const searchQueries = [
    `${cnName} 车质网 投诉`,
    `${cnName} 质量问题`,
    `${cnName} 故障`,
    `${input.brandName} ${input.modelName} 汽车投诉网`,
  ];

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { formattedText, sourceUrls } = await runGroundedResearch({ kickoffPrompt, formatPrompt, searchQueries, model });
      return { parsed: extractJson(formattedText), sourceUrls, rawText: formattedText };
    } catch (err) {
      if (err instanceof ModelNotFoundError) throw err;
      if (err instanceof SearchProviderError) throw err;
      lastErr = err;
      const backoffMs = 2000 * attempt;
      console.error(`  [retry ${attempt}/${maxAttempts}] research-issues ${input.brandName} ${input.modelName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface IssueResearchResult {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  known_issues?: Record<string, unknown>[];
  valid: boolean;
  errors: string[];
  /** Items rejected by the exact-model filter, with the reason (indices refer to the raw researched array). */
  dropped?: { index: number; errors: string[] }[];
}

export async function researchIssues(model: string, input: IssueResearchInput): Promise<IssueResearchResult> {
  try {
    const { parsed, sourceUrls: rawSourceUrls, rawText } = await queryIssueResearch(model, input);

    if (!parsed || parsed.known_issues === undefined) {
      return {
        status: "error",
        errorMessage: `Could not parse a known_issues array from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        valid: false,
        errors: [],
      };
    }

    const sourceUrls = filterToChineseSources(rawSourceUrls);
    const hasGrounding = sourceUrls.length > 0;

    // Hard exact-model filter (lib/categoryValidators.ts) BEFORE validation: keeps only items
    // attested + code-verified as about the target model, and strips the attestation keys so
    // the persisted item shape is unchanged. Rejections are returned, never silently lost.
    const { kept, rejected } = filterIssuesToTargetModel(parsed.known_issues, { brandName: input.brandName, modelName: input.modelName, modelNameCn: input.modelNameCn });
    const offModel = rejected.map((r) => ({ index: r.index, errors: [`off-model: ${r.reason}`] }));

    const { valid, errors } = validateResearchedIssues(kept);
    if (!valid) {
      return { status: "not_found", sourceUrls, hasGrounding, known_issues: kept as Record<string, unknown>[], valid, errors, dropped: offModel };
    }

    const gated = applyIssuesGroundingGate((kept as Record<string, unknown>[]).map((i) => ({ ...i })), hasGrounding);
    return { status: "found", sourceUrls, hasGrounding, known_issues: gated, valid: true, errors: [], dropped: offModel };
  } catch (err) {
    if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
    return { status: "error", errorMessage: (err as Error).message, sourceUrls: [], hasGrounding: false, valid: false, errors: [] };
  }
}
