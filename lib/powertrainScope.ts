// Single source of truth for WHAT MAY LIVE in the Powertrain collection, and the pure checks every
// write path enforces. Imported by: the research/import validators (lib/techSpecResearch.ts,
// lib/manualResearchImport.ts), the apply layer (lib/applySpecUpdates.ts, the manual-import apply
// route) and — as the un-bypassable backstop — Mongoose hooks on the Powertrain schema
// (models/Powertrain.ts).
//
// Why this exists (2026-09-19): the DB was scoped to PHEV-only / engine <=1.5L on 2026-09-18, but
// nothing in the code ENFORCED that. Prompts framed the DB as "EVs/ICE/hybrids" and the write layer
// accepted any energy_type, so a day later manual DeepSeek imports created 7 ICE trims (Tiggo 8 Pro
// x4, GS4 x3) alongside their PHEV trims. Tech Search only hid them (it pins energy_type=PHEV);
// Compare, the model page and the bounds endpoint did not. Prompt wording alone had already failed
// once that day (known-issues off-model padding), so — same principle as the exact-model filter —
// the rule is enforced in code at every layer, not just stated in a prompt.
//
// Policy (CLAUDE.md, cleanup passes 1-3): energy_type must be exactly "PHEV" (REEV/EREV is excluded,
// not folded in), and a CONFIRMED engine displacement above 1.5 L is out of scope. An unconfirmed or
// unknown displacement is FLAGGED, not rejected — the same "unresearched != disqualified" rule pass 2
// applied. `engine.is_range_extender` is deliberately NOT tested (5 BAIC Taitan 700 trims carry it
// under energy_type PHEV; that is a known open review item, not new leakage).

export const POWERTRAIN_SCOPE = {
  allowedEnergyTypes: ["PHEV"] as readonly string[],
  /** Litres. A tiny tolerance is added at comparison time because stored values like 1.498 are "1.5". */
  maxDisplacementL: 1.5,
} as const;

const DISPLACEMENT_TOLERANCE = 0.05;

export interface VariantScopeInput {
  energy_type?: unknown;
  engine?: { displacement_l?: unknown; confidence?: unknown } | null;
}

export interface ScopeResult {
  ok: boolean;
  /** Hard violations — the trim must not be written. */
  reasons: string[];
  /** Soft findings — allowed, but worth a reviewer's eye (e.g. an UNCONFIRMED engine above 1.5 L). */
  flags: string[];
}

/** Pure. `energy_type` undefined is fine (a partial update that doesn't touch it); a present value must be "PHEV". */
export function checkVariantScope(v: VariantScopeInput): ScopeResult {
  const reasons: string[] = [];
  const flags: string[] = [];

  if (v.energy_type !== undefined && v.energy_type !== null && !POWERTRAIN_SCOPE.allowedEnergyTypes.includes(String(v.energy_type))) {
    reasons.push(`energy_type "${String(v.energy_type)}" is out of scope — this database covers PHEV trims only`);
  }

  const d = v.engine?.displacement_l;
  if (typeof d === "number" && d > POWERTRAIN_SCOPE.maxDisplacementL + DISPLACEMENT_TOLERANCE) {
    if (v.engine?.confidence === "confirmed") {
      reasons.push(`confirmed engine displacement ${d}L exceeds the ${POWERTRAIN_SCOPE.maxDisplacementL}L scope limit`);
    } else {
      flags.push(`engine displacement ${d}L (unconfirmed) exceeds the ${POWERTRAIN_SCOPE.maxDisplacementL}L scope limit — verify before keeping`);
    }
  }
  return { ok: reasons.length === 0, reasons, flags };
}

export class OutOfScopeError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[], context = "Powertrain write") {
    super(`${context} rejected as out of scope: ${reasons.join("; ")}`);
    this.name = "OutOfScopeError";
    this.reasons = reasons;
  }
}

/** Deliberate, explicit escape hatch (a future scope change, or legacy seed data). Never set implicitly. */
export function scopeOverrideActive(): boolean {
  return process.env.POWERTRAIN_SCOPE_OVERRIDE === "1";
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Reduces a Mongoose UPDATE document to the two facts the policy needs. Handles the shapes this
 * codebase actually writes: `{ $set: {...} }`, `{ $setOnInsert: {...} }` (upserts), a bare field object
 * (Mongoose wraps it in $set), and both dotted (`"engine.displacement_l"`) and nested (`engine: {...}`)
 * forms. When only a displacement is written (no confidence in the same update) the existing doc's
 * confidence is unknown here, so it is treated as unconfirmed — flagged, not rejected.
 */
export function scopeInputFromUpdate(update: unknown): VariantScopeInput {
  if (!isRec(update)) return {};
  const sources = [update.$set, update.$setOnInsert, update].filter(isRec) as Rec[];
  let energy_type: unknown;
  let displacement: unknown;
  let confidence: unknown;
  for (const s of sources) {
    if ("energy_type" in s) energy_type = s.energy_type;
    if ("engine.displacement_l" in s) displacement = s["engine.displacement_l"];
    if ("engine.confidence" in s) confidence = s["engine.confidence"];
    if (isRec(s.engine)) {
      if ("displacement_l" in s.engine) displacement = s.engine.displacement_l;
      if ("confidence" in s.engine) confidence = s.engine.confidence;
    }
  }
  return { energy_type, engine: displacement !== undefined ? { displacement_l: displacement, confidence } : undefined };
}

/** Throws OutOfScopeError if the update would write an out-of-scope value. */
export function assertUpdateInScope(update: unknown, context = "Powertrain update"): void {
  const r = checkVariantScope(scopeInputFromUpdate(update));
  if (!r.ok) throw new OutOfScopeError(r.reasons, context);
}

/** Same, for a full document (create/save/insertMany). */
export function assertDocInScope(doc: VariantScopeInput, context = "Powertrain write"): void {
  const r = checkVariantScope(doc);
  if (!r.ok) throw new OutOfScopeError(r.reasons, context);
}

/**
 * For import parsing: would applying `incoming` on top of `existing` (or as a brand-new trim when
 * `existing` is undefined) leave an out-of-scope trim? Merges the two so an update that omits
 * energy_type is judged by what the stored trim already is — and so an update to a stray non-PHEV trim
 * is refused too (no point refreshing a trim that is about to be removed).
 */
export function checkImportedVariantScope(incoming: VariantScopeInput, existing?: VariantScopeInput | null): ScopeResult {
  return checkVariantScope({
    energy_type: incoming.energy_type ?? existing?.energy_type,
    engine: {
      displacement_l: incoming.engine?.displacement_l ?? existing?.engine?.displacement_l,
      confidence: incoming.engine?.confidence ?? existing?.engine?.confidence,
    },
  });
}

/** The scope paragraph every Powertrain-generating prompt carries. The code enforces it regardless (see file header). */
export const POWERTRAIN_SCOPE_PROMPT = `SCOPE — this database covers ONLY the plug-in hybrid (PHEV) version of a model, with an engine of 1.5 L or smaller. Do NOT add or return any trim whose energy type is ICE (petrol/diesel), HEV, MHEV, BEV or REEV/EREV, and do NOT return a trim with an engine larger than 1.5 L, even if the same nameplate is also sold that way (e.g. a 2.0T or 1.6T petrol version of a model whose PHEV is 1.5T) — leave those variants out of "powertrains" entirely. This is enforced by the import step: an out-of-scope trim is rejected no matter what.`;
