import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Brand from "@/models/Brand";
import { getModelPowertrain } from "@/lib/modelPowertrain";
import { targetForModelDoc, verifyImportedItems } from "@/lib/researchCategoriesImport";
import { parseCategoryImport } from "@/lib/researchCategoriesImport";
import type { ExistingCategoryData } from "@/lib/researchCategoriesImport";

// Preview-only: parses + validates + diffs a pasted research-categories-v1 response
// against the current DB state. NEVER writes — ../apply re-runs this exact parse rather
// than trusting whatever the client saw here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.json !== "string" || body.json.trim() === "") {
    return NextResponse.json({ error: 'Missing "json" (the pasted response text) in request body.' }, { status: 400 });
  }
  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const parse = parseCategoryImport(body.json, modelId, modelDoc as unknown as ExistingCategoryData);
  return NextResponse.json(await verifyImportedItems(parse, await targetFor(modelDoc)));
}

const targetFor = (modelDoc: { _id: unknown; name: string; name_cn?: string; brand_id: unknown }) =>
  targetForModelDoc(modelDoc, { brandName: (id) => Brand.findById(id).lean() as never, powertrain: getModelPowertrain });
