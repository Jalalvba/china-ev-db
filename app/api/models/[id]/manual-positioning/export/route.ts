import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { buildPositioningManualExportPrompt } from "@/lib/positioningResearch";

// Read-only: builds the copy-paste prompt (+ positioning-manual-v1 envelope template).
// Never writes to MongoDB.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  const brand = await Brand.findById(modelDoc.brand_id).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found for this model" }, { status: 404 });

  const text = buildPositioningManualExportPrompt({
    brandName: brand.name_en ?? brand.name,
    brandNameCn: brand.name_cn,
    modelName: modelDoc.name,
    modelNameCn: modelDoc.name_cn,
    modelId,
  });
  return NextResponse.json({ text });
}
