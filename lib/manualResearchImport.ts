// Shared core for the manual Kimi/DeepSeek round-trip workflow: export a
// model's current document as clean JSON, generate a companion prompt, and
// validate+diff a pasted-back response before anything is written.
//
// Deliberately separate from lib/techSpecResearch.ts (the Gemini pipeline) —
// this never calls an LLM API itself, it only prepares/validates JSON for a
// human to hand-carry through an external chat UI. It DOES reuse
// validateCanonicalVariant/validateNotableFacts from techSpecResearch.ts for
// the powertrain shape, and findMismatchedKeys from applySpecUpdates.ts for
// diffing, so there is exactly one definition of "what does a valid
// powertrain variant look like" / "did this field actually change" across
// both pipelines.

import { validateCanonicalVariant, describeTrimGaps, type PowertrainLean } from "./techSpecResearch";
import { findMismatchedKeys } from "./applySpecUpdates";
import type { IBrand } from "@/types";

/** Model fields this workflow may ever read from an import and write back — deliberately excludes _id, brand_id, timestamps, Morocco fields (a different scraped-data pipeline), and any research-log bookkeeping field. Adding a field here means adding it to RESEARCHABLE_MODEL_KEYS below too — kept as two names for the same Set so a future editor sees why both exist. */
export const RESEARCHABLE_MODEL_KEYS = [
  "name",
  "name_cn",
  "name_en",
  "generation",
  "segment",
  "body_type",
  "notable_facts",
  "notable_facts_confidence",
] as const;

const RESEARCHABLE_MODEL_KEY_SET = new Set<string>(RESEARCHABLE_MODEL_KEYS);

export interface ExportedPowertrain {
  _id: string;
  trim_name?: string;
  energy_type?: string;
  engine?: Record<string, unknown> | null;
  motor?: Record<string, unknown> | null;
  battery?: Record<string, unknown> | null;
  transmission?: Record<string, unknown> | null;
  performance?: Record<string, unknown> | null;
  combined_range_km?: number | null;
  combined_range_note?: string | null;
  source?: string | null;
  confidence?: string | null;
  // Deliberately no "unverified" field — that's a Gemini-grounding-gate-only
  // flag set by applyGroundingGate() based on whether the AI call actually
  // had search grounding, not something a researcher (human or external LLM)
  // should ever set directly. validateCanonicalVariant (reused as-is below)
  // already rejects it as an unknown field for exactly this reason — kept
  // out of the export/prompt/import shape entirely rather than special-cased
  // through the validator. An existing powertrain's `unverified` value is
  // left untouched by a manual import.
  /** Output of describeTrimGaps() at export time — told to the external LLM, never guessed by it. Not read back on import; re-derived fresh from whatever the import actually changed. */
  research_gaps: string[];
}

export interface ExportDocument {
  export_meta: {
    exported_at: string;
    schema_version: "canonical-powertrain-v2";
    model_id: string;
  };
  model: {
    _id: string;
    brand_id: string;
    brand_name: string;
    brand_name_cn?: string;
    name: string;
    name_cn?: string;
    name_en?: string;
    generation?: string;
    segment: string;
    body_type: string;
    production_status: string;
    unverified?: boolean;
    notable_facts?: string;
    notable_facts_confidence?: string;
  };
  powertrains: ExportedPowertrain[];
}

/** Fields that only exist to give the external LLM context (e.g. brand_name) or are read-only display (production_status, _id, brand_id) — never accepted back as a change on import, regardless of what the returned JSON says. */
const MODEL_CONTEXT_ONLY_KEYS = new Set(["_id", "brand_id", "brand_name", "brand_name_cn", "production_status", "unverified"]);

// ---------------------------------------------------------------------------
// Export-document builder — shared by the CLI script
// (scripts/export-model-for-manual-research.ts) and the model-page "Export
// for Kimi/DeepSeek" button (app/api/models/[id]/manual-export/route.ts) so
// there is exactly one definition of the export shape, not two that can
// drift (the same reasoning as techSpecResearch.ts being shared by the CLI
// batch agent and the per-model API route).
// ---------------------------------------------------------------------------

