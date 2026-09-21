import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { buildModelDiscoveryManualExportPrompt } from "@/lib/modelDiscovery";
import { lookupMoteurMa, renderMoteurMaContext } from "@/lib/moteurMaScraper";

// Read-only: builds the copy-paste prompt (+ model-discovery-manual-v1 envelope template).
// Never calls the AI provider — same real, deterministic moteur.ma pre-fetch the old automated
// route used, folded into the prompt as context rather than left for the external chat to redo.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const existingModels = await ModelSchema.find({ brand_id: brandId }, { name: 1 }).lean();
  const existingModelNames = existingModels.map((m) => m.name);

  const moteurLookup = await lookupMoteurMa(brand.name_en ?? brand.name);
  const moteurMaContext = renderMoteurMaContext(moteurLookup);

  const text = buildModelDiscoveryManualExportPrompt({
    brandId,
    brandName: brand.name_en ?? brand.name,
    brandNameCn: brand.name_cn,
    parentGroup: brand.parent_group,
    existingModelNames: existingModelNames.length ? existingModelNames : undefined,
    brandContext: {
      parentGroup: brand.parent_group,
      relationshipType: brand.relationship_type,
      stakePercentage: brand.stake_percentage,
      techPartner: brand.tech_partner,
      status: brand.status,
    },
    moteurMaContext,
  });
  return NextResponse.json({ text });
}
