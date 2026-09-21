import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import BrandPhevSuvWorkshopProfile from "@/models/BrandPhevSuvWorkshopProfile";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";
import { normalizePhevSuvWorkshopProfile, validatePhevSuvWorkshopProfile } from "@/lib/phevSuvWorkshopResearch";

// The only write path for BrandPhevSuvWorkshopProfile from the UI. Import-only: the payload is a
// workshop-manual-v2 profile the user already pasted, validated and reviewed — nothing here calls an
// AI/search provider. Re-validates and re-normalizes server-side (never trusts the client's copy),
// upserts by brand_id with REPLACE semantics (a field absent from the paste is unset, so the stored
// profile equals what was reviewed), then re-fetches and field-verifies per CLAUDE.md's Write safety.

const PROFILE_FIELDS = ["diagnostic_interface", "lift_spec", "ppe_required", "technician_prerequisites", "audit_checklist"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  const raw = body?.workshop_profile;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ applied: false, error: "Missing workshop_profile object" }, { status: 400 });
  }

  const { valid, errors } = validatePhevSuvWorkshopProfile(raw);
  if (!valid) return NextResponse.json({ applied: false, error: `Invalid profile: ${errors.join("; ")}` }, { status: 400 });

  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ applied: false, error: "Brand not found" }, { status: 404 });

  const { profile } = normalizePhevSuvWorkshopProfile(raw as Record<string, unknown>);

  const set: Record<string, unknown> = {
    ppe_required: profile.ppe_required,
    technician_prerequisites: profile.technician_prerequisites,
    audit_checklist: profile.audit_checklist,
    _source: "brand_specific",
    _confidence: profile.confidence,
    _last_researched_at: new Date(),
  };
  const unset: Record<string, 1> = {};
  for (const f of ["diagnostic_interface", "lift_spec"] as const) {
    if (profile[f]) set[f] = profile[f];
    else unset[f] = 1;
  }

  try {
    assertSchemaKnowsFields(BrandPhevSuvWorkshopProfile, [...Object.keys(set), ...Object.keys(unset)], "BrandPhevSuvWorkshopProfile");
    await BrandPhevSuvWorkshopProfile.findOneAndUpdate(
      { brand_id: brandId },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}), $setOnInsert: { brand_id: brandId } },
      { upsert: true }
    );

    const persisted = (await BrandPhevSuvWorkshopProfile.findOne({ brand_id: brandId }).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(set, persisted);
    for (const f of PROFILE_FIELDS) if (unset[f] && persisted?.[f] !== undefined) badFields.push(f);
    if (badFields.length > 0) {
      return NextResponse.json({
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(
          ", "
        )}] did not persist as expected on re-fetch. Not applied — check for a stale cached Mongoose schema (see comment in models/BrandPhevSuvWorkshopProfile.ts).`,
      });
    }
    return NextResponse.json({ applied: true });
  } catch (err) {
    return NextResponse.json({ applied: false, error: (err as Error).message });
  }
}
