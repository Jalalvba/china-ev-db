import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { GoogleGenAI } from "@google/genai";
import "@/models/Brand";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { DEFAULT_MODEL, ModelNotFoundError, researchModel, describeTrimGaps, type PowertrainLean } from "@/lib/techSpecResearch";
import { lookupMoteurMa, renderMoteurMaContext } from "@/lib/moteurMaScraper";
import { appendResearchLog } from "@/lib/researchLog";
import type { IBrand } from "@/types";

// Runs the same per-model research pipeline as scripts/tech-spec-agent.ts
// and the brand-level route (shared via lib/techSpecResearch.ts), scoped to
// exactly one model — no needsResearch filtering, since the user explicitly
// asked to research this specific model regardless of its current state.
// NEVER writes to MongoDB — returns a result for the UI's review screen; see
// app/api/models/[id]/apply-specs/route.ts for the write path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: "Missing GEMINI_API_KEY on the server." }, { status: 500 });
  }

  await connectToDatabase();
  const { id: modelId } = await params;

  const modelDoc = await ModelSchema.findById(modelId)
    .populate("brand_id", "name name_cn name_en parent_group relationship_type stake_percentage tech_partner status")
    .lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const brand = modelDoc.brand_id as unknown as IBrand | null;

  const existingPowertrains = (await Powertrain.find({ model_id: modelId }).lean()) as unknown as PowertrainLean[];
  const existingTrimNames = existingPowertrains.map((pt) => pt.trim_name).filter((t): t is string => Boolean(t));

  const variantsByTrim: Record<string, unknown> = {};
  for (const pt of existingPowertrains) {
    if (pt.trim_name) variantsByTrim[pt.trim_name] = pt;
  }

  const knownGaps = existingPowertrains
    .filter((pt): pt is PowertrainLean & { trim_name: string } => Boolean(pt.trim_name))
    .map((pt) => ({ trimName: pt.trim_name, fields: describeTrimGaps(pt) }))
    .filter((g) => g.fields.length > 0);

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const model = DEFAULT_MODEL;

  try {
    const brandName = brand?.name_en ?? brand?.name ?? "Unknown";
    const modelName = modelDoc.name_en ?? modelDoc.name;

    // Real code-level pre-fetch — an actual HTTP fetch + JSON-LD parse of
    // moteur.ma's own pages, narrowed to this specific model, not a prompt
    // asking Gemini to go check itself.
    const moteurLookup = await lookupMoteurMa(brandName, modelName);
    const moteurMaContext = renderMoteurMaContext(moteurLookup);

    const result = await researchModel(ai, model, {
      modelDbId: String(modelDoc._id),
      brandName,
      brandNameCn: brand?.name_cn,
      modelName,
      modelNameCn: modelDoc.name_cn,
      generation: modelDoc.generation,
      segment: modelDoc.segment,
      bodyType: modelDoc.body_type,
      existingTrimNames: existingTrimNames.length ? existingTrimNames : undefined,
      brandContext: brand
        ? {
            parentGroup: brand.parent_group,
            relationshipType: brand.relationship_type,
            stakePercentage: brand.stake_percentage,
            techPartner: brand.tech_partner,
            status: brand.status,
          }
        : undefined,
      moteurMaContext,
      knownGaps: knownGaps.length ? knownGaps : undefined,
    });

    // Durable record of exactly what the review screen was shown — the only
    // artifact of this run, since this route never writes to MongoDB itself.
    appendResearchLog({ kind: "research", modelDbId: String(modelDoc._id), modelName, result });

    return NextResponse.json({
      results: [result],
      previousDataByModel: {
        [String(modelDoc._id)]: {
          variantsByTrim,
          notableFacts: modelDoc.notable_facts
            ? { text: modelDoc.notable_facts, confidence: modelDoc.notable_facts_confidence }
            : undefined,
        },
      },
    });
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    // Defensive top-level catch: same reasoning as the brand-level routes —
    // always return JSON so the client's res.json() never chokes on Next's
    // default HTML error page for an unexpected failure.
    console.error("update-specs failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
