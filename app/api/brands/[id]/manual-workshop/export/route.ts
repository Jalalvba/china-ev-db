import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { buildPhevSuvWorkshopManualExportPrompt } from "@/lib/phevSuvWorkshopResearch";

// Read-only: builds the copy-paste prompt (+ workshop-manual-v2 envelope). Never writes, never calls an AI/search provider.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const text = buildPhevSuvWorkshopManualExportPrompt({ brandName: brand.name_en ?? brand.name, brandNameCn: brand.name_cn, brandId });
  return NextResponse.json({ text });
}
