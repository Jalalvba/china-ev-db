// Shared write path for AI-researched specs, used by
// app/api/models/[id]/apply-specs/route.ts. Only ever called after the user
// has reviewed research results and clicked "Apply these updates" — never
// called automatically, and this module never runs research itself (see
// lib/techSpecResearch.ts for that). Upserts Powertrain docs by
// (model_id, trim_name), same pattern as scripts/import-deepseek.ts's
// variant import: existing fields are overwritten via $set, a new doc is
// created via $setOnInsert if no trim with this name exists yet. Model-level
// notable_facts are written directly onto the Model document.
//
// Every write here is re-fetched and field-by-field verified before being
// counted as applied — a Mongoose upsert call not throwing does NOT mean the
// fields you asked for actually landed. We hit this for real: a running dev
// server had `models/Model.ts`'s OLD schema (pre-notable_facts) cached in
// mongoose.models, so `$set: { notable_facts: ... }` on a field the cached
// schema didn't know about was silently dropped under strict mode — the call
// resolved successfully, `updatedAt` even changed, but the field was never
// written. See the comment next to the Model export in models/Model.ts.

import { Types } from "mongoose";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { matchTrimName } from "@/lib/trimMatching";

export interface ApplyVariantUpdate {
  modelDbId: string;
  variant: Record<string, unknown>;
}

export interface ApplyNotableFactsUpdate {
  modelDbId: string;
  text: string;
  confidence?: string;
}

export interface ApplyResult {
  /** Writes that were re-fetched and confirmed to match what was requested. */
  applied: number;
  notableFactsApplied: number;
  /** Every problem, including a write that succeeded but failed verification (see message) — never silently swallowed. */
  errors: { modelDbId: string; message: string }[];
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripUndefined(v as Record<string, unknown>) : v;
  }
  return out as T;
}

/** True if every key/value in `expected` is present with an equal value somewhere in `actual` (recursively) — `actual` may have extra keys (e.g. _id, timestamps) without failing the check. Dates compare by timestamp, since a Date round-tripped through Mongo is a new object instance even when it represents the identical instant; likewise an ObjectId ref field (e.g. brand_id) round-trips as a Types.ObjectId object even when `expected` is the plain id string that was passed in to create/update it — compared by `.toString()` (hit for real: comparing a string brand_id against the persisted ObjectId with plain `===` always failed, a false-negative verification bug in its own right). Exported for reuse by any other write path that needs the same "don't trust the write call not throwing" verification (see file header) — e.g. app/api/brands/[id]/create-models/route.ts. */
export function valuesMatch(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected instanceof Date) {
    const actualTime =
      actual instanceof Date ? actual.getTime() : typeof actual === "string" || typeof actual === "number" ? new Date(actual).getTime() : NaN;
    return !Number.isNaN(actualTime) && actualTime === expected.getTime();
  }
  if (typeof expected === "string" && actual instanceof Types.ObjectId) {
    return actual.toString() === expected;
  }
  if (typeof expected !== "object") return expected === actual;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((v, i) => valuesMatch(v, actual[i]));
  }
  if (typeof actual !== "object" || actual === null) return false;
  const actualObj = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) => valuesMatch(v, actualObj[k]));
}

/** Returns the top-level keys of `expected` whose value did not verify against `actual` — used to name exactly which fields failed to persist, rather than a generic "verification failed". */
export function findMismatchedKeys(expected: Record<string, unknown>, actual: Record<string, unknown> | null): string[] {
  if (!actual) return Object.keys(expected);
  return Object.entries(expected)
    .filter(([k, v]) => !valuesMatch(v, actual[k]))
    .map(([k]) => k);
}

/**
 * Applies approved variant + notable-facts updates. `modelFilter` scopes which
 * Model documents are eligible — e.g. `{ brand_id }` from the brand-level
 * route so it can't be used to write to a model under a different brand, or
 * `{ _id: modelId }` from the model-level route.
 */
