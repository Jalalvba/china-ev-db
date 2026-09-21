import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import { groupBrands } from "@/lib/brandGrouping";
import { buildBrandGroupManualExportPrompt, type BrandGroupMember } from "@/lib/brandGroupResearch";
import type { IBrand } from "@/types";

// Read-only: builds the copy-paste prompt (+ brand-group-manual-v2 envelope template) for an
// entire manufacturer group at once — covers both jobs in one prompt: updates/corrections for
// brands+models already in the DB under this group, AND brands/sub-brands not in the DB at all
// yet (the two used to be separate button pairs; see CLAUDE.md's 2026-09-21 merge entry). group_key
// is taken from the request body, not a URL param, since a group key can contain spaces/
// punctuation (e.g. "Chery Automobile Co., Ltd.") that would need careful encode/decode
// round-tripping as a dynamic route segment. Never calls the AI provider.
export async function POST(req: NextRequest) {
  await connectToDatabase();
  const body = await req.json().catch(() => null);
  const groupKey = typeof body?.group_key === "string" ? body.group_key : "";
  if (!groupKey) return NextResponse.json({ error: 'Missing "group_key" in request body.' }, { status: 400 });

  const allBrands = (await Brand.find().lean()) as unknown as IBrand[];
  const { groups } = groupBrands(allBrands);
  const group = groups.find((g) => g.key === groupKey);
  if (!group) return NextResponse.json({ error: `No manufacturer group found for key ${JSON.stringify(groupKey)}.` }, { status: 404 });

  const members: BrandGroupMember[] = [];
  for (const brand of group.brands) {
    const existing = await ModelSchema.find({ brand_id: brand._id }, { name: 1 }).lean();
    members.push({
      brandId: String(brand._id),
      brandName: brand.name_en ?? brand.name,
      brandNameCn: brand.name_cn,
      currentParentGroup: brand.parent_group,
      existingModelNames: existing.map((m) => m.name),
    });
  }

  const text = buildBrandGroupManualExportPrompt({ groupKey, members });
  return NextResponse.json({ text });
}
