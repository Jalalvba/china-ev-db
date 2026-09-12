import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";

// The only write path for discovered models: only ever called after the user
// has reviewed results from ../discover-models/route.ts, confirmed/edited
// segment & body_type (required by the Model schema but frequently returned
// null by research, since Gemini isn't always confident enough to classify
// them), and clicked "Create models". Same verification posture as
// lib/applySpecUpdates.ts: every create is re-fetched and checked before
// being counted as applied, not trusted just because the call didn't throw.

interface CreateModelInput {
  name: string;
  name_cn?: string;
  name_en?: string;
  generation?: string;
  segment: string;
  body_type: string;
  production_status?: string;
  price_range?: { min?: number; max?: number; currency_local?: string };
  confidence?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  const inputModels = (body?.models ?? []) as CreateModelInput[];

  if (!Array.isArray(inputModels) || inputModels.length === 0) {
    return NextResponse.json({ error: "No models provided" }, { status: 400 });
  }

  let created = 0;
  const errors: { name: string; message: string }[] = [];

  for (const m of inputModels) {
    try {
      if (!m.name || typeof m.name !== "string" || m.name.trim() === "") {
        errors.push({ name: String(m.name ?? "(missing)"), message: "Missing model name — skipped." });
        continue;
      }
      if (!m.segment || typeof m.segment !== "string") {
        errors.push({ name: m.name, message: "Missing segment — required by the schema, skipped." });
        continue;
      }
      if (!m.body_type || typeof m.body_type !== "string") {
        errors.push({ name: m.name, message: "Missing body_type — required by the schema, skipped." });
        continue;
      }

      const existing = await ModelSchema.findOne({ brand_id: brandId, name: m.name }).lean();
      if (existing) {
        errors.push({ name: m.name, message: "A model with this name already exists under this brand — skipped, not duplicated." });
        continue;
      }

      const expected: Record<string, unknown> = {
        brand_id: brandId,
        name: m.name,
        name_cn: m.name_cn,
        name_en: m.name_en,
        generation: m.generation,
        segment: m.segment,
        body_type: m.body_type,
        production_status: m.production_status ?? "in production",
        unverified: m.confidence !== "confirmed",
      };
      if (m.price_range && (m.price_range.min || m.price_range.max)) {
        expected.price_range = {
          min: m.price_range.min,
          max: m.price_range.max,
          currency_local: m.price_range.currency_local ?? "CNY",
        };
      }

      const created_doc = await ModelSchema.create(expected);

      // Re-fetch and verify — same posture as lib/applySpecUpdates.ts: a
      // create() call not throwing does not guarantee every field landed
      // (e.g. a stale cached schema silently drops an unknown field under
      // strict mode — see the comment in models/Model.ts).
      const persisted = (await ModelSchema.findById(created_doc._id).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(expected, persisted);
      if (badFields.length > 0) {
        errors.push({
          name: m.name,
          message: `Create did not throw, but failed verification: field(s) [${badFields.join(
            ", "
          )}] did not persist as expected on re-fetch. Not counted as created — check for a stale cached Mongoose schema (see comment in models/Model.ts).`,
        });
        continue;
      }

      created++;
    } catch (err) {
      errors.push({ name: m.name ?? "(unknown)", message: (err as Error).message });
    }
  }

  return NextResponse.json({ created, errors });
}
