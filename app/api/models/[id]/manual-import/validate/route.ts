import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { parseManualImport } from "@/lib/manualResearchImport";
import type { PowertrainLean } from "@/lib/techSpecResearch";

// Preview-only: parses + validates + diffs a pasted-back Kimi/DeepSeek
// response against the current DB state. NEVER writes to MongoDB — see
// app/api/models/[id]/manual-import/apply/route.ts for the write path, which
// re-runs this exact same parse rather than trusting whatever diff the
// client saw here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;

  const body = await req.json().catch(() => null);
  const rawText = body?.json;
  if (typeof rawText !== "string" || rawText.trim() === "") {
    return NextResponse.json({ error: "Missing \"json\" (the pasted Kimi/DeepSeek response text) in request body." }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const existingPowertrains = (await Powertrain.find({ model_id: modelId }).lean()) as unknown as (PowertrainLean & Record<string, unknown>)[];

  const result = parseManualImport(rawText, modelDoc as unknown as Record<string, unknown>, existingPowertrains);

  return NextResponse.json(result);
}
