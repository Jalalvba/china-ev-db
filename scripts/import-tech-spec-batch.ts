// Applies a raw-data/tech-spec-batch-*.json file (produced by
// scripts/tech-spec-agent.ts) directly to MongoDB, WITHOUT the human-review
// step that file's own header comment describes as the normal flow.
//
// Explicit user decision (2026-09-13): for this batch, skip manual review —
// a later Kimi/DeepSeek manual research pass will re-verify these models
// anyway (see lib/manualResearchImport.ts's cross-check job), so waiting on
// a first human review pass before that happens isn't buying much safety
// here. This does NOT change the default recommended flow for future
// batches — review remains the normal path; this script exists for when
// someone deliberately chooses to skip it.
//
// Reuses lib/applySpecUpdates.ts (the exact same write-then-verify path as
// the "Apply these updates" button and the brand-level bulk-apply route) —
// same trim-name matching, same $set + re-fetch verification, same
// findMismatchedKeys reporting. The only thing this script skips is showing
// the diff to a human before writing.
//
// Usage:
//   pnpm import-tech-spec-batch -- raw-data/tech-spec-batch-<timestamp>.json

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import mongoose from "mongoose";
import { applySpecUpdates, type ApplyVariantUpdate } from "../lib/applySpecUpdates";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

interface TechSpecBatchEntry {
  brand_en: string;
  model_en: string;
  agent_query_model_db_id: string;
  variant: Record<string, unknown>;
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: pnpm import-tech-spec-batch -- <path-to-tech-spec-batch-file>.json");
    process.exit(1);
  }

  const entries: TechSpecBatchEntry[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  console.log(`Read ${entries.length} researched variant(s) from ${filePath}.`);

  const updates: ApplyVariantUpdate[] = entries.map((e) => ({
    modelDbId: e.agent_query_model_db_id,
    variant: e.variant,
  }));

  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB. Applying (no review gate — see file header)...\n");

  const result = await applySpecUpdates({ updates, modelFilter: {} });

  console.log(`\n=== RESULT ===`);
  console.log(`Applied (verified after write): ${result.applied} / ${updates.length}`);
  if (result.errors.length > 0) {
    console.log(`Errors (${result.errors.length}):`);
    for (const e of result.errors) console.log(`  [${e.modelDbId}] ${e.message}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