export async function applySpecUpdates(opts: {
  updates: ApplyVariantUpdate[];
  notableFacts?: ApplyNotableFactsUpdate[];
  modelFilter: Record<string, unknown>;
}): Promise<ApplyResult> {
  const { updates, notableFacts = [], modelFilter } = opts;

  let applied = 0;
  let notableFactsApplied = 0;
  const errors: { modelDbId: string; message: string }[] = [];

  // Per-model existing-trim-name cache for this call — avoids re-querying for
  // every update in a multi-trim batch, and gets updated as new trims are
  // inserted so a later update in the same batch matches against them too.
  const existingTrimNamesByModel = new Map<string, string[]>();
  async function getExistingTrimNames(modelId: string): Promise<string[]> {
    const cached = existingTrimNamesByModel.get(modelId);
    if (cached) return cached;
    const docs = (await Powertrain.find({ model_id: modelId }, { trim_name: 1 }).lean()) as unknown as {
      trim_name?: string;
    }[];
    const names = docs.map((d) => d.trim_name).filter((t): t is string => Boolean(t));
    existingTrimNamesByModel.set(modelId, names);
    return names;
  }

  for (const update of updates) {
    try {
      const modelDoc = await ModelSchema.findOne({ _id: update.modelDbId, ...modelFilter }).lean();
      if (!modelDoc) {
        errors.push({ modelDbId: update.modelDbId, message: "Model not found in scope — skipped." });
        continue;
      }

      const cleaned = stripUndefined(update.variant ?? {});
      const { trim_name: researchedTrimName, ...rest } = cleaned;
      if (!researchedTrimName || typeof researchedTrimName !== "string") {
        errors.push({ modelDbId: update.modelDbId, message: "Variant is missing trim_name — skipped." });
        continue;
      }

      // Gemini does not reliably reproduce an existing trim name
      // character-for-character across research passes (see
      // lib/trimMatching.ts) — match against what's already stored before
      // deciding whether this is an update or a genuinely new trim, so a
      // reworded trim name updates the existing doc instead of duplicating it.
      const modelIdStr = String(modelDoc._id);
      const existingNames = await getExistingTrimNames(modelIdStr);
      const { matchedTrimName } = matchTrimName(researchedTrimName, existingNames);
      // Keep the ORIGINAL stored trim name stable across research passes
      // rather than overwriting it with whatever wording Gemini used this
      // time — trim_name is this doc's identity, not a researched field.
      const trim_name = matchedTrimName ?? researchedTrimName;

      // Stamped in the same write as the researched fields (not a separate
      // call) so verification below covers it too — a doc whose spec fields
      // landed but whose timestamp didn't would be a half-applied write.
      const expected = { ...rest, last_researched_at: new Date() };

      await Powertrain.findOneAndUpdate(
        { model_id: modelDoc._id, trim_name },
        { $set: expected, $setOnInsert: { model_id: modelDoc._id, trim_name } },
        { upsert: true, runValidators: true }
      );
      if (!matchedTrimName) existingTrimNamesByModel.set(modelIdStr, [...existingNames, trim_name]);

      // Re-fetch and verify — do not trust that the write call not throwing
      // means the fields actually persisted (see file header comment).
      const persisted = (await Powertrain.findOne({ model_id: modelDoc._id, trim_name }).lean()) as Record<
        string,
        unknown
      > | null;
      const badFields = findMismatchedKeys(expected, persisted);
      if (badFields.length > 0) {
        errors.push({
          modelDbId: update.modelDbId,
          message: `Write for trim "${trim_name}" did not throw, but failed verification: field(s) [${badFields.join(
            ", "
          )}] did not persist as expected on re-fetch. Not counted as applied — check for a stale cached Mongoose schema (see comment in models/Powertrain.ts) or a concurrent write.`,
        });
        continue;
      }

      applied++;
    } catch (err) {
      errors.push({ modelDbId: update.modelDbId, message: (err as Error).message });
    }
  }

  for (const nf of notableFacts) {
    try {
      if (!nf.text || typeof nf.text !== "string" || nf.text.trim() === "") {
        errors.push({ modelDbId: nf.modelDbId, message: "notable_facts.text is empty — skipped." });
        continue;
      }
      const modelDoc = await ModelSchema.findOne({ _id: nf.modelDbId, ...modelFilter }).lean();
      if (!modelDoc) {
        errors.push({ modelDbId: nf.modelDbId, message: "Model not found in scope — notable_facts skipped." });
        continue;
      }

      const expected = {
        notable_facts: nf.text,
        notable_facts_confidence: nf.confidence === "confirmed" ? "confirmed" : "unconfirmed",
        notable_facts_last_researched_at: new Date(),
      };

      await ModelSchema.findByIdAndUpdate(modelDoc._id, { $set: expected });

      // Re-fetch and verify, same as above — this is the exact write path
      // that silently no-op'd against a stale cached schema in production use.
      const persisted = (await ModelSchema.findById(modelDoc._id).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(expected, persisted);
      if (badFields.length > 0) {
        errors.push({
          modelDbId: nf.modelDbId,
          message: `notable_facts write did not throw, but failed verification: field(s) [${badFields.join(
            ", "
          )}] did not persist as expected on re-fetch. Not counted as applied — check for a stale cached Mongoose schema (see comment in models/Model.ts) or a concurrent write.`,
        });
        continue;
      }

      notableFactsApplied++;
    } catch (err) {
      errors.push({ modelDbId: nf.modelDbId, message: (err as Error).message });
    }
  }

  return { applied, notableFactsApplied, errors };
}
