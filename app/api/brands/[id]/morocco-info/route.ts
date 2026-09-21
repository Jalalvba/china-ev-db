import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";

// Direct manual edit of a Brand's Morocco-market name — NOT part of the export-prompt/paste-
// response research flow, and deliberately bypasses every guard that flow has (identity check,
// source verification, confidence-downgrade-on-no-citation): the person editing this is asserting
// a fact they know themselves, not submitting an AI response for review. Brand has no Morocco
// price field — brands don't have a single price, only Models/Trims do (see
// app/api/models/[id]/morocco-info/route.ts and app/api/powertrains/[id]/morocco-info/route.ts).
//
// Body: { morocco_name?: string | null }. A field omitted from the body is left untouched; `null`
// explicitly clears it (falls back to the brand's own `name` for display).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { morocco_name } = body as { morocco_name?: string | null };
  if (!("morocco_name" in body)) {
    return NextResponse.json({ error: "Nothing to update — provide morocco_name." }, { status: 400 });
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (morocco_name === null || (typeof morocco_name === "string" && morocco_name.trim() === "")) {
    unset.morocco_name = "";
  } else if (typeof morocco_name === "string") {
    set.morocco_name = morocco_name.trim();
  } else {
    return NextResponse.json({ error: "morocco_name must be a string or null." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;

  const doc = await Brand.findByIdAndUpdate(id, update, { new: true, runValidators: true }).lean();
  if (!doc) return NextResponse.json({ error: "Brand not found." }, { status: 404 });

  // Re-fetch-verify per this repo's Write safety convention.
  const verify = await Brand.findById(id, "morocco_name").lean();
  if (!verify) return NextResponse.json({ error: "Write verification failed — brand disappeared." }, { status: 500 });
  for (const key of Object.keys(set)) {
    if (JSON.stringify((verify as Record<string, unknown>)[key]) !== JSON.stringify(set[key])) {
      return NextResponse.json({ error: `Write verification failed: ${key} did not persist.` }, { status: 500 });
    }
  }
  for (const key of Object.keys(unset)) {
    if ((verify as Record<string, unknown>)[key] !== undefined) {
      return NextResponse.json({ error: `Write verification failed: ${key} was not cleared.` }, { status: 500 });
    }
  }

  return NextResponse.json({ applied: true, morocco_name: verify.morocco_name ?? null });
}
