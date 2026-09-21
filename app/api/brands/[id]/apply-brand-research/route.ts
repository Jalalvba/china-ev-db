import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";

// The only write path for Tier-1 brand-identity research: only ever called
// after the user has reviewed results from the manual export/import panel
// (../manual-brand, app/BrandResearch.tsx) and clicked "Apply". Same
// verification posture as lib/applySpecUpdates.ts: re-fetched and checked
// before being counted as applied, not trusted just because the call didn't throw.

const ALLOWED_FIELDS = new Set([
  "name_cn",
  "parent_group",
  "relationship_type",
  "stake_percentage",
  "tech_partner",
  "country_origin",
  "founded_year",
  "status",
  "status_note",
]);

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
  const fields = (body?.fields ?? {}) as Record<string, unknown>;

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stripUndefined(fields))) {
    if (ALLOWED_FIELDS.has(k)) cleaned[k] = v;
  }

  if (Object.keys(cleaned).length === 0) {
    return NextResponse.json({ error: "No fields to apply" }, { status: 400 });
  }

  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const expected = { ...cleaned, last_researched_at: new Date() };

  try {
    await Brand.findByIdAndUpdate(brandId, { $set: expected });

    // Re-fetch and verify — do not trust that the write call not throwing
    // means the fields actually persisted (see lib/applySpecUpdates.ts's
    // file header for why this matters).
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
