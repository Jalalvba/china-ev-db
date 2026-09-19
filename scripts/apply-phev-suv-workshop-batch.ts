// Applies a reviewed raw-data/phev-suv-workshop-batch-<timestamp>.json (produced by
// scripts/research-phev-suv-workshop.ts) to MongoDB — upserts a
// BrandPhevSuvWorkshopProfile doc for every entry with status === "found", one per
// brand (this collection is already scoped to the single PHEV/REEV-SUV segment, so
// there's no per-category split like brand_workshop_overrides).
//
// Re-validates at apply time (same posture as apply-workshop-overrides-batch.ts) rather
// than trusting the batch file's own status field blindly. Re-fetches and field-checks
// after each write per CLAUDE.md's "Write safety" section.
//
// Usage:
//   npm run apply-phev-suv-workshop-batch -- raw-data/phev-suv-workshop-batch-....json
//   npm run apply-phev-suv-workshop-batch -- raw-data/phev-suv-workshop-batch-....json --dry-run

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import BrandPhevSuvWorkshopProfile from "../models/BrandPhevSuvWorkshopProfile";
import { validatePhevSuvWorkshopProfile } from "../lib/phevSuvWorkshopResearch";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");

if (!filePath) {
  console.error("Usage: npm run apply-phev-suv-workshop-batch -- <path-to-batch.json> [--dry-run]");
  process.exit(1);
}

interface BatchEntry {
  brandId: string;
  brandName: string;
  status: "found" | "not_found" | "error";
  sourceUrls?: string[];
  profile?: Record<string, unknown>;
}

async function main() {
  const resolvedPath = path.resolve(filePath as string);
  const entries = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as BatchEntry[];

  await mongoose.connect(MONGODB_URI as string);

  let upserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.status !== "found" || !entry.profile) {
      console.log(`Skipping ${entry.brandName}: status=${entry.status}`);
      skipped++;
      continue;
    }

    const { confidence, ...rest } = entry.profile;
    const { valid, errors } = validatePhevSuvWorkshopProfile(entry.profile);
    if (!valid) {
      console.log(`Skipping ${entry.brandName}: failed re-validation at apply time (${errors.join("; ")})`);
      skipped++;
      continue;
    }

    const payload = {
      brand_id: entry.brandId,
      diagnostic_interface: rest.diagnostic_interface,
      lift_spec: rest.lift_spec,
      ppe_required: rest.ppe_required ?? [],
      technician_prerequisites: rest.technician_prerequisites ?? [],
      audit_checklist: rest.audit_checklist ?? [],
      _source: "brand_specific" as const,
      _confidence: (confidence as string) ?? "unconfirmed",
      _last_researched_at: new Date(),
    };

    console.log(`  ${dryRun ? "[dry-run] would upsert" : "Upserting"} ${entry.brandName}`);
    if (!dryRun) {
      await BrandPhevSuvWorkshopProfile.findOneAndUpdate(
        { brand_id: entry.brandId },
        { $set: payload },
        { upsert: true, setDefaultsOnInsert: true }
      );

      const verify = await BrandPhevSuvWorkshopProfile.findOne({ brand_id: entry.brandId }).lean();
      if (!verify || verify._confidence !== payload._confidence) {
        console.error(`  WARNING: write verification failed for ${entry.brandName} — re-fetched doc does not match what was written`);
      }
    }
    upserted++;
  }

  console.log(`\n${dryRun ? "[dry-run] Would upsert" : "Upserted"} ${upserted} brand_phev_suv_workshop_profile doc(s), skipped ${skipped} entries.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
