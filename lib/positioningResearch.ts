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

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
export const POSITIONING_MANUAL_SCHEMA_VERSION = "positioning-manual-v1";

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

// ---------- manual export/import (research-categories-v1-style envelope, single object) ----------

export interface PositioningManualExportContext extends PositioningResearchInput {
  modelId: string;
}

/** One-shot prompt for the manual round trip: paste into any external AI chat, paste its JSON reply into the importer. */
export function buildPositioningManualExportPrompt(ctx: PositioningManualExportContext): string {
  const envelope = {
    schema_version: POSITIONING_MANUAL_SCHEMA_VERSION,
    model_id: ctx.modelId,
    market_positioning: {
      text: "string | null (the positioning claim, translated to English, e.g. 'Positioned by Chinese media against the Honda CR-V')",
      source: "string | null (which Chinese source this came from)",
      confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
    },
  };
  return `${buildPositioningKickoffPrompt(ctx)}

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have, not a literal example value.
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "model_id" exactly as shown.
- OUTPUT LANGUAGE: "text" and "source" must be English — translate the Chinese framing faithfully, do not leave Chinese characters in the output.
- The claim must come from a Chinese-language source you actually opened — never invent a comparison.
- Use null for "text" if no Chinese source's own framing was found.
- Do NOT add, rename, or omit any field from the shape above.`;
}

export interface PositioningManualImportResult {
  valid: boolean;
  errors: string[];
  /** null when the model has "text": null (researched, nothing found) — nothing to apply. */
  market_positioning: Record<string, unknown> | null;
}

function extractJsonObjectLoose(text: string): Record<string, unknown> | null {
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

/** Parses + validates a pasted positioning-manual-v1 reply. Confidence is forced "unconfirmed" if no source is given — same rule the automated grounding gate used to enforce (see applyPositioningGroundingGate, kept for the automated-era write path's own use if ever revived). */
export function parsePositioningManualImport(rawText: string, modelId: string): PositioningManualImportResult {
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], market_positioning: null };
  const errors: string[] = [];
  if (obj.schema_version !== POSITIONING_MANUAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${POSITIONING_MANUAL_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.model_id !== modelId) errors.push(`model_id ${JSON.stringify(obj.model_id)} does not match this model (${modelId}) — pasted into the wrong model's page?`);
  if (errors.length > 0) return { valid: false, errors, market_positioning: null };

  const positioning = obj.market_positioning as Record<string, unknown> | null | undefined;
  if (positioning === null || positioning === undefined || !positioning.text) {
    return { valid: true, errors: [], market_positioning: null };
  }
  const { valid, errors: itemErrors } = validateResearchedPositioning(positioning);
  if (!valid) return { valid: false, errors: itemErrors, market_positioning: null };

  const gated = applyPositioningGroundingGate({ ...positioning }, !!positioning.source);
  return { valid: true, errors: [], market_positioning: gated };
}
