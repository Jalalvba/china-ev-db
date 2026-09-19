// Applies a reviewed raw-data/workshop-overrides-batch-<timestamp>.json (produced
// by scripts/research-brand-workshop-overrides.ts) to MongoDB — upserts a
// BrandWorkshopOverride doc for every entry that passed the specificity gate
// (status === "found"), one per powertrain_category the brand actually has a
// classified Model in (Model.powertrain_category, populated by
// scripts/backfill-powertrain-category.ts). A brand-specific fact found by this
// research pass is a fact about that brand's whole after-sales network, so it's
// written once per category the brand actually sells, not guessed onto a category
// it doesn't have any classified models in.
//
// Skips "thin"/"not_found"/"error" entries — those never should have been marked
// "found" in the first place, but this is a second, code-level gate rather than
// trusting the batch file's own status field blindly (same re-fetch-and-verify
// posture as every other write path in this codebase, see CLAUDE.md's "Write
// safety" section).
//
// Usage:
//   npm run apply-workshop-overrides-batch -- raw-data/workshop-overrides-batch-....json
//   npm run apply-workshop-overrides-batch -- raw-data/workshop-overrides-batch-....json --dry-run

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import BrandWorkshopOverride from "../models/BrandWorkshopOverride";
import ModelSchema from "../models/Model";
import { passesSpecificityGate, validateResearchedOverride, type ResearchedOverrideFields } from "../lib/workshopOverrideResearch";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!filePath) {
  console.error("Usage: npm run apply-workshop-overrides-batch -- <path-to-batch.json> [--dry-run]");
  process.exit(1);
}

interface BatchEntry {
  brandId: string;
  brandName: string;
  status: "found" | "thin" | "not_found" | "error";
  sourceUrls?: string[];
  overrides?: ResearchedOverrideFields;
}

async function main() {
  const resolvedPath = path.resolve(filePath as string);
  const entries = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as BatchEntry[];

  await mongoose.connect(MONGODB_URI as string);

  let upserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.status !== "found" || !entry.overrides) {
      console.log(`Skipping ${entry.brandName}: status=${entry.status}`);
      skipped++;
      continue;
    }

    const { valid, errors } = validateResearchedOverride(entry.overrides);
    if (!valid || !passesSpecificityGate(entry.overrides)) {
      console.log(`Skipping ${entry.brandName}: failed re-validation at apply time (${errors.join("; ") || "specificity gate"})`);
      skipped++;
      continue;
    }

    const categories = await ModelSchema.distinct("powertrain_category", {
      brand_id: entry.brandId,
      powertrain_category: { $ne: null },
    });

    if (categories.length === 0) {
      console.log(`Skipping ${entry.brandName}: no classified (powertrain_category) models to attach an override to`);
      skipped++;
      continue;
    }

    const overridesPayload = {
      technician_certification: entry.overrides.technician_certification,
      lift_requirements: entry.overrides.lift_requirements,
      special_tools: entry.overrides.special_tools,
    };

    for (const category of categories) {
      console.log(`  ${dryRun ? "[dry-run] would upsert" : "Upserting"} ${entry.brandName} / ${category}`);
      if (!dryRun) {
        await BrandWorkshopOverride.findOneAndUpdate(
          { brand_id: entry.brandId, powertrain_category: category },
          {
            $set: {
              brand_id: entry.brandId,
              powertrain_category: category,
              overrides: overridesPayload,
              _source_url: entry.sourceUrls?.[0],
              _last_researched_at: new Date(),
            },
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
      upserted++;
    }
  }

  console.log(`\n${dryRun ? "[dry-run] Would upsert" : "Upserted"} ${upserted} brand_workshop_overrides doc(s), skipped ${skipped} entries.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
