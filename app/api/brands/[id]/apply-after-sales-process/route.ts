import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import BrandAfterSalesProcess from "@/models/BrandAfterSalesProcess";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";
import { parseAfterSalesProcess } from "@/lib/dealershipOpsResearch";
import { AFTER_SALES_SECTION_KEYS } from "@/types/afterSalesProcess";

// The only write path for BrandAfterSalesProcess. Import-only: the payload is an after_sales_process the user already
// pasted, validated and reviewed — nothing here calls an AI/search provider. Re-validates server-side (never trusts the
// client's copy), then re-fetches and field-verifies per CLAUDE.md's Write safety.
//
// FACT-LEVEL MERGE, not replace: each incoming fact is $set at its own dotted path; a fact the paste reported NOT FOUND
// (or a section it left null) never erases what is already stored. Per CLAUDE.md's open item on silent overwrites, the
// response lists every path whose stored value was CHANGED so it is never invisible.
// _confidence is "confirmed" only if BOTH the paste and the previously stored doc were — old unconfirmed facts stay
// unconfirmed, so a good paste can't launder them.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  const incoming = body?.after_sales_process;
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    return NextResponse.json({ applied: false, error: "Missing after_sales_process object" }, { status: 400 });
  }

  // The reviewed shape is { sections, confidence }; parseAfterSalesProcess wants the flat paste shape.
  const flat = { ...(incoming.sections ?? {}), confidence: incoming.confidence };
  const { valid, errors, parsed } = parseAfterSalesProcess(flat);
  if (!valid || !parsed) return NextResponse.json({ applied: false, error: `Invalid after_sales_process: ${errors.join("; ")}` }, { status: 400 });

  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ applied: false, error: "Brand not found" }, { status: 404 });

  const factSets: Record<string, unknown> = {};
  for (const s of AFTER_SALES_SECTION_KEYS) {
    for (const [k, fact] of Object.entries(parsed.sections[s] ?? {})) factSets[`${s}.${k}`] = fact;
  }
  if (Object.keys(factSets).length === 0) return NextResponse.json({ applied: false, error: "No facts to apply" }, { status: 400 });

  try {
    const existing = (await BrandAfterSalesProcess.findOne({ brand_id: brandId }).lean()) as Record<string, unknown> | null;
    const get = (o: Record<string, unknown> | null, path: string) =>
      path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);
    const overwritten = Object.entries(factSets)
      .filter(([path, fact]) => {
        const cur = get(existing, path) as { value?: string; source_url?: string; market?: string } | undefined;
        const f = fact as { value: string; source_url: string; market?: string };
        return cur && (cur.value !== f.value || cur.source_url !== f.source_url || cur.market !== f.market);
      })
      .map(([path]) => path);

    const confidence = parsed.confidence === "confirmed" && (!existing || existing._confidence === "confirmed") ? "confirmed" : "unconfirmed";
    const set = { ...factSets, _confidence: confidence, _last_researched_at: new Date() } as Record<string, unknown>;

    assertSchemaKnowsFields(BrandAfterSalesProcess, Object.keys(set), "BrandAfterSalesProcess");
    await BrandAfterSalesProcess.findOneAndUpdate({ brand_id: brandId }, { $set: set, $setOnInsert: { brand_id: brandId } }, { upsert: true });

    const persisted = (await BrandAfterSalesProcess.findOne({ brand_id: brandId }).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(set, persisted);
    if (badFields.length > 0) {
      return NextResponse.json({
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(
          ", "
        )}] did not persist as expected on re-fetch. Not applied — check for a stale cached Mongoose schema (see comment in models/BrandAfterSalesProcess.ts).`,
      });
    }
    return NextResponse.json({ applied: true, facts_written: Object.keys(factSets).length, overwritten });
  } catch (err) {
    return NextResponse.json({ applied: false, error: (err as Error).message });
  }
}
