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
  HYBRID_TYPE_VALUES,
  EMISSIONS_STANDARD_VALUES,
} from "../types/canonicalPowertrain";
import { buildBrandContextBlock, type BrandContext } from "./brandContext";
import { correctRangeStandard } from "./deepseekNormalize";

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

/** Reads a dotted "block.field" path (e.g. "battery.dc_charge_kw") out of a lean powertrain-like record. Trim-level paths with no dot (e.g. "combined_range_km") are read directly off the record. */
function readFieldPath(pt: Record<string, unknown>, path: string): unknown {
  const dot = path.indexOf(".");
  if (dot === -1) return pt[path];
  const block = pt[path.slice(0, dot)] as Record<string, unknown> | undefined;
  return block ? block[path.slice(dot + 1)] : undefined;
}

/** Field-by-field gap check for one existing powertrain. Returns human-readable labels like "motor torque (Nm)", suitable for dropping straight into a prompt — one label per individually-null field, not just a coarse per-block summary, so nothing empty can hide inside an otherwise-"confirmed" block. A block that's entirely absent is reported as one label for the block rather than every sub-field (nothing to gain from itemizing fields inside a block that doesn't exist at all). */
export function describeTrimGaps(pt: PowertrainLean): string[] {
  const gaps: string[] = [];
  const record = pt as unknown as Record<string, unknown>;

  const engine = pt.engine as Record<string, unknown> | undefined;
  const motor = pt.motor as Record<string, unknown> | undefined;
  const battery = pt.battery as Record<string, unknown> | undefined;
  const transmission = pt.transmission as Record<string, unknown> | undefined;
  const performance = pt.performance as Record<string, unknown> | undefined;

  function fieldGapsFor(block: Record<string, unknown>, specs: FieldSpec[]): void {
    for (const spec of specs) {
      const key = spec.path.slice(spec.path.indexOf(".") + 1);
      if (block[key] == null) gaps.push(spec.label);
    }
  }

  // Gate motor/battery and engine checks by energy_type so a pure-ICE trim
  // is never told its (correctly nonexistent) battery chemistry or EV range
  // is a "gap" — those fields are N/A for that trim, not missing data, and
  // asking an external researcher to hunt for a battery on a gasoline car
  // produces nonsense answers, not useful research. When energy_type isn't
  // recorded at all (older records), fall back to the previous
  // presence-based heuristic rather than guessing.
  const energyType = pt.energy_type;
  const motorBatteryApplicable = energyType === undefined ? true : energyType !== "ICE";
  const engineApplicable =
    energyType === undefined
      ? !(engine === undefined && pt.motor !== undefined) // old heuristic: skip only if this looks like a pure EV (motor present, no engine)
      : energyType !== "BEV";

  if (motorBatteryApplicable) {
    if (motor === undefined) {
      gaps.push("electric motor specs (power, torque, drive layout)");
    } else {
      fieldGapsFor(motor, MOTOR_FIELDS);
      if (motor.confidence === "unconfirmed") gaps.push("motor specs (currently unconfirmed — needs a citable source)");
    }

    if (battery === undefined) {
      gaps.push("battery specs (chemistry, capacity, charging rates, range)");
    } else {
      fieldGapsFor(battery, BATTERY_FIELDS);
      if (battery.confidence === "unconfirmed") gaps.push("battery specs (currently unconfirmed — needs a citable source)");
    }
  }

  if (engineApplicable && engine) {
    fieldGapsFor(engine, ENGINE_FIELDS);
    if (engine.confidence === "unconfirmed") gaps.push("engine specs (currently unconfirmed — needs a citable source)");
  }

  if (transmission === undefined) {
    gaps.push("transmission specs (type, gear count)");
  } else {
    fieldGapsFor(transmission, TRANSMISSION_FIELDS);
    if (transmission.confidence === "unconfirmed") gaps.push("transmission specs (currently unconfirmed)");
  }

  if (performance === undefined) {
    gaps.push("performance figures (0-100 acceleration, top speed)");
  } else {
    fieldGapsFor(performance, PERFORMANCE_FIELDS);
    if (performance.confidence === "unconfirmed") gaps.push("performance figures (currently unconfirmed)");
  }

  for (const spec of TRIM_LEVEL_FIELDS) {
    if (readFieldPath(record, spec.path) == null) gaps.push(spec.label);
  }

  if (pt.confidence === "unconfirmed" || pt.unverified) gaps.push("overall trim data (currently unverified/unconfirmed — needs a citable source)");

  return gaps;
}

