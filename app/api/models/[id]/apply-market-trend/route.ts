import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import { applyModelFields } from "@/lib/applyModelFields";
import { normalizeMarketTrend } from "@/lib/categoryValidators";

// The only write path for market_trend — replaces the whole nested object (it's a
// single current-state assessment, not an accumulating list), stamped with
// _last_researched_at only after the re-fetch verification in applyModelFields passes.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);

  // The review UI sends the item as researched: { ..., confidence }. Accept that or `_confidence`.
  const raw = (body?.market_trend ?? null) as Record<string, unknown> | null;
  const res = normalizeMarketTrend(raw && typeof raw === "object" ? { ...raw, confidence: raw.confidence ?? raw._confidence, _confidence: undefined } : raw, { checkChineseSource: true });
  if (!res.item) {
    return NextResponse.json({ applied: false, error: `Invalid market_trend: ${res.errors.join("; ")}` }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ applied: false, error: "Model not found" }, { status: 404 });

  const result = await applyModelFields(modelId, { market_trend: { ...res.item, _last_researched_at: new Date() } });
  return NextResponse.json(result);
}
