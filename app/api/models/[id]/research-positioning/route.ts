import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Brand from "@/models/Brand";
import { getDefaultModel, ModelNotFoundError, SearchProviderError } from "@/lib/techSpecResearch";
import { researchPositioning } from "@/lib/positioningResearch";
import { getMissingConfigError } from "@/lib/aiProvider";

// Chinese-source-only market-positioning research (lib/positioningResearch.ts)
// — never writes to MongoDB. See ../apply-positioning/route.ts for the write
// path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const missingConfig = getMissingConfigError();
    if (missingConfig) {
      return NextResponse.json({ error: `${missingConfig} on the server.` }, { status: 500 });
    }
    if (!process.env.SEARCH_API_KEY) {
      return NextResponse.json({ error: "Missing SEARCH_API_KEY on the server." }, { status: 500 });
    }

    await connectToDatabase();
    const { id: modelId } = await params;

    const modelDoc = await ModelSchema.findById(modelId).lean();
    if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });
    const brand = await Brand.findById(modelDoc.brand_id).lean();
    if (!brand) return NextResponse.json({ error: "Brand not found for this model" }, { status: 404 });

    const aiModel = getDefaultModel();

    const result = await researchPositioning(aiModel, {
      brandName: brand.name_en ?? brand.name,
      modelName: modelDoc.name,
      brandNameCn: brand.name_cn,
      modelNameCn: modelDoc.name_cn,
    });

    return NextResponse.json({
      modelName: `${brand.name_en ?? brand.name} ${modelDoc.name}`,
      result,
      currentMarketPositioning: modelDoc.market_positioning
        ? { text: modelDoc.market_positioning, source: modelDoc.market_positioning_source, confidence: modelDoc.market_positioning_confidence }
        : null,
    });
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof SearchProviderError) {
      return NextResponse.json({ error: `Search provider error: ${err.message}` }, { status: 503 });
    }
    console.error("research-positioning failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
