import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";

// Direct manual edit of a Model's Morocco-market name/price — NOT part of the export-prompt/
// paste-response research flow, and deliberately bypasses every guard that flow has (identity
// check, PHEV-only scope guard, source verification, confidence-downgrade-on-no-citation): the
// person editing this is asserting a fact they know themselves, not submitting an AI response for
// review. A manually-entered price is marked morocco_price_confirmed: true with
// morocco_price_source: "manual" and no source_url requirement — this is intentional, not an
// inconsistency with the rest of the app's confidence tracking. Confidence elsewhere exists to
// answer "is this trustworthy enough to show by default," and a human directly asserting a known
// fact about their own market is MORE trustworthy than the AI-fallback case CLAUDE.md already
// allows to write an unconfirmed price — see the Listing/Write-safety conventions.
//
// Body: { morocco_name?: string | null, morocco_price_dh?: number | null }. A field omitted from
// the body is left untouched; `null` explicitly clears that field (distinct from 0, which is a
// real — if unusual — asserted price). Clearing the price also clears morocco_price_source/
// morocco_price_url/morocco_price_confirmed together, since those are only meaningful alongside a
// price value.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { morocco_name, morocco_price_dh } = body as { morocco_name?: string | null; morocco_price_dh?: number | null };

  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};

  if ("morocco_name" in body) {
    if (morocco_name === null || (typeof morocco_name === "string" && morocco_name.trim() === "")) {
      unset.morocco_name = "";
    } else if (typeof morocco_name === "string") {
      set.morocco_name = morocco_name.trim();
    } else {
      return NextResponse.json({ error: "morocco_name must be a string or null." }, { status: 400 });
    }
  }

  if ("morocco_price_dh" in body) {
    if (morocco_price_dh === null) {
      unset.morocco_price_dh = "";
      unset.morocco_price_source = "";
      unset.morocco_price_url = "";
      set.morocco_price_confirmed = false;
    } else if (typeof morocco_price_dh === "number" && Number.isFinite(morocco_price_dh) && morocco_price_dh >= 0) {
      set.morocco_price_dh = morocco_price_dh;
      set.morocco_price_source = "manual";
      set.morocco_price_confirmed = true;
      unset.morocco_price_url = ""; // a manual entry has no source URL — clear any stale scraped one
    } else {
      return NextResponse.json({ error: "morocco_price_dh must be a non-negative number or null." }, { status: 400 });
    }
  }

  if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
    return NextResponse.json({ error: "Nothing to update — provide morocco_name and/or morocco_price_dh." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;

  const doc = await ModelSchema.findByIdAndUpdate(id, update, { new: true, runValidators: true }).lean();
  if (!doc) return NextResponse.json({ error: "Model not found." }, { status: 404 });

  // Re-fetch-verify per this repo's Write safety convention — a Mongoose call not throwing does
  // not guarantee the fields actually persisted (stale-schema-cache incidents have happened here).
  const verify = await ModelSchema.findById(id, "morocco_name morocco_price_dh morocco_price_source morocco_price_confirmed").lean();
  if (!verify) return NextResponse.json({ error: "Write verification failed — model disappeared." }, { status: 500 });
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

  return NextResponse.json({
    applied: true,
    morocco_name: verify.morocco_name ?? null,
    morocco_price_dh: verify.morocco_price_dh ?? null,
    morocco_price_source: verify.morocco_price_source ?? null,
    morocco_price_confirmed: verify.morocco_price_confirmed ?? false,
  });
}
