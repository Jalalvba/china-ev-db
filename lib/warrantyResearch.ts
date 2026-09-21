// Brand-level warranty-terms research — Chinese-source-only variant of the
// Tier-1 pattern in lib/brandResearch.ts (same two-turn grounded research,
// validation, zero-citation confidence gate). HARD CONSTRAINT: every search
// query targets Chinese-language sources and every accepted source URL must
// pass lib/chineseSourceGuard.ts's domain allowlist — an English or
// third-country source is never allowed to ground this category, even if the
// LLM's raw formatted answer cites one (dropped in code, not just by prompt
// instruction). If nothing survives the allowlist, this is functionally
// "found nothing" and the confidence gate forces "unconfirmed".

import {
  WARRANTY_TIER_KINDS,
  WARRANTY_VEHICLE_USES,
  WARRANTY_POWERTRAINS,
  WARRANTY_LIMIT_RULES,
} from "@/types/warrantyTiers";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
export const WARRANTY_MANUAL_SCHEMA_VERSION = "warranty-manual-v1";

export interface WarrantyResearchInput {
  brandName: string;
  brandNameCn?: string;
}

/** One tier's shape, shared by the standalone warranty-manual-v1 prompt and dealership-ops-manual-v1. */
export const WARRANTY_TIER_SHAPE = `{ "tier_name": string, "kind": ${WARRANTY_TIER_KINDS.map((k) => `"${k}"`).join("|")}, "vehicle_use": ${WARRANTY_VEHICLE_USES.map((k) => `"${k}"`).join("|")}, "powertrain": ${WARRANTY_POWERTRAINS.map((k) => `"${k}"`).join("|")}, "duration_months": number|null, "duration_km": number|null, "is_lifetime": boolean|null, "limit_rule": ${WARRANTY_LIMIT_RULES.map((k) => `"${k}"`).join("|")}|null, "covered_parts": [string], "conditions": string|null, "clause_ref": string|null }`;

