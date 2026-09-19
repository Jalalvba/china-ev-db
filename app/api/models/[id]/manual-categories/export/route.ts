import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { buildCategoryExportText } from "@/lib/researchCategoriesImport";
import { RESEARCH_CATEGORY_KEYS } from "@/types/researchCategories";
import type { ResearchCategoryKey } from "@/types/researchCategories";

// Read-only: builds the copy-paste prompt (+ research-categories-v1 envelope template)
// for the chosen categories. Never writes to MongoDB.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  const categories = (Array.isArray(body?.categories) ? body.categories : []).filter((c: unknown): c is ResearchCategoryKey =>
    RESEARCH_CATEGORY_KEYS.includes(c as ResearchCategoryKey)
  );
  if (categories.length === 0) return NextResponse.json({ error: `Pick at least one category (${RESEARCH_CATEGORY_KEYS.join(", ")}).` }, { status: 400 });

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  const brand = await Brand.findById(modelDoc.brand_id).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found for this model" }, { status: 404 });

  const text = buildCategoryExportText(
    {
      brandName: brand.name_en ?? brand.name,
      brandNameCn: brand.name_cn,
      modelName: modelDoc.name,
      modelNameCn: modelDoc.name_cn,
      segment: modelDoc.segment,
      productionStatus: modelDoc.production_status,
      modelId,
    },
    categories
  );
  return NextResponse.json({ text });
}
