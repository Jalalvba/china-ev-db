// One-shot backfill: compute morocco_to_china_price_ratio (morocco_price_dh /
// price_range.min) for every model where both inputs exist AND
// price_range.unverified is not true — see the 2026-09-13 CNY/DH audit
// (flag-price-range-outliers.ts) for why that guard exists: 6 models have a
// price_range.min that is actually a mislabeled Morocco DH price, which would
// make their ratio ≈1.0 and corrupt the mean/stddev if included.
//
// Usage:
//   npx tsx scripts/backfill-morocco-china-ratio.ts            (dry run, default)
//   npx tsx scripts/backfill-morocco-china-ratio.ts --confirm  (writes for real)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  await mongoose.connect(MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const models = db.collection("models");

  const eligible = await models
    .find({
      "price_range.min": { $exists: true, $ne: null },
      morocco_price_dh: { $exists: true, $ne: null },
      "price_range.unverified": { $ne: true },
    })
    .toArray();

  console.log(confirm ? "=== LIVE WRITE MODE ===" : "=== DRY RUN (pass --confirm to write) ===");
  console.log(`Eligible records: ${eligible.length}\n`);

  const now = new Date();
  let written = 0;
  for (const d of eligible) {
    const ratio = d.morocco_price_dh / d.price_range.min;
    console.log(
      `${d.name} (_id: ${d._id}): CNY_min=${d.price_range.min} DH=${d.morocco_price_dh} -> ratio=${ratio.toFixed(4)}`
    );

    if (confirm) {
      const result = await models.updateOne(
        { _id: d._id },
        {
          $set: {
            morocco_to_china_price_ratio: ratio,
            morocco_to_china_price_ratio_computed_at: now,
          },
        }
      );
      written += result.modifiedCount;
    }
  }

  if (confirm) {
    console.log(`\nWrote ratio to ${written}/${eligible.length} records.`);
  } else {
    console.log(`\n${eligible.length} records would be written. Re-run with --confirm to write.`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
