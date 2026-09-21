import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { groupBrands } from "@/lib/brandGrouping";
import { buildBrandDiscoveryExportPrompt } from "@/lib/brandDiscoveryResearch";
import type { IBrand } from "@/types";

// Read-only: builds the copy-paste prompt for finding brands/sub-brands that belong to this
// manufacturer group but aren't in our DB at all yet. group_key is a request-body field, not a URL
// param, same reasoning as app/api/brand-groups/export/route.ts (punctuation-safe). Never calls the
// AI provider.
export async function POST(req: NextRequest) {
  await connectToDatabase();
  const body = await req.json().catch(() => null);
  const groupKey = typeof body?.group_key === "string" ? body.group_key : "";
  if (!groupKey) return NextResponse.json({ error: 'Missing "group_key" in request body.' }, { status: 400 });

  const allBrands = (await Brand.find().lean()) as unknown as IBrand[];
  const { groups } = groupBrands(allBrands);
  const group = groups.find((g) => g.key === groupKey);
  if (!group) return NextResponse.json({ error: `No manufacturer group found for key ${JSON.stringify(groupKey)}.` }, { status: 404 });

  const existingBrandNames = group.brands.map((b) => b.name_en ?? b.name);
  const text = buildBrandDiscoveryExportPrompt({ groupKey, existingBrandNames });
  return NextResponse.json({ text });
}
