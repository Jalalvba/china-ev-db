// Segment backfill: finds every Model with segment == null (a small legacy
// backlog — records written before the schema made segment required, or by
// an older import path that didn't yet enforce the "never null" rule — see
// models/Model.ts / lib/modelDiscovery.ts) and fills it in via the active AI
// provider (lib/aiProvider.ts: DeepSeek by default, or Kimi/Qwen), tagging
// every result segment_confidence: "inferred" per the "always fill, tag
// confidence separately" rule — this script never claims "confirmed", since
// it's a single non-grounded classification call (no real web search), not
// the full researchModel()/discoverModels() grounded pipeline. A model that
// wants a source-backed "confirmed" segment for one of these records should
// re-run the normal per-brand "Discover models" flow or the manual Kimi/
// DeepSeek round-trip instead — both of those DO search and can upgrade an
// "inferred" segment to "confirmed" (see lib/manualResearchImport.ts job 6).
//
// Same write-then-reverify posture as every other write path in this
// codebase (see the comment on findMismatchedKeys in lib/applySpecUpdates.ts
// and models/Model.ts) — a write that doesn't throw is not trusted until a
// re-fetch confirms the field actually landed.
//
// Usage:
//   npm run backfill-segment -- --limit 3   (test batch)
//   npm run backfill-segment                (full unattended run)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import "../models/Brand";
import ModelSchema, { SEGMENTS } from "../models/Model";
import { complete, getActiveProvider, getDefaultModel, ModelNotFoundError } from "../lib/aiProvider";
import { findMismatchedKeys } from "../lib/applySpecUpdates";
import type { IBrand } from "../types";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

console.log(`AI provider: ${getActiveProvider()}`);

const SEGMENT_SET = new Set<string>(SEGMENTS);

interface CliOptions {
  limit?: number;
  model: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { model: getDefaultModel() };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") options.limit = Number(args[++i]);
    else if (args[i] === "--model") options.model = args[++i];
  }
  return options;
}

function buildPrompt(brandName: string, modelName: string, generation: string | undefined, bodyType: string | undefined): string {
  return `You are classifying a Chinese-market vehicle's market segment for a database. No web search is available for this task — use your own knowledge of the vehicle's body type, size, and market positioning.

Vehicle: "${brandName} ${modelName}"${generation ? ` (${generation})` : ""}${bodyType ? `\nKnown body type: ${bodyType}` : ""}

Classify its segment as EXACTLY one of: ${SEGMENTS.join(", ")}.

Respond with ONLY that single segment string, nothing else — no punctuation, no explanation, no markdown.`;
}

async function run() {
  const { limit, model } = parseArgs();
  await mongoose.connect(MONGODB_URI!);

  const targets = (await ModelSchema.find({
    $or: [{ segment: null }, { segment: { $exists: false } }],
  })
    .populate<{ brand_id: IBrand }>("brand_id")
    .lean()) as unknown as (Record<string, unknown> & { brand_id: IBrand })[];

  const scoped = limit ? targets.slice(0, limit) : targets;
  console.log(`Found ${targets.length} Model doc(s) with a null/missing segment.${limit ? ` Processing first ${scoped.length} (--limit).` : ""}`);

  let filled = 0;
  let writeFailed = 0;
  let classifyFailed = 0;

  for (let i = 0; i < scoped.length; i++) {
    const m = scoped[i];
    const brandName = m.brand_id?.name_en ?? m.brand_id?.name ?? "Unknown brand";
    const modelName = m.name as string;
    const progress = `[${i + 1}/${scoped.length}]`;

    try {
      const raw = (
        await complete(buildPrompt(brandName, modelName, m.generation as string | undefined, m.body_type as string | undefined), { model })
      ).trim();
      const segment = SEGMENTS.find((s) => s === raw) ?? SEGMENTS.find((s) => raw.includes(s));

      if (!segment) {
        console.log(`${progress} ${brandName} ${modelName}: could not parse a valid segment from response "${raw}" — skipping.`);
        classifyFailed++;
        continue;
      }

      const expected = { segment, segment_confidence: "inferred" };
      await ModelSchema.updateOne({ _id: m._id }, { $set: expected });
      const persisted = (await ModelSchema.findById(m._id).lean()) as Record<string, unknown> | null;
      const badFields = findMismatchedKeys(expected, persisted);
      if (badFields.length > 0) {
        console.log(`${progress} ${brandName} ${modelName}: write did not verify on re-fetch (field(s): ${badFields.join(", ")}) — not counted as filled.`);
        writeFailed++;
        continue;
      }

      filled++;
      console.log(`${progress} ${brandName} ${modelName}: segment = ${segment} (inferred) — write confirmed.`);
    } catch (err) {
      if (err instanceof ModelNotFoundError) {
        console.error(`\n${progress} ${brandName} ${modelName}: FATAL — ${err.message}`);
        break;
      }
      console.error(`${progress} ${brandName} ${modelName}: unexpected error — ${(err as Error).message} — skipping.`);
      classifyFailed++;
    }
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `Processed:        ${scoped.length}\n` +
      `Filled (inferred): ${filled}\n` +
      `Write failed:     ${writeFailed}\n` +
      `Classify failed:  ${classifyFailed}\n` +
      `Remaining null after this run: ${targets.length - filled}${limit ? " minus whatever --limit left unprocessed" : ""}\n`
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