export const WARRANTY_FIELD_TEMPLATE = {
  tiers: `array of ${WARRANTY_TIER_SHAPE} — one entry per distinct warranty tier; empty array if the source states no tiers`,
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
- Every distinct warranty TIER the policy defines (whole-vehicle base, replacement/return, core components, special components, consumables — each with its own period, vehicle use, powertrain and parts list). Give each tier's period in months (8 years = 96) and km.

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

const TIER_KEYS = new Set(["tier_name", "kind", "vehicle_use", "powertrain", "duration_months", "duration_km", "is_lifetime", "limit_rule", "covered_parts", "conditions", "clause_ref"]);
const isPosNumOrNull = (x: unknown) => x === undefined || x === null || (typeof x === "number" && Number.isFinite(x) && x > 0);

/** Validates warranty_terms.tiers (absent/null = not stated). Shared by every warranty path so a tier can't pass one and fail another. */
export function validateWarrantyTiers(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return ["tiers: must be an array"];
  const errors: string[] = [];
  raw.forEach((item, i) => {
    const at = `tiers[${i}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    const t = item as Record<string, unknown>;
    for (const k of Object.keys(t)) if (!TIER_KEYS.has(k)) errors.push(`${at}.${k}: unexpected field, not in tier shape`);
    if (typeof t.tier_name !== "string" || t.tier_name.trim() === "") errors.push(`${at}.tier_name: required string`);
    const oneOf = (k: string, allowed: readonly string[], required: boolean) => {
      if (t[k] == null) {
        if (required) errors.push(`${at}.${k}: required, one of ${allowed.join("/")}`);
      } else if (typeof t[k] !== "string" || !allowed.includes(t[k] as string)) errors.push(`${at}.${k}: invalid value ${JSON.stringify(t[k])} (one of ${allowed.join("/")})`);
    };
    oneOf("kind", WARRANTY_TIER_KINDS, true);
    oneOf("vehicle_use", WARRANTY_VEHICLE_USES, true);
    oneOf("powertrain", WARRANTY_POWERTRAINS, true);
    oneOf("limit_rule", WARRANTY_LIMIT_RULES, false);
    if (!isPosNumOrNull(t.duration_months)) errors.push(`${at}.duration_months: must be a positive number or null (8 years = 96)`);
    if (!isPosNumOrNull(t.duration_km)) errors.push(`${at}.duration_km: must be a positive number or null`);
    if (t.is_lifetime != null && typeof t.is_lifetime !== "boolean") errors.push(`${at}.is_lifetime: must be boolean or null`);
    if (t.duration_months == null && t.duration_km == null && t.is_lifetime !== true) errors.push(`${at}: needs duration_months, duration_km or is_lifetime true`);
    if (!Array.isArray(t.covered_parts) || t.covered_parts.some((p) => typeof p !== "string" || p.trim() === "")) errors.push(`${at}.covered_parts: must be an array of non-empty strings`);
    else if (t.covered_parts.length === 0 && t.kind !== "replacement_return" && t.kind !== "whole_vehicle") errors.push(`${at}.covered_parts: empty is only allowed for replacement_return / whole_vehicle`);
    for (const k of ["conditions", "clause_ref"]) if (t[k] != null && typeof t[k] !== "string") errors.push(`${at}.${k}: must be string or null`);
  });
  return errors;
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
  errors.push(...validateWarrantyTiers(v.tiers));
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
  // A tier with no clause_ref can't be traced back inside the source document — not "confirmed".
  const tiers = warranty.tiers;
  if (Array.isArray(tiers) && tiers.some((t) => !(t as Record<string, unknown>)?.clause_ref)) warranty.confidence = "unconfirmed";
  return warranty;
}

// ---------- manual export/import (research-categories-v1-style envelope, single object) ----------

export interface WarrantyManualExportContext extends WarrantyResearchInput {
  brandId: string;
}

export function buildWarrantyManualExportPrompt(ctx: WarrantyManualExportContext): string {
  const envelope = { schema_version: WARRANTY_MANUAL_SCHEMA_VERSION, brand_id: ctx.brandId, warranty_terms: WARRANTY_FIELD_TEMPLATE };
  return `${buildWarrantyKickoffPrompt(ctx)}

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have, not a literal example value.
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "brand_id" exactly as shown.
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese source text before writing it), except do not translate a specific policy document's proper name if quoting it directly in "source".
- Every fact must come from a Chinese-language source you actually opened — do not estimate, infer from a sibling brand, or use a non-Chinese source.
- Use null for anything you cannot find a sourced Chinese value for. Do NOT guess.
- Do NOT add, rename, or omit any field from the shape above.`;
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

export interface WarrantyManualImportResult {
  valid: boolean;
  errors: string[];
  warranty_terms: Record<string, unknown> | null;
}

/** Parses + validates a pasted warranty-manual-v1 reply. Confidence forced "unconfirmed" if no "source" is given (mirrors applyWarrantyGroundingGate's zero-citation rule). */
export function parseWarrantyManualImport(rawText: string, brandId: string): WarrantyManualImportResult {
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], warranty_terms: null };
  const errors: string[] = [];
  if (obj.schema_version !== WARRANTY_MANUAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${WARRANTY_MANUAL_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.brand_id !== brandId) errors.push(`brand_id ${JSON.stringify(obj.brand_id)} does not match this brand (${brandId}) — pasted into the wrong brand's page?`);
  if (errors.length > 0) return { valid: false, errors, warranty_terms: null };

  const terms = obj.warranty_terms as Record<string, unknown> | null | undefined;
  if (!terms || typeof terms !== "object") return { valid: true, errors: [], warranty_terms: null };
  const { valid, errors: itemErrors } = validateResearchedWarranty(terms);
  if (!valid) return { valid: false, errors: itemErrors, warranty_terms: null };

  const gated = applyWarrantyGroundingGate({ ...terms }, !!terms.source);
  return { valid: true, errors: [], warranty_terms: gated };
}
