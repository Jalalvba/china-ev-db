import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import "@/models/Brand";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { buildCombinedExportText, buildExportDocument } from "@/lib/manualResearchImport";
import type { PowertrainLean } from "@/lib/techSpecResearch";
import type { IBrand } from "@/types";

// Server-side counterpart to scripts/export-model-for-manual-research.ts,
// for the model page's "Export for Kimi/DeepSeek" button — same
// buildExportDocument/buildCombinedExportText functions, so the CLI and the
// button can never drift into producing different shapes. Read-only: never
// writes to MongoDB.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;

  const modelDoc = await ModelSchema.findById(modelId).populate("brand_id", "name name_cn name_en").lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const brand = modelDoc.brand_id as unknown as (IBrand & { _id: unknown }) | null;
  const powertrainDocs = (await Powertrain.find({ model_id: modelId }).lean()) as unknown as (PowertrainLean & Record<string, unknown>)[];

  const exportDoc = buildExportDocument(modelDoc as unknown as Record<string, unknown> & { _id: unknown }, brand, powertrainDocs);
  const text = buildCombinedExportText(exportDoc);

  return NextResponse.json({ text });
}
