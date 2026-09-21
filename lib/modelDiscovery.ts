// Brand-level "discover models" research: for a brand with zero (or
// incomplete) Model documents, builds a prompt asking an external AI chat to
// find its current model lineup, and validates the pasted-back JSON into
// candidate Model records for review — never writes to MongoDB itself (see
// app/api/brands/[id]/create-models/route.ts for that).
//
// This is deliberately a separate step from lib/techSpecResearch.ts's
// per-model spec research: that pipeline researches POWERTRAIN variants for
// an EXISTING Model document and has nowhere to attach results without one.
// 115 of this project's 147 brands (as of this writing) have zero Model
// docs — mostly brand-only metadata from the delta-report import shape (see
// scripts/import-deepseek.ts's Shape 2) — so model discovery is the common
// case that needs solving, not a one-off.
//
// 2026-09-21: this used to also call the AI provider directly
// (runGroundedResearch) via an automated "Discover models" button — the last
// remaining automated-AI-call trigger in the app. That live-call path
// (queryDiscovery/discoverModels) was removed; see the manual export/import
// functions near the bottom of this file (buildModelDiscoveryManualExportPrompt/
// parseModelDiscoveryManualImport), which reuse the same prompt builders and
// validator.

import { SEGMENTS, PRODUCTION_STATUSES } from "@/models/Model";
import { buildBrandContextBlock, type BrandContext } from "@/lib/brandContext";

const SEGMENT_SET = new Set<string>(SEGMENTS);
const PRODUCTION_STATUS_SET = new Set<string>(PRODUCTION_STATUSES);
const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
const SEGMENT_CONFIDENCE_SET = new Set(["confirmed", "inferred"]);

export interface ModelDiscoveryInput {
  brandName: string;
  brandNameCn?: string;
  parentGroup?: string;
  /** Model names already on file for this brand, if any — asks the AI to skip these rather than re-suggest them as "new". */
  existingModelNames?: string[];
  /** Confirmed Tier-1 brand-identity facts (see lib/brandResearch.ts), if this brand has been researched. Optional: model discovery still works without it. */
  brandContext?: BrandContext;
  /** Rendered result of a real, code-level moteur.ma pre-fetch (see lib/moteurMaScraper.ts) — actual fetched/parsed data, not a request for the AI to go check itself. */
  moteurMaContext?: string;
}

