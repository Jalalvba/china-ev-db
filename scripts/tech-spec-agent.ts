// Research agent: for every Model in our DB with zero Powertrain records, or
// with existing Powertrain records missing engine/motor/battery/transmission/
// performance data (or still marked "unconfirmed"), asks the configured AI provider (with real search
// Search grounding enabled) to fill in the canonical spec, and writes the
// results to a batch JSON file for human review.
//
// This script NEVER writes to MongoDB. It only produces
// raw-data/tech-spec-batch-<timestamp>.json (plus a sibling
// -rejected.json for responses that failed schema validation) — review the
// file, edit out anything wrong, then hand it to whatever import step this
// project uses for canonical-shaped powertrain data, like any other source.
//
// The core research/validation logic (prompt building, schema validation,
// grounding gate) lives in lib/techSpecResearch.ts, shared with the per-model
// "Update technical info" button (app/api/models/[id]/update-specs/route.ts)
// so there is exactly one implementation, not two copies that can drift.
//
// Usage:
//   npm run tech-spec-agent                  (full run over every incomplete model)
//   npm run tech-spec-agent -- --limit 5     (only the first 5, for a quick test)
//   npm run tech-spec-agent -- --model deepseek-reasoner  (override the active provider's default model)
//   npm run tech-spec-agent -- --brand-ids <id1>,<id2>    (only these brands)
//   npm run tech-spec-agent -- --zero-only   (only models with zero Powertrain docs — skip
//                                              re-researching models that already have some,
//                                              even incomplete, data)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
// Side-effect import only: registers the "Brand" model so ModelSchema.find().populate("brand_id")
// below can resolve it. A default import here would be elided by esbuild since the binding
// is otherwise unused in this file — see debug notes in the PR/commit that added this.
import "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import type { IBrand } from "../types";
import {
  getDefaultModel,
  DEFAULT_DELAY_MS,
  ModelNotFoundError,
  SearchProviderError,
  sleep,
  needsResearch,
  researchModel,
  type PowertrainLean,
} from "../lib/techSpecResearch";
import { lookupMoteurMa, renderMoteurMaContext } from "../lib/moteurMaScraper";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

// A real function call (not a module-level const — see the comment on
// getActiveProvider() in lib/aiProvider.ts for why that matters: import
// hoisting vs. this script's own dotenv.config() call above) that surfaces a
// missing <PROVIDER>_API_KEY / bad AI_PROVIDER value immediately, before any
// Mongo connection or research work starts.
import { getActiveProvider } from "../lib/aiProvider";
console.log(`AI provider: ${getActiveProvider()}`);
if (!process.env.SEARCH_API_KEY) {
  throw new Error("Missing SEARCH_API_KEY. Get a free Brave Search API key at https://api.search.brave.com/app/keys and set it in .env.");
}

interface CliOptions {
  limit?: number;
  model: string;
  /** Restrict targets to these Brand _ids (comma-separated). Unset = every brand, same as before. */
  brandIds?: string[];
  /** Only models with ZERO Powertrain docs — skips the needsResearch() "has some data but it's incomplete/unconfirmed" case entirely, rather than also re-researching partially-populated models. */
  zeroOnly?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { model: getDefaultModel() };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      options.limit = Number(args[++i]);
    } else if (args[i] === "--model") {
      options.model = args[++i];
    } else if (args[i] === "--brand-ids") {
      options.brandIds = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--zero-only") {
      options.zeroOnly = true;
    }
  }
  return options;
}

interface TechSpecBatchEntry {
  brand_en: string;
  brand_cn?: string;
  model_en: string;
  model_cn?: string;
  model_generation?: string;
  agent_query_model_db_id: string;
  agent_query_brand_db_name: string;
  agent_query_time: string;
  agent_model_used: string;
  source_url?: string[];
  variant: Record<string, unknown>;
}

interface RejectedBatchEntry extends TechSpecBatchEntry {
  validation_errors: string[];
}

