import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { parseManualImport } from "@/lib/manualResearchImport";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { appendResearchLog } from "@/lib/researchLog";
import type { PowertrainLean } from "@/lib/techSpecResearch";

type ManualSource = "manual-kimi-import" | "manual-deepseek-import";

// Write path for the manual Kimi/DeepSeek round-trip. Deliberately does NOT
// trust the diff the client already saw from the validate route — re-parses
// the same raw JSON from scratch (same rule as lib/applySpecUpdates.ts never
// trusting that a write call not throwing means the fields landed), then
// writes and re-fetches to verify, exactly like applySpecUpdates.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;

  const body = await req.json().catch(() => null);
  const rawText = body?.json;
  const source = body?.source as ManualSource | undefined;
  if (typeof rawText !== "string" || rawText.trim() === "") {
    return NextResponse.json({ error: "Missing \"json\" (the pasted Kimi/DeepSeek response text) in request body." }, { status: 400 });
  }
  if (source !== "manual-kimi-import" && source !== "manual-deepseek-import") {
    return NextResponse.json({ error: 'Missing/invalid "source" — must be "manual-kimi-import" or "manual-deepseek-import".' }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const existingPowertrains = (await Powertrain.find({ model_id: modelId }).lean()) as unknown as (PowertrainLean & Record<string, unknown>)[];

  const parseResult = parseManualImport(rawText, modelDoc as unknown as Record<string, unknown>, existingPowertrains);
  if (!parseResult.valid) {
    return NextResponse.json({ error: "Validation failed — nothing was written.", errors: parseResult.errors }, { status: 422 });
  }

  const errors: string[] = [];
  let modelApplied = false;
  const powertrainOutcomes: { trimName?: string; status: string; applied: boolean; error?: string }[] = [];

  // --- model fields ---
  if (parseResult.modelDiff.length > 0) {
    const expected: Record<string, unknown> = {};
    for (const entry of parseResult.modelDiff) expected[entry.path] = entry.after;

    await ModelSchema.findByIdAndUpdate(modelId, { $set: expected });
    const persisted = (await ModelSchema.findById(modelId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      errors.push(`Model fields did not verify after write: [${badFields.join(", ")}]. Check for a stale cached Mongoose schema.`);
    } else {
      modelApplied = true;
    }
  }

  // --- powertrains ---
  for (const pt of parseResult.powertrainResults) {
    if (pt.status === "update" && pt.existingId) {
      if (pt.diff.length === 0) {
        powertrainOutcomes.push({ trimName: pt.trimName, status: "unchanged", applied: true });
        continue;
      }
      await Powertrain.findByIdAndUpdate(pt.existingId, { $set: pt.variant });
      const persisted = (await Powertrain.findById(pt.existingId).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(pt.variant, persisted);
      if (badFields.length > 0) {
        const msg = `Trim "${pt.trimName}" (${pt.existingId}) did not verify after write: [${badFields.join(", ")}].`;
        errors.push(msg);
        powertrainOutcomes.push({ trimName: pt.trimName, status: "update", applied: false, error: msg });
      } else {
        powertrainOutcomes.push({ trimName: pt.trimName, status: "update", applied: true });
      }
    } else {
      const created = await Powertrain.create({ ...pt.variant, model_id: modelId });
      const persisted = (await Powertrain.findById(created._id).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(pt.variant, persisted);
      if (badFields.length > 0) {
        const msg = `New trim "${pt.variant.trim_name}" did not verify after insert: [${badFields.join(", ")}].`;
        errors.push(msg);
        powertrainOutcomes.push({ trimName: pt.variant.trim_name as string | undefined, status: "new", applied: false, error: msg });
      } else {
        powertrainOutcomes.push({ trimName: pt.variant.trim_name as string | undefined, status: "new", applied: true });
      }
    }
  }

  const result = { modelApplied, powertrainOutcomes, errors };

  appendResearchLog({
    kind: "manual-apply",
    modelDbId: modelId,
    source,
    modelDiff: parseResult.modelDiff,
    powertrainResults: parseResult.powertrainResults,
    result,
  });

  return NextResponse.json(result);
}
