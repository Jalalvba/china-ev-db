// Shared core for AI-assisted technical-spec research: builds the Gemini
// prompt from the canonical schema, calls Gemini with Google Search
// grounding, validates the response against ICanonicalPowertrain, and applies
// the zero-citation "force unconfirmed" gate. Used by both the CLI batch tool
// (scripts/tech-spec-agent.ts) and the per-model API route
// (app/api/models/[id]/update-specs/route.ts) so there is exactly one
// implementation of this logic, not two copies that can drift apart.

import { GoogleGenAI, ApiError } from "@google/genai";
import {
  CANONICAL_POWERTRAIN_FIELD_TEMPLATE,
  ENERGY_TYPE_VALUES,
  DRIVE_TYPE_VALUES,
  MOTOR_COUNT_VALUES,
  GEARBOX_TYPE_VALUES,
  RANGE_STANDARD_VALUES,
  CONFIDENCE_VALUES,
  ASPIRATION_VALUES,
  FUEL_TYPE_VALUES,
  BATTERY_CHEMISTRY_VALUES,
} from "../types/canonicalPowertrain";
import { buildBrandContextBlock, type BrandContext } from "./brandContext";

// gemini-3.6-flash confirmed available on this project's key via
// `ai.models.list()` — re-run that check if this starts 404ing, rather than
// guessing the next name from an error message alone.
export const DEFAULT_MODEL = "gemini-3.6-flash";

// Conservative default so a large batch run doesn't hit per-minute rate
// limits on typical Gemini API tiers. Override via GEMINI_AGENT_DELAY_MS.
export const DEFAULT_DELAY_MS = 4000;

const SOURCE_SITES = [
  "autohome.com.cn (汽车之家)",
  "dongchedi.com (懂车帝)",
  "gasgoo.com",
  "official manufacturer press/spec pages",
  "MIIT (工信部) filings",
];

