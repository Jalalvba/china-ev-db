// One-time backfill: every Powertrain doc written by today's
// backfill-trim-price.ts / fill-missing-mandatory-fields.ts runs got a raw
// trim_price_min/max (CNY) with NO trim_price_min_usd/max_usd — those two
// USD fields didn't exist yet (see lib/applySpecUpdates.ts's
// computeTrimPriceUsd, added after the fact once raw CNY was found
// displaying directly in the UI, a real bug: this app must NEVER show a
// non-USD, non-Morocco-DH price anywhere). This script finds every such
// record and computes the missing USD figures, using ONE exchange rate
// fetched at the start of the run (same convention as scripts/
// backfill-price-usd.ts for Model.price_range) rather than a fresh rate per
// record, so every record converted in one run agrees with every other.
//
// Same write-then-reverify posture as every other write path in this
// codebase (lib/applySpecUpdates.ts).
//
// Usage:
//   npm run backfill-trim-price-usd -- --limit 3   (test batch)
//   npm run backfill-trim-price-usd                (full unattended run)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import Powertrain from "../models/Powertrain";
import { getCnyPerUsdRate } from "../lib/deepseekNormalize";
import { findMismatchedKeys } from "../lib/applySpecUpdates";
import { assertSchemaKnowsFields } from "../lib/schemaGuard";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

function parseArgs(): { limit?: number } {
  const args = process.argv.slice(2);
  const options: { limit?: number } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") options.limit = Number(args[++i]);
  }
  return options;
}

interface TrimPriceLean {
  _id: unknown;
  trim_name?: string;
  trim_price_min?: number;
  trim_price_max?: number;
  trim_price_currency?: string;
}

async function run() {
  const { limit } = parseArgs();
  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  const query = {
    $and: [
      { $or: [{ trim_price_min: { $ne: null } }, { trim_price_max: { $ne: null } }] },
      { trim_price_min_usd: null },
      { trim_price_max_usd: null },
    ],
  };
  let targets = (await Powertrain.find(query, {
    trim_name: 1,
    trim_price_min: 1,
    trim_price_max: 1,
    trim_price_currency: 1,
  }).lean()) as unknown as TrimPriceLean[];
  if (limit) targets = targets.slice(0, limit);

  console.log(`${targets.length} Powertrain doc(s) have a trim_price but no USD conversion yet${limit ? ` (limited to ${limit})` : ""}.\n`);
  if (targets.length === 0) {
    await mongoose.disconnect();
    return;
  }

  // One rate for the whole run — every record converted here agrees with
  // every other, same as scripts/backfill-price-usd.ts's own convention for
  // Model.price_range.
  const { rate, date } = await getCnyPerUsdRate();
  console.log(`Using CNY->USD rate: 1 USD = ${rate.toFixed(4)} CNY (as of ${date})\n`);

  let converted = 0;
  let skippedNonCny = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const progress = `[${i + 1}/${targets.length}]`;
    const currency = (t.trim_price_currency ?? "CNY").toUpperCase();
    if (currency !== "CNY") {
      // Hasn't come up in practice (every research prompt only ever asks
      // for CNY) but don't guess a conversion for a currency this script
      // doesn't know the rate for — leave it for manual review instead.
      console.log(`${progress} "${t.trim_name}": SKIPPED — trim_price_currency is "${t.trim_price_currency}", not CNY.`);
      skippedNonCny++;
      continue;
    }

    const expected: Record<string, unknown> = {
      trim_price_exchange_rate_used: rate,
      trim_price_exchange_rate_date: date,
    };
    if (t.trim_price_min != null) expected.trim_price_min_usd = Math.round(t.trim_price_min / rate);
    if (t.trim_price_max != null) expected.trim_price_max_usd = Math.round(t.trim_price_max / rate);

    try {
      assertSchemaKnowsFields(Powertrain, Object.keys(expected), "Powertrain");
      await Powertrain.findByIdAndUpdate(t._id, { $set: expected });

      const persisted = (await Powertrain.findById(t._id).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(expected, persisted);
      if (badFields.length > 0) {
        console.log(`${progress} "${t.trim_name}": WRITE FAILED verification — field(s) [${badFields.join(", ")}] did not persist.`);
        failed++;
        continue;
      }

      console.log(
        `${progress} "${t.trim_name}": ${t.trim_price_min ?? "?"}-${t.trim_price_max ?? "?"} CNY -> $${expected.trim_price_min_usd ?? "?"}-$${
          expected.trim_price_max_usd ?? "?"
        } — WRITE CONFIRMED.`
      );
      converted++;
    } catch (err) {
      console.log(`${progress} "${t.trim_name}": ERROR — ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `Converted:        ${converted}\n` +
      `Skipped (non-CNY): ${skippedNonCny}\n` +
      `Failed:           ${failed}\n`
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
