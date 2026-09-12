import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { GoogleGenAI } from "@google/genai";
import Brand from "@/models/Brand";
import { DEFAULT_MODEL, ModelNotFoundError } from "@/lib/techSpecResearch";
import { researchBrand } from "@/lib/brandResearch";
import { lookupMoteurMa, renderMoteurMaContext } from "@/lib/moteurMaScraper";

// Tier 1: brand-identity research only (parent_group, relationship_type,
// stake_percentage, tech_partner, status, status_note, founded_year, name_cn,
// country_origin) — explicitly NOT models or specs, see lib/brandResearch.ts.
// NEVER writes to MongoDB — returns a result (plus the brand's current
// values, for the review screen's diff) for the UI; see
// ../apply-brand-research/route.ts for the write path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY on the server." }, { status: 500 });
    }

    await connectToDatabase();
    const { id: brandId } = await params;

    const brand = await Brand.findById(brandId).lean();
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const model = DEFAULT_MODEL;

    // Real code-level pre-fetch — an actual HTTP fetch + JSON-LD parse of
    // moteur.ma's own pages, not a prompt asking Gemini to go check itself.
    const moteurLookup = await lookupMoteurMa(brand.name_en ?? brand.name);
    const moteurMaContext = renderMoteurMaContext(moteurLookup);

    const result = await researchBrand(ai, model, {
      brandName: brand.name_en ?? brand.name,
      brandNameCn: brand.name_cn,
      currentParentGroup: brand.parent_group,
      currentCountryOrigin: brand.country_origin,
      moteurMaContext,
    });

    return NextResponse.json({
      brandName: brand.name_en ?? brand.name,
      result,
      currentBrand: {
        name_cn: brand.name_cn,
        parent_group: brand.parent_group,
        relationship_type: brand.relationship_type,
        stake_percentage: brand.stake_percentage,
        tech_partner: brand.tech_partner,
        country_origin: brand.country_origin,
        founded_year: brand.founded_year,
        status: brand.status,
        status_note: brand.status_note,
      },
    });
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    // Defensive top-level catch: same reasoning as discover-models/route.ts —
    // always return JSON so the client's res.json() never chokes on Next's
    // default HTML error page for an unexpected failure.
    console.error("research-brand failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
