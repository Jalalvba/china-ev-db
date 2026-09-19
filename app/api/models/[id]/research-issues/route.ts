import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Brand from "@/models/Brand";
import { getDefaultModel, ModelNotFoundError, SearchProviderError } from "@/lib/techSpecResearch";
import { researchIssues } from "@/lib/issueResearch";
import { getMissingConfigError } from "@/lib/aiProvider";

// Chinese-source-only known-issues research (lib/issueResearch.ts),
// prioritizing 车质网/汽车投诉网 — never writes to MongoDB. See
// ../apply-issues/route.ts for the write path.
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

    const result = await researchIssues(aiModel, {
      brandName: brand.name_en ?? brand.name,
      modelName: modelDoc.name,
      brandNameCn: brand.name_cn,
      modelNameCn: modelDoc.name_cn,
      generation: modelDoc.generation,
      modelYear: modelDoc.year,
    });

    return NextResponse.json({
      modelName: `${brand.name_en ?? brand.name} ${modelDoc.name}`,
      result,
      currentKnownIssues: modelDoc.known_issues ?? [],
    });
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof SearchProviderError) {
      return NextResponse.json({ error: `Search provider error: ${err.message}` }, { status: 503 });
    }
    console.error("research-issues failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
