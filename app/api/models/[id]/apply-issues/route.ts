import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import { findMismatchedKeys } from "@/lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "@/lib/schemaGuard";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
const AFFECTED_SYSTEMS_SET = new Set(["engine", "battery", "motor", "transmission", "electronics", "chassis", "body", "climate", "other"]);

interface IssueItem {
  issue_description: string;
  affected_systems: string[];
  frequency_signal?: string;
  source: string;
  confidence: string;
}

function isValidItem(v: unknown): v is IssueItem {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.issue_description === "string" &&
    o.issue_description.trim() !== "" &&
    Array.isArray(o.affected_systems) &&
    o.affected_systems.every((s) => typeof s === "string" && AFFECTED_SYSTEMS_SET.has(s)) &&
    typeof o.source === "string" &&
    o.source.trim() !== "" &&
    typeof o.confidence === "string" &&
    CONFIDENCE_SET.has(o.confidence)
  );
}

// The only write path for known_issues — appends the user-selected,
// reviewed items from ../research-issues/route.ts's result to the model's
// existing known_issues array (deduped by exact issue_description match, so
// re-running research on the same model doesn't pile up duplicates). Same
// re-fetch-verified posture as every other apply route in this codebase.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.known_issues) ? (body.known_issues as unknown[]) : [];

  const validItems = incoming.filter(isValidItem);
  if (validItems.length === 0) {
    return NextResponse.json({ applied: false, error: "No valid known_issues items to apply" }, { status: 400 });
  }

  const modelDoc = await ModelSchema.findById(modelId).lean();
  if (!modelDoc) return NextResponse.json({ applied: false, error: "Model not found" }, { status: 404 });

  const existing = (modelDoc.known_issues ?? []) as IssueItem[];
  const existingDescriptions = new Set(existing.map((i) => i.issue_description));
  const merged = [...existing, ...validItems.filter((i) => !existingDescriptions.has(i.issue_description))];

  const expected = { known_issues: merged, known_issues_last_researched_at: new Date() };

  try {
    assertSchemaKnowsFields(ModelSchema, Object.keys(expected), "Model");
    await ModelSchema.findByIdAndUpdate(modelId, { $set: expected });

    const persisted = (await ModelSchema.findById(modelId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      return NextResponse.json({
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(
          ", "
        )}] did not persist as expected on re-fetch. Not applied — check for a stale cached Mongoose schema (see comment in models/Model.ts).`,
      });
    }

    return NextResponse.json({ applied: true, added: merged.length - existing.length });
  } catch (err) {
    return NextResponse.json({ applied: false, error: (err as Error).message });
  }
}
