// Brand-level warranty-terms research — Chinese-source-only variant of the
// Tier-1 pattern in lib/brandResearch.ts (same two-turn grounded research,
// validation, zero-citation confidence gate). HARD CONSTRAINT: every search
// query targets Chinese-language sources and every accepted source URL must
// pass lib/chineseSourceGuard.ts's domain allowlist — an English or
// third-country source is never allowed to ground this category, even if the
// LLM's raw formatted answer cites one (dropped in code, not just by prompt
// instruction). If nothing survives the allowlist, this is functionally
// "found nothing" and the confidence gate forces "unconfirmed".

import { ModelNotFoundError, SearchProviderError, sleep } from "@/lib/techSpecResearch";
import { runGroundedResearch } from "@/lib/groundedResearch";
import { filterToChineseSources } from "@/lib/chineseSourceGuard";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

export interface WarrantyResearchInput {
  brandName: string;
  brandNameCn?: string;
}

const WARRANTY_FIELD_TEMPLATE = {
  ice_component_years: "number | null",
  ice_component_km: "number | null",
  battery_years: "number | null",
  battery_km: "number | null",
  motor_years: "number | null",
  motor_km: "number | null",
  source: "string | null (which Chinese source this came from, e.g. '官方质保政策页')",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export function buildWarrantyKickoffPrompt(input: WarrantyResearchInput): string {
  const { brandName, brandNameCn } = input;
  return `You are a researcher building a database of Chinese-market vehicle brands' official warranty policies, for an after-sales operation in Morocco that needs to know real warranty terms.

Brand to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language sources (official manufacturer 质保政策/三包政策 pages, 汽车之家, 懂车帝, 太平洋汽车网, 易车). If a search result below is in English or from a non-Chinese site (a Moroccan, European, or generic English-language automotive site), IGNORE it completely — do not use it as a source, even to corroborate a Chinese source. If you cannot find a Chinese-language source for a fact, report that field as not found (null) rather than using a non-Chinese source or your own general knowledge.

Research this brand's OFFICIAL warranty policy (质保政策/三包政策), specifically:
- The standard ICE/vehicle-body component warranty: how many years and how many km
- The HV battery warranty (often longer than the rest of the vehicle for a Chinese PHEV/BEV brand): years and km
- The electric motor warranty (sometimes bundled with the battery, sometimes separate): years and km

Search for official manufacturer service/warranty pages (质保政策, 三包政策, 保修政策) and Chinese auto-media coverage of the brand's warranty terms. Report your findings in plain prose with citations (include the actual URL for each fact) — do not format as JSON yet.`;
}

export function buildWarrantyFormatPrompt(): string {
  const templateJson = JSON.stringify({ warranty_terms: WARRANTY_FIELD_TEMPLATE }, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object is a field-by-field description of the type each field must have, not a literal example value):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese source text before writing it), except do not translate a specific policy document's proper name if quoting it directly in "source".
- Every fact must come from a Chinese-language source you actually found in the search results provided (grounding is enabled) — do not estimate, infer from a sibling brand, or use a non-Chinese source.
- Use null for anything you cannot find a sourced Chinese value for. Do NOT guess.
- Do NOT add, rename, or omit any field from the shape above.
- "source" should name which Chinese site/page the figures came from (e.g. "官方质保政策页" or "汽车之家").`;
}

const TOP_LEVEL_KEYS = new Set(Object.keys(WARRANTY_FIELD_TEMPLATE));

export interface ResearchedWarrantyTerms {
  ice_component_years?: number;
  ice_component_km?: number;
  battery_years?: number;
  battery_km?: number;
  motor_years?: number;
  motor_km?: number;
  source?: string;
  confidence?: string;
}

export function validateResearchedWarranty(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["warranty_terms is not an object"] };
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }
  for (const numField of ["ice_component_years", "ice_component_km", "battery_years", "battery_km", "motor_years", "motor_km"]) {
    if (v[numField] !== undefined && v[numField] !== null && typeof v[numField] !== "number") {
      errors.push(`${numField}: must be a number or null`);
    }
  }
  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }
  return { valid: errors.length === 0, errors };
}

/** Same rule as every other research lib: zero (post-allowlist) grounding citations means force "unconfirmed" regardless of self-report. */
export function applyWarrantyGroundingGate(warranty: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) warranty.confidence = "unconfirmed";
  return warranty;
}

interface WarrantyAgentResponse {
  warranty_terms?: unknown;
}

function extractJson(text: string): WarrantyAgentResponse | null {
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

async function queryWarrantyResearch(
  model: string,
  input: WarrantyResearchInput
): Promise<{ parsed: WarrantyAgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildWarrantyKickoffPrompt(input);
  const formatPrompt = buildWarrantyFormatPrompt();
  // Chinese-only search terms, deliberately — no English query added (unlike
  // buildVehicleSearchQueries), since an English query is what would surface
  // the non-Chinese sources this category must never use.
  const searchQueries = [
    `${input.brandName} 质保政策`,
    `${input.brandName} 三包政策`,
    `${input.brandNameCn ?? input.brandName} 电池质保`,
    `${input.brandNameCn ?? input.brandName} 保修政策`,
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
      console.error(`  [retry ${attempt}/${maxAttempts}] research-warranty ${input.brandName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface WarrantyResearchResult {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  warranty_terms?: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export async function researchWarranty(model: string, input: WarrantyResearchInput): Promise<WarrantyResearchResult> {
  try {
    const { parsed, sourceUrls: rawSourceUrls, rawText } = await queryWarrantyResearch(model, input);

    if (!parsed || !parsed.warranty_terms) {
      return {
        status: "error",
        errorMessage: `Could not parse a warranty_terms object from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        valid: false,
        errors: [],
      };
    }

    // Defense-in-depth: drop any source URL not on the Chinese-source
    // allowlist before it's allowed to count as grounding, regardless of
    // what the LLM claims it used.
    const sourceUrls = filterToChineseSources(rawSourceUrls);
    const hasGrounding = sourceUrls.length > 0;
    const { valid, errors } = validateResearchedWarranty(parsed.warranty_terms);
    if (!valid) {
      return { status: "not_found", sourceUrls, hasGrounding, warranty_terms: parsed.warranty_terms as Record<string, unknown>, valid, errors };
    }

    const gated = applyWarrantyGroundingGate({ ...(parsed.warranty_terms as Record<string, unknown>) }, hasGrounding);
    return { status: "found", sourceUrls, hasGrounding, warranty_terms: gated, valid: true, errors: [] };
  } catch (err) {
    if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
    return { status: "error", errorMessage: (err as Error).message, sourceUrls: [], hasGrounding: false, valid: false, errors: [] };
  }
}
