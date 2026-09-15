// Dedicated trim_price backfill: finds every Model with at least one
// Powertrain record missing trim_price_min (regardless of whether its other
// mandatory fields — engine/motor/thermal_management, see
// fill-missing-mandatory-fields.ts — are already filled), and re-researches
// it via researchModel() with priceFocus: true (lib/techSpecResearch.ts).
//
// Why this is a SEPARATE script rather than a flag on the existing one: the
// existing mandatory-fields backfill already ran across all ~110 target
// models and (per a live check partway through) filled trim_price for only
// ~17% of trims — the schema/prompt mechanism works (proven: XPeng G6 got 3
// genuinely different per-trim prices with real citations), it just wasn't
// getting enough of the model's attention against everything else in that
// pass's checklist. priceFocus injects extra prompt emphasis + extra
// "<trim name> 价格" search queries specifically for this field (see
// TechSpecPromptInput.priceFocus's own comment) — deliberately NOT the
// default for every research pass, since most passes shouldn't spend search
// budget chasing a field they don't need.
//
// Same write-then-reverify posture as every other write path in this
// codebase (lib/applySpecUpdates.ts) — one model at a time, strictly
// sequential, no batching.
//
// Usage:
//   npm run backfill-trim-price -- --limit 3   (test batch)
//   npm run backfill-trim-price                (full unattended run)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import type { IBrand } from "../types";
import { getDefaultModel, DEFAULT_DELAY_MS, ModelNotFoundError, sleep, researchModel, type PowertrainLean } from "../lib/techSpecResearch";
import { applySpecUpdates } from "../lib/applySpecUpdates";
import { lookupMoteurMa, renderMoteurMaContext } from "../lib/moteurMaScraper";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

import { getActiveProvider } from "../lib/aiProvider";
console.log(`AI provider: ${getActiveProvider()}`);
if (!process.env.SEARCH_API_KEY) {
  throw new Error("Missing SEARCH_API_KEY. Get a free Brave Search API key at https://api.search.brave.com/app/keys and set it in .env.");
}

interface CliOptions {
  limit?: number;
  model: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { model: getDefaultModel() };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      options.limit = Number(args[++i]);
    } else if (args[i] === "--model") {
      options.model = args[++i];
    }
  }
  return options;
}

interface TrimPricePowertrainLean extends PowertrainLean {
  trim_price_min?: number | null;
}

