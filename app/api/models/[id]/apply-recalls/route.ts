import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import { applyModelFields } from "@/lib/applyModelFields";
import { normalizeRecall, recallKey, mergeByKey, normalizeArray } from "@/lib/categoryValidators";
import type { IRecall } from "@/types/researchCategories";

// The only write path for recalls — appends the user-selected, reviewed items to the
// model's existing array, deduped by recall_id (else description), then re-fetch-verifies (applyModelFields).
// Items are re-validated here with the same normalizer the research step used; the
// client's copy is never trusted.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.recalls) ? (body.recalls as unknown[]) : [];

  const { items: validItems } = normalizeArray(incoming, (raw) => normalizeRecall(raw));
  if (validItems.length === 0) {
    return NextResponse.json({ applied: false, error: "No valid recalls items to apply" }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ applied: false, error: "Model not found" }, { status: 404 });

  const existing = ((modelDoc as unknown as Record<string, unknown>).recalls ?? []) as unknown as IRecall[];
  const { merged, added } = mergeByKey(existing, validItems, recallKey);

  const result = await applyModelFields(modelId, { recalls: merged, recalls_last_researched_at: new Date() });
  if (!result.applied) return NextResponse.json(result);
  return NextResponse.json({ applied: true, added });
}
