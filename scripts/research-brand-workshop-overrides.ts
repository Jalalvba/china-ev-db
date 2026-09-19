// Batch research pass for brand_workshop_overrides — targets only brands with a
// confirmed Morocco market presence (Model.morocco_price_confirmed === true), not
// global sales volume, per the explicit review decision on this feature. Does NOT
// run against all 148 brands: this is deliberately narrow, expensive AI research,
// and most brands have zero public brand-specific workshop documents (that was the
// correct finding from the old per-model version — this script doesn't fix source
// scarcity, it just stops treating scarcity as "0% coverage").
//
// Three distinct search queries per brand (lib/workshopOverrideResearch.ts's
// buildOverrideSearchQueries), not one — the old single-query approach's thin
// coverage was a big part of why it got deprecated.
//
// NEVER writes to MongoDB. Writes a batch review file
// (raw-data/workshop-overrides-batch-<timestamp>.json) — review it, then run
// `npm run apply-workshop-overrides-batch -- <path>` to upsert the entries that
// passed the specificity gate. Also maintains
// raw-data/workshop-override-dead-brands.json: brands that returned nothing
// specific after all 3 queries are logged there and skipped on future runs (pass
// --force to re-query a dead brand anyway, e.g. after a schema/prompt change).
//
// Usage:
//   npm run research-workshop-overrides                  (all 18 confirmed-Morocco brands, skipping known-dead ones)
//   npm run research-workshop-overrides -- --limit 3      (first 3, for a quick test)
//   npm run research-workshop-overrides -- --force        (re-query brands already logged as dead)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import { getDefaultModel, DEFAULT_DELAY_MS, ModelNotFoundError, SearchProviderError, sleep } from "../lib/techSpecResearch";
import { researchBrandWorkshopOverride } from "../lib/workshopOverrideResearch";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit"));
const limit = limitArg ? parseInt(limitArg.split("=")[1] ?? args[args.indexOf(limitArg) + 1], 10) : undefined;
const force = args.includes("--force");

const DEAD_BRANDS_PATH = path.resolve("raw-data/workshop-override-dead-brands.json");

interface DeadBrandEntry {
  brandName: string;
  lastCheckedAt: string;
  queriesRun: string[];
}

function loadDeadBrands(): Record<string, DeadBrandEntry> {
  if (!fs.existsSync(DEAD_BRANDS_PATH)) return {};
  return JSON.parse(fs.readFileSync(DEAD_BRANDS_PATH, "utf-8"));
}

function saveDeadBrands(map: Record<string, DeadBrandEntry>) {
  fs.writeFileSync(DEAD_BRANDS_PATH, JSON.stringify(map, null, 2) + "\n");
}

async function main() {
  await mongoose.connect(MONGODB_URI as string);

  // Same signal CLAUDE.md's listing convention treats as "confirmed Morocco
  // market presence" — Model.morocco_price_confirmed — aggregated up to brand
  // level. Reviewed and confirmed with the user as the ranking basis for this
  // batch (18 brands total have any confirmed Morocco model; all 18 qualify).
  const rankedBrandIds = await ModelSchema.aggregate([
    { $match: { morocco_price_confirmed: true, morocco_price_dh: { $ne: null } } },
    { $group: { _id: "$brand_id", confirmedCount: { $sum: 1 } } },
    { $sort: { confirmedCount: -1 } },
  ]);

  const brands = await Brand.find({ _id: { $in: rankedBrandIds.map((r) => r._id) } }).lean();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));
  let targets = rankedBrandIds
    .map((r) => ({ brand: brandById.get(String(r._id)), confirmedCount: r.confirmedCount }))
    .filter((t): t is { brand: NonNullable<typeof t.brand>; confirmedCount: number } => Boolean(t.brand));

  console.log(`${targets.length} brand(s) with a confirmed Morocco-priced model (the full ranked list):`);
  for (const t of targets) console.log(`  - ${t.brand.name} (${t.confirmedCount} confirmed model(s))`);

  const deadBrands = loadDeadBrands();
  if (!force) {
    const before = targets.length;
    targets = targets.filter((t) => !deadBrands[t.brand.name]);
    const skipped = before - targets.length;
    if (skipped > 0) {
      console.log(`\nSkipping ${skipped} brand(s) already logged as dead in ${DEAD_BRANDS_PATH} (pass --force to re-query):`);
      for (const name of Object.keys(deadBrands)) console.log(`  - ${name}`);
    }
  }

  if (limit) targets = targets.slice(0, limit);

  const model = getDefaultModel();
  const results: Record<string, unknown>[] = [];
  const newlyDead: string[] = [];

  for (const { brand } of targets) {
    console.log(`\nResearching ${brand.name}...`);
    try {
      const result = await researchBrandWorkshopOverride(model, {
        brandName: brand.name_en ?? brand.name,
        brandNameCn: brand.name_cn,
      });

      console.log(
        `  status=${result.status} hasGrounding=${result.hasGrounding} sources=${result.sourceUrls.length} passesSpecificity=${result.passesSpecificity}`
      );

      results.push({
        brandId: String(brand._id),
        brandName: brand.name,
        ...result,
      });

      if (result.status === "not_found" || result.status === "thin" || result.status === "error") {
        deadBrands[brand.name] = {
          brandName: brand.name,
          lastCheckedAt: new Date().toISOString(),
          queriesRun: [
            `${brand.name_en ?? brand.name} 经销商招募 售后服务标准`,
            `${brand.name_cn ?? brand.name} 特约维修站 认证要求`,
            `${brand.name_cn ?? brand.name} 新能源 维修资质 培训`,
          ],
        };
        newlyDead.push(brand.name);
      } else {
        // Found something real — clear any stale dead-brand entry from a prior run.
        delete deadBrands[brand.name];
      }
    } catch (err) {
      if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
      console.error(`  error: ${(err as Error).message}`);
      results.push({ brandId: String(brand._id), brandName: brand.name, status: "error", errorMessage: (err as Error).message });
    }
    await sleep(DEFAULT_DELAY_MS);
  }

  saveDeadBrands(deadBrands);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/workshop-overrides-batch-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

  const foundCount = results.filter((r) => r.status === "found").length;
  console.log(`\nWrote ${results.length} result(s) to ${outPath}.`);
  console.log(`  ${foundCount} passed the specificity gate (status "found") — candidates for apply.`);
  console.log(`  ${newlyDead.length} newly logged as dead (thin/not_found/error) in ${DEAD_BRANDS_PATH}.`);
  console.log(`\nReview ${outPath}, then run: npm run apply-workshop-overrides-batch -- ${outPath}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
