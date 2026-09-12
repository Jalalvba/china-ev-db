import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { applySpecUpdates, type ApplyVariantUpdate, type ApplyNotableFactsUpdate } from "@/lib/applySpecUpdates";
import { appendResearchLog } from "@/lib/researchLog";

// The only write path for AI-researched specs at model scope: only ever
// called after the user has reviewed results from
// /api/models/[id]/update-specs and clicked "Apply these updates". See
// lib/applySpecUpdates.ts for the actual upsert logic (shared with the
// per-brand route).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;
  const body = await req.json().catch(() => null);
  const updates = (body?.updates ?? []) as ApplyVariantUpdate[];
  const notableFacts = (body?.notableFacts ?? []) as ApplyNotableFactsUpdate[];

  if ((!Array.isArray(updates) || updates.length === 0) && (!Array.isArray(notableFacts) || notableFacts.length === 0)) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const result = await applySpecUpdates({ updates, notableFacts, modelFilter: { _id: modelId } });

  // Durable record of exactly what was requested to be applied and what
  // applySpecUpdates actually verified as persisted — see lib/researchLog.ts.
  appendResearchLog({
    kind: "apply",
    modelDbId: modelId,
    requestedUpdates: updates,
    requestedNotableFacts: notableFacts,
    result,
  });

  return NextResponse.json(result);
}
