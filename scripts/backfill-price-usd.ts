// One-off backfill: every Model with a real CNY price_range (min/max) but no
// min_usd/max_usd gets one computed from a live CNY->USD rate (Frankfurter,
// same source used at import time — see getCnyPerUsdRate in
// lib/deepseekNormalize.ts). Models that only ever had a USD-derived range
// (no real CNY source) are left untouched — there's nothing to convert from.
//
// Usage:
//   pnpm backfill-price-usd                (writes)
//   pnpm backfill-price-usd -- --dry-run    (report only, no writes)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import ModelSchema from "../models/Model";
import { getCnyPerUsdRate } from "../lib/deepseekNormalize";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected. dryRun=${dryRun}`);

  const { rate: cnyPerUsd, date: rateDate } = await getCnyPerUsdRate();
  console.log(`Using CNY->USD rate ${cnyPerUsd.toFixed(4)} (Frankfurter, dated ${rateDate})`);

  const allMissingUsd = await ModelSchema.find(
    {
      "price_range.min": { $exists: true, $ne: null },
      "price_range.max": { $exists: true, $ne: null },
      $or: [{ "price_range.min_usd": { $exists: false } }, { "price_range.min_usd": null }],
    },
    { name: 1, price_range: 1 }
  ).lean();

  // The fetched rate converts CNY only — a non-CNY currency_local (seen in
  // practice: one "AED" entry) would silently get converted at the wrong
  // rate if not filtered out here. Report skips rather than drop them
  // invisibly, so they stay visible for a currency-specific pass later.
  const targets = allMissingUsd.filter((m) => m.price_range!.currency_local === "CNY");
  const skipped = allMissingUsd.filter((m) => m.price_range!.currency_local !== "CNY");
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} model(s) with a non-CNY currency_local (needs its own rate, not backfilled here):`);
    for (const m of skipped) console.log(`  [${m.name}] currency_local=${m.price_range!.currency_local}`);
    console.log();
  }

  console.log(`${targets.length} model(s) need a backfilled USD range.\n`);

  let updated = 0;
  for (const m of targets) {
    const min_usd = Math.round(m.price_range!.min! / cnyPerUsd);
    const max_usd = Math.round(m.price_range!.max! / cnyPerUsd);
    console.log(`[${m.name}] ${m.price_range!.min}-${m.price_range!.max} ${m.price_range!.currency_local} -> $${min_usd}-$${max_usd}`);
    if (!dryRun) {
      await ModelSchema.findByIdAndUpdate(m._id, {
        $set: { "price_range.min_usd": min_usd, "price_range.max_usd": max_usd },
      });
      updated++;
    }
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${dryRun ? targets.length : updated} model(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
