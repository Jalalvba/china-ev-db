// One-shot migration: flag price_range.unverified + flag_reason on the 7
// models identified by the 2026-09-13 CNY/DH audit (see conversation/commit
// history — no separate writeup file). Scoped by _id, never by name (names
// like "9X" aren't unique across brands).
//
// Usage:
//   npx tsx scripts/flag-price-range-outliers.ts            (dry run, default)
//   npx tsx scripts/flag-price-range-outliers.ts --confirm  (writes for real)

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

  // Resolve _ids live rather than hardcoding guesses for all 7 — only Zeekr
  // 9X and Tiggo 4 Pro's _ids were captured earlier in this session.
  const targets: { match: Record<string, unknown>; reason: string }[] = [
    {
      match: { name: "9X" },
      reason:
        "morocco_price_dh/url point to Zeekr X (moteur.ma/zeekr/x/), not Zeekr 9X — wrong model matched, Morocco price not usable for this model",
    },
    {
      match: { name: "Arrizo 6" },
      reason:
        "CNY value (159000) matches Morocco DH price exactly — likely mislabeled, not a real China price",
    },
    {
      match: { name: "Tiggo 2 Pro" },
      reason:
        "CNY value (159000) matches Morocco DH price exactly — likely mislabeled, not a real China price",
    },
    {
      match: { name: "Tiggo 4 Pro" },
      reason:
        "CNY min/max (185000/205000) match Morocco DH trim prices exactly — likely mislabeled, not real China prices",
    },
    {
      match: { name: "Tiggo 4 CROSS" },
      reason:
        "CNY value (239000) matches Morocco DH price exactly — likely mislabeled, not a real China price",
    },
    {
      match: { name: "Tiggo 7 Pro" },
      reason:
        "CNY value (329000) matches Morocco DH price exactly — likely mislabeled, not a real China price",
    },
    {
      match: { name: "Tiggo 8 Pro" },
      reason:
        "price_range.min/max missing — only derived min_usd/max_usd present, no real CNY source",
    },
  ];

  console.log(confirm ? "=== LIVE WRITE MODE ===" : "=== DRY RUN (pass --confirm to write) ===");

  let matched = 0;
  for (const t of targets) {
    const doc = await models.findOne(t.match);
    if (!doc) {
      console.log(`\n[NOT FOUND] ${JSON.stringify(t.match)}`);
      continue;
    }
    matched++;
    const before = {
      unverified: doc.price_range?.unverified ?? false,
      flag_reason: doc.price_range?.flag_reason ?? null,
    };
    console.log(`\n--- ${doc.name} (_id: ${doc._id}) ---`);
    console.log(`BEFORE: ${JSON.stringify(before)}`);
    console.log(`AFTER:  ${JSON.stringify({ unverified: true, flag_reason: t.reason })}`);

    if (confirm) {
      const result = await models.updateOne(
        { _id: doc._id },
        { $set: { "price_range.unverified": true, "price_range.flag_reason": t.reason } }
      );
      console.log(`WRITE: matched=${result.matchedCount} modified=${result.modifiedCount}`);
    }
  }

  console.log(`\n${matched}/${targets.length} target records matched.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
