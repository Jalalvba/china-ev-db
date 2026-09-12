// One-off update of dealer_morocco/dealer_confidence/note on existing
// MoroccoListing rows, from raw-data/morocco_dealers_final.json. Does not
// create new listings — only updates rows that already exist (from
// import-morocco.ts), matched by brand_en.
//
// Usage: npm run update-morocco-dealers -- raw-data/morocco_dealers_final.json

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import MoroccoListing from "../models/MoroccoListing";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

interface Correction {
  brand_en_list: string[];
  old_value: string;
  new_value: string;
  reason?: string;
  confidence: string;
}

interface DealerEntry {
  brand_en: string;
  dealer_morocco: string;
  confidence: string;
  note?: string;
  website?: string;
}

interface DealersFile {
  corrections?: Correction[];
  dealers: DealerEntry[];
}

// Some source brand_en labels (e.g. "GWM POER") describe the same rows we
// already store under a different brand_en ("GWM", with model_en "POER DC").
// Normalize before matching so we don't silently no-op on a label that was
// never actually stored.
const BRAND_EN_ALIAS: Record<string, string> = {
  "GWM POER": "GWM",
};

function loadJson(filePath: string): DealersFile {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const parsed = JSON.parse(fs.readFileSync(abs, "utf8"));

  // Accept a single bare dealer entry (e.g. a one-brand follow-up file)
  // alongside the full {corrections, dealers} shape.
  if (Array.isArray(parsed)) return { dealers: parsed };
  if ("brand_en" in parsed) return { dealers: [parsed] };
  return parsed;
}

function normalizeConfidence(v: string): "confirmed" | "unconfirmed" | undefined {
  return v === "confirmed" || v === "unconfirmed" ? v : undefined;
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run update-morocco-dealers -- <path-to-json-file>");
    process.exit(1);
  }

  const data = loadJson(filePath);
  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  // 1. Corrections
  let correctionsApplied = 0;
  for (const c of data.corrections ?? []) {
    for (const rawBrand of c.brand_en_list) {
      const brand_en = BRAND_EN_ALIAS[rawBrand] ?? rawBrand;
      const result = await MoroccoListing.updateMany(
        { brand_en, dealer_morocco: c.old_value },
        { $set: { dealer_morocco: c.new_value, dealer_confidence: normalizeConfidence(c.confidence) } }
      );
      correctionsApplied += result.modifiedCount;
      if (result.matchedCount === 0) {
        console.log(`  [correction] No rows matched brand_en="${brand_en}" with dealer_morocco="${c.old_value}"`);
      }
    }
  }
  console.log(`Corrections: ${correctionsApplied} row(s) updated.`);

  // 2. Dealers
  let dealersApplied = 0;
  const noMatch: string[] = [];
  for (const d of data.dealers) {
    const brand_en = BRAND_EN_ALIAS[d.brand_en] ?? d.brand_en;
    // note explicitly set to null when the entry doesn't carry one, so any
    // stale note (e.g. a prior conflict-flag on Changan) is always cleared
    // rather than left in place.
    const result = await MoroccoListing.updateMany(
      { brand_en: new RegExp(`^${escapeRegex(brand_en)}$`, "i") },
      { $set: { dealer_morocco: d.dealer_morocco, dealer_confidence: normalizeConfidence(d.confidence), note: d.note ?? null } }
    );

    dealersApplied += result.modifiedCount;
    if (result.matchedCount === 0) noMatch.push(d.brand_en);
  }
  console.log(`Dealers: ${dealersApplied} row(s) updated.`);
  if (noMatch.length) {
    console.log(`  No existing MoroccoListing rows found for: ${noMatch.join(", ")}`);
  }

  // 3. Coverage report
  const totalBrands = await MoroccoListing.distinct("brand_en");
  const confirmedBrands = await MoroccoListing.distinct("brand_en", { dealer_confidence: "confirmed" });
  const unconfirmedBrands = await MoroccoListing.distinct("brand_en", {
    dealer_confidence: "unconfirmed",
    dealer_morocco: { $exists: true, $ne: null },
  });
  const noDealerBrands = await MoroccoListing.distinct("brand_en", {
    $or: [{ dealer_morocco: { $exists: false } }, { dealer_morocco: null }],
  });

  console.log(`\n--- Coverage ---`);
  console.log(`Distinct brands in MoroccoListing: ${totalBrands.length}`);
  console.log(`Confirmed dealer: ${confirmedBrands.length} — ${confirmedBrands.sort().join(", ")}`);
  console.log(`Unconfirmed dealer (name known, not verified): ${unconfirmedBrands.length} — ${unconfirmedBrands.sort().join(", ")}`);
  console.log(`No dealer at all: ${noDealerBrands.length} — ${noDealerBrands.sort().join(", ")}`);

  await mongoose.disconnect();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
