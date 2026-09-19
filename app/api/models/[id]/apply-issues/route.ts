import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import { applyModelFields } from "@/lib/applyModelFields";
import { issueKey, mergeByKey, normalizeArray, normalizeIssue } from "@/lib/categoryValidators";
import { ISSUE_REGIONS } from "@/types/researchCategories";
import type { IssueRegion } from "@/types/researchCategories";
import type { IKnownIssue } from "@/types";

// The only write path for known_issues — appends the user-selected, reviewed items
// from ../research-issues (region "china", the default) or ../research-global-issues
// (region "global") to the model's existing known_issues array. Dedupe is per
// (region, issue_description), so re-running research doesn't pile up duplicates and a
// China item never collapses into a global one with the same text. Existing items with
// no region count as "china". Same re-fetch-verified posture as every other apply route.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.known_issues) ? (body.known_issues as unknown[]) : [];
  const region = (body?.region ?? "china") as IssueRegion;
  if (!ISSUE_REGIONS.includes(region)) {
    return NextResponse.json({ applied: false, error: `Invalid region ${JSON.stringify(body?.region)} — must be one of ${ISSUE_REGIONS.join(", ")}` }, { status: 400 });
  }

  const { items: validItems } = normalizeArray(incoming, (raw) => normalizeIssue(raw, region, { checkChineseSource: region === "china" }));
  if (validItems.length === 0) {
    return NextResponse.json({ applied: false, error: "No valid known_issues items to apply" }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ applied: false, error: "Model not found" }, { status: 404 });

  const existing = (modelDoc.known_issues ?? []) as unknown as IKnownIssue[];
  const { merged, added } = mergeByKey(existing, validItems, issueKey);

  const now = new Date();
  const expected = {
    known_issues: merged,
    known_issues_last_researched_at: now,
    [`known_issues_${region}_last_researched_at`]: now,
  };

  const result = await applyModelFields(modelId, expected);
  if (!result.applied) return NextResponse.json(result);
  return NextResponse.json({ applied: true, added });
}
