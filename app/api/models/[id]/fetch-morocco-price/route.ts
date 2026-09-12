import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import "@/models/Brand";
import ModelSchema from "@/models/Model";
import { lookupMoteurMa } from "@/lib/moteurMaScraper";
import { lookupWandaloo } from "@/lib/wandalooScraper";
import type { IBrand } from "@/types";

// Deterministic, code-level price scrape — no LLM involved. Separate from
// update-specs (Gemini research) on purpose: this is a fact a script can
// just go get, not something that needs AI judgment.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id: modelId } = await params;

  const modelDoc = await ModelSchema.findById(modelId).populate("brand_id", "name name_en").lean();
  if (!modelDoc) return NextResponse.json({ error: "Model not found" }, { status: 404 });

  const brand = modelDoc.brand_id as unknown as IBrand | null;
  const brandName = brand?.name_en ?? brand?.name ?? "";
  const modelName = modelDoc.name_en ?? modelDoc.name;

  try {
    const [moteurResult, wandalooResult] = await Promise.all([
      lookupMoteurMa(brandName, modelName),
      lookupWandaloo(brandName, modelName),
    ]);

    const moteurPrice = moteurResult.models.find((m) => typeof m.cheapestPriceDh === "number");

    let update: {
      morocco_price_dh?: number;
      morocco_price_source?: "moteur.ma" | "wandaloo.com";
      morocco_price_url?: string;
      morocco_price_confirmed: boolean;
    };

    // Prefer moteur.ma when both have a confirmed price: it's backed by
    // structured JSON-LD (schema.org Car/Offer) rather than a regex over
    // plain markup, so it's the more reliable of the two when they agree.
    if (moteurPrice) {
      update = {
        morocco_price_dh: moteurPrice.cheapestPriceDh,
        morocco_price_source: "moteur.ma",
        morocco_price_url: moteurPrice.url,
        morocco_price_confirmed: true,
      };
    } else if (wandalooResult.modelFound && typeof wandalooResult.cheapestPriceDh === "number") {
      update = {
        morocco_price_dh: wandalooResult.cheapestPriceDh,
        morocco_price_source: "wandaloo.com",
        morocco_price_url: wandalooResult.modelUrl,
        morocco_price_confirmed: true,
      };
    } else {
      // Not listed (or listed with no parseable price) on either site —
      // clear any stale value rather than leave it dangling, and report
      // this as a normal (non-error) outcome per the omit-rather-than-empty
      // convention.
      update = { morocco_price_confirmed: false };
      await ModelSchema.findByIdAndUpdate(modelId, {
        $set: { morocco_price_confirmed: false },
        $unset: { morocco_price_dh: "", morocco_price_source: "", morocco_price_url: "" },
      });
      return NextResponse.json({
        found: false,
        message: "Not listed on moteur.ma or wandaloo.com.",
        moteurFetchError: moteurResult.fetchError,
        wandalooFetchError: wandalooResult.fetchError,
      });
    }

    await ModelSchema.findByIdAndUpdate(modelId, { $set: update });

    return NextResponse.json({ found: true, ...update });
  } catch (err) {
    console.error("fetch-morocco-price failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? "Unexpected error" }, { status: 500 });
  }
}
