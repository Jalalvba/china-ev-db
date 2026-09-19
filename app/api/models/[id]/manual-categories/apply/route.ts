import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Brand from "@/models/Brand";
import { getModelPowertrain } from "@/lib/modelPowertrain";
import { targetForModelDoc, verifyImportedItems } from "@/lib/researchCategoriesImport";
import { applyCategoryImport } from "@/lib/researchCategoriesImport";
import type { ExistingCategoryData } from "@/lib/researchCategoriesImport";

// The write path for the research-categories-v1 manual import. Re-parses the pasted
// text against the CURRENT DB state (not the client's preview), then applies each
// changed category with re-fetch verification (lib/applyModelFields.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.json !== "string" || body.json.trim() === "") {
    return NextResponse.json({ error: 'Missing "json" (the pasted response text) in request body.' }, { status: 400 });
  }
  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const target = await targetFor(modelDoc);
  const { parse, outcomes } = await applyCategoryImport(modelId, body.json, modelDoc as unknown as ExistingCategoryData, (p) => verifyImportedItems(p, target));
  if (!parse.valid) return NextResponse.json({ error: parse.errors.join(" ") }, { status: 400 });
  return NextResponse.json({ outcomes, parse });
}

const targetFor = (modelDoc: { _id: unknown; name: string; name_cn?: string; brand_id: unknown }) =>
  targetForModelDoc(modelDoc, { brandName: (id) => Brand.findById(id).lean() as never, powertrain: getModelPowertrain });
