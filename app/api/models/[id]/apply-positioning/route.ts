import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";

// The only write path for market_positioning — same review-gated,
// re-fetch-verified pattern as every other apply route in this codebase.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  const positioning = (body?.market_positioning ?? {}) as { text?: string; source?: string; confidence?: string };

  if (!positioning.text || typeof positioning.text !== "string" || positioning.text.trim() === "") {
    return NextResponse.json({ applied: false, error: "market_positioning.text is empty" }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ applied: false, error: "Model not found" }, { status: 404 });

  const expected = {
    market_positioning: positioning.text,
    ...(positioning.source ? { market_positioning_source: positioning.source } : {}),
    market_positioning_confidence: positioning.confidence === "confirmed" ? "confirmed" : "unconfirmed",
    market_positioning_last_researched_at: new Date(),
  };

  try {
    assertSchemaKnowsFields(ModelSchema, Object.keys(expected), "Model");
    await ModelSchema.findByIdAndUpdate(modelId, { $set: expected });

    const persisted = (await ModelSchema.findById(modelId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      return NextResponse.json({
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(
          ", "
        )}] did not persist as expected on re-fetch. Not applied — check for a stale cached Mongoose schema (see comment in models/Model.ts).`,
      });
    }

    return NextResponse.json({ applied: true });
  } catch (err) {
    return NextResponse.json({ applied: false, error: (err as Error).message });
  }
}
