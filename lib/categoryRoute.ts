import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Brand from "@/models/Brand";
import { getDefaultModel, ModelNotFoundError, SearchProviderError } from "@/lib/techSpecResearch";
import { getMissingConfigError } from "@/lib/aiProvider";
import type { CategoryResearchInput, CategoryResearchResult } from "@/lib/categoryResearch";

/**
 * Shared body of the four newer research routes (research-market-trend,
 * research-global-issues, research-bulletins, research-recalls) — same checks and
 * error mapping as research-issues/route.ts, factored once. Never writes to MongoDB;
 * the matching apply-* route is the only write path. `currentField` is the Model field
 * the review UI shows as "what's already there".
 */
export async function handleCategoryResearch<T>(
  modelId: string,
  label: string,
  research: (aiModel: string, input: CategoryResearchInput) => Promise<CategoryResearchResult<T>>,
  currentField: string
): Promise<NextResponse> {
  try {
    const missingConfig = getMissingConfigError();
    if (missingConfig) return NextResponse.json({ error: `${missingConfig} on the server.` }, { status: 500 });
    if (!process.env.SEARCH_API_KEY) return NextResponse.json({ error: "Missing SEARCH_API_KEY on the server." }, { status: 500 });

    await connectToDatabase();
    const modelDoc = await ModelSchema.findById(modelId).lean();
    if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });
    const brand = await Brand.findById(modelDoc.brand_id).lean();
    if (!brand) return NextResponse.json({ error: "Brand not found for this model" }, { status: 404 });

    const result = await research(getDefaultModel(), {
      brandName: brand.name_en ?? brand.name,
      modelName: modelDoc.name,
      brandNameCn: brand.name_cn,
      modelNameCn: modelDoc.name_cn,
    });

    return NextResponse.json({
      modelName: `${brand.name_en ?? brand.name} ${modelDoc.name}`,
      result,
      current: (modelDoc as unknown as Record<string, unknown>)[currentField] ?? null,
    });
  } catch (err) {
    if (err instanceof ModelNotFoundError) return NextResponse.json({ error: err.message }, { status: 502 });
    if (err instanceof SearchProviderError) return NextResponse.json({ error: `Search provider error: ${err.message}` }, { status: 503 });
    console.error(`${label} failed:`, err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
