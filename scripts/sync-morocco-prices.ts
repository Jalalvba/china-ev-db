// Standalone batch sync of Morocco pricing onto Model documents, using the
// same two scrapers as app/api/models/[id]/fetch-morocco-price/route.ts
// (that endpoint is untouched — it stays for manual one-off re-checks).
//
// Fetch/reconcile logic (moteur.ma -> wandaloo.com -> suffix-strip ->
// brand-prefix-strip -> flag-for-manual-review-on-disagreement, no longer
// AI-reconciled as of 2026-09-21) lives in
// lib/priceFetchCore.ts, shared with scripts/fetch-all-prices.ts (the
// review-first, three-stage alternative to this script — see
// scripts/analyze-price-fetch.ts and scripts/import-price-fetch.ts). This
// script is the original single-pass fetch-and-write flow: still useful for
// a quick supervised run where you trust the tolerance/exact-match logic and
// want writes to happen inline instead of via a separate approval step.
//
// Usage:
//   pnpm sync-prices                          (all models missing a confirmed Morocco price)
//   pnpm sync-prices -- --force               (re-check every model, including already-confirmed ones)
//   pnpm sync-prices -- --brand=Dongfeng       (scope to one brand, for testing)
//   pnpm sync-prices -- --dry-run              (scrape + log only, write nothing)
//   pnpm sync-prices -- --concurrency=3 --delay=1500

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import { processModel, type Outcome, type ModelResult } from "../lib/priceFetchCore";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

// Two small sites, not a CDN-backed API — keep this conservative by default.
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 1500;

interface CliOptions {
  force: boolean;
  dryRun: boolean;
  brand?: string;
  concurrency: number;
  delayMs: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    force: false,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
  };
  for (const arg of args) {
    if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--brand=")) opts.brand = arg.slice("--brand=".length);
    else if (arg.startsWith("--concurrency=")) opts.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--delay=")) opts.delayMs = Number(arg.slice("--delay=".length));
  }
  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const opts = parseArgs();
  await mongoose.connect(MONGODB_URI as string);
  console.log(
    `Connected. force=${opts.force} dryRun=${opts.dryRun} brand=${opts.brand ?? "(all)"} concurrency=${opts.concurrency} delay=${opts.delayMs}ms\n`
  );

  const brandFilter: Record<string, unknown> = {};
  if (opts.brand) brandFilter.name = new RegExp(`^${opts.brand}$`, "i");
  const brands = await Brand.find(brandFilter, { name: 1, name_en: 1 }).lean();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));

  const modelFilter: Record<string, unknown> = { brand_id: { $in: brands.map((b) => b._id) } };
  if (!opts.force) modelFilter.morocco_price_confirmed = { $ne: true };

  const targets = await ModelSchema.find(modelFilter, {
    name: 1,
    name_en: 1,
    brand_id: 1,
    morocco_price_dh: 1,
    morocco_price_source: 1,
    morocco_price_confirmed: 1,
  }).lean();

  console.log(`${targets.length} model(s) to process.\n`);

  const results: ModelResult[] = [];
  const disagreementCounter = { count: 0 };
  let httpCalls = 0; // rough count: 2 scraper lookups per model, each internally does more, but this tracks top-level calls

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const model = targets[idx++];
      const brand = brandById.get(String(model.brand_id));
      if (!brand) continue;

      const result = await processModel(brand.name, model.name, model.name_en, opts.dryRun, disagreementCounter);
      httpCalls += 2;
      results.push(result);

      const diffStr = typeof result.diffPct === "number" ? ` diff=${(result.diffPct * 100).toFixed(1)}%` : "";
      console.log(
        `[${brand.name} / ${model.name}] -> ${result.outcome}${diffStr}` +
          (result.finalPriceDh ? ` price=${result.finalPriceDh}DH` : "") +
          (result.note ? ` (${result.note})` : "")
      );

      if (!opts.dryRun && result.finalPriceDh && (result.outcome === "moteur.ma" || result.outcome === "wandaloo.com")) {
        await ModelSchema.findByIdAndUpdate(model._id, {
          $set: {
            morocco_price_dh: result.finalPriceDh,
            morocco_price_source: result.outcome,
            morocco_price_url: result.finalUrl,
            morocco_price_confirmed: true,
          },
        });
      }
      // "not-found", "non-exact-match", and "ai-fallback" (sources disagree —
      // see lib/priceFetchCore.ts, no longer AI-reconciled as of 2026-09-21)
      // all write nothing — leave whatever was in the DB untouched and
      // surface it in the review file instead. A failed/uncertain/disagreeing
      // lookup this run is never grounds to clear a price that may have been
      // confirmed some other way (manual verification, a prior run, etc.) —
      // only a fresh successful exact-source match (moteur.ma / wandaloo.com,
      // handled above) writes.

      if (idx < targets.length) await sleep(opts.delayMs);
    }
  }

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, () => worker());
  const start = Date.now();
  await Promise.all(workers);
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  const counts: Record<Outcome, number> = {
    "moteur.ma": 0,
    "wandaloo.com": 0,
    "ai-fallback": 0,
    "non-exact-match": 0,
    "ambiguous-multiple-candidates": 0,
    "not-found": 0,
    error: 0,
  };
  for (const r of results) counts[r.outcome]++;

  console.log(`\n--- Summary ---`);
  console.log(`Scanned:               ${results.length}`);
  console.log(`Updated via moteur.ma:  ${counts["moteur.ma"]}`);
  console.log(`Updated via wandaloo:   ${counts["wandaloo.com"]}`);
  console.log(`Source disagreement (review): ${counts["ai-fallback"]}`);
  console.log(`Non-exact match (review): ${counts["non-exact-match"]}`);
  console.log(`Ambiguous, multiple candidates (review): ${counts["ambiguous-multiple-candidates"]}`);
  console.log(`Failed both / no data:  ${counts["not-found"]}`);
  console.log(`Errors:                 ${counts.error}`);
  console.log(`Total scraper HTTP calls (top-level): ~${httpCalls}`);
  console.log(`Source disagreements needing manual review: ${disagreementCounter.count}`);
  console.log(`Elapsed: ${elapsedSec}s`);

  const reviewNeeded = results.filter(
    (r) =>
      r.outcome === "ai-fallback" ||
      r.outcome === "non-exact-match" ||
      r.outcome === "ambiguous-multiple-candidates" ||
      r.outcome === "not-found" ||
      r.outcome === "error"
  );
  if (reviewNeeded.length > 0 && !opts.dryRun) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = path.resolve(`raw-data/morocco-sync-${timestamp}.review.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(reviewNeeded, null, 2) + "\n");
    console.log(`\nWrote ${reviewNeeded.length} item(s) needing manual review to ${outPath}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