const RANGE_STANDARDS_LABEL = RANGE_STANDARD_VALUES.join(", ");

// ---------------------------------------------------------------------------
// Shared field-list — single source of truth for "what does a field-by-field
// research target list look like", consumed by both describeTrimGaps() (to
// report per-field gaps on an existing record) and the Gemini kickoff prompt
// (to give a full checklist even when there's no existing record to diff
// against yet). Keeping one definition means the two can't silently drift on
// what "every field" means.
// ---------------------------------------------------------------------------

interface FieldSpec {
  /** Dotted path, e.g. "battery.dc_charge_kw" — matches CANONICAL_POWERTRAIN_FIELD_TEMPLATE. */
  path: string;
  /** Human-readable label with units, suitable for a prompt or a gap list. */
  label: string;
}

const ENGINE_FIELDS: FieldSpec[] = [
  { path: "engine.displacement_l", label: "engine displacement (L)" },
  { path: "engine.cylinders", label: "cylinder count" },
  { path: "engine.aspiration", label: "aspiration (turbo / naturally-aspirated / supercharged / twin-charged)" },
  { path: "engine.fuel_type", label: "engine fuel type" },
  { path: "engine.is_range_extender", label: "range-extender flag (true only if this engine drives a generator, REEV/EREV)" },
  { path: "engine.power_kw", label: "engine power (kW)" },
  { path: "engine.torque_nm", label: "engine torque (Nm)" },
];
const MOTOR_FIELDS: FieldSpec[] = [
  { path: "motor.type", label: "electric motor type (e.g. PMSM)" },
  { path: "motor.power_kw", label: "motor power (kW)" },
  { path: "motor.torque_nm", label: "motor torque (Nm)" },
  { path: "motor.count", label: "motor count (single / dual / tri-motor / quad-motor)" },
  { path: "motor.drive", label: "drive layout (FWD / RWD / AWD)" },
];
const BATTERY_FIELDS: FieldSpec[] = [
  { path: "battery.chemistry", label: "battery chemistry (LFP / NMC / LTO / semi-solid-state / other)" },
  { path: "battery.battery_variant", label: "battery product/variant name (e.g. Blade, 800V, 2nd gen)" },
  { path: "battery.capacity_total_kwh", label: "battery total capacity (kWh)" },
  { path: "battery.capacity_usable_kwh", label: "battery usable capacity (kWh)" },
  { path: "battery.supplier", label: "battery supplier" },
  { path: "battery.dc_charge_kw", label: "DC fast-charging rate (kW)" },
  { path: "battery.ac_charge_kw", label: "AC charging rate (kW)" },
  { path: "battery.ev_range_km", label: "EV range (km)" },
  { path: "battery.ev_range_standard", label: "EV range test standard (CLTC / WLTP / WLTC / NEDC)" },
];
const TRANSMISSION_FIELDS: FieldSpec[] = [
  { path: "transmission.type", label: "transmission type" },
  { path: "transmission.speed_count", label: "number of gears" },
];
const PERFORMANCE_FIELDS: FieldSpec[] = [
  { path: "performance.accel_0_100_s", label: "0-100 km/h acceleration (s)" },
  { path: "performance.top_speed_kmh", label: "top speed (km/h)" },
];
const TRIM_LEVEL_FIELDS: FieldSpec[] = [
  { path: "combined_range_km", label: "combined/total range (km) — fuel+EV combined for PHEV/REEV, or fuel range for ICE, or same as EV range for BEV; if no figure is published outright, it may be computed from tank capacity ÷ fuel consumption × 100 (both individually sourced) — see the JSON-formatting rules for the required \"Computed:\" note format" },
  { path: "source", label: "source attribution (which site/press release the figures came from)" },
];

