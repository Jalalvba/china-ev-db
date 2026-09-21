import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { groupBrands } from "@/lib/brandGrouping";
import { parseBrandGroupManualImport } from "@/lib/brandGroupResearch";
import type { IBrand } from "@/types";

// Preview-only: parses + validates a pasted brand-group-manual-v1 response, sectioned by
// sub-brand. Never writes — the client applies selected brand-field changes via the existing
// apply-brand-research route (once per changed brand) and selected new models via the existing
// create-models route (once per brand), same pattern as the single-brand/model-discovery panels.
export async function POST(req: NextRequest) {
  await connectToDatabase();
  const body = await req.json().catch(() => null);
  const groupKey = typeof body?.group_key === "string" ? body.group_key : "";
  const json = typeof body?.json === "string" ? body.json : "";
  if (!groupKey) return NextResponse.json({ error: 'Missing "group_key" in request body.' }, { status: 400 });
  if (!json.trim()) return NextResponse.json({ error: 'Missing "json" (the pasted response text) in request body.' }, { status: 400 });

  const allBrands = (await Brand.find().lean()) as unknown as IBrand[];
  const { groups } = groupBrands(allBrands);
  const group = groups.find((g) => g.key === groupKey);
  if (!group) return NextResponse.json({ error: `No manufacturer group found for key ${JSON.stringify(groupKey)}.` }, { status: 404 });

  const validBrandIds = new Set(group.brands.map((b) => String(b._id)));

  const existingModelsByBrandId = new Map<string, { _id: string; name?: string; name_cn?: string; name_en?: string }[]>();
  for (const brandId of validBrandIds) {
    const existing = await ModelSchema.find({ brand_id: brandId }, { name: 1, name_cn: 1, name_en: 1 }).lean();
    existingModelsByBrandId.set(
      brandId,
      existing.map((m) => ({ _id: String(m._id), name: m.name, name_cn: m.name_cn, name_en: m.name_en }))
    );
  }

  return NextResponse.json(parseBrandGroupManualImport(json, groupKey, validBrandIds, existingModelsByBrandId));
}
