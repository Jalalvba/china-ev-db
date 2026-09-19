// Batch research pass for brand_phev_suv_workshop_profile — scoped ONLY to brands that
// actually have a PHEV/REEV SUV model in the catalog (Model.powertrain_category === "PHEV"
// AND segment in the SUV-* buckets; REEV is already folded into "PHEV" by
// scripts/backfill-powertrain-category.ts, see CLAUDE.md). Further narrowed, per explicit
// user decision on this run, to brands with 2+ such models (drops the single-model long tail).
//
// Separate collection/pipeline from workshop_standards / brand_workshop_overrides — see
// types/index.ts's IBrandPhevSuvWorkshopProfile doc comment. Never touches those.
//
// NEVER writes to MongoDB. Writes a batch review file
// (raw-data/phev-suv-workshop-batch-<timestamp>.json) — review it, then run
// `npm run apply-phev-suv-workshop-batch -- <path>` to upsert entries that found real data.
//
// Usage:
//   npm run research-phev-suv-workshop                 (all qualifying brands)
//   npm run research-phev-suv-workshop -- --limit 3     (first 3, for a quick test)
//   npm run research-phev-suv-workshop -- --brand=WEY   (one brand by exact name)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import { getDefaultModel, DEFAULT_DELAY_MS, ModelNotFoundError, SearchProviderError, sleep } from "../lib/techSpecResearch";
import { researchPhevSuvWorkshopProfile } from "../lib/phevSuvWorkshopResearch";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

// Same threshold confirmed with the user for this run: brands with 2+ PHEV/REEV SUV
// models in the catalog, not the single-model long tail.
const MIN_MODEL_COUNT = 2;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit"));
const limit = limitArg ? parseInt(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1], 10) : undefined;
const brandArg = args.find((a) => a.startsWith("--brand="));
const onlyBrandName = brandArg ? brandArg.split("=")[1] : undefined;

async function main() {
  await mongoose.connect(MONGODB_URI as string);

  const grouped = await ModelSchema.aggregate([
    { $match: { powertrain_category: "PHEV", segment: { $in: ["SUV-compact", "SUV-mid", "SUV-full"] } } },
    { $group: { _id: "$brand_id", count: { $sum: 1 } } },
    { $match: { count: { $gte: MIN_MODEL_COUNT } } },
    { $sort: { count: -1 } },
  ]);

  const brands = await Brand.find({ _id: { $in: grouped.map((g) => g._id) } }).lean();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  let targets = grouped
    .map((g) => ({ brand: brandById.get(String(g._id)), count: g.count }))
    .filter((t): t is { brand: NonNullable<typeof t.brand>; count: number } => Boolean(t.brand));

  if (onlyBrandName) targets = targets.filter((t) => t.brand.name === onlyBrandName);
  if (limit) targets = targets.slice(0, limit);

  console.log(`${targets.length} brand(s) in scope (>=${MIN_MODEL_COUNT} PHEV/REEV SUV models):`);
  for (const t of targets) console.log(`  - ${t.brand.name} (${t.count} model(s))`);

  const model = getDefaultModel();
  const results: Record<string, unknown>[] = [];

  for (const { brand } of targets) {
    console.log(`\nResearching ${brand.name}...`);
    try {
      const result = await researchPhevSuvWorkshopProfile(model, {
        brandName: brand.name_en ?? brand.name,
        brandNameCn: brand.name_cn,
      });
      console.log(`  status=${result.status} hasGrounding=${result.hasGrounding} sources=${result.sourceUrls.length}`);
      results.push({ brandId: String(brand._id), brandName: brand.name, ...result });
    } catch (err) {
      if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
      console.error(`  error: ${(err as Error).message}`);
      results.push({ brandId: String(brand._id), brandName: brand.name, status: "error", errorMessage: (err as Error).message });
    }
    await sleep(DEFAULT_DELAY_MS);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/phev-suv-workshop-batch-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

  const foundCount = results.filter((r) => r.status === "found").length;
  console.log(`\nWrote ${results.length} result(s) to ${outPath}.`);
  console.log(`  ${foundCount} passed with real data (status "found") — candidates for apply.`);
  console.log(`\nReview ${outPath}, then run: npm run apply-phev-suv-workshop-batch -- ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
