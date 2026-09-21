import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import BrandAfterSalesProcess from "@/models/BrandAfterSalesProcess";
import { parseDealershipOpsImport } from "@/lib/dealershipOpsResearch";

// Preview-only: parses + validates a pasted dealership-ops-manual-v1 response. Never writes — the client applies
// each accepted section through its own apply route (apply-warranty / apply-workshop-profile / apply-after-sales-process).
// Also returns the stored after-sales facts so the review can flag which incoming facts would REPLACE an existing one.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.json !== "string" || body.json.trim() === "") {
    return NextResponse.json({ error: 'Missing "json" (the pasted response text) in request body.' }, { status: 400 });
  }
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const existing = await BrandAfterSalesProcess.findOne({ brand_id: brandId }).lean();
  return NextResponse.json({
    ...parseDealershipOpsImport(body.json, brandId),
    existing_after_sales_process: existing ? JSON.parse(JSON.stringify(existing)) : null,
  });
}
