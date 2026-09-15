// Shared core for the manual Kimi/DeepSeek round-trip workflow: export a
// model's current document as clean JSON, generate a companion prompt, and
// validate+diff a pasted-back response before anything is written.
//
// Deliberately separate from lib/techSpecResearch.ts (the shared research pipeline) —
// this never calls an LLM API itself, it only prepares/validates JSON for a
// human to hand-carry through an external chat UI. It DOES reuse
// validateCanonicalVariant from techSpecResearch.ts VERBATIM for the
// powertrain shape (see validateManualPowertrain below — no separate,
// possibly-drifting copy of "what does a valid powertrain variant look
// like"), and findMismatchedKeys from applySpecUpdates.ts for diffing.
// validateNotableFacts is NOT reused as-is: the Model schema stores
// notable_facts/notable_facts_confidence as two flat top-level fields (see
// models/Model.ts), not the nested {text, confidence} object shape that
// function expects (that shape only exists transiently inside a
// ResearchedNotableFacts result in the automated pipeline) — so
// validateManualModelFields below re-implements the equivalent check for
// that flat shape instead, reusing the same CONFIDENCE_VALUES enum so the
// two paths can't disagree on what a valid confidence value is, even though
// they can't share the literal validator function.

import { validateCanonicalVariant, checkPriceCurrencyFidelity, describeTrimGaps, type PowertrainLean } from "./techSpecResearch";
import { CANONICAL_POWERTRAIN_FIELD_TEMPLATE, CONFIDENCE_VALUES } from "@/types/canonicalPowertrain";
import { findMismatchedKeys } from "./applySpecUpdates";
import { correctRangeStandard, correctGearboxType } from "./deepseekNormalize";
import { buildOutputLanguageRule, THERMAL_MANAGEMENT_MANDATORY_RULE, TRIM_NAME_FIDELITY_RULE, CURRENCY_SOURCE_FIDELITY_RULE } from "./researchPromptRules";
import { SEGMENTS } from "@/models/Model";
import { matchTrimName } from "./trimMatching";
import type { IBrand } from "@/types";

/** Model fields this workflow may ever read from an import and write back — deliberately excludes _id, brand_id, timestamps, Morocco fields (a different scraped-data pipeline), and any research-log bookkeeping field. Adding a field here means adding it to RESEARCHABLE_MODEL_KEYS below too — kept as two names for the same Set so a future editor sees why both exist. */
export const RESEARCHABLE_MODEL_KEYS = [
  "name",
  "name_cn",
  "name_en",
  "generation",
  "segment",
  "segment_confidence",
  "body_type",
  "notable_facts",
  "notable_facts_confidence",
  "price_range",
] as const;

const RESEARCHABLE_MODEL_KEY_SET = new Set<string>(RESEARCHABLE_MODEL_KEYS);
const SEGMENT_SET = new Set<string>(SEGMENTS);

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
  // Deliberately no "unverified" field — that's a AI-grounding-gate-only
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
    segment_confidence?: string;
    body_type: string;
    production_status: string;
    unverified?: boolean;
    notable_facts?: string;
    notable_facts_confidence?: string;
    price_range?: {
      min?: number;
      max?: number;
      currency_local?: string;
      unverified?: boolean;
    };
  };
  powertrains: ExportedPowertrain[];
}

