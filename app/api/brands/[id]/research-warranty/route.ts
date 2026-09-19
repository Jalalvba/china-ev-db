import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { getDefaultModel, ModelNotFoundError, SearchProviderError } from "@/lib/techSpecResearch";
import { researchWarranty } from "@/lib/warrantyResearch";
import { getMissingConfigError } from "@/lib/aiProvider";

// Chinese-source-only warranty-terms research (lib/warrantyResearch.ts) —
// same posture as research-brand/route.ts: never writes to MongoDB, returns
// a result (plus the brand's current warranty_terms, for the review
// screen's diff) for the UI. See ../apply-warranty/route.ts for the write
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
    const { id: brandId } = await params;

    const brand = await Brand.findById(brandId).lean();
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    const model = getDefaultModel();

    const result = await researchWarranty(model, {
      brandName: brand.name_en ?? brand.name,
      brandNameCn: brand.name_cn,
    });

    return NextResponse.json({
      brandName: brand.name_en ?? brand.name,
      result,
      currentWarrantyTerms: brand.warranty_terms ?? null,
    });
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof SearchProviderError) {
      return NextResponse.json({ error: `Search provider error: ${err.message}` }, { status: 503 });
    }
    console.error("research-warranty failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