// A 404 here means the model name itself is wrong/retired — every query
// would hit the exact same error, so callers should treat this as fatal for
// the whole run/request rather than a per-model retry candidate.
export class ModelNotFoundError extends Error {
  constructor(modelName: string) {
    super(
      `Model '${modelName}' is not available; check available models with the API ` +
        `(ai.models.list()) or in Google AI Studio (https://aistudio.google.com/apikey).`
    );
    this.name = "ModelNotFoundError";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Prompt — standalone so a future DeepSeek verifier pass can reuse the exact
// same canonical-schema instructions Gemini is given here.
// ---------------------------------------------------------------------------

export interface TechSpecPromptInput {
  brandName: string;
  brandNameCn?: string;
  modelName: string;
  modelNameCn?: string;
  generation?: string;
  segment?: string;
  bodyType?: string;
  /** Trim names already on file, if any — asks Gemini to fill these in rather than invent a different lineup. */
  existingTrimNames?: string[];
  /** Confirmed Tier-1 brand-identity facts (see lib/brandResearch.ts), if this brand has been researched — lets this call focus on the model itself instead of re-deriving ownership. Optional: Tier 2 still works without it. */
  brandContext?: BrandContext;
  /** Rendered result of a real, code-level moteur.ma pre-fetch (see lib/moteurMaScraper.ts) — actual fetched/parsed data, not a request for Gemini to go check itself. */
  moteurMaContext?: string;
  /** Per-trim list of currently-missing/unconfirmed field labels (see describeTrimGaps) — lets the prompt name exactly what to look for instead of a generic "research this car" ask. Omit if there's nothing on file yet to diff against. */
  knownGaps?: { trimName: string; fields: string[] }[];
}

// ---------------------------------------------------------------------------
// Gap detection — turns an existing (possibly incomplete) powertrain record
// into a plain-English list of exactly which fields are missing or
// unconfirmed, so the research prompt can target them by name instead of
// asking a generic "research this car" question and hoping the gaps get
// covered incidentally.
// ---------------------------------------------------------------------------

/** Field-by-field gap check for one existing powertrain. Returns human-readable labels like "motor torque (Nm)", suitable for dropping straight into a prompt. A block that's entirely absent is reported as one label for the block rather than every sub-field. */
export function describeTrimGaps(pt: PowertrainLean): string[] {
  const gaps: string[] = [];

  const engine = pt.engine as Record<string, unknown> | undefined;
  const motor = pt.motor as Record<string, unknown> | undefined;
  const battery = pt.battery as Record<string, unknown> | undefined;
  const transmission = pt.transmission as Record<string, unknown> | undefined;
  const performance = pt.performance as Record<string, unknown> | undefined;

  if (motor === undefined) {
    gaps.push("electric motor specs (power, torque, drive layout)");
  } else {
    if (motor.torque_nm == null) gaps.push("motor torque (Nm)");
    if (motor.power_kw == null) gaps.push("motor power (kW)");
    if (motor.confidence === "unconfirmed") gaps.push("motor specs (currently unconfirmed — needs a citable source)");
  }

  if (battery === undefined) {
    gaps.push("battery specs (chemistry, capacity, charging rates, range)");
  } else {
    if (!battery.chemistry) gaps.push("battery chemistry (e.g. LFP vs NMC)");
    if (battery.dc_charge_kw == null) gaps.push("DC fast-charging rate (kW)");
    if (battery.ev_range_km == null) gaps.push("EV range (km)");
    if (battery.confidence === "unconfirmed") gaps.push("battery specs (currently unconfirmed — needs a citable source)");
  }

  if (engine === undefined && pt.motor !== undefined) {
    // Pure-EV trims legitimately have no engine block — only flag as a gap
    // when there's some other signal (unset entirely with no motor either)
    // that this might be a combustion/hybrid trim missing its engine data.
  } else if (engine && engine.confidence === "unconfirmed") {
    gaps.push("engine specs (currently unconfirmed — needs a citable source)");
  }

  if (transmission?.confidence === "unconfirmed") gaps.push("transmission specs (currently unconfirmed)");
  if (performance?.confidence === "unconfirmed") gaps.push("performance figures (currently unconfirmed)");
  if (pt.confidence === "unconfirmed" || pt.unverified) gaps.push("overall trim data (currently unverified/unconfirmed — needs a citable source)");

  return gaps;
}

const RANGE_STANDARDS_LABEL = RANGE_STANDARD_VALUES.join(", ");

/**
 * First-turn prompt: prose, not JSON. Gemini's Google Search grounding is
 * invoked at the model's own discretion, and empirically a "respond with
 * ONLY a JSON object" instruction makes it skip search entirely and answer
 * from its own training data instead — even with an explicit "you must
 * search" directive layered on top of the JSON instruction. Asking for a
 * plain prose research answer here reliably triggers real search grounding;
 * buildTechSpecPrompt() is then used as a second turn (with this turn's
 * answer as conversation history) purely to reformat already-grounded
 * findings into the canonical JSON shape, not to trigger new search.
 */
export function buildResearchKickoffPrompt(input: TechSpecPromptInput): string {
  const { brandName, brandNameCn, modelName, modelNameCn, generation, segment, bodyType, existingTrimNames, brandContext, moteurMaContext, knownGaps } = input;

  return `You are a technical researcher building a spec database of Chinese-market EVs/ICE/hybrids. Use the Google Search tool to research this vehicle — do not answer from memory alone.

Vehicle to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""} — "${modelName}"${
    modelNameCn ? ` (${modelNameCn})` : ""
  }${generation ? `, generation/year: ${generation}` : ""}${segment ? `\nSegment: ${segment}` : ""}${
    bodyType ? `\nBody type: ${bodyType}` : ""
  }${buildBrandContextBlock(brandContext)}

${
  moteurMaContext
    ? `${moteurMaContext} This isn't one of the structured spec fields below (Morocco market data is tracked separately, in the MoroccoListing collection, not here), so if it names this model, add a line to the "notes" field instead — e.g. "Listed on moteur.ma at 259,900 DH" — citing moteur.ma. Do not re-search moteur.ma yourself, this was already fetched directly.`
    : ""
}
${
  existingTrimNames?.length
    ? `\nKnown trims to research specs for (reuse these exact names character-for-character in your findings below — do not rephrase, translate, reorder their words, or append clarifying detail like an engine code or spec summary in parentheses, even if accurate): ${existingTrimNames.join(", ")}`
    : `\nEnumerate the current production trim/variant lineup for this model.`
}

Prioritize sources in this order: (1) Chinese manufacturer official sources and Chinese automotive press for technical specs, (2) Moroccan automotive press (wandaloo.com, atlasdragon.ma, lematin.ma, etc.) for anything Morocco-market-specific, (3) generic/global English-language sources only if nothing more specific exists.

Search Chinese-language automotive sources, especially: ${SOURCE_SITES.join(", ")}.

For EACH trim/variant, report the full technical specification you find: engine (if any), electric motor (if any), battery, transmission, and performance figures.
${
  knownGaps?.length
    ? `\nThe following data is already on file but currently incomplete or unconfirmed — this research pass exists specifically to fill these gaps, so make sure your searches specifically target each of these rather than stopping once you've confirmed the fields that are already known:\n${knownGaps
        .map((g) => `- ${g.trimName}: ${g.fields.join("; ")}`)
        .join("\n")}\nIf, after searching, a specific gap still can't be found with a citable source, say so explicitly rather than estimating — leaving it unresolved is correct behavior, not a failure.`
    : ""
}

Also separately note anything genuinely unusual or noteworthy about this model AS A WHOLE (not trim-specific) — e.g. battery-swap capability, a notable award, a production milestone, a controversy, a first-in-class feature. Only mention this if you actually find something notable with a citation; say explicitly if you find nothing noteworthy rather than inventing something.

Report your findings in plain prose with citations — do not format as JSON yet.`;
}

export function buildTechSpecPrompt(input: TechSpecPromptInput): string {
  const { brandName, brandNameCn, modelName, modelNameCn, generation, segment, bodyType, existingTrimNames, brandContext } = input;

  const templateJson = JSON.stringify(
    {
      variants: [CANONICAL_POWERTRAIN_FIELD_TEMPLATE],
      notable_facts: {
        text: "string | null (prose noting anything genuinely unusual about this model as a whole — battery-swap, award, milestone, controversy, first-in-class feature — null if nothing notable)",
        confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
      },
      notes: "string",
    },
    null,
    2
  );

  return `You are a technical researcher building a spec database of Chinese-market EVs/ICE/hybrids.

Vehicle to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""} — "${modelName}"${
    modelNameCn ? ` (${modelNameCn})` : ""
  }${generation ? `, generation/year: ${generation}` : ""}${segment ? `\nSegment: ${segment}` : ""}${
    bodyType ? `\nBody type: ${bodyType}` : ""
  }${buildBrandContextBlock(brandContext)}
${
  existingTrimNames?.length
    ? `\nKnown trims to fill in specs for: ${existingTrimNames.join(", ")}\nUse "trim_name" values that match these EXACTLY, character-for-character — copy them verbatim rather than rephrasing, translating, or appending extra detail (e.g. an engine code) even if it's accurate. Only write a trim_name NOT in this list if you're confident it's a genuinely different trim this list is missing, not a reworded version of one that's already there.`
    : `\nEnumerate the current production trim/variant lineup for this model.`
}

Search Chinese-language automotive sources, especially: ${SOURCE_SITES.join(", ")}.

For EACH trim/variant, report the full technical specification: engine (if any), electric motor (if any), battery (if any), transmission, and performance figures, plus a top-level energy type classification (${ENERGY_TYPE_VALUES.join(", ")}).

CRITICAL RULES:
- Every numeric or categorical fact must come from a search result you actually found (grounding is enabled on this request) — do not estimate or infer from similar vehicles.
- Use "null" for any field you cannot find a sourced value for. Do NOT guess a plausible-sounding number.
- Set each block's "confidence" to "confirmed" only if a specific cited source backs the block's claim — including a claim reported only in "note" when the structured numeric fields are null (e.g. a concept vehicle's press release quoting horsepower and wheel-torque instead of the standard kW/motor-torque_nm shape: report it in "note" and mark "confirmed" if the source is real, rather than downgrading confidence just because it didn't fit the structured fields). Otherwise "unconfirmed".
- motor.count must be one of: ${MOTOR_COUNT_VALUES.join(", ")}. motor.drive must be one of: ${DRIVE_TYPE_VALUES.join(", ")}. transmission.type must be one of: ${GEARBOX_TYPE_VALUES.join(", ")}. battery.ev_range_standard must be one of: ${RANGE_STANDARDS_LABEL}. engine.aspiration must be one of: ${ASPIRATION_VALUES.join(", ")}. engine.fuel_type must be one of: ${FUEL_TYPE_VALUES.join(", ")} (this is ICE fuel only — do not encode "range extender" here; use the separate engine.is_range_extender boolean for a REEV/EREV's generator engine). battery.chemistry must be one of: ${BATTERY_CHEMISTRY_VALUES.join(", ")} — put any proprietary product name or extra qualifier (e.g. "Blade", "800V", "2nd gen") in battery.battery_variant instead of inventing a new chemistry value. Every "confidence" field must be one of: ${CONFIDENCE_VALUES.join(", ")}.
- Do NOT add, rename, or omit any field from the JSON shape below. Use exactly these field names, nothing else.
- "notable_facts" is separate from the structured spec fields above — only fill in "notable_facts.text" if you found something genuinely noteworthy with a citation; otherwise set both "notable_facts.text" and "notable_facts.confidence" to null. Same confirmed/unconfirmed rule applies: "confirmed" only if a specific source backs the claim.
- If known trims were given above, "trim_name" must reuse their exact wording — a reworded, translated, or detail-appended trim_name for what is really the same trim (e.g. turning "1.6T" into "1.6T (290T / 1.6TGDI)") is treated as a data-loss bug downstream, not a helpful improvement.

Respond with ONLY a single JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object shown is a field-by-field description of the type each field must have, not a literal example value — array should contain one object per trim/variant):
${templateJson}`;
}

// ---------------------------------------------------------------------------
// Response validation against the canonical schema — reject anything with
// extra, missing (required-field), or renamed keys rather than coercing.
// ---------------------------------------------------------------------------

const TOP_LEVEL_KEYS = new Set([
  "trim_name",
  "energy_type",
  "engine",
  "motor",
  "battery",
  "transmission",
  "performance",
  "combined_range_km",
  "combined_range_note",
  "source",
  "confidence",
]);
const ENGINE_KEYS = new Set(Object.keys(CANONICAL_POWERTRAIN_FIELD_TEMPLATE.engine));
const MOTOR_KEYS = new Set(Object.keys(CANONICAL_POWERTRAIN_FIELD_TEMPLATE.motor));
const BATTERY_KEYS = new Set(Object.keys(CANONICAL_POWERTRAIN_FIELD_TEMPLATE.battery));
const TRANSMISSION_KEYS = new Set(Object.keys(CANONICAL_POWERTRAIN_FIELD_TEMPLATE.transmission));
const PERFORMANCE_KEYS = new Set(Object.keys(CANONICAL_POWERTRAIN_FIELD_TEMPLATE.performance));

const ENERGY_TYPE_SET = new Set<string>(ENERGY_TYPE_VALUES);
const DRIVE_TYPE_SET = new Set<string>(DRIVE_TYPE_VALUES);
const MOTOR_COUNT_SET = new Set<string>(MOTOR_COUNT_VALUES);
const GEARBOX_TYPE_SET = new Set<string>(GEARBOX_TYPE_VALUES);
const RANGE_STANDARD_SET = new Set<string>(RANGE_STANDARD_VALUES);
const CONFIDENCE_SET = new Set<string>(CONFIDENCE_VALUES);
const ASPIRATION_SET = new Set<string>(ASPIRATION_VALUES);
const FUEL_TYPE_SET = new Set<string>(FUEL_TYPE_VALUES);
const BATTERY_CHEMISTRY_SET = new Set<string>(BATTERY_CHEMISTRY_VALUES);

function checkBoolean(value: unknown, path: string, errors: string[]) {
  if (value === undefined || value === null) return;
  if (typeof value !== "boolean") errors.push(`${path}: must be a boolean or null`);
}

function checkExtraKeys(obj: Record<string, unknown>, allowed: Set<string>, path: string, errors: string[]) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unexpected field, not in canonical schema`);
  }
}

