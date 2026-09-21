// See CLAUDE.md (Data model conventions) before changing this prompt or its validation — it's
// the frozen reference for what each ownership/grouping field is supposed to
// hold, and requires treating new correction claims as claims to verify, not
// facts to apply blindly.
//
// Tier-1 brand-identity research: for a Brand document, asks the configured
// AI provider (see lib/aiProvider.ts) to confirm/correct corporate/
// ownership facts — parent_group, relationship_type,
// stake_percentage, tech_partner, status, status_note, founded_year, name_cn,
// country_origin. Explicitly NOT models or specs — that's Tier 2
// (lib/modelDiscovery.ts, lib/techSpecResearch.ts), which now takes this
// tier's confirmed output as input context (see BrandContext below) instead
// of re-deriving ownership facts itself. Same two-turn grounded pattern,
// validation, and zero-citation confidence gate as the other two research
// libs, for the same reasons (see the comments there) — this supersedes the
// one-off manual DeepSeek ownership-audit chat prompts from earlier with a
// proper reusable, reviewed, source-cited agent.

import { BRAND_STATUSES, RELATIONSHIP_TYPES } from "@/models/Brand";

const STATUS_SET = new Set<string>(BRAND_STATUSES);
const RELATIONSHIP_SET = new Set<string>(RELATIONSHIP_TYPES);
const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
export const BRAND_MANUAL_SCHEMA_VERSION = "brand-manual-v1";

export interface BrandResearchInput {
  brandName: string;
  brandNameCn?: string;
  /** Current on-file values, if any — given as context so the AI confirms/corrects rather than re-deriving from a blank slate, same idea as techSpecResearch's existingTrimNames. */
  currentParentGroup?: string;
  currentCountryOrigin?: string;
  /** Rendered result of a real, code-level moteur.ma pre-fetch (see lib/moteurMaScraper.ts) — actual fetched/parsed data, not a request for the AI to go check itself. Callers (API routes) run the fetch and pass its rendered text here; omit only if the caller didn't run it. */
  moteurMaContext?: string;
}

const BRAND_FIELD_TEMPLATE = {
  name_cn: "string | null (original-language, typically Chinese, name)",
  parent_group: "string | null (the controlling company/group, if any)",
  relationship_type: RELATIONSHIP_TYPES.join(" | ") + " | null",
  stake_percentage: "number | null (parent's equity/control stake, 0-100)",
  tech_partner: "string | null (a technology/co-development partner, distinct from parent_group — e.g. Huawei on AITO)",
  country_origin: "string | null",
  founded_year: "number | null",
  status: BRAND_STATUSES.join(" | ") + " | null",
  status_note: "string | null (free text, e.g. why discontinued/merged, or an ownership-structure clarification)",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export function buildBrandResearchKickoffPrompt(input: BrandResearchInput): string {
  const { brandName, brandNameCn, currentParentGroup, currentCountryOrigin, moteurMaContext } = input;
  return `You are a researcher building a database of Chinese-market vehicle brands' corporate structure and ownership. Real web search results for this brand are provided below — base your research ONLY on those, do not answer from memory alone.

Brand to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}
${currentParentGroup ? `Currently on file — parent group: ${currentParentGroup}` : ""}
${currentCountryOrigin ? `Currently on file — country of origin: ${currentCountryOrigin}` : ""}

${
  moteurMaContext
    ? `${moteurMaContext} This is not one of the structured fields below, so if it says the brand IS listed, record a line in the "notes" field instead (e.g. "Listed on moteur.ma — market presence in Morocco") — it's a useful signal for Tier-2 model/spec research on this brand later. Do not re-search moteur.ma yourself, this was already fetched directly.`
    : ""
}

Research ONLY this brand's corporate identity and ownership — do NOT research its vehicle models or specs, that is out of scope here:
- Who owns/controls it (parent group / controlling company), and the nature of that relationship (wholly-owned subsidiary, joint venture, minority stake, contract manufacturing, technology partnership, or fully independent)
- Any equity/control stake percentage, if disclosed
- Any technology partner distinct from ownership (e.g. a brand co-developed with a tech company but not owned by it)
- Country of origin, founding year
- Current status: active, discontinued, bankrupt, or merged into another entity — and why, if status changed

Search for sources such as official company filings/press releases, Chinese automotive/business press (e.g. 汽车之家, 懂车帝, 36氪, Caixin), and Wikipedia/company registries. Report your findings in plain prose with citations — do not format as JSON yet.`;
}

export function buildBrandResearchFormatPrompt(): string {
  const templateJson = JSON.stringify({ brand: BRAND_FIELD_TEMPLATE, notes: "string" }, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object is a field-by-field description of the type each field must have, not a literal example value):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value in your JSON response must be English — "status_note", "tech_partner", "notes", everything — with exactly one exception: "name_cn" is explicitly the ORIGINAL-LANGUAGE name and must stay in its original script. If a source fact is in Chinese, translate it into English before writing it anywhere else. Never leave Chinese (or any other non-English) characters in any field other than "name_cn".
- Every fact must come from a search result you actually found (grounding is enabled) — do not estimate or infer from similar brands.
- Use null for anything you cannot find a sourced value for. Do NOT guess.
- "relationship_type" must be exactly one of: ${RELATIONSHIP_TYPES.join(", ")} — or null if unclear.
- "status" must be exactly one of: ${BRAND_STATUSES.join(", ")} — or null if unclear.
- Do NOT add, rename, or omit any field from the shape above.
- Do NOT include any model/vehicle/spec information — this is brand-identity only.`;
}

