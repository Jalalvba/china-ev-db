import { NextRequest } from "next/server";
import { handleCategoryResearch } from "@/lib/categoryRoute";
import { researchGlobalIssues } from "@/lib/globalIssueResearch";

// International/export-market known-issues research (lib/globalIssueResearch.ts); apply via ../apply-issues with region "global" — never writes to MongoDB. See ../apply-issues/route.ts for the write path.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleCategoryResearch(id, "research-global-issues", researchGlobalIssues, "known_issues");
}