const DISCOVERY_FIELD_TEMPLATE = {
  name: "string (the model's INTERNATIONAL/EXPORT market name if it's exported anywhere, e.g. \"Coolray\" not the domestic-China name \"Boyue Pro\" — see the export-scope rules above; only use the domestic Chinese name here if the model is genuinely domestic-only)",
  name_cn: "string | null (the domestic Chinese-market name/badge, if different from `name` above — this is where a domestic name like \"Boyue Pro\" belongs when `name` is the export name \"Coolray\")",
  name_en: "string | null",
  regional_name_note: "string | null (if this model is sold under DIFFERENT names in different export regions, note the other regional names here as free text, e.g. \"Sold as Coolray in most export markets; also marketed as Vision X6 Pro in some Middle East/Africa markets.\" — do not create a separate model entry per regional name)",
  generation: "string | null (e.g. \"2026\" or a generation label, if known)",
  segment: SEGMENTS.join(" | ") + " (NEVER null — see segment_confidence below and the CRITICAL RULES for how to fill this in even without a source)",
  segment_confidence: "\"confirmed\" | \"inferred\" (\"confirmed\" only if a real search result backs this segment; \"inferred\" if you had to classify it from your own knowledge of the vehicle's body type/size/positioning with no direct source)",
  body_type: "string | null (e.g. \"5-door SUV\", \"4-door sedan\")",
  production_status: PRODUCTION_STATUSES.join(" | ") + " | null",
  price_range: {
    min: "number | null (the DOMESTIC mainland-China price in CNY — NOT an export-market price, even though this model may be scoped in because it's exported. Export-market pricing, e.g. Morocco DH, is tracked separately in the MoroccoListing collection, not here.)",
    max: "number | null (same currency as min)",
    currency_local: "string | null (should almost always be \"CNY\" — this is the domestic China price, not the export market's local currency)",
  },
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export function buildModelDiscoveryKickoffPrompt(input: ModelDiscoveryInput): string {
  const { brandName, brandNameCn, parentGroup, existingModelNames, brandContext, moteurMaContext } = input;
  return `You are a researcher building a database of Chinese-market vehicle brands and their model lineups. Real web search results for this brand are provided below — base your research ONLY on those, do not answer from memory alone.

Brand to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}${parentGroup ? `\nParent group / manufacturer: ${parentGroup}` : ""}${buildBrandContextBlock(brandContext)}

${
  moteurMaContext
    ? `${moteurMaContext} This isn't one of the structured per-model fields below (Morocco market data is tracked separately, in the MoroccoListing collection, not here), so if it names models, add a line to the top-level "notes" field instead — e.g. "Song Plus listed on moteur.ma at 259,900 DH" — citing moteur.ma. Do not re-search moteur.ma yourself, this was already fetched directly.`
    : ""
}

Find this brand's current production model lineup (and notable recently-discontinued or announced-upcoming models). For each model, note: its name, generation/year, vehicle segment (e.g. compact sedan, mid-size SUV), body type, production status, and its DOMESTIC mainland-China price in CNY if you find one (NOT an export-market price — export scoping below decides which models to include, it does not change what currency the price field is in).

SCOPE — this database exists to cross-reference vehicles against export markets (Morocco specifically, but any export market counts), so apply this rule to EVERY brand, not just brands you'd expect to export:
- Only include models that are actually exported/sold outside mainland China — any export market (Southeast Asia, Middle East, Africa, Latin America, Europe, etc.), currently OR historically. A model sold only in mainland China with no export history should be EXCLUDED — it's noise for this database's actual use case.
- If genuinely uncertain whether a specific model has ever been exported, err toward INCLUDING it rather than silently dropping it — but note the uncertainty (set confidence to unconfirmed and say so in "notes") rather than guessing either way.
- When a model IS exported, its name in this database must be the INTERNATIONAL/EXPORT market name, not the domestic Chinese-market name — e.g. Geely's domestic "Boyue Pro" must be recorded as "Coolray" (its export name), not as a separate "Boyue Pro" entry alongside or instead of "Coolray". Put the domestic Chinese name in "name_cn" if it differs from the export name, don't treat them as two different models.
- If a model is sold under different names in different export regions, use the single most globally common/recognized export name as the primary name, and note the other regional names in "regional_name_note" — never create multiple model entries for what's mechanically the same vehicle under different regional badges.
${
  existingModelNames?.length
    ? `\nAlready on file for this brand (do not re-report these as if they were new, but you may correct/update details about them if you find something different): ${existingModelNames.join(", ")}`
    : ""
}

Search for sources such as the brand's official site, autohome.com.cn (汽车之家), dongchedi.com (懂车帝), and MIIT (工信部) filings. Report your findings in plain prose with citations — do not format as JSON yet.`;
}