const TOP_LEVEL_KEYS = new Set([
  "name_cn",
  "parent_group",
  "relationship_type",
  "stake_percentage",
  "tech_partner",
  "country_origin",
  "founded_year",
  "status",
  "status_note",
  "confidence",
]);

export interface ResearchedBrand {
  name_cn?: string;
  parent_group?: string;
  relationship_type?: string;
  stake_percentage?: number;
  tech_partner?: string;
  country_origin?: string;
  founded_year?: number;
  status?: string;
  status_note?: string;
  confidence?: string;
}

/** Validates the researched-brand object's shape (extra/renamed keys, bad enum values, wrong types). */
export function validateResearchedBrand(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["brand is not an object"] };
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }
  if (v.relationship_type !== undefined && v.relationship_type !== null && (typeof v.relationship_type !== "string" || !RELATIONSHIP_SET.has(v.relationship_type))) {
    errors.push(`relationship_type: invalid value ${JSON.stringify(v.relationship_type)}`);
  }
  if (v.status !== undefined && v.status !== null && (typeof v.status !== "string" || !STATUS_SET.has(v.status))) {
    errors.push(`status: invalid value ${JSON.stringify(v.status)}`);
  }
  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }
  if (v.stake_percentage !== undefined && v.stake_percentage !== null && typeof v.stake_percentage !== "number") {
    errors.push("stake_percentage: must be a number or null");
  }
  return { valid: errors.length === 0, errors };
}

/** Same rule as the other two research libs: zero grounding citations means force "unconfirmed" regardless of self-report. Mutates and returns the brand. */
export function applyBrandGroundingGate(brand: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) brand.confidence = "unconfirmed";
  return brand;
}

// ---------- manual export/import (research-categories-v1-style envelope, single object) ----------

export interface BrandManualExportContext extends BrandResearchInput {
  brandId: string;
}

export function buildBrandManualExportPrompt(ctx: BrandManualExportContext): string {
  const envelope = { schema_version: BRAND_MANUAL_SCHEMA_VERSION, brand_id: ctx.brandId, brand: BRAND_FIELD_TEMPLATE, notes: "string" };
  return `${buildBrandResearchKickoffPrompt(ctx)}

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have, not a literal example value.
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "brand_id" exactly as shown.
- OUTPUT LANGUAGE: every string value must be English, except "name_cn" (kept in its original script). Translate any Chinese source text before writing it elsewhere.
- Every fact must come from a source you actually opened — do not estimate or infer from similar brands.
- Use null for anything you cannot find a sourced value for. Do NOT guess.
- "relationship_type" must be exactly one of: ${RELATIONSHIP_TYPES.join(", ")} — or null.
- "status" must be exactly one of: ${BRAND_STATUSES.join(", ")} — or null.
- Do NOT add, rename, or omit any field from the shape above.
- Do NOT include any model/vehicle/spec information — this is brand-identity only.`;
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

export interface BrandManualImportResult {
  valid: boolean;
  errors: string[];
  brand: Record<string, unknown> | null;
}

/** Parses + validates a pasted brand-manual-v1 reply. Confidence is forced "unconfirmed" if the reply cites no source-bearing "notes"/status_note evidence — mirrors applyBrandGroundingGate's zero-citation rule, applied here on absence of any status_note/notes text since a manual paste carries no source-URL list of its own. */
export function parseBrandManualImport(rawText: string, brandId: string): BrandManualImportResult {
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], brand: null };
  const errors: string[] = [];
  if (obj.schema_version !== BRAND_MANUAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${BRAND_MANUAL_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.brand_id !== brandId) errors.push(`brand_id ${JSON.stringify(obj.brand_id)} does not match this brand (${brandId}) — pasted into the wrong brand's page?`);
  if (errors.length > 0) return { valid: false, errors, brand: null };

  const brand = obj.brand as Record<string, unknown> | null | undefined;
  if (!brand || typeof brand !== "object") return { valid: true, errors: [], brand: null };
  const { valid, errors: itemErrors } = validateResearchedBrand(brand);
  if (!valid) return { valid: false, errors: itemErrors, brand: null };

  const hasEvidence = !!(brand.status_note || (typeof obj.notes === "string" && obj.notes.trim() !== ""));
  const gated = applyBrandGroundingGate({ ...brand }, hasEvidence);
  return { valid: true, errors: [], brand: gated };
}
