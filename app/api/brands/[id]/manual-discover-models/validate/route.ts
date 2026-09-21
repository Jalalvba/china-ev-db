import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { parseModelDiscoveryManualImport } from "@/lib/modelDiscovery";

// Preview-only: parses + validates a pasted model-discovery-manual-v1 response, flagging each
// item's validity AND whether it looks like a duplicate of a model already on file for this
// brand. Never writes — the client applies selected rows via the existing create-models route,
// which re-checks the exact name and re-verifies on write.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.json !== "string" || body.json.trim() === "") {
    return NextResponse.json({ error: 'Missing "json" (the pasted response text) in request body.' }, { status: 400 });
  }
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const existingModels = (await ModelSchema.find({ brand_id: brandId }, { name: 1, name_cn: 1, name_en: 1 }).lean()).map((m) => ({
    _id: String(m._id),
    name: m.name,
    name_cn: m.name_cn,
    name_en: m.name_en,
  }));

  return NextResponse.json(parseModelDiscoveryManualImport(body.json, brandId, existingModels));
}