function checkEnum(value: unknown, allowed: Set<string>, path: string, errors: string[]) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !allowed.has(value)) {
    errors.push(`${path}: invalid value ${JSON.stringify(value)}`);
  }
}

/** Validates one variant object against ICanonicalPowertrain's shape. Does not mutate. */
export function validateCanonicalVariant(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["variant is not an object"] };
  }
  const v = raw as Record<string, unknown>;

  checkExtraKeys(v, TOP_LEVEL_KEYS, "variant", errors);

  if (typeof v.trim_name !== "string" || v.trim_name.trim() === "") {
    errors.push("variant.trim_name: missing or not a non-empty string");
  }
  checkEnum(v.energy_type, ENERGY_TYPE_SET, "variant.energy_type", errors);
  if (v.energy_type === undefined || v.energy_type === null) {
    errors.push("variant.energy_type: missing (required)");
  }
  checkEnum(v.confidence, CONFIDENCE_SET, "variant.confidence", errors);

  if (v.engine !== undefined && v.engine !== null) {
    if (typeof v.engine !== "object" || Array.isArray(v.engine)) {
      errors.push("variant.engine: not an object");
    } else {
      const engine = v.engine as Record<string, unknown>;
      checkExtraKeys(engine, ENGINE_KEYS, "variant.engine", errors);
      checkEnum(engine.aspiration, ASPIRATION_SET, "variant.engine.aspiration", errors);
      checkEnum(engine.fuel_type, FUEL_TYPE_SET, "variant.engine.fuel_type", errors);
      checkBoolean(engine.is_range_extender, "variant.engine.is_range_extender", errors);
      checkEnum(engine.confidence, CONFIDENCE_SET, "variant.engine.confidence", errors);
    }
  }

  if (v.motor !== undefined && v.motor !== null) {
    if (typeof v.motor !== "object" || Array.isArray(v.motor)) {
      errors.push("variant.motor: not an object");
    } else {
      const motor = v.motor as Record<string, unknown>;
      checkExtraKeys(motor, MOTOR_KEYS, "variant.motor", errors);
      checkEnum(motor.count, MOTOR_COUNT_SET, "variant.motor.count", errors);
      checkEnum(motor.drive, DRIVE_TYPE_SET, "variant.motor.drive", errors);
      checkEnum(motor.confidence, CONFIDENCE_SET, "variant.motor.confidence", errors);
    }
  }

  if (v.battery !== undefined && v.battery !== null) {
    if (typeof v.battery !== "object" || Array.isArray(v.battery)) {
      errors.push("variant.battery: not an object");
    } else {
      const battery = v.battery as Record<string, unknown>;
      checkExtraKeys(battery, BATTERY_KEYS, "variant.battery", errors);
      checkEnum(battery.chemistry, BATTERY_CHEMISTRY_SET, "variant.battery.chemistry", errors);
      checkEnum(battery.ev_range_standard, RANGE_STANDARD_SET, "variant.battery.ev_range_standard", errors);
      checkEnum(battery.confidence, CONFIDENCE_SET, "variant.battery.confidence", errors);
    }
  }

  if (v.transmission !== undefined && v.transmission !== null) {
    if (typeof v.transmission !== "object" || Array.isArray(v.transmission)) {
      errors.push("variant.transmission: not an object");
    } else {
      const transmission = v.transmission as Record<string, unknown>;
      checkExtraKeys(transmission, TRANSMISSION_KEYS, "variant.transmission", errors);
      checkEnum(transmission.type, GEARBOX_TYPE_SET, "variant.transmission.type", errors);
      checkEnum(transmission.confidence, CONFIDENCE_SET, "variant.transmission.confidence", errors);
    }
  }

  if (v.performance !== undefined && v.performance !== null) {
    if (typeof v.performance !== "object" || Array.isArray(v.performance)) {
      errors.push("variant.performance: not an object");
    } else {
      const performance = v.performance as Record<string, unknown>;
      checkExtraKeys(performance, PERFORMANCE_KEYS, "variant.performance", errors);
      checkEnum(performance.confidence, CONFIDENCE_SET, "variant.performance.confidence", errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

const NOTABLE_FACTS_KEYS = new Set(["text", "confidence"]);

/** Validates the optional top-level notable_facts block. A missing/null block is valid (it's optional) — only present-but-malformed shapes are rejected. */
export function validateNotableFacts(raw: unknown): { valid: boolean; errors: string[] } {
  if (raw === undefined || raw === null) return { valid: true, errors: [] };
  const errors: string[] = [];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["notable_facts: not an object"] };
  }
  const v = raw as Record<string, unknown>;
  checkExtraKeys(v, NOTABLE_FACTS_KEYS, "notable_facts", errors);
  if (v.text !== undefined && v.text !== null && typeof v.text !== "string") {
    errors.push("notable_facts.text: must be a string or null");
  }
  checkEnum(v.confidence, CONFIDENCE_SET, "notable_facts.confidence", errors);
  return { valid: errors.length === 0, errors };
}

/** Same rule as applyGroundingGate, for the notable_facts block: zero citations means force "unconfirmed" regardless of self-report. Mutates and returns the block (no-op on null/undefined). */
export function gateNotableFacts(
  notableFacts: Record<string, unknown> | null | undefined,
  hasGrounding: boolean
): Record<string, unknown> | null | undefined {
  if (!notableFacts || hasGrounding) return notableFacts;
  notableFacts.confidence = "unconfirmed";
  return notableFacts;
}

/** Validates + grounding-gates a raw notable_facts value from a parsed response, collapsing "no text" into a clean null rather than an empty-but-present object. */
function buildNotableFactsResult(raw: unknown, hasGrounding: boolean): ResearchedNotableFacts {
  const { valid, errors } = validateNotableFacts(raw);
  if (!valid) {
    return { notableFacts: raw as Record<string, unknown>, valid: false, errors };
  }
  if (!raw || typeof raw !== "object") {
    return { notableFacts: null, valid: true, errors: [] };
  }
  const block = raw as Record<string, unknown>;
  if (!block.text || typeof block.text !== "string" || block.text.trim() === "") {
    return { notableFacts: null, valid: true, errors: [] };
  }
  const gated = gateNotableFacts({ ...block }, hasGrounding);
  return { notableFacts: gated ?? null, valid: true, errors: [] };
}

/** Zero grounding citations means none of this response's claims are actually search-backed — force every confidence field to "unconfirmed" regardless of what Gemini self-reported, and flag the record as unverified. Mutates and returns `variant`. */
export function applyGroundingGate(variant: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (hasGrounding) return variant;
  variant.confidence = "unconfirmed";
  variant.unverified = true;
  for (const key of ["engine", "motor", "battery", "transmission", "performance"]) {
    const block = variant[key];
    if (block && typeof block === "object" && !Array.isArray(block)) {
      (block as Record<string, unknown>).confidence = "unconfirmed";
    }
  }
  return variant;
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

interface AgentResponse {
  variants?: unknown[];
  notable_facts?: { text?: string | null; confidence?: string | null } | null;
  notes?: string;
}

function extractJson(text: string): AgentResponse | null {
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

async function queryModel(
  ai: GoogleGenAI,
  model: string,
  promptInput: TechSpecPromptInput
): Promise<{ parsed: AgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildResearchKickoffPrompt(promptInput);
  const formatPrompt = buildTechSpecPrompt(promptInput);

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Turn 1: prose research request — this is the call that actually
      // triggers Google Search grounding. Its groundingChunks are the
      // authoritative source list for the whole exchange.
      const researchTurn = await ai.models.generateContent({
        model,
        contents: kickoffPrompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const groundingChunks = researchTurn.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sourceUrls = groundingChunks
        .map((chunk) => chunk.web?.uri)
        .filter((uri): uri is string => Boolean(uri));

      // Turn 2: reformat turn 1's grounded findings into the canonical JSON
      // shape. Passed as conversation history so it has turn 1's actual
      // findings to draw from, rather than re-answering from scratch.
      const formatTurn = await ai.models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: kickoffPrompt }] },
          { role: "model", parts: [{ text: researchTurn.text ?? "" }] },
          { role: "user", parts: [{ text: formatPrompt }] },
        ],
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const rawText = formatTurn.text ?? "";
      const parsed = extractJson(rawText);

      return { parsed, sourceUrls, rawText };
    } catch (err) {
      // Model-not-found is not transient — retrying hits the same 404 every
      // time. Fail fast on attempt 1 instead of wasting the whole retry
      // budget (and the backoff delay) on a broken model name.
      if (err instanceof ApiError && err.status === 404) {
        throw new ModelNotFoundError(model);
      }
      // Rate-limit responses ARE transient — let the retry loop's backoff handle them.
      lastErr = err;
      const backoffMs = 2000 * attempt;
      console.error(
        `  [retry ${attempt}/${maxAttempts}] ${promptInput.brandName} ${promptInput.modelName}: ${(err as Error).message} — waiting ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Target selection — shared "does this powertrain need research" rule
// ---------------------------------------------------------------------------

export interface PowertrainLean {
  _id: unknown;
  model_id: unknown;
  trim_name?: string;
  engine?: Record<string, unknown>;
  motor?: Record<string, unknown>;
  battery?: Record<string, unknown>;
  transmission?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  confidence?: string;
  unverified?: boolean;
}

/** True if this existing powertrain record is missing a major spec block, or is (or contains) an "unconfirmed" fact. */
export function needsResearch(pt: PowertrainLean): boolean {
  if (pt.unverified) return true;
  if (pt.confidence === "unconfirmed") return true;
  const blocks = [pt.engine, pt.motor, pt.battery, pt.transmission, pt.performance];
  if (blocks.some((b) => b === undefined)) return true;
  for (const b of blocks) {
    if (b && b.confidence === "unconfirmed") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-model research — the core unit of work, reused by both the CLI batch
// script (which loops over every incomplete model in the DB) and the
// per-brand API route (which loops over just one brand's models).
// ---------------------------------------------------------------------------

export interface ResearchedVariant {
  /** The raw (validated-or-not) variant object, in canonical shape, with the grounding gate already applied if valid. */
  variant: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export interface ResearchedNotableFacts {
  notableFacts: Record<string, unknown> | null;
  valid: boolean;
  errors: string[];
}

export interface ModelResearchResult {
  modelDbId: string;
  brandName: string;
  brandNameCn?: string;
  modelName: string;
  modelNameCn?: string;
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  variants: ResearchedVariant[];
  /** Model-level (not per-trim) prose findings, if any — see types/index.ts's IModel.notable_facts. Present (valid: true) even when Gemini found nothing notable; `notableFacts` itself is then null. */
  notableFacts?: ResearchedNotableFacts;
  agentModelUsed: string;
  queriedAt: string;
}

export interface ResearchModelInput extends TechSpecPromptInput {
  modelDbId: string;
}

/** Runs the full research + validation + grounding-gate pipeline for one model. Throws ModelNotFoundError on a 404 (fatal for the whole run/request); any other per-model failure is captured in the returned result's `status: "error"`. */
export async function researchModel(
  ai: GoogleGenAI,
  model: string,
  input: ResearchModelInput
): Promise<ModelResearchResult> {
  const queriedAt = new Date().toISOString();
  const base = {
    modelDbId: input.modelDbId,
    brandName: input.brandName,
    brandNameCn: input.brandNameCn,
    modelName: input.modelName,
    modelNameCn: input.modelNameCn,
    agentModelUsed: model,
    queriedAt,
  };

  try {
    const { parsed, sourceUrls, rawText } = await queryModel(ai, model, input);

    if (!parsed || !Array.isArray(parsed.variants)) {
      return {
        ...base,
        status: "error",
        errorMessage: `Could not parse variants array from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        variants: [],
      };
    }

    const hasGrounding = sourceUrls.length > 0;
    const notableFacts = buildNotableFactsResult(parsed.notable_facts, hasGrounding);

    if (parsed.variants.length === 0) {
      return {
        ...base,
        status: "not_found",
        errorMessage: parsed.notes,
        sourceUrls,
        hasGrounding,
        variants: [],
        notableFacts,
      };
    }

    const variants: ResearchedVariant[] = parsed.variants.map((rawVariant) => {
      const { valid, errors } = validateCanonicalVariant(rawVariant);
      if (!valid) {
        return { variant: rawVariant as Record<string, unknown>, valid: false, errors };
      }
      const variant = applyGroundingGate({ ...(rawVariant as Record<string, unknown>) }, hasGrounding);
      return { variant, valid: true, errors: [] };
    });

    return {
      ...base,
      status: variants.some((v) => v.valid) ? "found" : "not_found",
      sourceUrls,
      hasGrounding,
      variants,
      notableFacts,
    };
  } catch (err) {
    if (err instanceof ModelNotFoundError) throw err;
    return {
      ...base,
      status: "error",
      errorMessage: (err as Error).message,
      sourceUrls: [],
      hasGrounding: false,
      variants: [],
    };
  }
}
