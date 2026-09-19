// Model-level market-positioning research — Chinese-source-only, mirrors
// models/Model.ts's existing notable_facts / notable_facts_confidence /
// notable_facts_last_researched_at single-string pattern exactly (see
// lib/applySpecUpdates.ts's notableFacts write path — this category follows
// the same shape so it could share that write path's structure, though it
// gets its own dedicated apply route to keep the Chinese-source allowlist
// check localized to this module rather than threaded through the shared
// spec-update path). See lib/warrantyResearch.ts's header for the shared
// Chinese-source-only reasoning and lib/chineseSourceGuard.ts for the
// allowlist.
//
// The point of this field specifically: capture how CHINESE sources
// themselves frame this model's competitive position (e.g. "对标本田CR-V"),
// not our own inference — so the kickoff prompt asks for direct framing
// language pulled from Chinese auto-media coverage, not a general
// competitive analysis.

import { ModelNotFoundError, SearchProviderError, sleep } from "@/lib/techSpecResearch";
import { runGroundedResearch } from "@/lib/groundedResearch";
import { filterToChineseSources } from "@/lib/chineseSourceGuard";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

export interface PositioningResearchInput {
  brandName: string;
  modelName: string;
  brandNameCn?: string;
  modelNameCn?: string;
}

export function buildPositioningKickoffPrompt(input: PositioningResearchInput): string {
  const { brandName, modelName, brandNameCn, modelNameCn } = input;
  const cnName = modelNameCn ?? (brandNameCn ? `${brandNameCn} ${modelName}` : undefined);
  return `You are a researcher documenting how Chinese automotive media itself frames a vehicle's competitive market position.

Model to research: "${brandName} ${modelName}"${cnName ? ` (${cnName})` : ""}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language auto-media sources (汽车之家, 懂车帝, 太平洋汽车网, 易车). If a search result below is in English or from a non-Chinese site, IGNORE it completely. If no Chinese source frames this model's positioning, report null rather than inventing your own comparison.

Find how CHINESE auto-media sources themselves describe this model's competitive positioning — e.g. phrases like "对标本田CR-V" (positioned against the Honda CR-V), "锁定合资紧凑型SUV市场" (targeting the compact joint-venture SUV market), or a direct named-competitor comparison from a Chinese review/article. This must be the SOURCE'S OWN framing, not your own inference about what competitors this model resembles.

Report your findings in plain prose with citations (include the actual URL) — do not format as JSON yet.`;
}

export function buildPositioningFormatPrompt(): string {
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object is a field-by-field description of the type each field must have, not a literal example value):
${JSON.stringify(
  {
    market_positioning: {
      text: "string | null (the positioning claim, translated to English, e.g. 'Positioned by Chinese media against the Honda CR-V')",
      source: "string | null (which Chinese source this came from)",
      confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
    },
  },
  null,
  2
)}

CRITICAL RULES:
- OUTPUT LANGUAGE: "text" and "source" must be English — translate the Chinese framing faithfully (e.g. translate "对标本田CR-V" as "positioned against the Honda CR-V"), do not leave Chinese characters in the output.
- The claim must come from a Chinese-language source you actually found in the search results provided (grounding is enabled) — do not invent a comparison yourself.
- Use null for "text" if no Chinese source's own framing was found. Do NOT guess or supply your own competitive analysis as a substitute.
- Do NOT add, rename, or omit any field from the shape above.`;
}

export interface ResearchedPositioning {
  text?: string;
  source?: string;
  confidence?: string;
}

export function validateResearchedPositioning(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["market_positioning is not an object"] };
  }
  const v = raw as Record<string, unknown>;
  const allowed = new Set(["text", "source", "confidence"]);
  for (const key of Object.keys(v)) {
    if (!allowed.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }
  if (v.text !== undefined && v.text !== null && typeof v.text !== "string") errors.push("text: must be a string or null");
  if (v.source !== undefined && v.source !== null && typeof v.source !== "string") errors.push("source: must be a string or null");
  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }
  return { valid: errors.length === 0, errors };
}

export function applyPositioningGroundingGate(positioning: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) positioning.confidence = "unconfirmed";
  return positioning;
}

interface PositioningAgentResponse {
  market_positioning?: unknown;
}

function extractJson(text: string): PositioningAgentResponse | null {
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

async function queryPositioningResearch(
  model: string,
  input: PositioningResearchInput
): Promise<{ parsed: PositioningAgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildPositioningKickoffPrompt(input);
  const formatPrompt = buildPositioningFormatPrompt();
  const cnName = input.modelNameCn ?? (input.brandNameCn ? `${input.brandNameCn} ${input.modelName}` : `${input.brandName} ${input.modelName}`);
  const searchQueries = [
    `${cnName} 对标`,
    `${cnName} 竞品对比`,
    `${input.brandName} ${input.modelName} 定位`,
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
      console.error(`  [retry ${attempt}/${maxAttempts}] research-positioning ${input.brandName} ${input.modelName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface PositioningResearchResult {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  market_positioning?: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export async function researchPositioning(model: string, input: PositioningResearchInput): Promise<PositioningResearchResult> {
  try {
    const { parsed, sourceUrls: rawSourceUrls, rawText } = await queryPositioningResearch(model, input);

    if (!parsed || !parsed.market_positioning) {
      return {
        status: "error",
        errorMessage: `Could not parse a market_positioning object from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        valid: false,
        errors: [],
      };
    }

    const sourceUrls = filterToChineseSources(rawSourceUrls);
    const hasGrounding = sourceUrls.length > 0;
    const { valid, errors } = validateResearchedPositioning(parsed.market_positioning);
    if (!valid) {
      return { status: "not_found", sourceUrls, hasGrounding, market_positioning: parsed.market_positioning as Record<string, unknown>, valid, errors };
    }

    const gated = applyPositioningGroundingGate({ ...(parsed.market_positioning as Record<string, unknown>) }, hasGrounding);
    return { status: "found", sourceUrls, hasGrounding, market_positioning: gated, valid: true, errors: [] };
  } catch (err) {
    if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
    return { status: "error", errorMessage: (err as Error).message, sourceUrls: [], hasGrounding: false, valid: false, errors: [] };
  }
}
