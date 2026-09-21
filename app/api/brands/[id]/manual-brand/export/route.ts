import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { buildBrandManualExportPrompt } from "@/lib/brandResearch";

// Read-only: builds the copy-paste prompt (+ brand-manual-v1 envelope template). Never writes.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const text = buildBrandManualExportPrompt({
    brandName: brand.name_en ?? brand.name,
    brandNameCn: brand.name_cn,
    currentParentGroup: brand.parent_group,
    currentCountryOrigin: brand.country_origin,
    brandId,
  });
  return NextResponse.json({ text });
}
