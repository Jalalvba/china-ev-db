import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { parsePhevSuvWorkshopManualImport } from "@/lib/phevSuvWorkshopResearch";

// Preview-only: parses + validates a pasted workshop-manual-v2 response. Never writes — the
// client applies the returned workshop_profile via apply-workshop-profile.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.json !== "string" || body.json.trim() === "") {
    return NextResponse.json({ error: 'Missing "json" (the pasted response text) in request body.' }, { status: 400 });
  }
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  return NextResponse.json(parsePhevSuvWorkshopManualImport(body.json, brandId));
}