export function buildModelDiscoveryFormatPrompt(): string {
  const templateJson = JSON.stringify({ models: [DISCOVERY_FIELD_TEMPLATE], notes: "string" }, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object is a field-by-field description of the type each field must have, not a literal example value — one object per model you found):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English — "regional_name_note", "notes", everything — with exactly two exceptions: "name_cn" is explicitly the ORIGINAL-LANGUAGE (Chinese) name and must stay in its original script, and "name" must stay in whatever script the vehicle's actual international/export nameplate uses (per the naming rules above). If a source fact is in Chinese, translate it into English before writing it into any other field. Never leave Chinese (or any other non-English) characters anywhere else.
- Every fact must come from a search result you actually found (grounding is enabled) — do not estimate or infer from similar brands/models.
- Use null for anything you cannot find a sourced value for. Do NOT guess. The ONE explicit exception is "segment" — see below.
- SEGMENT IS MANDATORY, NEVER NULL: you MUST classify this vehicle's segment (${SEGMENTS.join(", ")}) even if you cannot find a direct source confirming it. If no source is found, use your own knowledge of the vehicle's body type, size, and market positioning to infer the most likely segment — never return null or skip this field. A best-effort classification is always better than no classification. Set "segment_confidence" to "confirmed" if a real search result backs your classification, or "inferred" if you had to reason it out yourself with no direct source.
- "production_status" must be exactly one of: ${PRODUCTION_STATUSES.join(", ")} — or null if unclear.
- Do NOT add, rename, or omit any field from the shape above.
- Do not include a model already listed as "already on file" above unless you have new/corrected details about it — this is for discovering models not yet in the database, not re-describing known ones.
- Do NOT include a model confirmed to be sold only in mainland China with no export history — see the export-scope rule above. If unsure, include it with confidence "unconfirmed" rather than dropping it.
- "price_range" must be the DOMESTIC China price in CNY, never an export-market price (AED, MAD, USD, etc.) — export scoping decides which models to include, not what currency to price them in. Leave price_range null rather than report an export-market price in it.
- "name" must be the model's export/international name if it's exported anywhere — never the domestic Chinese name for an exported model. One export-relevant vehicle = one entry in "models", even if it has a different domestic name or multiple regional export names (put those in "name_cn" / "regional_name_note" instead of duplicating the entry).`;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "name_cn",
  "name_en",
  "regional_name_note",
  "generation",
  "segment",
  "segment_confidence",
  "body_type",
  "production_status",
  "price_range",
  "confidence",
]);
const PRICE_RANGE_KEYS = new Set(["min", "max", "currency_local"]);

/** Validates one discovered-model object's shape (extra/renamed keys, bad enum values) — does NOT require body_type to be present (it commonly comes back null and the review UI lets a person fill it in before creating the Model doc), but DOES require segment: unlike every other field here, segment is mandatory per the prompt (never null) — see applyDiscoveryGroundingGate for how segment_confidence gets force-corrected when grounding is missing. */
export function validateDiscoveredModel(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["model is not an object"] };
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }
  if (typeof v.name !== "string" || v.name.trim() === "") {
    errors.push("name: missing or not a non-empty string");
  }
  if (typeof v.segment !== "string" || !SEGMENT_SET.has(v.segment)) {
    errors.push(`segment: missing or invalid value ${JSON.stringify(v.segment)} — segment is mandatory, never null`);
  }
  if (
    v.segment_confidence !== undefined &&
    v.segment_confidence !== null &&
    (typeof v.segment_confidence !== "string" || !SEGMENT_CONFIDENCE_SET.has(v.segment_confidence))
  ) {
    errors.push(`segment_confidence: invalid value ${JSON.stringify(v.segment_confidence)}`);
  }
  if (
    v.production_status !== undefined &&
    v.production_status !== null &&
    (typeof v.production_status !== "string" || !PRODUCTION_STATUS_SET.has(v.production_status))
  ) {
    errors.push(`production_status: invalid value ${JSON.stringify(v.production_status)}`);
  }
  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }
  if (v.price_range !== undefined && v.price_range !== null) {
    if (typeof v.price_range !== "object" || Array.isArray(v.price_range)) {
      errors.push("price_range: not an object");
    } else {
      for (const key of Object.keys(v.price_range as Record<string, unknown>)) {
        if (!PRICE_RANGE_KEYS.has(key)) errors.push(`price_range.${key}: unexpected field`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Same rule as lib/techSpecResearch.ts's applyGroundingGate: zero citations means force "unconfirmed" regardless of self-report. Also forces segment_confidence to "inferred" with no grounding — segment can never be "confirmed" without a real search result behind it, regardless of what the model self-reported. Mutates and returns the model. */
export function applyDiscoveryGroundingGate(model: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) {
    model.confidence = "unconfirmed";
    model.segment_confidence = "inferred";
  }
  return model;
}

interface DiscoveryAgentResponse {
  models?: unknown[];
  notes?: string;
}

function extractJson(text: string): DiscoveryAgentResponse | null {
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

// ---------- manual export/import (2026-09-21: replaces the automated discoverModels() call below, ----------
// which was the last remaining button in the app that hit the AI provider directly. Same
// kickoff/format prompts, same validateDiscoveredModel, same zero-grounding confidence-downgrade
// intent — but "grounding" here just means "did the paste include a source-bearing notes field",
// same convention lib/brandResearch.ts's parseBrandManualImport uses for a manual paste with no
// citation list of its own.

export const MODEL_DISCOVERY_MANUAL_SCHEMA_VERSION = "model-discovery-manual-v1";

export interface ModelDiscoveryManualExportContext extends ModelDiscoveryInput {
  brandId: string;
}

export function buildModelDiscoveryManualExportPrompt(ctx: ModelDiscoveryManualExportContext): string {
  const envelope = {
    schema_version: MODEL_DISCOVERY_MANUAL_SCHEMA_VERSION,
    brand_id: ctx.brandId,
    models: [DISCOVERY_FIELD_TEMPLATE],
    notes: "string",
  };
  // Reuses the format prompt's own "CRITICAL RULES:" block verbatim (everything from that
  // heading onward) rather than restating the rules, so the two prompt paths can't drift apart.
  const formatPrompt = buildModelDiscoveryFormatPrompt();
  const rulesIdx = formatPrompt.indexOf("CRITICAL RULES:");
  const rulesBlock = rulesIdx >= 0 ? formatPrompt.slice(rulesIdx) : formatPrompt;

  return `${buildModelDiscoveryKickoffPrompt(ctx)}

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. The "models" array's inner object is a field-by-field description of the type each field must have, not a literal example value — one object per model you found.
${JSON.stringify(envelope, null, 2)}

${rulesBlock}
- Keep "schema_version" and "brand_id" exactly as shown.`;
}

export interface ModelDiscoveryImportItem {
  model: Record<string, unknown>;
  valid: boolean;
  errors: string[];
  duplicate: boolean;
  existingModelId: string | null;
}

export interface ModelDiscoveryManualImportResult {
  valid: boolean;
  errors: string[];
  items: ModelDiscoveryImportItem[];
}

/** Case-insensitive name match against an existing model's name/name_cn/name_en — same "match either the export or domestic name" spirit as lib/categoryValidators.ts's modelNameAlternatives, applied here to flag likely re-discoveries rather than reject them outright (the reviewer decides). */
function namesMatch(a: string, existing: { name?: string; name_cn?: string; name_en?: string }): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(a);
  if (!target) return false;
  return [existing.name, existing.name_cn, existing.name_en].some((n) => typeof n === "string" && norm(n) === target);
}

/**
 * Parses + validates a pasted model-discovery-manual-v1 reply. Unlike the single-object brand/
 * warranty/workshop manual imports, this is an array of candidate NEW Model documents — each item
 * gets its own valid/duplicate verdict so the review UI can offer per-row accept/reject instead of
 * all-or-nothing (existing models are looked up here; the actual write still goes through
 * app/api/brands/[id]/create-models, which re-checks the exact-name case and re-verifies on write).
 */
export function parseModelDiscoveryManualImport(
  rawText: string,
  brandId: string,
  existingModels: { _id: string; name?: string; name_cn?: string; name_en?: string }[]
): ModelDiscoveryManualImportResult {
  const obj = extractJson(rawText) as (DiscoveryAgentResponse & { schema_version?: string; brand_id?: string }) | null;
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], items: [] };

  const errors: string[] = [];
  if (obj.schema_version !== MODEL_DISCOVERY_MANUAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${MODEL_DISCOVERY_MANUAL_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.brand_id !== brandId) {
    errors.push(`brand_id ${JSON.stringify(obj.brand_id)} does not match this brand (${brandId}) — pasted into the wrong brand's page?`);
  }
  if (errors.length > 0) return { valid: false, errors, items: [] };

  if (!Array.isArray(obj.models)) {
    return { valid: false, errors: ['"models" must be an array.'], items: [] };
  }

  const hasEvidence = typeof obj.notes === "string" && obj.notes.trim() !== "";

  const items: ModelDiscoveryImportItem[] = obj.models.map((raw) => {
    const { valid, errors: itemErrors } = validateDiscoveredModel(raw);
    if (!valid) return { model: raw as Record<string, unknown>, valid: false, errors: itemErrors, duplicate: false, existingModelId: null };

    const gated = applyDiscoveryGroundingGate({ ...(raw as Record<string, unknown>) }, hasEvidence);
    const name = typeof gated.name === "string" ? gated.name : "";
    const match = existingModels.find((m) => namesMatch(name, m));

    return {
      model: gated,
      valid: true,
      errors: [],
      duplicate: !!match,
      existingModelId: match?._id ?? null,
    };
  });

  return { valid: true, errors: [], items };
}