/**
 * Every canonical field applicable to a given energy type, as flat FieldSpecs
 * — engine fields are dropped for a pure BEV, motor/battery fields are
 * dropped for a pure ICE, everything else (transmission, performance,
 * trim-level) always applies. Pass `undefined` (energy type not yet known,
 * e.g. before first-pass research) to get the full union — the prompt then
 * tells Gemini to disregard whichever half turns out not to apply.
 */
function getApplicableFieldSpecs(energyType?: string): FieldSpec[] {
  const specs: FieldSpec[] = [];
  if (energyType !== "BEV") specs.push(...ENGINE_FIELDS);
  if (energyType !== "ICE") specs.push(...MOTOR_FIELDS, ...BATTERY_FIELDS);
  specs.push(...TRANSMISSION_FIELDS, ...PERFORMANCE_FIELDS, ...TRIM_LEVEL_FIELDS);
  return specs;
}

/** Renders a field checklist as a bullet list of labels, for embedding directly in a prompt. */
function renderFieldChecklist(specs: FieldSpec[]): string {
  return specs.map((s) => `- ${s.label}`).join("\n");
}

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

For EACH trim/variant, you must individually attempt to find every one of the following fields — this is a named checklist, not a general "get a feel for the car" request. If the field turns out not to apply once you know the actual energy type (e.g. this is a pure EV with no engine, or a pure ICE with no motor/battery), just say so and skip that block; otherwise treat every field below as something to actively go find, not something to skip because you already have a general sense of the trim:
${renderFieldChecklist(getApplicableFieldSpecs())}