async function run() {
  const { limit, model, brandIds, zeroOnly } = parseArgs();
  const delayMs = Number(process.env.AI_AGENT_DELAY_MS ?? DEFAULT_DELAY_MS);

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Using model: ${model}, delay: ${delayMs}ms between requests.`);

  const allModels = await ModelSchema.find({})
    .populate("brand_id", "name name_cn name_en parent_group relationship_type stake_percentage tech_partner status")
    .sort({ name: 1 })
    .lean();

  const allPowertrains = (await Powertrain.find(
    {},
    { model_id: 1, engine: 1, motor: 1, battery: 1, transmission: 1, performance: 1, confidence: 1, unverified: 1 }
  ).lean()) as unknown as PowertrainLean[];

  const powertrainsByModel = new Map<string, PowertrainLean[]>();
  for (const pt of allPowertrains) {
    const key = String(pt.model_id);
    const list = powertrainsByModel.get(key);
    if (list) list.push(pt);
    else powertrainsByModel.set(key, [pt]);
  }

  const brandIdSet = brandIds ? new Set(brandIds) : null;
  let targets = allModels.filter((m) => {
    if (brandIdSet && !brandIdSet.has(String(m.brand_id?._id ?? m.brand_id))) return false;
    const pts = powertrainsByModel.get(String(m._id)) ?? [];
    if (pts.length === 0) return true;
    if (zeroOnly) return false; // has data — zeroOnly means skip it, don't re-research
    return pts.some(needsResearch);
  });
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `${allModels.length} total models, ${targets.length} need research (zero or incomplete powertrain data)${
      limit ? ` (limited to ${limit})` : ""
    }.\n`
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/tech-spec-batch-${timestamp}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const rejectedPath = path.resolve(`raw-data/tech-spec-batch-${timestamp}.rejected.json`);
  const results: TechSpecBatchEntry[] = [];
  const rejected: RejectedBatchEntry[] = [];

  function flush() {
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
    if (rejected.length > 0) {
      fs.writeFileSync(rejectedPath, JSON.stringify(rejected, null, 2) + "\n");
    }
  }

  let acceptedCount = 0;
  let rejectedCount = 0;
  let modelsFoundCount = 0;
  let modelsNotFoundCount = 0;
  let modelsErrorCount = 0;
  let forcedUnconfirmedCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    const brand = m.brand_id as unknown as IBrand | null;
    const brandName = brand?.name_en ?? brand?.name ?? "Unknown";
    const progress = `[${i + 1}/${targets.length}]`;

    const existingTrimNames = (powertrainsByModel.get(String(m._id)) ?? [])
      .map((pt) => pt.trim_name)
      .filter((t): t is string => Boolean(t));

    try {
      const modelName = m.name_en ?? m.name;
      // Real code-level pre-fetch — an actual HTTP fetch + JSON-LD parse of
      // moteur.ma's own pages, not a prompt asking the AI to go check itself.
      const moteurLookup = await lookupMoteurMa(brandName, modelName);
      const moteurMaContext = renderMoteurMaContext(moteurLookup);

      const result = await researchModel(model, {
        modelDbId: String(m._id),
        brandName,
        brandNameCn: brand?.name_cn,
        modelName,
        modelNameCn: m.name_cn,
        generation: m.generation,
        segment: m.segment,
        bodyType: m.body_type,
        existingTrimNames: existingTrimNames.length ? existingTrimNames : undefined,
        brandContext: brand
          ? {
              parentGroup: brand.parent_group,
              relationshipType: brand.relationship_type,
              stakePercentage: brand.stake_percentage,
              techPartner: brand.tech_partner,
              status: brand.status,
            }
          : undefined,
        moteurMaContext,
      });

      if (result.status === "error") {
        console.log(`${progress} ${brandName} ${m.name}: error — ${result.errorMessage}`);
        modelsErrorCount++;
        continue;
      }

      if (result.variants.length === 0) {
        console.log(
          `${progress} ${brandName} ${m.name}: not found — model returned zero variants${result.errorMessage ? ` (${result.errorMessage})` : ""}`
        );
        modelsNotFoundCount++;
        continue;
      }

      const entryBase: Omit<TechSpecBatchEntry, "variant"> = {
        brand_en: brandName,
        brand_cn: brand?.name_cn,
        model_en: m.name_en ?? m.name,
        model_cn: m.name_cn,
        model_generation: m.generation,
        agent_query_model_db_id: String(m._id),
        agent_query_brand_db_name: brandName,
        agent_query_time: result.queriedAt,
        agent_model_used: model,
        source_url: result.sourceUrls,
      };

      let acceptedHere = 0;
      let rejectedHere = 0;
      for (const rv of result.variants) {
        if (!rv.valid) {
          rejected.push({ ...entryBase, variant: rv.variant, validation_errors: rv.errors });
          rejectedHere++;
          continue;
        }
        results.push({ ...entryBase, variant: rv.variant });
        acceptedHere++;
        if (!result.hasGrounding) forcedUnconfirmedCount++;
      }

      console.log(
        `${progress} ${brandName} ${m.name}: ${acceptedHere} accepted, ${rejectedHere} rejected (schema mismatch), ${result.sourceUrls.length} source(s)${
          result.hasGrounding ? "" : " — NO grounding, forced unconfirmed"
        }`
      );
      acceptedCount += acceptedHere;
      rejectedCount += rejectedHere;
      if (acceptedHere > 0) modelsFoundCount++;
      else modelsNotFoundCount++;
      flush();
    } catch (err) {
      if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) {
        // Every remaining model would hit this same 404, or a search-
        // provider failure (rate limit, exhausted credit) that won't clear
        // itself mid-run — stop now rather than grinding through the rest
        // logging the same root cause repeatedly. Flush first so any results
        // found before the failure aren't lost.
        const remaining = targets.length - i;
        const reason =
          err instanceof SearchProviderError
            ? `Brave Search credit exhausted (HTTP ${err.status}) — ${i} model(s) processed successfully before failure, ${remaining} model(s) remain unprocessed.`
            : err.message;
        console.error(`\n${progress} ${brandName} ${m.name}: FATAL — ${reason}`);
        console.error(
          `\n=== PARTIAL SUMMARY (aborted early) ===\n` +
            `Models processed before abort: ${i} / ${targets.length}\n` +
            `  - found (>=1 variant): ${modelsFoundCount}\n` +
            `  - not found:           ${modelsNotFoundCount}\n` +
            `  - errored:             ${modelsErrorCount}\n` +
            `Variants accepted:       ${acceptedCount}\n` +
            `Variants rejected (schema mismatch): ${rejectedCount}\n` +
            `Variants forced to "unconfirmed" (zero-citation gate): ${forcedUnconfirmedCount} / ${acceptedCount}\n`
        );
        if (results.length > 0 || rejected.length > 0) {
          flush();
          console.error(`Stopping the run — this is not a per-model issue. ${results.length} already-found result(s) saved to ${outPath}.`);
        } else {
          console.error(`Stopping the run — this is not a per-model issue. No results were found before this failure, so no output file was written.`);
        }
        await mongoose.disconnect();
        process.exit(1);
      }
      console.error(`${progress} ${brandName} ${m.name}: error — ${(err as Error).message}`);
      modelsErrorCount++;
    }

    if (i < targets.length - 1) await sleep(delayMs);
  }

  flush();
  console.log(
    `\n=== SUMMARY ===\n` +
      `Models processed:        ${targets.length}\n` +
      `  - found (>=1 variant): ${modelsFoundCount}\n` +
      `  - not found:           ${modelsNotFoundCount}\n` +
      `  - errored:             ${modelsErrorCount}\n` +
      `Variants accepted:       ${acceptedCount}\n` +
      `Variants rejected (schema mismatch): ${rejectedCount}\n` +
      `Variants forced to "unconfirmed" (zero-citation gate): ${forcedUnconfirmedCount} / ${acceptedCount}\n`
  );
  console.log(`Wrote ${results.length} accepted variant(s) to ${outPath}`);
  if (rejected.length > 0) {
    console.log(`Wrote ${rejected.length} rejected variant(s) (with validation errors) to ${rejectedPath} — review before deciding whether to fix and re-include them.`);
  }
  console.log(`\nThis file was NOT written to MongoDB. Review it manually before importing.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
