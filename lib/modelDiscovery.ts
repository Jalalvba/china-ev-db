// Brand-level "discover models" research: for a brand with zero (or
// incomplete) Model documents, asks Gemini to find its current model
// lineup and returns candidate Model records for review — never writes to
// MongoDB itself (see app/api/brands/[id]/create-models/route.ts for that).
//
// This is deliberately a separate step from lib/techSpecResearch.ts's
// per-model spec research: that pipeline researches POWERTRAIN variants for
// an EXISTING Model document and has nowhere to attach results without one.
// 115 of this project's 147 brands (as of this writing) have zero Model
// docs — mostly brand-only metadata from the delta-report import shape (see
// scripts/import-deepseek.ts's Shape 2) — so model discovery is the common
// case that needs solving, not a one-off. Reuses the exact same "prose
// research turn triggers real grounding, JSON-format turn reformats it"
// pattern and the same zero-citation confidence gate as lib/techSpecResearch.ts,
// for the same reasons (see the comments there).

import { GoogleGenAI, ApiError } from "@google/genai";
import { SEGMENTS, PRODUCTION_STATUSES } from "@/models/Model";
import { ModelNotFoundError, sleep } from "@/lib/techSpecResearch";
import { buildBrandContextBlock, type BrandContext } from "@/lib/brandContext";

const SEGMENT_SET = new Set<string>(SEGMENTS);
const PRODUCTION_STATUS_SET = new Set<string>(PRODUCTION_STATUSES);
const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

export interface ModelDiscoveryInput {
  brandName: string;
  brandNameCn?: string;
  parentGroup?: string;
  /** Model names already on file for this brand, if any — asks Gemini to skip these rather than re-suggest them as "new". */
  existingModelNames?: string[];
  /** Confirmed Tier-1 brand-identity facts (see lib/brandResearch.ts), if this brand has been researched. Optional: model discovery still works without it. */
  brandContext?: BrandContext;
  /** Rendered result of a real, code-level moteur.ma pre-fetch (see lib/moteurMaScraper.ts) — actual fetched/parsed data, not a request for Gemini to go check itself. */
  moteurMaContext?: string;
}

const DISCOVERY_FIELD_TEMPLATE = {
  name: "string (the model's INTERNATIONAL/EXPORT market name if it's exported anywhere, e.g. \"Coolray\" not the domestic-China name \"Boyue Pro\" — see the export-scope rules above; only use the domestic Chinese name here if the model is genuinely domestic-only)",
  name_cn: "string | null (the domestic Chinese-market name/badge, if different from `name` above — this is where a domestic name like \"Boyue Pro\" belongs when `name` is the export name \"Coolray\")",
  name_en: "string | null",
  regional_name_note: "string | null (if this model is sold under DIFFERENT names in different export regions, note the other regional names here as free text, e.g. \"Sold as Coolray in most export markets; also marketed as Vision X6 Pro in some Middle East/Africa markets.\" — do not create a separate model entry per regional name)",
  generation: "string | null (e.g. \"2026\" or a generation label, if known)",
  segment: SEGMENTS.join(" | ") + " | null (null if you can't confidently classify it)",
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
  return `You are a researcher building a database of Chinese-market vehicle brands and their model lineups. Use the Google Search tool to research this brand — do not answer from memory alone.

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
- Every fact must come from a search result you actually found (grounding is enabled) — do not estimate or infer from similar brands/models.
- Use null for anything you cannot find a sourced value for. Do NOT guess.
- "segment" must be exactly one of: ${SEGMENTS.join(", ")} — or null if you're not confident which one fits.
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
  "body_type",
  "production_status",
  "price_range",
  "confidence",
]);
const PRICE_RANGE_KEYS = new Set(["min", "max", "currency_local"]);

export interface DiscoveredModel {
  name: string;
  name_cn?: string;
  name_en?: string;
  regional_name_note?: string;
  generation?: string;
  segment?: string;
  body_type?: string;
  production_status?: string;
  price_range?: { min?: number; max?: number; currency_local?: string };
  confidence?: string;
}

/** Validates one discovered-model object's shape (extra/renamed keys, bad enum values) — does NOT require segment/body_type to be present, since those commonly come back null and the review UI lets a person fill them in before creating the Model doc. */
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
  if (v.segment !== undefined && v.segment !== null && (typeof v.segment !== "string" || !SEGMENT_SET.has(v.segment))) {
    errors.push(`segment: invalid value ${JSON.stringify(v.segment)}`);
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

/** Same rule as lib/techSpecResearch.ts's applyGroundingGate: zero citations means force "unconfirmed" regardless of self-report. Mutates and returns the model. */
export function applyDiscoveryGroundingGate(model: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) model.confidence = "unconfirmed";
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

async function queryDiscovery(
  ai: GoogleGenAI,
  model: string,
  input: ModelDiscoveryInput
): Promise<{ parsed: DiscoveryAgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildModelDiscoveryKickoffPrompt(input);
  const formatPrompt = buildModelDiscoveryFormatPrompt();

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const researchTurn = await ai.models.generateContent({
        model,
        contents: kickoffPrompt,
        config: { tools: [{ googleSearch: {} }] },
      });

      const groundingChunks = researchTurn.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sourceUrls = groundingChunks.map((c) => c.web?.uri).filter((uri): uri is string => Boolean(uri));

      const formatTurn = await ai.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: kickoffPrompt }] },
          { role: "model", parts: [{ text: researchTurn.text ?? "" }] },
          { role: "user", parts: [{ text: formatPrompt }] },
        ],
        config: { tools: [{ googleSearch: {} }] },
      });

      const rawText = formatTurn.text ?? "";
      return { parsed: extractJson(rawText), sourceUrls, rawText };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw new ModelNotFoundError(model);
      lastErr = err;
      const backoffMs = 2000 * attempt;
      console.error(`  [retry ${attempt}/${maxAttempts}] discover-models ${input.brandName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface DiscoveredModelEntry {
  model: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export interface ModelDiscoveryResult {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  discovered: DiscoveredModelEntry[];
}

/** Runs the full discovery + validation + grounding-gate pipeline for one brand. Throws ModelNotFoundError on a 404 (fatal, same as researchModel); any other failure is captured in the returned result's status. */
export async function discoverModels(
  ai: GoogleGenAI,
  model: string,
  input: ModelDiscoveryInput
): Promise<ModelDiscoveryResult> {
  try {
    const { parsed, sourceUrls, rawText } = await queryDiscovery(ai, model, input);

    if (!parsed || !Array.isArray(parsed.models)) {
      return {
        status: "error",
        errorMessage: `Could not parse models array from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        discovered: [],
      };
    }

    const hasGrounding = sourceUrls.length > 0;

    if (parsed.models.length === 0) {
      return { status: "not_found", errorMessage: parsed.notes, sourceUrls, hasGrounding, discovered: [] };
    }

    const discovered: DiscoveredModelEntry[] = parsed.models.map((raw) => {
      const { valid, errors } = validateDiscoveredModel(raw);
      if (!valid) return { model: raw as Record<string, unknown>, valid: false, errors };
      const gated = applyDiscoveryGroundingGate({ ...(raw as Record<string, unknown>) }, hasGrounding);
      return { model: gated, valid: true, errors: [] };
    });

    return {
      status: discovered.some((d) => d.valid) ? "found" : "not_found",
      sourceUrls,
      hasGrounding,
      discovered,
    };
  } catch (err) {
    if (err instanceof ModelNotFoundError) throw err;
    return { status: "error", errorMessage: (err as Error).message, sourceUrls: [], hasGrounding: false, discovered: [] };
  }
}
