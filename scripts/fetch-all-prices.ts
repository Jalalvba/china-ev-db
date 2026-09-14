// Stage 1 of the review-first Morocco price pipeline (fetch -> analyze ->
// import; see scripts/analyze-price-fetch.ts and
// scripts/import-price-fetch.ts). Pure fetch: reads Model/Brand docs from
// Mongo for context (current stored price, so stage 2 can spot a changed
// price on an already-confirmed model) but NEVER writes to Mongo. Uses the
// exact same moteur.ma -> wandaloo.com -> suffix-strip -> brand-prefix-strip
// -> AI-on-disagreement logic as scripts/sync-morocco-prices.ts, via the
// shared lib/priceFetchCore.ts — no separate/drifting scraper-calling code.
//
// Safe to run alongside a live `next dev` server / other Mongo writers: this
// script only ever reads from Mongo (a single find() at startup) and writes
// results to a local JSON file.
//
// Usage:
//   pnpm fetch-all-prices                          (all models missing a confirmed Morocco price)
//   pnpm fetch-all-prices -- --force               (re-check every model, including already-confirmed ones)
//   pnpm fetch-all-prices -- --brand=Dongfeng       (scope to one brand, for testing)
//   pnpm fetch-all-prices -- --concurrency=3 --delay=1500

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

// Same defaults as sync-morocco-prices.ts — two small sites, not a
// CDN-backed API, keep this conservative by default.
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 1500;

interface CliOptions {
  force: boolean;
  brand?: string;
  concurrency: number;
  delayMs: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    force: false,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
  };
  for (const arg of args) {
    if (arg === "--force") opts.force = true;
    else if (arg.startsWith("--brand=")) opts.brand = arg.slice("--brand=".length);
    else if (arg.startsWith("--concurrency=")) opts.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--delay=")) opts.delayMs = Number(arg.slice("--delay=".length));
  }
  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Extends lib/priceFetchCore.ts's ModelResult with the pre-fetch DB context
// stage 2 needs to tell "safe to auto-import" apart from "a previously
// confirmed price just changed" — see scripts/analyze-price-fetch.ts.
export interface FetchRecord extends ModelResult {
  modelId: string;
  currentPriceDh?: number;
  currentSource?: string;
  currentConfirmed: boolean;
}

async function run() {
  const opts = parseArgs();
  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected (read-only). force=${opts.force} brand=${opts.brand ?? "(all)"} concurrency=${opts.concurrency} delay=${opts.delayMs}ms\n`);

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

  console.log(`${targets.length} model(s) to fetch.\n`);

  // No Mongo writes needed past this point — disconnect immediately so this
  // script can't interfere with a running dev server's connection pool while
  // the (potentially long) scrape loop runs.
  await mongoose.disconnect();

  const results: FetchRecord[] = [];
  const aiCallCounter = { count: 0 };
  let httpCalls = 0;

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const model = targets[idx++];
      const brand = brandById.get(String(model.brand_id));
      if (!brand) continue;

      // dryRun=false: we still want processModel's AI reconciliation on
      // disagreement (a genuine fetch, not a Mongo write) so stage 2 sees the
      // same outcome sync-morocco-prices.ts would have produced.
      const result = await processModel(brand.name, model.name, model.name_en, false, aiCallCounter);
      httpCalls += 2;

      const record: FetchRecord = {
        ...result,
        modelId: String(model._id),
        currentPriceDh: model.morocco_price_dh,
        currentSource: model.morocco_price_source,
        currentConfirmed: Boolean(model.morocco_price_confirmed),
      };
      results.push(record);

      const diffStr = typeof result.diffPct === "number" ? ` diff=${(result.diffPct * 100).toFixed(1)}%` : "";
      console.log(
        `[${brand.name} / ${model.name}] -> ${result.outcome}${diffStr}` +
          (result.finalPriceDh ? ` price=${result.finalPriceDh}DH` : "") +
          (result.note ? ` (${result.note})` : "")
      );

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

  console.log(`\n--- Fetch summary (no Mongo writes made) ---`);
  console.log(`Scanned:                 ${results.length}`);
  console.log(`moteur.ma matches:       ${counts["moteur.ma"]}`);
  console.log(`wandaloo.com matches:    ${counts["wandaloo.com"]}`);
  console.log(`ai-fallback:         ${counts["ai-fallback"]}`);
  console.log(`non-exact-match:         ${counts["non-exact-match"]}`);
  console.log(`ambiguous-multiple-candidates: ${counts["ambiguous-multiple-candidates"]}`);
  console.log(`not-found:               ${counts["not-found"]}`);
  console.log(`errors:                  ${counts.error}`);
  console.log(`Total scraper HTTP calls (top-level): ~${httpCalls}`);
  console.log(`Total AI calls: ${aiCallCounter.count}`);
  console.log(`Elapsed: ${elapsedSec}s`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/fetch-all-prices-${timestamp}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nWrote ${results.length} result(s) to ${outPath}`);
  console.log(`Next: pnpm analyze-price-fetch -- --input ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
