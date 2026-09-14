// Structural fix for a recurring bug class: a Next.js dev server (or any
// long-running process) that has mongoose.models.<X> compiled from an OLDER
// version of models/<X>.ts keeps serving that stale schema across a Fast
// Refresh reload of route files — so a `$set` on a field the stale schema
// doesn't know about is silently dropped under strict mode. The call
// resolves, `updatedAt` even changes, but the field never lands. This has
// now hit three different fields for real (notable_facts/
// notable_facts_confidence, thermal_management, segment_confidence — see
// the comment on the Model export in models/Model.ts) and was each time only
// discovered AFTER a write, via findMismatchedKeys()'s post-write re-fetch
// verification (lib/applySpecUpdates.ts). That verification step is correct
// and should stay (it's the only thing that ever surfaces this at all — a
// process's own compiled schema has no way to know it's stale relative to
// its own source file), but it means the failure is only caught once a
// write has already been attempted and wasted.
//
// This module adds a PREFLIGHT check: immediately before a $set/create call,
// assert that the model's CURRENTLY LOADED schema recognizes every field
// about to be written. If the running process's schema is stale, this
// throws immediately with a loud, actionable message — no wasted write, no
// generic "did not verify" surprise discovered later, and a clear next step
// ("restart the dev server").

import type { Model as MongooseModel } from "mongoose";

export class StaleSchemaError extends Error {
  constructor(modelName: string, unknownFields: string[]) {
    super(
      `STALE MONGOOSE SCHEMA DETECTED: the "${modelName}" schema currently loaded in this process does not recognize field(s) [${unknownFields.join(
        ", "
      )}]. This means models/${modelName}.ts was edited after this process last loaded it — Next.js Fast Refresh (or any long-running dev/server process) keeps the OLD compiled schema in mongoose.models across a route-file reload, so a $set on these fields would otherwise be silently dropped instead of throwing (see the comment on the Model export in models/Model.ts). FIX: restart the dev server (or, in production, this can't happen — every deploy is a fresh process) and retry this write.`
    );
    this.name = "StaleSchemaError";
  }
}

/**
 * Throws StaleSchemaError if any of `fields` (dot-paths allowed, e.g.
 * "price_range.min") is not a path the model's CURRENTLY LOADED schema
 * recognizes. Call this immediately before a $set/create that includes
 * fields — cheap, in-memory, no DB round-trip — so a stale-schema mismatch
 * fails loudly and immediately rather than being discovered only after
 * findMismatchedKeys()'s post-write re-fetch reports it.
 */
export function assertSchemaKnowsFields(model: MongooseModel<any>, fields: string[], modelName: string): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  const unknown = fields.filter((f) => !model.schema.path(f));
  if (unknown.length > 0) throw new StaleSchemaError(modelName, unknown);
}
