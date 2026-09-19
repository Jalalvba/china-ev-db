import { NextRequest } from "next/server";
import { handleCategoryResearch } from "@/lib/categoryRoute";
import { researchRecalls } from "@/lib/recallResearch";

// Recall research, deliberately not source-restricted (lib/recallResearch.ts) — never writes to MongoDB. See ../apply-recalls/route.ts for the write path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCategoryResearch(id, "research-recalls", researchRecalls, "recalls");
}
