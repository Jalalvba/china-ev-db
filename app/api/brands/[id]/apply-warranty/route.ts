import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";

// The only write path for warranty_terms: only ever called after the user
// has reviewed results from ../research-warranty/route.ts and clicked
// "Apply". Same verification posture as lib/applySpecUpdates.ts: re-fetched
// and checked before being counted as applied.

const ALLOWED_FIELDS = new Set(["ice_component_years", "ice_component_km", "battery_years", "battery_km", "motor_years", "motor_km", "source", "confidence"]);

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  const fields = (body?.warranty_terms ?? {}) as Record<string, unknown>;

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stripUndefined(fields))) {
    if (ALLOWED_FIELDS.has(k)) cleaned[k] = v;
  }

  if (Object.keys(cleaned).length === 0) {
    return NextResponse.json({ applied: false, error: "No fields to apply" }, { status: 400 });
  }

  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ applied: false, error: "Brand not found" }, { status: 404 });

  const expected = { warranty_terms: cleaned, warranty_terms_last_researched_at: new Date() };

  try {
    assertSchemaKnowsFields(Brand, Object.keys(expected), "Brand");
    await Brand.findByIdAndUpdate(brandId, { $set: expected });

    const persisted = (await Brand.findById(brandId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      return NextResponse.json({
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(
          ", "
        )}] did not persist as expected on re-fetch. Not applied — check for a stale cached Mongoose schema (see comment in models/Brand.ts).`,
      });
    }

    return NextResponse.json({ applied: true });
  } catch (err) {
    return NextResponse.json({ applied: false, error: (err as Error).message });
  }
}
