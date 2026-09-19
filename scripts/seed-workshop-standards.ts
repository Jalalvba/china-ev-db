// One-time seed for the workshop_standards collection — generic (non-brand-scraped)
// reference docs built from known industry-standard structure: China's national EV
// technician certification tiers (人社部 新能源汽车维修工 grades), generic BEV/PHEV/
// HEV/ICE lift capacity classes, and baseline HV safety tooling. See CLAUDE.md and
// types/index.ts's IWorkshopStandard doc comment for the shape/rationale.
//
// Same review-before-apply pattern as the rest of the research pipeline: the actual
// seed content lives in raw-data/workshop-standards-seed.json for human review
// BEFORE this script is ever run — this script only reads that file and inserts it,
// it does not itself decide the content. Re-running is safe: upsert on
// (powertrain_category, service_tier), so editing the JSON and re-running updates
// existing docs rather than duplicating them.
//
// Usage:
//   npm run seed-workshop-standards            (insert/update all docs)
//   npm run seed-workshop-standards -- --dry-run   (print what would happen, no writes)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import WorkshopStandard, { POWERTRAIN_CATEGORIES, SERVICE_TIERS } from "../models/WorkshopStandard";
import type { IWorkshopStandard } from "../types";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const SEED_PATH = path.resolve("raw-data/workshop-standards-seed.json");
const dryRun = process.argv.includes("--dry-run");

function validate(doc: unknown, index: number): string[] {
  const errors: string[] = [];
  const d = doc as Record<string, unknown>;
  if (!POWERTRAIN_CATEGORIES.includes(d.powertrain_category as string)) {
    errors.push(`[${index}] invalid powertrain_category: ${JSON.stringify(d.powertrain_category)}`);
  }
  if (!SERVICE_TIERS.includes(d.service_tier as string)) {
    errors.push(`[${index}] invalid service_tier: ${JSON.stringify(d.service_tier)}`);
  }
  if (d._source !== "industry_standard" && d._source !== "brand_specific") {
    errors.push(`[${index}] invalid _source: ${JSON.stringify(d._source)}`);
  }
  if (d._confidence !== "confirmed" && d._confidence !== "unconfirmed") {
    errors.push(`[${index}] invalid _confidence: ${JSON.stringify(d._confidence)}`);
  }
  return errors;
}

async function main() {
  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Seed file not found: ${SEED_PATH} — review/create it before running this script.`);
  }
  const docs = JSON.parse(fs.readFileSync(SEED_PATH, "utf-8")) as IWorkshopStandard[];
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error(`${SEED_PATH} did not parse to a non-empty array.`);
  }

  const allErrors = docs.flatMap((d, i) => validate(d, i));
  if (allErrors.length > 0) {
    console.error(`Validation failed for ${SEED_PATH}:`);
    for (const e of allErrors) console.error(`  ${e}`);
    process.exit(1);
  }

  const seen = new Set<string>();
  for (const d of docs) {
    const key = `${d.powertrain_category}/${d.service_tier}`;
    if (seen.has(key)) throw new Error(`Duplicate (powertrain_category, service_tier) in seed file: ${key}`);
    seen.add(key);
  }

  console.log(`Loaded ${docs.length} workshop_standards doc(s) from ${SEED_PATH}:`);
  for (const d of docs) console.log(`  - ${d.powertrain_category} / ${d.service_tier}`);

  if (dryRun) {
    console.log("\n--dry-run: no writes performed.");
    return;
  }

  await mongoose.connect(MONGODB_URI as string);
  let upserted = 0;
  for (const d of docs) {
    await WorkshopStandard.findOneAndUpdate(
      { powertrain_category: d.powertrain_category, service_tier: d.service_tier },
      { $set: d },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted++;
  }
  console.log(`\nUpserted ${upserted} workshop_standards doc(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
