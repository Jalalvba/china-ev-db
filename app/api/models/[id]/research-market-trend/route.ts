import { NextRequest } from "next/server";
import { handleCategoryResearch } from "@/lib/categoryRoute";
import { researchMarketTrend } from "@/lib/marketTrendResearch";

// Chinese-source-only sales-trend research (lib/marketTrendResearch.ts) — never writes to MongoDB. See ../apply-market-trend/route.ts for the write path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCategoryResearch(id, "research-market-trend", researchMarketTrend, "market_trend");
}
