import { NextRequest } from "next/server";
import { handleCategoryResearch } from "@/lib/categoryRoute";
import { researchBulletins } from "@/lib/bulletinResearch";

// Technical-service-bulletin research, Chinese + manufacturer service sites (lib/bulletinResearch.ts) — never writes to MongoDB. See ../apply-bulletins/route.ts for the write path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCategoryResearch(id, "research-bulletins", researchBulletins, "technical_bulletins");
}