/** Fields that only exist to give the external LLM context (e.g. brand_name) or are read-only display (production_status, _id, brand_id) — never accepted back as a change on import, regardless of what the returned JSON says. "unverified_note" isn't a real field at all — Kimi/DeepSeek reliably invents it anyway to explain why it set "unverified", so it's silently dropped here rather than hard-failing every import that touches that field (the same reasoning as "unverified" itself being context-only: whatever it says is redundant with the field-level "<field>_source_note"s already required elsewhere). "segment_note" is the same pattern for "segment" — harmless AI-added color commentary explaining its segment classification (seen for real on a Geely Coolray/Binyue import), not a real schema field; not worth rejecting the whole model diff over, unlike a genuine data-shape or enum mismatch. */
const MODEL_CONTEXT_ONLY_KEYS = new Set([
  "_id",
  "brand_id",
  "brand_name",
  "brand_name_cn",
  "production_status",
  "unverified",
  "unverified_note",
  "segment_note",
]);

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
      segment_confidence: modelDoc.segment_confidence as string | undefined,
      body_type: modelDoc.body_type as string,
      production_status: modelDoc.production_status as string,
      unverified: modelDoc.unverified as boolean | undefined,
      notable_facts: modelDoc.notable_facts as string | undefined,
      notable_facts_confidence: modelDoc.notable_facts_confidence as string | undefined,
      // Only the researchable subset — never min_usd/max_usd/exchange_rate_used:
      // those are always computed server-side from a live rate at import time
      // (see the apply route), never trusted from the researcher's own math.
      price_range: modelDoc.price_range
        ? {
            min: (modelDoc.price_range as Record<string, unknown>).min as number | undefined,
            max: (modelDoc.price_range as Record<string, unknown>).max as number | undefined,
            currency_local: (modelDoc.price_range as Record<string, unknown>).currency_local as string | undefined,
            unverified: (modelDoc.price_range as Record<string, unknown>).unverified as boolean | undefined,
          }
        : { min: undefined, max: undefined, currency_local: "CNY", unverified: undefined },
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
  const modelGapLines = [
    ...(model.price_range?.min == null || model.price_range?.max == null ? ['- model.price_range: missing — see job 4 below.'] : []),
    ...(model.segment_confidence !== "confirmed" ? ['- model.segment: currently unconfirmed/inferred — see job 6 below.'] : []),
  ];
  const gapLines = [
    ...modelGapLines,
    ...powertrains.filter((p) => p.research_gaps.length > 0).map((p) => `- "${p.trim_name}": ${p.research_gaps.join("; ")}`),
  ].join("\n");

  return `You are a technical researcher building a spec database of Chinese-market EVs/ICE/hybrids.

Below is the current database record (as JSON) for "${model.brand_name}" — "${model.name_en ?? model.name}"${
    model.name_cn ? ` (${model.name_cn})` : ""
  }. This record was produced by an earlier, automated research pass (an automated research pass with real search grounding) — it is a reasonable starting point, not ground truth. You are doing a SECOND, INDEPENDENT research pass on top of it, and that pass has six distinct jobs, not one:

1. FILL GAPS — find sourced values for whatever is currently null or unconfirmed (see "Known gaps" below).
2. CROSS-CHECK EXISTING VALUES — independently verify fields that are already populated and marked "confirmed", using your own search rather than trusting that the first pass got them right. Do not skip a field just because it already has a value. If your independent research disagrees with a stored value — a wrong battery chemistry, a wrong power figure, a wrong transmission type, anything — correct it and explain the discrepancy in that field's "<field>_source_note", even though it was never listed as a "known gap". This matters: on a previous model (Soueast S06 DM), the original automated pass reported the wrong battery chemistry, and it only got caught because a second independent pass happened to check a field nobody had flagged as missing. Treat every "confirmed" field as a candidate to challenge, not as settled.
3. FIND MISSING TRIMS — the trim list below may be incomplete, not just the fields within it (see the trim-completeness note below). Actively search for variants of this model that exist in the real market but aren't in this record at all.
4. RESEARCH PRICE — "model.price_range" (min/max CHINA MSRP, in CNY) is one of the fields to fill/cross-check exactly like any other, and it is MANDATORY: price_range must never be left null in your response. If it's null, first try to find the real China starting-price range for this model (the manufacturer's official listed price, or the lowest/highest trim MSRP from autohome.com.cn / dongchedi.com's price pages — not a used-market or export price). ONLY if no sourced China MSRP exists anywhere (a genuinely unlaunched or export-only model), this is the one explicit exception to rule 3 below: give a reasonable approximate price instead, estimated from comparable vehicles in the same segment/body_type/powertrain class (e.g. "similar C-segment PHEV SUVs in China retail for roughly 150,000-200,000 CNY, used as an estimate since no listed price exists for this specific model") — set "unverified": true and put the comparison reasoning in "price_range_source_note" so a reader can tell at a glance this is an estimate, not a quoted price. If it's already populated, cross-check it per job 2 above. Only "min", "max", "currency_local" (should be "CNY"), and "unverified" belong in price_range — do NOT add "min_usd"/"max_usd"/"exchange_rate_used": the USD conversion is always computed separately from a live exchange rate, never from your own math, so those fields are deliberately absent from the record below and must stay absent from your response.

5. BATTERY THERMAL MANAGEMENT — "thermal_management" is one of the fields to fill/cross-check exactly like any other, and it is MANDATORY, even if it isn't listed under "Known gaps" below (older trims in this record predate this field and won't be flagged as a gap for it, but the requirement still applies to them): ${THERMAL_MANAGEMENT_MANDATORY_RULE} Actively search for the battery cooling method (Chinese terms like "液冷"/liquid cooling, "热泵"/heat pump, "风冷"/air cooling, "冷却液"/coolant) the same way as every other field. An entirely missing "thermal_management" key on a non-ICE trim will fail validation and block this entire import, so never omit it, not even by oversight while focusing on other fields.

6. VEHICLE SEGMENT — "model.segment" is MANDATORY and must NEVER be left null, same posture as price_range in job 4. If "model.segment_confidence" is currently "inferred" (or the field is missing), actively try to find a real source (autohome.com.cn / dongchedi.com's own segment classification, or a comparable-vehicle listing) that confirms which of ${SEGMENTS.join(", ")} this model belongs to, and set "segment_confidence" to "confirmed" if you find one. If no source is found even after a genuine search, keep (or set) "segment" to your own best-effort classification based on the vehicle's body type, size, and market positioning — never null, never omitted — and set "segment_confidence" to "inferred". A best-effort classification is always better than no classification.

Research this vehicle using Chinese-language automotive sources as your first priority (autohome.com.cn, dongchedi.com, gasgoo.com, official manufacturer press/spec pages, MIIT/工信部 filings), then Moroccan automotive press, then generic English-language sources only if nothing more specific exists.

${
  gapLines
    ? `Known gaps to focus on first (fields currently missing or unconfirmed):\n${gapLines}\n`
    : "No specific gaps were flagged, but this is still a cross-check pass, not a no-op — independently re-verify fields against real sources per job 2 above rather than assuming the current values are correct.\n"
}
This record may be INCOMPLETE at the trim/variant level, not just at the field level: the "powertrains" list below is only whatever trims happen to already be in our database, which may be a subset of the real production lineup for this model (e.g. we might only have a base trim on file when the actual market lineup also includes a higher-output engine option, a PHEV variant, a special edition, etc.). Actively check whether additional trims exist for this model beyond what's listed below — don't limit your research to filling gaps in the trims you were given. If you find a real trim that isn't in the list, add it as a new entry in "powertrains" per rule 2 below (omit "_id" entirely for it).

CRITICAL RULES — read carefully, this is a round-trip into a strict-schema database:
1. Return the SAME JSON shape you were given below — same top-level keys ("model", "powertrains"), same nested field names. Do not add, rename, or omit any field. This means NESTED fields stay nested — e.g. transmission type is "transmission": {"type": ...}, never a flat trim-level "transmission_type"; gear count is "transmission": {"speed_count": ...}, never a flat "number_of_gears"; 0-100 acceleration is "performance": {"accel_0_100_s": ...}, never a flat "acceleration_0_100_s"; battery capacity is "battery": {"capacity_total_kwh": ...}, never "battery": {"total_capacity_kwh": ...}. A response using a different-but-plausible-looking flat naming scheme instead of the exact nested shape below is rejected by the importer's strict schema validator, not silently accepted — it must match exactly.
2. model._id and every powertrains[]._id MUST be returned byte-for-byte UNCHANGED from what you were given. These IDs are how the import step matches your response back to the exact existing database record — if you omit an _id, invent a new one, or alter it in any way, that entire record will be misread as a brand-new trim instead of an update to the existing one, which defeats the whole point of this workflow. If you are adding a genuinely NEW trim that wasn't in the input, give it no "_id" field at all (omit it, don't invent a placeholder) — that is the only case where a missing _id is correct. ${TRIM_NAME_FIDELITY_RULE}
3. Every numeric or categorical fact must come from a source you can point to — do not estimate or infer from similar vehicles. Use null for anything you cannot find a sourced value for. The exceptions are price_range per job 4 above (never left null even when only an estimate is possible) and segment per job 6 above (never left null even when only your own best-effort classification is possible — tag it "inferred" via segment_confidence in that case).
2b. ${buildOutputLanguageRule([
    '"name_cn" is explicitly the ORIGINAL-LANGUAGE (Chinese) name and must stay in its original script',
  ])} A genuinely NEW trim_name you are adding should itself be in English/Latin script where the vehicle's real nameplate allows it.
2c. ${CURRENCY_SOURCE_FIDELITY_RULE} This applies to every price field in this record — both "model.price_range" (job 4 above) and any per-trim price you fill in on a "powertrains[]" entry.
3b. "thermal_management" is REQUIRED on every powertrain entry whose "energy_type" is not "ICE" — per job 5 above, fill it with real values if you find them or with "thermal_evidence": "UNKNOWN" / "morocco_suitable": false if you genuinely can't. Omitting the "thermal_management" key entirely on a non-ICE trim is a validation failure that blocks the whole import, not a harmless gap — double-check every non-ICE trim in your response has this key before returning it.
4. For every field you CHANGE from its current value — whether it was null (a gap you filled) or already populated (a value your independent research corrected) — add a sibling "<field>_source_note" string explaining the source and, if you're correcting an existing value, what was wrong with it (e.g. if you change "battery.chemistry" from an existing "NMC" to "LFP", include "battery.chemistry_source_note": "Corrected from NMC — official Soueast spec sheet and autohome.com.cn both list LFP"). Only changed fields need a source note — leave unchanged fields as-is with no note. A field you independently checked and confirmed matches the stored value needs no note either; notes exist only to flag a change, not to prove you checked something.
5. Do not touch any field not listed in "model" or "powertrains[]" below — there is no other data to research.
6. Respond with ONLY the JSON object. No markdown code fences, no explanation before or after, no commentary — your entire response must be valid JSON starting with { and ending with }, ready to be pasted directly into a JSON parser.
7. Every powertrain field name and nesting below is EXACT and FIXED — this is the only valid shape for a powertrain entry, shown here with every field present as null so you have the precise structure to fill in (do not infer it from which fields happen to already have values):

${JSON.stringify(CANONICAL_POWERTRAIN_FIELD_TEMPLATE, null, 2)}

In particular: "ev_range_km" lives ONLY inside "battery" (never at the top level of a powertrain, never inside "motor"), and battery capacity is "capacity_total_kwh" (never "capacity_kwh").

Here is the current record: research it as described above (fill gaps, cross-check existing values, look for missing trims) and return it in the same shape:

${JSON.stringify({ model, powertrains: powertrains.map(({ research_gaps: _rg, ...p }) => p) }, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Model-field validation (mirrors validateCanonicalVariant's discipline)
// ---------------------------------------------------------------------------

export function validateManualModelFields(
  raw: unknown
): { valid: boolean; errors: string[]; cleaned: Record<string, unknown>; sourceNotes: Record<string, string> } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["model: not an object"], cleaned: {}, sourceNotes: {} };
  }
  // Strips "<field>_source_note"/bare "source_note" siblings recursively,
  // one level into each nested block — needed here, not just at the
  // top level, because a note can land nested inside a block field (e.g.
  // model.price_range.price_range_source_note) rather than as a sibling of
  // "model" itself. Without this the raw note string rides along into
  // "cleaned.price_range" and Mongoose's strict schema silently drops it on
  // write, which then fails findMismatchedKeys's re-fetch verification
  // (seen for real on Geely Galaxy Warship 700: "Model fields did not
  // verify after write: [price_range.price_range_source_note]").
  const { stripped, notes } = extractSourceNotes(raw as Record<string, unknown>);
  const v = stripped;
  const cleaned: Record<string, unknown> = {};

  for (const key of Object.keys(v)) {
    if (MODEL_CONTEXT_ONLY_KEYS.has(key)) continue; // context-only, silently ignored on the way back in
    if (!RESEARCHABLE_MODEL_KEY_SET.has(key)) {
      errors.push(`model.${key}: unexpected field, not researchable`);
      continue;
    }
    cleaned[key] = v[key];
  }

  if (v.notable_facts_confidence !== undefined && v.notable_facts_confidence !== null) {
    // Same CONFIDENCE_VALUES enum the automated pipeline's validateNotableFacts
    // checks against — model.notable_facts_confidence can't share that
    // function literally (this is a flat Model field, not the nested
    // {text, confidence} object shape validateNotableFacts validates), but
    // it must agree on what counts as a valid value.
    if (!(CONFIDENCE_VALUES as string[]).includes(v.notable_facts_confidence as string)) {
      errors.push(`model.notable_facts_confidence: invalid value ${JSON.stringify(v.notable_facts_confidence)}`);
    }
  }

  // segment is mandatory (never null) per job 6 of the prompt — unlike every
  // other researchable field here, a missing/null value is rejected outright
  // rather than silently accepted as "not researched this round".
  if (typeof v.segment !== "string" || !SEGMENT_SET.has(v.segment)) {
    errors.push(`model.segment: missing or invalid value ${JSON.stringify(v.segment)} — segment is mandatory, never null`);
  }
  if (v.segment_confidence !== undefined && v.segment_confidence !== null) {
    if (v.segment_confidence !== "confirmed" && v.segment_confidence !== "inferred") {
      errors.push(`model.segment_confidence: invalid value ${JSON.stringify(v.segment_confidence)}`);
    }
  }

  // Same defense-in-depth as validateCanonicalVariant's trim_price check —
  // catches a self-converted-to-USD price_range that CURRENCY_SOURCE_FIDELITY_RULE
  // (job 2c above) told the model never to produce.
  if (v.price_range && typeof v.price_range === "object" && !Array.isArray(v.price_range)) {
    const pr = v.price_range as Record<string, unknown>;
    checkPriceCurrencyFidelity(pr.min, pr.max, pr.currency_local, "model.price_range", "currency_local", errors);
  }

  return { valid: errors.length === 0, errors, cleaned, sourceNotes: notes };
}

// ---------------------------------------------------------------------------
// Powertrain-field validation — reuses the shared research pipeline's validator
// verbatim, minus the trim_name/energy_type "required" checks (a returned
// UPDATE to an existing trim may legitimately omit trim_name/energy_type if
// unchanged... but our export always includes them, and the prompt asks for
// the full shape back, so we still require them for a clean, unambiguous
// diff — same rule as the AI's response).
// ---------------------------------------------------------------------------

/** Strips "<field>_source_note" sibling keys (recursively, one level into each block) before running the canonical validator, which doesn't know about them — returns the stripped copy plus a flat map of path -> source note for display in the diff. Also accepts the bare "source_note" spelling (no leading field name) as shorthand for "source_source_note" — a recurring Kimi/DeepSeek mistake where it means "a note about my source citation" rather than "a note about a field named source", since the trim already has its own top-level "source" field this clearly refers to. */
export function extractSourceNotes(raw: Record<string, unknown>): { stripped: Record<string, unknown>; notes: Record<string, string> } {
  const notes: Record<string, string> = {};
  function strip(obj: Record<string, unknown>, path: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "source_note" || k.endsWith("_source_note")) {
        const fieldName = k === "source_note" ? "source" : k.replace(/_source_note$/, "");
        // A note nested one level inside the very field it's annotating
        // (e.g. "price_range.price_range_source_note", another redundant
        // Kimi/DeepSeek naming variant) shouldn't double up the segment —
        // collapse to just "path" rather than "path.path".
        const fieldPath = !path ? fieldName : path.split(".").pop() === fieldName ? path : `${path}.${fieldName}`;
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

/**
 * Known, recurring DeepSeek/Kimi mistakes: a field lands in the wrong block,
 * or under the wrong name, even though the export/prompt always shows it
 * correctly nested and named (buildManualResearchPrompt). Each entry below
 * is a single field with exactly one correct location/name per the
 * canonical schema (types/canonicalPowertrain.ts), confirmed case by case as
 * they surface — this is a mechanical relocate/rename, not a general
 * "accept anything" leniency. It never invents or guesses a value, only
 * moves/renames a field (and its "<field>_source_note" sibling, if present)
 * to its one valid spot before validation runs. Extend this table, don't
 * hand-roll a new one-off function, when the next misplaced-field case shows up.
 */
const KNOWN_FIELD_RELOCATIONS: { from: string; to: string }[] = [
  // trim-level -> battery (the original ev_range_km flattening bug)
  { from: "ev_range_km", to: "battery.ev_range_km" },
  // motor -> battery (same field, different wrong block)
  { from: "motor.ev_range_km", to: "battery.ev_range_km" },
  // battery -> battery, name mismatch only
  { from: "battery.capacity_kwh", to: "battery.capacity_total_kwh" },
  // Confirmed on a real Geely Coolray/Binyue response (14 trims, all
  // rejected — see the incident this table was extended for): Kimi/DeepSeek
  // flattened transmission/performance into trim-level fields under a
  // different, more "natural" flat naming scheme, despite the prompt
  // embedding the exact canonical shape verbatim (buildManualResearchPrompt
  // rule 7 / CANONICAL_POWERTRAIN_FIELD_TEMPLATE) and rule 1 explicitly
  // forbidding renamed fields. Prompt fidelity alone isn't reliable here —
  // same reasoning as the trim_name-translation fix — so these are
  // mechanically relocated/renamed before validation runs, exactly like the
  // battery.capacity_kwh case above.
  { from: "transmission_type", to: "transmission.type" },
  { from: "number_of_gears", to: "transmission.speed_count" },
  { from: "acceleration_0_100_s", to: "performance.accel_0_100_s" },
  { from: "top_speed_kmh", to: "performance.top_speed_kmh" },
  { from: "battery.total_capacity_kwh", to: "battery.capacity_total_kwh" },
  { from: "battery.usable_capacity_kwh", to: "battery.capacity_usable_kwh" },
  { from: "battery.ac_charging_kw", to: "battery.ac_charge_kw" },
  { from: "battery.dc_charging_kw", to: "battery.dc_charge_kw" },
  // Same response also renamed these two thermal_management booleans —
  // matches the earlier Geely Atlas Pro/Azkarra/Boyue Pro incident
  // (thermal_management fields nested under the wrong block entirely) as a
  // second, independent confirmation that thermal_management's exact shape
  // is a recurring trouble spot for the AI, not a one-off.
  { from: "thermal_management.active_liquid_cooling", to: "thermal_management.has_liquid_cooling" },
  { from: "thermal_management.heat_pump", to: "thermal_management.has_heat_pump" },
];

function getPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function deleteAtPath(obj: Record<string, unknown>, path: string[]): void {
  if (path.length === 1) {
    delete obj[path[0]];
    return;
  }
  const parent = getPath(obj, path.slice(0, -1));
  if (parent && typeof parent === "object" && !Array.isArray(parent)) {
    delete (parent as Record<string, unknown>)[path[path.length - 1]];
  }
}

function setAtPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur = obj;
  for (const key of path.slice(0, -1)) {
    const existing = cur[key];
    const next = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    cur[key] = next;
    cur = next as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/** Deep-clones just enough of `rest` (plain objects only) that relocations can mutate freely without touching the caller's object. */
function deepCloneShallowRecord(rest: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rest };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = deepCloneShallowRecord(v as Record<string, unknown>);
    }
  }
  return out;
}

function relocateKnownMisplacedFields(rest: Record<string, unknown>): Record<string, unknown> {
  const out = deepCloneShallowRecord(rest);
  for (const { from, to } of KNOWN_FIELD_RELOCATIONS) {
    for (const suffix of ["", "_source_note"]) {
      const fromPath = (from + suffix).split(".");
      const toPath = (to + suffix).split(".");
      const value = getPath(out, fromPath);
      if (value !== undefined) {
        deleteAtPath(out, fromPath);
        setAtPath(out, toPath, value);
      }
    }
  }
  return out;
}

/**
 * Known value-level aliasing, applied AFTER relocateKnownMisplacedFields
 * (which handles wrong location/name, not wrong value) and BEFORE
 * validation. Reuses correctRangeStandard from deepseekNormalize.ts, whose
 * table only fixes genuine typo/citation artifacts (e.g. "NEDC2") — "WLTC"
 * is deliberately NOT one of them, since it's a real, distinct test standard
 * from "WLTP" (different correction factors, not guaranteed to produce the
 * same figure for the same car) and is accepted as its own valid enum value
 * rather than relabeled. Reusing the same table the the AI-research and DeepSeek
 * batch pipelines use keeps all three import paths agreeing on what counts
 * as an alias vs. a distinct standard, instead of maintaining separate
 * answers to the same question.
 */
function normalizeKnownValueAliases(rest: Record<string, unknown>): Record<string, unknown> {
  const out = deepCloneShallowRecord(rest);
  const battery = out.battery;
  if (battery && typeof battery === "object" && !Array.isArray(battery)) {
    const b = battery as Record<string, unknown>;
    if (typeof b.ev_range_standard === "string") {
      b.ev_range_standard = correctRangeStandard(b.ev_range_standard) ?? null;
    }
  }
  // Same "resolve a known alias, else drop rather than guess" contract as
  // ev_range_standard above — see correctGearboxType's own comment for why
  // this exists as a separate function from the legacy correctGearbox.
  const transmission = out.transmission;
  if (transmission && typeof transmission === "object" && !Array.isArray(transmission)) {
    const t = transmission as Record<string, unknown>;
    if (typeof t.type === "string") {
      t.type = correctGearboxType(t.type) ?? null;
    }
  }
  return out;
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
  const relocated = relocateKnownMisplacedFields(rest);
  const normalized = normalizeKnownValueAliases(relocated);
  const { stripped, notes } = extractSourceNotes(normalized);
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
  /**
   * True when this "update" was resolved via trim_name fallback matching,
   * not a real _id match — i.e. the response's _id was missing, fabricated,
   * or altered in transit (e.g. truncated by an external chat UI), but
   * exactly one existing trim's name matched closely enough to be
   * confident. Surfaced so the reviewer can tell "the app matched this by
   * name, not because the AI actually returned the right _id" apart from a
   * normal, trusted _id match — same transparency the automated path's
   * "matched to existing trim" badge already gives for its own trim_name
   * fallback (see lib/trimMatching.ts's matchTrimName, reused here).
   */
  matchedViaNameFallback?: boolean;
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

/**
 * Backstop only — the prompt explicitly asks for "_id" (with the leading
 * underscore) on model and every powertrain, byte-for-byte as given, but
 * Kimi/DeepSeek have been observed "cleaning up" the field name to a bare
 * "id" anyway despite that instruction. Rather than hard-failing an
 * otherwise-good response over a field-name typo the model made on its own,
 * rename "id" -> "_id" in place (only when "_id" itself isn't already
 * present, so a deliberate real "id" field — none exist in this schema, but
 * defensively) before validation ever sees it.
 */
function normalizeIdField(obj: unknown): void {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return;
  const rec = obj as Record<string, unknown>;
  if (!("_id" in rec) && "id" in rec) {
    rec._id = rec.id;
    delete rec.id;
  }
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

  normalizeIdField(top.model);
  if (Array.isArray(top.powertrains)) {
    for (const pt of top.powertrains) normalizeIdField(pt);
  }

  const errors: string[] = [];

  const modelResult = validateManualModelFields(top.model);
  errors.push(...modelResult.errors);
  const modelDiff = buildFieldDiff(currentModel, modelResult.cleaned, modelResult.sourceNotes);

  const existingById = new Map(existingPowertrains.map((pt) => [String(pt._id), pt]));

  // trim_name -> every existing doc under that exact name. Length >1 means
  // this model ALREADY has duplicate trims sharing a name (the exact
  // scenario that caused the 09-14 Coolray duplicates in the first place) —
  // never silently pick one of them, same "ambiguous means no match" rule
  // matchTrimName itself already applies for a normalized multi-match.
  const existingByName = new Map<string, (PowertrainLean & Record<string, unknown>)[]>();
  for (const pt of existingPowertrains) {
    if (!pt.trim_name) continue;
    const arr = existingByName.get(pt.trim_name) ?? [];
    arr.push(pt);
    existingByName.set(pt.trim_name, arr);
  }
  const allExistingTrimNames = existingPowertrains.map((pt) => pt.trim_name).filter((t): t is string => Boolean(t));
  // Names already claimed by an earlier entry in THIS SAME import via the
  // fallback below — excluded from later candidates so two incoming trims
  // with missing/wrong _ids can't both silently fall back onto the same
  // existing doc (which would make the second overwrite the first on apply).
  const claimedByFallback = new Set<string>();

  /**
   * Trim-name fallback matching (mirrors the automated path's
   * lib/trimMatching.ts matchTrimName, used the SAME way here) — used only
   * when this entry's _id was missing or didn't match anything. Returns the
   * one existing doc to treat this as an update against, or null if no
   * confident, unambiguous match exists (including when the matched name
   * itself maps to more than one existing doc) — in which case the caller
   * falls through to "new", exactly today's behavior, never a guess.
   */
  function fallbackMatchByName(trimName: unknown): (PowertrainLean & Record<string, unknown>) | null {
    if (typeof trimName !== "string" || trimName.trim() === "") return null;
    const candidates = allExistingTrimNames.filter((n) => !claimedByFallback.has(n));
    const { matchedTrimName } = matchTrimName(trimName, candidates);
    if (!matchedTrimName) return null;
    const docs = existingByName.get(matchedTrimName) ?? [];
    if (docs.length !== 1) return null; // ambiguous — this model already has duplicates under this name
    claimedByFallback.add(matchedTrimName);
    return docs[0];
  }

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
      // Declared as a brand-new trim by omitting "_id" — but that's also
      // exactly what an _id dropped/altered in transit looks like, so try a
      // name-based fallback before trusting "genuinely new" (see the
      // 09-14 Coolray duplicates this closes the gap for).
      const fallback = fallbackMatchByName(parsedVariant.variant.trim_name);
      if (fallback) {
        const diff = buildFieldDiff(fallback as Record<string, unknown>, parsedVariant.variant, parsedVariant.sourceNotes);
        return {
          status: "update",
          existingId: String(fallback._id),
          trimName: fallback.trim_name,
          diff,
          variant: parsedVariant.variant,
          valid: true,
          errors: [],
          matchedViaNameFallback: true,
        };
      }
      // Diff against nothing (every field is "new").
      const diff = buildFieldDiff(null, parsedVariant.variant, parsedVariant.sourceNotes);
      return { status: "new", diff, variant: parsedVariant.variant, valid: true, errors: [] };
    }

    const existing = existingById.get(parsedVariant._id);
    if (!existing) {
      // A recurring DeepSeek/Kimi mistake: inventing a plausible-looking
      // ObjectId for a genuinely new trim instead of omitting "_id" as
      // instructed — or, per the 09-14 Coolray incident, the real _id
      // dropped/altered in transit through an external chat UI. Since
      // existingById only covers THIS model's trims, an unmatched id can
      // never mean "silently overwrite the wrong document" — try the same
      // name-based fallback as the missing-_id case above before concluding
      // "new".
      const fallback = fallbackMatchByName(parsedVariant.variant.trim_name);
      if (fallback) {
        const diff = buildFieldDiff(fallback as Record<string, unknown>, parsedVariant.variant, parsedVariant.sourceNotes);
        return {
          status: "update",
          existingId: String(fallback._id),
          trimName: fallback.trim_name,
          diff,
          variant: parsedVariant.variant,
          valid: true,
          errors: [],
          matchedViaNameFallback: true,
        };
      }
      const diff = buildFieldDiff(null, parsedVariant.variant, parsedVariant.sourceNotes);
      return { status: "new", diff, variant: parsedVariant.variant, valid: true, errors: [] };
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
