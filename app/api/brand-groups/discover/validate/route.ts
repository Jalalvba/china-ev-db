import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { groupBrands } from "@/lib/brandGrouping";
import { parseBrandDiscoveryImport, type ExistingBrandForDedup } from "@/lib/brandDiscoveryResearch";
import type { IBrand } from "@/types";

// Preview-only: parses + validates a pasted brand-discovery-v1 response. Never writes — the client
// creates selected new brands via the existing generic POST /api/brands route (setting
// parent_group to this group's own key, so groupBrands() places the new brand in the same group).
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

  const toDedupShape = (b: IBrand): ExistingBrandForDedup => ({
    _id: String(b._id),
    name: b.name,
    name_cn: b.name_cn,
    parent_group: b.parent_group,
  });
  const existingBrandsInGroup = group.brands.map(toDedupShape);
  const allExistingBrands = allBrands.map(toDedupShape);

  return NextResponse.json(parseBrandDiscoveryImport(json, groupKey, existingBrandsInGroup, allExistingBrands));
}
