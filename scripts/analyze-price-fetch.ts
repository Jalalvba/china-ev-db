// Stage 2 of the review-first Morocco price pipeline (fetch -> analyze ->
// import; see scripts/fetch-all-prices.ts and scripts/import-price-fetch.ts).
// Pure read of a stage-1 JSON file — no Mongo connection at all, no network
// calls. Buckets every fetched result into exactly one of:
//
//   newlyConfirmed — previously unconfirmed, now a clean exact match
//     (moteur.ma/wandaloo.com outcome). The real "safe to auto-import" set —
//     stage 3 writes these by default.
//   unchanged — already confirmed, and the new fetch agrees with the stored
//     price within AGREEMENT_TOLERANCE. Reported only; stage 3 never writes
//     these (not even last_researched_at) since there's no new information.
//   needsReview — everything else: any gemini-fallback / non-exact-match /
//     ambiguous-multiple-candidates / not-found / error outcome, OR an
//     already-confirmed model whose new price disagrees with the stored
//     price beyond tolerance (a real price change — flagged for a human
//     look before overwriting a previously-trusted value, regardless of how
//     clean the new match itself is). Stage 3 only writes these with
//     --include-flagged.
//
// Usage:
//   pnpm analyze-price-fetch -- --input raw-data/fetch-all-prices-<ts>.json

import fs from "fs";
import path from "path";
import { AGREEMENT_TOLERANCE, pctDiff } from "../lib/priceFetchCore";
import type { FetchRecord } from "./fetch-all-prices";

interface CliOptions {
  input: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let input: string | undefined;
  for (const arg of args) {
    if (arg.startsWith("--input=")) input = arg.slice("--input=".length);
    else if (arg === "--input") {
      const i = args.indexOf(arg);
      input = args[i + 1];
    }
  }
  if (!input) {
    throw new Error("Missing --input <path-to-fetch-all-prices-*.json>");
  }
  return { input };
}

const CLEAN_MATCH_OUTCOMES = new Set(["moteur.ma", "wandaloo.com"]);

export interface AnalysisResult {
  sourceFile: string;
  generatedAt: string;
  counts: {
    newlyConfirmed: number;
    unchanged: number;
    needsReview: number;
  };
  newlyConfirmed: FetchRecord[];
  unchanged: FetchRecord[];
  needsReview: (FetchRecord & { reviewReason: string })[];
}

function analyze(records: FetchRecord[]): Omit<AnalysisResult, "sourceFile" | "generatedAt"> {
  const newlyConfirmed: FetchRecord[] = [];
  const unchanged: FetchRecord[] = [];
  const needsReview: (FetchRecord & { reviewReason: string })[] = [];

  for (const r of records) {
    const isCleanMatch = CLEAN_MATCH_OUTCOMES.has(r.outcome) && typeof r.finalPriceDh === "number";

    if (!r.currentConfirmed && isCleanMatch) {
      newlyConfirmed.push(r);
      continue;
    }

    if (r.currentConfirmed && isCleanMatch) {
      const finalPriceDh = r.finalPriceDh as number;
      if (typeof r.currentPriceDh === "number") {
        const diff = pctDiff(finalPriceDh, r.currentPriceDh);
        if (diff <= AGREEMENT_TOLERANCE) {
          unchanged.push(r);
          continue;
        }
        needsReview.push({
          ...r,
          reviewReason: `Already-confirmed model's price changed: stored ${r.currentPriceDh}DH -> fetched ${finalPriceDh}DH (diff ${(diff * 100).toFixed(1)}%).`,
        });
        continue;
      }
      // Confirmed but no stored price on record (shouldn't normally happen) —
      // treat as a change worth a look rather than silently guessing.
      needsReview.push({
        ...r,
        reviewReason: "Model marked confirmed but has no stored morocco_price_dh — needs manual check.",
      });
      continue;
    }

    // Everything else: gemini-fallback, non-exact-match,
    // ambiguous-multiple-candidates, not-found, error, or an unconfirmed
    // model that didn't resolve to a clean match.
    needsReview.push({ ...r, reviewReason: `outcome=${r.outcome}${r.note ? ` — ${r.note}` : ""}` });
  }

  return {
    counts: { newlyConfirmed: newlyConfirmed.length, unchanged: unchanged.length, needsReview: needsReview.length },
    newlyConfirmed,
    unchanged,
    needsReview,
  };
}

function run() {
  const opts = parseArgs();
  const inputPath = path.resolve(opts.input);
  const records: FetchRecord[] = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

  console.log(`Read ${records.length} record(s) from ${inputPath}\n`);

  const { counts, newlyConfirmed, unchanged, needsReview } = analyze(records);

  console.log(`--- Analysis summary ---`);
  console.log(`newlyConfirmed (safe to auto-import): ${counts.newlyConfirmed}`);
  console.log(`unchanged (already confirmed, price re-verified, no write needed): ${counts.unchanged}`);
  console.log(`needsReview (manual look before import): ${counts.needsReview}`);

  if (needsReview.length > 0) {
    console.log(`\nneedsReview breakdown:`);
    const byReasonPrefix = new Map<string, number>();
    for (const r of needsReview) {
      const key = r.currentConfirmed ? "price-changed-on-confirmed-model" : r.outcome;
      byReasonPrefix.set(key, (byReasonPrefix.get(key) ?? 0) + 1);
    }
    for (const [key, n] of byReasonPrefix) console.log(`  ${key}: ${n}`);
  }

  const outPath = inputPath.replace(/\.json$/, "") + ".analysis.json";
  const analysis: AnalysisResult = {
    sourceFile: inputPath,
    generatedAt: new Date().toISOString(),
    counts,
    newlyConfirmed,
    unchanged,
    needsReview,
  };
  fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2) + "\n");
  console.log(`\nWrote analysis to ${outPath}`);
  console.log(`Next: pnpm import-price-fetch -- --input ${outPath}`);
}

run();