async function run() {
  const { limit, model } = parseArgs();
  const delayMs = Number(process.env.AI_AGENT_DELAY_MS ?? DEFAULT_DELAY_MS);

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Using model: ${model}, delay: ${delayMs}ms between models.`);

  const allPowertrains = (await Powertrain.find(
    {},
    { model_id: 1, trim_name: 1, energy_type: 1, trim_price_min: 1 }
  ).lean()) as unknown as TrimPricePowertrainLean[];

  const trimsMissingPriceCount = allPowertrains.filter((pt) => pt.trim_price_min == null).length;
  const modelIdsNeedingBackfill = new Set<string>();
  for (const pt of allPowertrains) {
    if (pt.trim_price_min == null) modelIdsNeedingBackfill.add(String(pt.model_id));
  }

  let targetModelIds = Array.from(modelIdsNeedingBackfill);
  if (limit) targetModelIds = targetModelIds.slice(0, limit);

  const targets = await ModelSchema.find({ _id: { $in: targetModelIds } })
    .populate("brand_id", "name name_cn name_en parent_group relationship_type stake_percentage tech_partner status")
    .sort({ name: 1 })
    .lean();

  console.log(
    `${modelIdsNeedingBackfill.size} model(s) have at least one Powertrain record missing trim_price_min (${trimsMissingPriceCount} trim(s) total across all models)${
      limit ? `, limited to ${limit}` : ""
    }.\n`
  );

  let modelsProcessed = 0;
  let modelsWriteSucceeded = 0;
  let modelsWriteFailed = 0;
  let modelsResearchNotFound = 0;
  let modelsResearchError = 0;
  let variantsApplied = 0;
  let variantsRejected = 0;
  // Success-rate tracking: of every trim this run actually got a valid,
  // applied research result for, how many came back with a real
  // trim_price_min — this is the number to compare against the ~17% baseline
  // from the un-focused pass.
  let trimsWithResultAndPrice = 0;
  let trimsWithResultTotal = 0;

  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    const brand = m.brand_id as unknown as IBrand | null;
    const brandName = brand?.name_en ?? brand?.name ?? "Unknown";
    const modelName = m.name_en ?? m.name;
    const progress = `[${i + 1}/${targets.length}]`;
    modelsProcessed++;

    const existingPowertrains = allPowertrains.filter((pt) => String(pt.model_id) === String(m._id));
    const existingTrimNames = existingPowertrains.map((pt) => pt.trim_name).filter((t): t is string => Boolean(t));

    try {
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
        priceFocus: true,
      });

      if (result.status === "error") {
        console.log(`${progress} ${brandName} ${modelName}: RESEARCH FAILED — ${result.errorMessage} — skipping.`);
        modelsResearchError++;
        continue;
      }
      if (result.variants.length === 0) {
        console.log(
          `${progress} ${brandName} ${modelName}: research returned zero variants${
            result.errorMessage ? ` (${result.errorMessage})` : ""
          } — skipping.`
        );
        modelsResearchNotFound++;
        continue;
      }

      const validVariants = result.variants.filter((v) => v.valid);
      const invalidVariants = result.variants.filter((v) => !v.valid);
      variantsRejected += invalidVariants.length;
      for (const iv of invalidVariants) {
        console.log(`${progress} ${brandName} ${modelName}: REJECTED variant (schema mismatch) — ${iv.errors.join("; ")}`);
      }

      if (validVariants.length === 0) {
        console.log(`${progress} ${brandName} ${modelName}: all variants rejected — nothing to write, skipping.`);
        modelsResearchNotFound++;
        continue;
      }

      for (const v of validVariants) {
        const trimName = (v.variant.trim_name as string) ?? "?";
        const priceMin = v.variant.trim_price_min as number | null | undefined;
        const priceMax = v.variant.trim_price_max as number | null | undefined;
        const priceCurrency = (v.variant.trim_price_currency as string) ?? "";
        trimsWithResultTotal++;
        if (priceMin != null) trimsWithResultAndPrice++;
        console.log(
          `${progress} ${brandName} ${modelName} — trim "${trimName}": trim_price=${
            priceMin != null ? `${priceMin}${priceMax != null && priceMax !== priceMin ? `-${priceMax}` : ""} ${priceCurrency}` : "NOT FOUND"
          } (grounding=${result.hasGrounding ? `yes, ${result.sourceUrls.length} source(s)` : "NO — forced unconfirmed"})`
        );
      }

      const applyResult = await applySpecUpdates({
        updates: validVariants.map((v) => ({ modelDbId: String(m._id), variant: v.variant })),
        modelFilter: { _id: m._id },
      });

      variantsApplied += applyResult.applied;
      if (applyResult.errors.length > 0) {
        modelsWriteFailed++;
        for (const e of applyResult.errors) {
          console.log(`${progress} ${brandName} ${modelName}: WRITE FAILED — ${e.message}`);
        }
      }
      if (applyResult.applied > 0) {
        modelsWriteSucceeded++;
        console.log(
          `${progress} ${brandName} ${modelName}: WRITE CONFIRMED — ${applyResult.applied} variant(s) verified on re-fetch. Moving to next model.`
        );
      } else if (applyResult.errors.length === 0) {
        console.log(`${progress} ${brandName} ${modelName}: no variants applied and no errors reported — treating as failed.`);
        modelsWriteFailed++;
      }
    } catch (err) {
      if (err instanceof ModelNotFoundError) {
        console.error(`\n${progress} ${brandName} ${modelName}: FATAL — ${err.message}`);
        console.error(
          `\n=== PARTIAL SUMMARY (aborted early) ===\n` +
            `Models processed before abort: ${i} / ${targets.length}\n` +
            `  - writes confirmed:      ${modelsWriteSucceeded}\n` +
            `  - writes failed:         ${modelsWriteFailed}\n` +
            `  - research not found:    ${modelsResearchNotFound}\n` +
            `  - research errored:      ${modelsResearchError}\n` +
            `Variants applied:  ${variantsApplied}\n` +
            `Variants rejected: ${variantsRejected}\n` +
            `Trim-price success rate: ${trimsWithResultAndPrice}/${trimsWithResultTotal}\n`
        );
        await mongoose.disconnect();
        process.exit(1);
      }
      console.error(`${progress} ${brandName} ${modelName}: unexpected error — ${(err as Error).message} — skipping.`);
      modelsResearchError++;
    }

    if (i < targets.length - 1) await sleep(delayMs);
  }

  const successRate = trimsWithResultTotal > 0 ? ((trimsWithResultAndPrice / trimsWithResultTotal) * 100).toFixed(1) : "n/a";
  console.log(
    `\n=== SUMMARY ===\n` +
      `Models processed:     ${modelsProcessed}\n` +
      `  - writes confirmed: ${modelsWriteSucceeded}\n` +
      `  - writes failed:    ${modelsWriteFailed}\n` +
      `  - research not found: ${modelsResearchNotFound}\n` +
      `  - research errored:   ${modelsResearchError}\n` +
      `Variants applied:  ${variantsApplied}\n` +
      `Variants rejected (schema mismatch): ${variantsRejected}\n` +
      `Trim-price success rate: ${trimsWithResultAndPrice}/${trimsWithResultTotal} (${successRate}%) — vs. ~17% baseline from the un-focused pass\n`
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
