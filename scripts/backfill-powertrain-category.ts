// Backfills Model.powertrain_category from each model's own Powertrain documents'
// energy_type — see IModel.powertrain_category's doc comment in types/index.ts for
// the REEV/EREV -> PHEV and MHEV -> HEV folding rule.
//
// A model can have multiple Powertrain trims with different energy_type values
// (e.g. an ICE version and a PHEV version of the same nameplate sold in China) —
// picks the highest-complexity bucket present (BEV > PHEV > HEV > ICE) so the
// workshop page always surfaces the superset of tooling/cert needs for that model,
// rather than under-representing them.
//
// Models with zero Powertrain docs are left untouched (never guessed).
//
// Usage:
//   npm run backfill-powertrain-category -- --dry-run
//   npm run backfill-powertrain-category

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import ModelSchema, { POWERTRAIN_CATEGORIES } from "../models/Model";
import Powertrain from "../models/Powertrain";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const dryRun = process.argv.includes("--dry-run");

const CATEGORY_RANK = ["ICE", "HEV", "PHEV", "BEV"]; // ascending complexity

function mapEnergyType(energyType: string): string | null {
  switch (energyType) {
    case "ICE":
      return "ICE";
    case "MHEV":
      return "HEV";
    case "HEV":
      return "HEV";
    case "REEV/EREV":
      return "PHEV";
    case "PHEV":
      return "PHEV";
    case "BEV":
      return "BEV";
    default:
      return null;
  }
}

function pickHighest(categories: string[]): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const c of categories) {
    const rank = CATEGORY_RANK.indexOf(c);
    if (rank > bestRank) {
      bestRank = rank;
      best = c;
    }
  }
  return best;
}

async function main() {
  await mongoose.connect(MONGODB_URI as string);

  const models = await ModelSchema.find().lean();
  console.log(`Checking ${models.length} model(s)...`);

  let updated = 0;
  let skippedNoTrims = 0;
  let skippedUnmapped = 0;
  let unchanged = 0;

  for (const m of models) {
    const trims = await Powertrain.find({ model_id: m._id }).select("energy_type").lean();
    if (trims.length === 0) {
      skippedNoTrims++;
      continue;
    }
    const mapped = trims.map((t) => (t.energy_type ? mapEnergyType(t.energy_type) : null)).filter((c): c is string => c !== null);
    if (mapped.length === 0) {
      skippedUnmapped++;
      continue;
    }
    const category = pickHighest(mapped);
    if (!category || !POWERTRAIN_CATEGORIES.includes(category)) {
      skippedUnmapped++;
      continue;
    }
    if (m.powertrain_category === category) {
      unchanged++;
      continue;
    }

    console.log(`  ${m.name} (${m._id}): ${m.powertrain_category ?? "unset"} -> ${category}`);
    if (!dryRun) {
      await ModelSchema.updateOne({ _id: m._id }, { $set: { powertrain_category: category } });
    }
    updated++;
  }

  console.log(
    `\n${dryRun ? "[dry-run] Would update" : "Updated"} ${updated} model(s). ` +
      `${unchanged} already correct, ${skippedNoTrims} skipped (no Powertrain docs), ${skippedUnmapped} skipped (unmapped/missing energy_type).`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
