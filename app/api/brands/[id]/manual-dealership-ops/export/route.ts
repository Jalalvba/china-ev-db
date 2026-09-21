import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import BrandPhevSuvWorkshopProfile from "@/models/BrandPhevSuvWorkshopProfile";
import BrandAfterSalesProcess from "@/models/BrandAfterSalesProcess";
import { buildDealershipOpsExportPrompt } from "@/lib/dealershipOpsResearch";
import { AFTER_SALES_SECTION_KEYS } from "@/types/afterSalesProcess";

// Read-only: builds the dealership-ops-manual-v1 copy-paste prompt. Never writes, never calls an AI/search provider.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: brandId } = await params;
  const brand = await Brand.findById(brandId).lean();
  if (!brand) return NextResponse.json({ error: "Brand not found" }, { status: 404 });

  const [models, profile, afterSales] = await Promise.all([
    ModelSchema.find({ brand_id: brandId }, { name: 1 }).sort({ name: 1 }).lean(),
    BrandPhevSuvWorkshopProfile.findOne({ brand_id: brandId }).lean(),
    BrandAfterSalesProcess.findOne({ brand_id: brandId }).lean(),
  ]);

  const w = brand.warranty_terms as Record<string, unknown> | undefined;
  const p = profile as Record<string, unknown> | null;
  const a = afterSales as Record<string, unknown> | null;
  const factCount = a ? AFTER_SALES_SECTION_KEYS.reduce((n, s) => n + Object.keys((a[s] as object) ?? {}).length, 0) : 0;

  const text = buildDealershipOpsExportPrompt({
    brandId,
    brandName: brand.name_en ?? brand.name,
    brandNameCn: brand.name_cn,
    parentGroup: brand.parent_group,
    modelNames: models.map((m) => m.name),
    existing: {
      warranty: w
        ? `on file (${(w.tiers as unknown[] | undefined)?.length ? `${(w.tiers as unknown[]).length} tiers` : `legacy flat figures only: battery ${w.battery_years ?? "?"} yr / ${w.battery_km ?? "?"} km`}, ${w.confidence ?? "no confidence"})`
        : undefined,
      workshop: p
        ? `on file (${(p.audit_checklist as unknown[] | undefined)?.length ?? 0} audit items, ${(p.technician_prerequisites as unknown[] | undefined)?.length ?? 0} technician prerequisites, ${p._confidence})`
        : undefined,
      afterSales: a ? `on file (${factCount} facts, ${a._confidence})` : undefined,
    },
  });
  return NextResponse.json({ text });
}