export function buildExportDocument(
  modelDoc: Record<string, unknown> & { _id: unknown; brand_id?: unknown },
  brand: (IBrand & { _id: unknown }) | null,
  powertrainDocs: (PowertrainLean & Record<string, unknown>)[]
): ExportDocument {
  const powertrains: ExportedPowertrain[] = powertrainDocs.map((pt) => {
    const {
      _id,
      model_id: _model_id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      last_researched_at: _lastResearchedAt,
      unverified: _unverified,
      __v: _v,
      ...rest
    } = pt as Record<string, unknown> & { _id: unknown };
    return {
      _id: String(_id),
      ...(rest as Omit<ExportedPowertrain, "_id" | "research_gaps">),
      research_gaps: describeTrimGaps(pt),
    };
  });

  return {
    export_meta: {
      exported_at: new Date().toISOString(),
      schema_version: "canonical-powertrain-v2",
      model_id: String(modelDoc._id),
    },
    model: {
      _id: String(modelDoc._id),
      brand_id: brand ? String(brand._id) : "",
      brand_name: brand?.name_en ?? brand?.name ?? "Unknown",
      brand_name_cn: brand?.name_cn,
      name: modelDoc.name as string,
      name_cn: modelDoc.name_cn as string | undefined,
      name_en: modelDoc.name_en as string | undefined,
      generation: modelDoc.generation as string | undefined,
      segment: modelDoc.segment as string,
      body_type: modelDoc.body_type as string,
      production_status: modelDoc.production_status as string,
      unverified: modelDoc.unverified as boolean | undefined,
      notable_facts: modelDoc.notable_facts as string | undefined,
      notable_facts_confidence: modelDoc.notable_facts_confidence as string | undefined,
    },
    powertrains,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Filename base (no extension) for this export — shared so the CLI script's file names and any future download-based export stay consistent. */
export function exportFileBase(modelDoc: { name_en?: string; name: string }): string {
  const slug = slugify(modelDoc.name_en ?? modelDoc.name);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `export-${slug}-${timestamp}`;
}

/** The single-file combined text for the "Export for Kimi/DeepSeek" button — the prompt (which already ends with the JSON record inline) is the whole thing; nothing else to concatenate. */
export function buildCombinedExportText(exportDoc: ExportDocument): string {
  return buildManualResearchPrompt(exportDoc);
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

export function buildManualResearchPrompt(exportDoc: ExportDocument): string {
  const { model, powertrains } = exportDoc;
  const gapLines = powertrains
    .filter((p) => p.research_gaps.length > 0)
    .map((p) => `- "${p.trim_name}": ${p.research_gaps.join("; ")}`)
    .join("\n");

  return `You are a technical researcher building a spec database of Chinese-market EVs/ICE/hybrids.

Below is the current database record (as JSON) for "${model.brand_name}" — "${model.name_en ?? model.name}"${
    model.name_cn ? ` (${model.name_cn})` : ""
  }. Research this vehicle using Chinese-language automotive sources as your first priority (autohome.com.cn, dongchedi.com, gasgoo.com, official manufacturer press/spec pages, MIIT/工信部 filings), then Moroccan automotive press, then generic English-language sources only if nothing more specific exists.

${
  gapLines
    ? `Known gaps to focus on (fields currently missing or unconfirmed):\n${gapLines}\n`
    : "No specific gaps were flagged, but re-verify every field against a real source rather than assuming the current values are correct.\n"
}
CRITICAL RULES — read carefully, this is a round-trip into a strict-schema database:
1. Return the SAME JSON shape you were given below — same top-level keys ("model", "powertrains"), same nested field names. Do not add, rename, or omit any field.
2. model._id and every powertrains[]._id MUST be returned byte-for-byte UNCHANGED from what you were given. These IDs are how the import step matches your response back to the exact existing database record — if you omit an _id, invent a new one, or alter it in any way, that entire record will be misread as a brand-new trim instead of an update to the existing one, which defeats the whole point of this workflow. If you are adding a genuinely NEW trim that wasn't in the input, give it no "_id" field at all (omit it, don't invent a placeholder) — that is the only case where a missing _id is correct.
3. Every numeric or categorical fact must come from a source you can point to — do not estimate or infer from similar vehicles. Use null for anything you cannot find a sourced value for.
4. For every field you CHANGE from its current value, add a sibling "<field>_source_note" string (e.g. if you change "battery.dc_charge_kw", also include "battery.dc_charge_kw_source_note": "40kW per official Soueast spec sheet, autohome.com.cn"). Only changed fields need a source note — leave unchanged fields as-is with no note.
5. Do not touch any field not listed in "model" or "powertrains[]" below — there is no other data to research.
6. Respond with ONLY the JSON object. No markdown code fences, no explanation before or after, no commentary — your entire response must be valid JSON starting with { and ending with }, ready to be pasted directly into a JSON parser.

Here is the current record to research and return, in the same shape, with gaps filled:

${JSON.stringify({ model, powertrains: powertrains.map(({ research_gaps: _rg, ...p }) => p) }, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Model-field validation (mirrors validateCanonicalVariant's discipline)
// ---------------------------------------------------------------------------

export function validateManualModelFields(raw: unknown): { valid: boolean; errors: string[]; cleaned: Record<string, unknown> } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["model: not an object"], cleaned: {} };
  }
  const v = raw as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};

  for (const key of Object.keys(v)) {
    if (key.endsWith("_source_note")) continue; // handled separately, not a schema field
    if (MODEL_CONTEXT_ONLY_KEYS.has(key)) continue; // context-only, silently ignored on the way back in
    if (!RESEARCHABLE_MODEL_KEY_SET.has(key)) {
      errors.push(`model.${key}: unexpected field, not researchable`);
      continue;
    }
    cleaned[key] = v[key];
  }

  if (v.notable_facts_confidence !== undefined && v.notable_facts_confidence !== null) {
    if (v.notable_facts_confidence !== "confirmed" && v.notable_facts_confidence !== "unconfirmed") {
      errors.push(`model.notable_facts_confidence: invalid value ${JSON.stringify(v.notable_facts_confidence)}`);
    }
  }

  return { valid: errors.length === 0, errors, cleaned };
}

// ---------------------------------------------------------------------------
// Powertrain-field validation — reuses the Gemini pipeline's validator
// verbatim, minus the trim_name/energy_type "required" checks (a returned
// UPDATE to an existing trim may legitimately omit trim_name/energy_type if
// unchanged... but our export always includes them, and the prompt asks for
// the full shape back, so we still require them for a clean, unambiguous
// diff — same rule as Gemini's response).
// ---------------------------------------------------------------------------

/** Strips "<field>_source_note" sibling keys (recursively, one level into each block) before running the canonical validator, which doesn't know about them — returns the stripped copy plus a flat map of path -> source note for display in the diff. */
export function extractSourceNotes(raw: Record<string, unknown>): { stripped: Record<string, unknown>; notes: Record<string, string> } {
  const notes: Record<string, string> = {};
  function strip(obj: Record<string, unknown>, path: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.endsWith("_source_note")) {
        const fieldPath = path ? `${path}.${k.replace(/_source_note$/, "")}` : k.replace(/_source_note$/, "");
        if (typeof v === "string") notes[fieldPath] = v;
        continue;
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        out[k] = strip(v as Record<string, unknown>, path ? `${path}.${k}` : k);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return { stripped: strip(raw, ""), notes };
}

export interface ValidatedPowertrainImport {
  _id: string | null; // null means "declared as a new trim"
  variant: Record<string, unknown>;
  sourceNotes: Record<string, string>;
  valid: boolean;
  errors: string[];
}

export function validateManualPowertrain(raw: unknown, index: number): ValidatedPowertrainImport {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { _id: null, variant: {}, sourceNotes: {}, valid: false, errors: [`powertrains[${index}]: not an object`] };
  }
  const withId = raw as Record<string, unknown>;
  const rawId = withId._id;
  if (rawId !== undefined && typeof rawId !== "string") {
    return { _id: null, variant: {}, sourceNotes: {}, valid: false, errors: [`powertrains[${index}]._id: must be a string if present`] };
  }
  const { _id, ...rest } = withId;
  const { stripped, notes } = extractSourceNotes(rest);
  const { valid, errors } = validateCanonicalVariant(stripped);
  return {
    _id: typeof rawId === "string" ? rawId : null,
    variant: stripped,
    sourceNotes: notes,
    valid,
    errors: errors.map((e) => e.replace(/^variant/, `powertrains[${index}]`)),
  };
}

// ---------------------------------------------------------------------------
// Generic recursive diff — only for building the human-facing review screen,
// never used to decide what gets written (the write path re-applies the
// validated `variant`/model fields wholesale via $set, same as
// applySpecUpdates.ts, then re-verifies with findMismatchedKeys).
// ---------------------------------------------------------------------------

export interface FieldDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
  sourceNote?: string;
}

/** Recursively walks `after`'s keys (plain objects only — arrays/primitives compared as whole values) and reports every leaf where the value differs from `before`, by re-using the exact equality rule applySpecUpdates.ts's write-verification already trusts (valuesMatch), so "what the diff shows changed" and "what verification checks landed" can never disagree. */
export function buildFieldDiff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, sourceNotes: Record<string, string>, basePath = ""): FieldDiffEntry[] {
  const entries: FieldDiffEntry[] = [];
  const beforeObj = before ?? {};
  for (const [key, afterValue] of Object.entries(after)) {
    const path = basePath ? `${basePath}.${key}` : key;
    const beforeValue = beforeObj[key];
    if (afterValue && typeof afterValue === "object" && !Array.isArray(afterValue)) {
      entries.push(
        ...buildFieldDiff(
          beforeValue && typeof beforeValue === "object" ? (beforeValue as Record<string, unknown>) : null,
          afterValue as Record<string, unknown>,
          sourceNotes,
          path
        )
      );
      continue;
    }
    const mismatched = findMismatchedKeys({ [key]: afterValue }, { [key]: beforeValue });
    if (mismatched.length > 0) {
      entries.push({ path, before: beforeValue, after: afterValue, sourceNote: sourceNotes[path] });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Composite parse+validate+diff — the single implementation shared by both
// the validate route (preview only) and the apply route (which re-runs this
// from scratch rather than trusting anything the client sent back from an
// earlier validate call, same "never trust the client's own diff" rule as
// applySpecUpdates.ts re-fetching after every write).
// ---------------------------------------------------------------------------

export interface PowertrainImportResult {
  status: "update" | "new";
  /** Set only when status is "update". */
  existingId?: string;
  trimName?: string;
  diff: FieldDiffEntry[];
  variant: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export interface ManualImportParseResult {
  valid: boolean;
  /** Every error across model + all variants — non-empty means nothing should be written. */
  errors: string[];
  modelDiff: FieldDiffEntry[];
  modelChanges: Record<string, unknown>;
  powertrainResults: PowertrainImportResult[];
}

/**
 * Parses raw pasted-back JSON text, validates model + every powertrain
 * variant against the canonical schema, and diffs each against the current
 * DB state. Never writes anything — pure function of (rawText, current DB
 * state). `existingPowertrains` must be the FULL current list for this
 * model (used to detect an _id that doesn't belong to this model at all —
 * reported as an error, never silently treated as "new").
 */
/**
 * Backstop only — the prompt explicitly asks for a bare JSON object with no
 * fencing or commentary, but Kimi/DeepSeek's own chat UI is outside our
 * control, so this strips a ```json ... ``` fence (or bare ``` ... ```) if
 * one slips through, and otherwise trims to the outermost { ... } to drop
 * any stray "Here's the research:" preamble or trailing remark. Does NOT
 * attempt to fix malformed JSON inside those braces — that still fails
 * JSON.parse and reports as a normal validation error.
 */
function stripFenceAndPreamble(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) return candidate.trim();
  return candidate.slice(braceStart, braceEnd + 1);
}

export function parseManualImport(
  rawText: string,
  currentModel: Record<string, unknown>,
  existingPowertrains: (PowertrainLean & Record<string, unknown>)[]
): ManualImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFenceAndPreamble(rawText));
  } catch (err) {
    return { valid: false, errors: [`Could not parse JSON: ${(err as Error).message}`], modelDiff: [], modelChanges: {}, powertrainResults: [] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, errors: ["Top level must be a JSON object with \"model\" and \"powertrains\" keys."], modelDiff: [], modelChanges: {}, powertrainResults: [] };
  }
  const top = parsed as Record<string, unknown>;

  const errors: string[] = [];

  const modelResult = validateManualModelFields(top.model);
  errors.push(...modelResult.errors);
  const modelDiff = buildFieldDiff(currentModel, modelResult.cleaned, {});

  const existingById = new Map(existingPowertrains.map((pt) => [String(pt._id), pt]));

  const rawPowertrains = top.powertrains;
  if (!Array.isArray(rawPowertrains)) {
    errors.push('"powertrains" must be an array.');
    return { valid: false, errors, modelDiff, modelChanges: modelResult.cleaned, powertrainResults: [] };
  }

  const powertrainResults: PowertrainImportResult[] = rawPowertrains.map((raw, index) => {
    const parsedVariant = validateManualPowertrain(raw, index);
    if (!parsedVariant.valid) {
      errors.push(...parsedVariant.errors);
      return { status: "new", diff: [], variant: parsedVariant.variant, valid: false, errors: parsedVariant.errors };
    }

    if (parsedVariant._id === null) {
      // Declared as a brand-new trim — diff against nothing (every field is "new").
      const diff = buildFieldDiff(null, parsedVariant.variant, parsedVariant.sourceNotes);
      return { status: "new", diff, variant: parsedVariant.variant, valid: true, errors: [] };
    }

    const existing = existingById.get(parsedVariant._id);
    if (!existing) {
      const err = `powertrains[${index}]._id "${parsedVariant._id}" does not match any existing trim on this model — if this is really a new trim, omit "_id" entirely rather than inventing one.`;
      errors.push(err);
      return { status: "new", diff: [], variant: parsedVariant.variant, valid: false, errors: [err] };
    }

    const diff = buildFieldDiff(existing as Record<string, unknown>, parsedVariant.variant, parsedVariant.sourceNotes);
    return {
      status: "update",
      existingId: parsedVariant._id,
      trimName: existing.trim_name,
      diff,
      variant: parsedVariant.variant,
      valid: true,
      errors: [],
    };
  });

  return { valid: errors.length === 0, errors, modelDiff, modelChanges: modelResult.cleaned, powertrainResults };
}
