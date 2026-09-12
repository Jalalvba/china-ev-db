// Imports Morocco-market availability/pricing data (raw-data/morocco_availability.json)
// into the MoroccoListing collection, matching each entry to an existing
// Model by brand_en + model_en where possible.
//
// Usage: npm run import-morocco -- raw-data/morocco_availability.json

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import MoroccoListing from "../models/MoroccoListing";
import { MOROCCO_BRAND_ALIAS } from "../lib/moroccoBrandAlias";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

interface RawListing {
  brand_en: string;
  model_en: string;
  // Some source files use price_mad, others price_mad_min — accept both.
  price_mad?: number | null;
  price_mad_min?: number | null;
  price_mad_max: number | null;
  autonomie_km?: number | null;
  powertrain: string | null;
  moteur_ma_price_dh?: number | null;
  moteur_ma_confirmed?: boolean | null;
  moteur_ma_url?: string | null;
  dealer_morocco: string | null;
  dealer_confidence: string | null;
  source: string | null;
  /** Model confirmed to exist in-market but no published price found — kept with price null rather than dropped. */
  price_unverified?: boolean;
}

// One explicit, human-verified alias rather than generic fuzzy matching,
// which risks false-positive merges (e.g. a blind substring match would
// wrongly fold Morocco's plain "Seal" into the DB's "Seal 06 GT").
const MODEL_ALIAS: Record<string, string> = {
  "BYD|Han": "Han EV",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadRaw(filePath: string): RawListing[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run import-morocco -- <path-to-json-file>");
    process.exit(1);
  }

  const raw = loadRaw(filePath);
  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Importing ${raw.length} Morocco listings from ${filePath}`);

  let matched = 0;
  let unmatched = 0;
  const unmatchedLog: string[] = [];

  for (const entry of raw) {
    const brandName = MOROCCO_BRAND_ALIAS[entry.brand_en] ?? entry.brand_en;
    const brand = await Brand.findOne({ name: new RegExp(`^${escapeRegex(brandName)}$`, "i") }).lean();

    let modelDoc = null;
    if (brand) {
      const aliasTarget = MODEL_ALIAS[`${entry.brand_en}|${entry.model_en}`];
      const candidates = [aliasTarget, entry.model_en, `${entry.brand_en} ${entry.model_en}`].filter(Boolean) as string[];

      for (const candidate of candidates) {
        modelDoc = await ModelSchema.findOne({
          brand_id: brand._id,
          name: new RegExp(`^${escapeRegex(candidate)}$`, "i"),
        }).lean();
        if (modelDoc) break;
      }
    }

    const dealer_confidence =
      entry.dealer_confidence === "confirmed" || entry.dealer_confidence === "unconfirmed"
        ? entry.dealer_confidence
        : undefined;

    const fields: Record<string, unknown> = {
      brand_en: entry.brand_en,
      model_en: entry.model_en,
      model_id: modelDoc?._id,
      price_mad: entry.price_mad ?? entry.price_mad_min ?? undefined,
      price_mad_max: entry.price_mad_max ?? undefined,
      autonomie_km: entry.autonomie_km ?? undefined,
      powertrain: entry.powertrain ?? undefined,
      moteur_ma_price_dh: entry.moteur_ma_price_dh ?? undefined,
      moteur_ma_confirmed: entry.moteur_ma_confirmed ?? undefined,
      moteur_ma_url: entry.moteur_ma_url ?? undefined,
      dealer_morocco: entry.dealer_morocco ?? undefined, // explicitly left unset when null — never guessed
      dealer_confidence,
      source: entry.source ?? undefined,
      matched: Boolean(modelDoc),
      last_updated: new Date(),
    };
    for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];

    await MoroccoListing.findOneAndUpdate(
      { brand_en: entry.brand_en, model_en: entry.model_en },
      { $set: fields },
      { upsert: true }
    );

    if (modelDoc) {
      matched++;
    } else {
      unmatched++;
      unmatchedLog.push(`${entry.brand_en} ${entry.model_en}${brand ? "" : "  (brand not in DB)"}`);
    }
  }

  console.log(`\nDone. ${matched} matched to an existing Model, ${unmatched} unmatched (kept, model_id unset).`);
  if (unmatchedLog.length) {
    console.log("\nUnmatched listings:");
    for (const line of unmatchedLog) console.log(`  - ${line}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
