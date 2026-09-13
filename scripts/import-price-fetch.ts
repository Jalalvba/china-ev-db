// Stage 3 of the review-first Morocco price pipeline (fetch -> analyze ->
// import; see scripts/fetch-all-prices.ts and scripts/analyze-price-fetch.ts).
// The only stage that writes to Mongo, and only after you've reviewed the
// stage-2 analysis file.
//
// By default writes only analysis.newlyConfirmed (clean exact match, no
// prior conflicting confirmed price). analysis.unchanged is never written —
// there's no new information, so nothing is touched, not even
// last_researched_at. Pass --include-flagged to additionally write
// analysis.needsReview — expected only after you've manually looked at that
// set (any Gemini-fallback, non-exact-match, ambiguous-multiple-candidates,
// or price change on an already-confirmed model).
//
// Same write-and-reverify discipline as lib/applySpecUpdates.ts: every write
// is re-fetched and field-by-field verified before being counted as applied,
// and one bad write never partial-applies — either every expected field
// verifies or the whole record is reported as an error, DB state untouched
// beyond the single findByIdAndUpdate call already issued.
//
// Usage:
//   pnpm import-price-fetch -- --input raw-data/fetch-all-prices-<ts>.analysis.json
//   pnpm import-price-fetch -- --input <path> --include-flagged

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Types } from "mongoose";
import ModelSchema from "../models/Model";
import type { AnalysisResult } from "./analyze-price-fetch";
import type { FetchRecord } from "./fetch-all-prices";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

interface CliOptions {
  input: string;
  includeFlagged: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let input: string | undefined;
  let includeFlagged = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--input=")) input = arg.slice("--input=".length);
    else if (arg === "--input") input = args[i + 1];
    else if (arg === "--include-flagged") includeFlagged = true;
  }
  if (!input) throw new Error("Missing --input <path-to-analysis.json>");
  return { input, includeFlagged };
}

/** Field-by-field check that every expected key landed as expected on the re-fetched doc — mirrors lib/applySpecUpdates.ts's valuesMatch/findMismatchedKeys (kept local: these expected shapes are simpler and specific to Model price fields, not worth sharing the generic recursive comparator for). */
function findMismatchedKeys(expected: Record<string, unknown>, actual: Record<string, unknown> | null): string[] {
  if (!actual) return Object.keys(expected);
  return Object.entries(expected).filter(([k, v]) => {
    const a = actual[k];
    if (v instanceof Types.ObjectId || a instanceof Types.ObjectId) return String(v) !== String(a);
    return v !== a;
  }).map(([k]) => k);
}

interface ImportOutcome {
  modelId: string;
  brandName: string;
  modelName: string;
  applied: boolean;
  error?: string;
}

async function writeRecord(record: FetchRecord, source: "newlyConfirmed" | "needsReview"): Promise<ImportOutcome> {
  const base = { modelId: record.modelId, brandName: record.brandName, modelName: record.modelName };
  if (typeof record.finalPriceDh !== "number") {
    return { ...base, applied: false, error: "No finalPriceDh on record — nothing to write." };
  }

  const confirmed = record.outcome === "moteur.ma" || record.outcome === "wandaloo.com";
  const expected: Record<string, unknown> = {
    morocco_price_dh: record.finalPriceDh,
    morocco_price_source: record.outcome,
    morocco_price_url: record.finalUrl,
    morocco_price_confirmed: confirmed,
  };

  try {
    await ModelSchema.findByIdAndUpdate(record.modelId, { $set: expected });

    // Re-fetch and verify — do not trust that the write call not throwing
    // means the fields actually persisted (same discipline as
    // lib/applySpecUpdates.ts, and for the same reason: a stale cached
    // Mongoose schema can silently drop a $set field under strict mode).
    const persisted = (await ModelSchema.findById(record.modelId).lean()) as Record<string, unknown> | null;
    const badFields = findMismatchedKeys(expected, persisted);
    if (badFields.length > 0) {
      return {
        ...base,
        applied: false,
        error: `Write did not throw, but failed verification: field(s) [${badFields.join(", ")}] did not persist as expected on re-fetch.`,
      };
    }
    return { ...base, applied: true };
  } catch (err) {
    return { ...base, applied: false, error: (err as Error).message };
  }
}

async function run() {
  const opts = parseArgs();
  const inputPath = path.resolve(opts.input);
  const analysis: AnalysisResult = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  console.log(`Read analysis from ${inputPath}`);
  console.log(
    `newlyConfirmed=${analysis.newlyConfirmed.length} unchanged=${analysis.unchanged.length} needsReview=${analysis.needsReview.length} includeFlagged=${opts.includeFlagged}\n`
  );

  const toWrite: { record: FetchRecord; source: "newlyConfirmed" | "needsReview" }[] = [
    ...analysis.newlyConfirmed.map((record) => ({ record, source: "newlyConfirmed" as const })),
    ...(opts.includeFlagged ? analysis.needsReview.map((record) => ({ record, source: "needsReview" as const })) : []),
  ];

  console.log(`unchanged: skipping ${analysis.unchanged.length} record(s) entirely (already confirmed, price re-verified, no write needed).`);
  if (!opts.includeFlagged) {
    console.log(`needsReview: skipping ${analysis.needsReview.length} record(s) — pass --include-flagged to write these after manual review.`);
  }
  console.log(`\n${toWrite.length} record(s) to write.\n`);

  if (toWrite.length === 0) {
    console.log("Nothing to write. Done.");
    return;
  }

  await mongoose.connect(MONGODB_URI as string);

  const outcomes: ImportOutcome[] = [];
  for (const { record, source } of toWrite) {
    const outcome = await writeRecord(record, source);
    outcomes.push(outcome);
    console.log(
      `[${outcome.brandName} / ${outcome.modelName}] (${source}) -> ${outcome.applied ? "applied" : "FAILED"}` +
        (outcome.error ? ` (${outcome.error})` : "")
    );
  }

  await mongoose.disconnect();

  const applied = outcomes.filter((o) => o.applied).length;
  const failed = outcomes.filter((o) => !o.applied);

  console.log(`\n--- Import summary ---`);
  console.log(`Applied: ${applied}`);
  console.log(`Failed:  ${failed.length}`);
  if (failed.length > 0) {
    console.log(`\nFailed records:`);
    for (const f of failed) console.log(`  [${f.brandName} / ${f.modelName}] ${f.error}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