Do not rely on a single general search to cover all of the above. For each field (or small cluster of closely related fields, e.g. motor power + torque from the same spec-sheet table), run a distinct, targeted search — vary your query wording (Chinese model name + "参数配置", + "配置表", + the specific spec you're missing, etc.) — and only give up on a field after a real, targeted search attempt for it specifically has failed to turn up a source. One search that "covers the car in general" and then filling in whatever it happened to surface is not sufficient effort.

This database is not limited to a handful of top-tier brands — it covers the whole range of mainstream Chinese-market brands with real sales volume and automotive-press coverage (household names like Chery, Geely, BYD, Changan, and GWM, but just as much smaller-but-real brands like Jetour, Soueast, or Livan). For ANY brand in that range — not only the biggest names — a thin, mostly-null result should be rare, because these vehicles are genuinely well documented in Chinese automotive media. If your findings for a mainstream, actively-sold model are coming back mostly null, treat that as a sign to search again with different terms before finalizing, not as an acceptable outcome — reserve actual "no source found" nulls for fields that are genuinely obscure or unpublished (e.g. an unannounced supplier name), not for a headline spec like DC charging rate or 0-100 time on a current-production model.
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
- "combined_range_km" is usually a directly-published spec, but if you found no such published figure, you MAY instead compute it from two other individually-sourced inputs via a deterministic conversion — most commonly fuel tank capacity ÷ published fuel consumption × 100 (e.g. an ICE/HEV trim where only "51 L tank, 7.2 L/100km WLTC" was published, never a combined range in km outright). This is the ONLY case where you may derive a numeric field rather than reporting a value you found stated outright — do not extend this to any other field. If you do this: (1) both inputs must individually come from a citable source — never combine one sourced figure with an assumed/typical one; (2) "combined_range_note" MUST show the arithmetic AND name both source inputs, prefixed with the literal word "Computed:" so it can never be mistaken for a directly-published figure, e.g. "Computed: 51L tank ÷ 7.2L/100km × 100 = ~708 km (WLTC, Autohome spec sheet)". A combined_range_note that reports a directly-published figure (the normal case) must NOT start with "Computed:" — that prefix is reserved exclusively for this derived-value case, so it stays unambiguous which kind of value combined_range_km actually is.

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
  "combined_system_power_kw",
  "hybrid_type",
  "emissions_standard",
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
const HYBRID_TYPE_SET = new Set<string>(HYBRID_TYPE_VALUES);
const EMISSIONS_STANDARD_SET = new Set<string>(EMISSIONS_STANDARD_VALUES);

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
  checkEnum(v.hybrid_type, HYBRID_TYPE_SET, "variant.hybrid_type", errors);
  checkEnum(v.emissions_standard, EMISSIONS_STANDARD_SET, "variant.emissions_standard", errors);

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

/**
 * Finds the index just past the closing brace that matches the `{` at
 * `start`, by walking the string tracking brace depth and string/escape
 * state (so a `}` inside a quoted string value, e.g. a trim's `note` field
 * containing literal text with braces, doesn't miscount). Returns -1 if the
 * braces never balance before the string ends — a real signal the response
 * was cut off mid-generation, distinct from "just isn't JSON at all".
 */
function findMatchingBraceEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function extractJson(text: string): AgentResponse | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  const braceStart = candidate.indexOf("{");
  if (braceStart === -1) return null;

  // Proper brace-matching first (handles trailing commentary after the JSON
  // block, and a `}` character legitimately inside a string value) — falls
  // back to the old naive lastIndexOf-based slice only if that fails to
  // find a balanced end, so no previously-working response starts failing.
  const matchedEnd = findMatchingBraceEnd(candidate, braceStart);
  if (matchedEnd !== -1) {
    try {
      return JSON.parse(candidate.slice(braceStart, matchedEnd));
    } catch {
      // Balanced braces but still invalid JSON (e.g. a trailing comma) —
      // fall through to the naive attempt below on the off chance it does
      // better, though it usually won't for this failure mode.
    }
  }

  const braceEnd = candidate.lastIndexOf("}");
  if (braceEnd === -1 || braceEnd <= braceStart) return null;
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

      // A malformed/truncated JSON response is usually a one-off flaky
      // generation, not a persistent problem — retry the same way a
      // thrown network/rate-limit error already does, instead of failing
      // the whole model on the first bad response. Only the final attempt
      // returns a parse failure to the caller.
      if ((!parsed || !Array.isArray(parsed.variants)) && attempt < maxAttempts) {
        const backoffMs = 2000 * attempt;
        console.error(
          `  [retry ${attempt}/${maxAttempts}] ${promptInput.brandName} ${promptInput.modelName}: response didn't parse as the expected JSON shape — waiting ${backoffMs}ms`
        );
        await sleep(backoffMs);
        continue;
      }

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
  energy_type?: string;
  engine?: Record<string, unknown>;
  motor?: Record<string, unknown>;
  battery?: Record<string, unknown>;
  transmission?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  combined_range_km?: number | null;
  source?: string | null;
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
      // Only handles genuine typo/artifact aliases here (see
      // RANGE_STANDARD_CORRECTIONS in deepseekNormalize.ts) — "WLTC" is
      // deliberately NOT one of them: it's a real, distinct standard from
      // "WLTP" (different correction factors can yield a different number
      // for the same car), so it passes through unchanged as its own valid
      // enum value rather than being relabeled. Same correction table is
      // shared with the DeepSeek batch pipeline and the manual Kimi/DeepSeek
      // round-trip in manualResearchImport.ts, so all three ingestion paths
      // agree on what counts as an alias vs. a distinct standard.
      if (rawVariant && typeof rawVariant === "object" && !Array.isArray(rawVariant)) {
        const battery = (rawVariant as Record<string, unknown>).battery;
        if (battery && typeof battery === "object" && !Array.isArray(battery)) {
          const b = battery as Record<string, unknown>;
          if (typeof b.ev_range_standard === "string") {
            b.ev_range_standard = correctRangeStandard(b.ev_range_standard) ?? null;
          }
        }
      }
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
