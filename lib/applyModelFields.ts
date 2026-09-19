import ModelSchema from "@/models/Model";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";

export type ApplyFieldsResult = { applied: true } | { applied: false; error: string };

/**
 * The one write-and-verify path for the newer Model-level research categories'
 * apply routes and the manual importer — same posture as every other apply route in
 * this codebase (see CLAUDE.md "Write safety"): preflight the loaded schema knows
 * every field, $set, then re-fetch and field-verify, because a Mongoose call not
 * throwing does NOT mean the fields persisted (stale cached schema silently drops
 * unknown fields under strict mode).
 */
export async function applyModelFields(modelId: string, expected: Record<string, unknown>): Promise<ApplyFieldsResult> {
  try {
    assertSchemaKnowsFields(ModelSchema, Object.keys(expected), "Model");
    await ModelSchema.findByIdAndUpdate(modelId, { $set: expected });

    const persisted = (await ModelSchema.findById(modelId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      return {
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(
          ", "
        )}] did not persist as expected on re-fetch. Not applied — check for a stale cached Mongoose schema (see comment in models/Model.ts).`,
      };
    }
    return { applied: true };
  } catch (err) {
    return { applied: false, error: (err as Error).message };
  }
}
