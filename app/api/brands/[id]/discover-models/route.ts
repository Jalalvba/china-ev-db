import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { GoogleGenAI } from "@google/genai";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { DEFAULT_MODEL, ModelNotFoundError } from "@/lib/techSpecResearch";
import { discoverModels } from "@/lib/modelDiscovery";
import { lookupMoteurMa, renderMoteurMaContext } from "@/lib/moteurMaScraper";

// Discovers candidate models for a brand that has zero (or few) Model
// documents — a distinct first step from /api/models/[id]/update-specs,
// which researches POWERTRAIN specs for an EXISTING Model and has nowhere to
// attach results without one. NEVER writes to MongoDB — returns results for
// the UI's review screen; see ../create-models/route.ts for the write path.
// Optional per-request override for brand-identity context, keyed the same
// as ResearchedBrand's top-level fields (see lib/brandResearch.ts). Lets a
// caller that just ran Tier-1 research pass its freshly-found facts straight
// through to this Tier-2 call, without first writing them to Mongo — used by
// the combined "Research brand" button (app/BrandAndModelDiscovery.tsx) so
// Tier 2 benefits from Tier 1's findings in the same pass, before the user
// has reviewed/applied anything.
interface BrandContextOverride {
  name_cn?: string;
  parent_group?: string;
  relationship_type?: string;
  stake_percentage?: number;
  tech_partner?: string;
  status?: string;
  country_origin?: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY on the server." }, { status: 500 });
    }

    await connectToDatabase();
    const { id: brandId } = await params;
    const body = await req.json().catch(() => null);
    const override = (body?.brandContext ?? {}) as BrandContextOverride;

    const brand = await Brand.findById(brandId).lean();
    if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

    const existingModels = await ModelSchema.find({ brand_id: brandId }, { name: 1 }).lean();
    const existingModelNames = existingModels.map((m) => m.name);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const model = DEFAULT_MODEL;

    // Override wins over what's on file — it reflects research just done in
    // this same request sequence, more current than the stored brand doc.
    const parentGroup = override.parent_group ?? brand.parent_group;

    // Real code-level pre-fetch — an actual HTTP fetch + JSON-LD parse of
    // moteur.ma's own pages, not a prompt asking Gemini to go check itself.
    const moteurLookup = await lookupMoteurMa(brand.name_en ?? brand.name);
    const moteurMaContext = renderMoteurMaContext(moteurLookup);

    const result = await discoverModels(ai, model, {
      brandName: brand.name_en ?? brand.name,
      brandNameCn: override.name_cn ?? brand.name_cn,
      parentGroup,
      existingModelNames: existingModelNames.length ? existingModelNames : undefined,
      brandContext: {
        parentGroup,
        relationshipType: override.relationship_type ?? brand.relationship_type,
        stakePercentage: override.stake_percentage ?? brand.stake_percentage,
        techPartner: override.tech_partner ?? brand.tech_partner,
        status: override.status ?? brand.status,
      },
      moteurMaContext,
    });

    return NextResponse.json({ brandName: brand.name_en ?? brand.name, result });
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    // Defensive top-level catch: any unexpected error (DB hiccup, etc.)
    // still comes back as JSON the client's `res.json()` can parse, rather
    // than Next's default HTML error page — which throws its own confusing
    // "Unexpected token '<'" client-side error that looks like a network
    // failure rather than what actually went wrong server-side.
    console.error("discover-models failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
