// Mandatory-field backfill: finds every Model whose Powertrain record(s) are
// missing one of a small, explicitly-named set of "mandatory" canonical
// fields (engine.displacement_l, engine.torque_nm, motor.torque_nm — see
// MANDATORY note below), researches it via the direct-provider AI stack (DeepSeek by default) +
// grounding + validation + confidence-gate pipeline (lib/techSpecResearch.ts),
// and writes the result straight to MongoDB via the existing
// lib/applySpecUpdates.ts (with its write-verification check) — one model at
// a time, strictly sequential: model N's write must be confirmed before
// model N+1 is even researched. No batching, no parallel work, no JSON
// review file.
//
// This is deliberately different from scripts/tech-spec-agent.ts, which
// writes a JSON file for manual review before any DB write. That review step
// is skipped here on purpose: this script only targets records that already
// exist and have already been reviewed once — it is filling a small,
// specific gap (a handful of mandatory numeric fields), not populating a
// brand-new record from scratch. The full researchModel() pipeline (schema
// validation + zero-citation "force unconfirmed" gate) still runs on every
// result, so a schema-mismatched or unconfirmed response still can't produce
// silently-wrong data — it's rejected/flagged, not skipped past.
//
// types/canonicalPowertrain.ts does NOT mark any field below the top level
// (trim_name/energy_type) as TS-required — everything in engine/motor/
// battery/etc. is optional. So "mandatory" here is this script's own
// explicit definition (confirmed with the user), not something read off the
// type file's own required markers:
//   - engine.displacement_l          (when energy_type !== "BEV")
//   - engine.torque_nm               (when energy_type !== "BEV")
//   - motor.torque_nm                (when energy_type !== "ICE")
//   - thermal_management (the block) (when energy_type !== "ICE")
// energy_type === undefined (older records) is treated conservatively: all
// checks apply, same fallback lib/techSpecResearch.ts's describeTrimGaps()
// already uses for that case.
//
// thermal_management was added after the first mandatory-field run (schema
// migration, see AGENTS.md-adjacent conversation) — every pre-existing
// Powertrain record, including ones this script already backfilled for
// displacement/torque, is missing it and will be picked up by a second run.
//
// Usage:
//   npm run fill-missing-mandatory-fields -- --limit 3   (test batch)
//   npm run fill-missing-mandatory-fields                (full unattended run)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
// Side-effect import only: registers the "Brand" model so ModelSchema.find().populate("brand_id")
// below can resolve it — see the identical comment in scripts/tech-spec-agent.ts.
import "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import type { IBrand } from "../types";
import { getDefaultModel, DEFAULT_DELAY_MS, ModelNotFoundError, SearchProviderError, sleep, researchModel, type PowertrainLean } from "../lib/techSpecResearch";
import { applySpecUpdates } from "../lib/applySpecUpdates";
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

/** True if this one Powertrain record is missing any of the explicitly-mandatory fields, gated by energy_type applicability the same way lib/techSpecResearch.ts's describeTrimGaps() is. */
function missingMandatoryField(pt: PowertrainLean): boolean {
  const energyType = pt.energy_type;
  const engineApplicable = energyType === undefined ? true : energyType !== "BEV";
  const motorApplicable = energyType === undefined ? true : energyType !== "ICE";
  const thermalManagementApplicable = energyType === undefined ? true : energyType !== "ICE";

  if (engineApplicable) {
    const engine = pt.engine as Record<string, unknown> | undefined;
    if (!engine) return true;
    if (engine.displacement_l == null) return true;
    if (engine.torque_nm == null) return true;
  }
  if (motorApplicable) {
    const motor = pt.motor as Record<string, unknown> | undefined;
    if (!motor) return true;
    if (motor.torque_nm == null) return true;
  }
  if (thermalManagementApplicable) {
    if (!pt.thermal_management) return true;
  }
  return false;
}

async function run() {
  const { limit, model } = parseArgs();
  const delayMs = Number(process.env.AI_AGENT_DELAY_MS ?? DEFAULT_DELAY_MS);

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Using model: ${model}, delay: ${delayMs}ms between models.`);

  const allPowertrains = (await Powertrain.find(
    {},
    { model_id: 1, trim_name: 1, energy_type: 1, engine: 1, motor: 1, thermal_management: 1 }
  ).lean()) as unknown as PowertrainLean[];

  const modelIdsNeedingBackfill = new Set<string>();
  for (const pt of allPowertrains) {
    if (missingMandatoryField(pt)) modelIdsNeedingBackfill.add(String(pt.model_id));
  }

  let targetModelIds = Array.from(modelIdsNeedingBackfill);
  if (limit) targetModelIds = targetModelIds.slice(0, limit);

  const targets = await ModelSchema.find({ _id: { $in: targetModelIds } })
    .populate("brand_id", "name name_cn name_en parent_group relationship_type stake_percentage tech_partner status")
    .sort({ name: 1 })
    .lean();

  console.log(
    `${modelIdsNeedingBackfill.size} model(s) have a Powertrain record missing a mandatory field (engine.displacement_l / engine.torque_nm / motor.torque_nm / thermal_management)${
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
      // --- a. research this ONE model (existing pipeline, unchanged) ---
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
        const confidence = (v.variant.confidence as string) ?? "?";
        console.log(
          `${progress} ${brandName} ${modelName} — trim "${trimName}": researched (confidence=${confidence}, grounding=${
            result.hasGrounding ? `yes, ${result.sourceUrls.length} source(s)` : "NO — forced unconfirmed"
          })`
        );
      }

      // --- b/c. write THIS model's results to MongoDB immediately, then
      // verify, before moving to the next model. applySpecUpdates() already
      // re-fetches and field-verifies every write (see lib/applySpecUpdates.ts). ---
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
        // Shouldn't happen (validVariants.length > 0 implies at least one
        // update was attempted) but log explicitly rather than silently
        // treating "0 applied, 0 errors" as success.
        console.log(`${progress} ${brandName} ${modelName}: no variants applied and no errors reported — treating as failed.`);
        modelsWriteFailed++;
      }
    } catch (err) {
      if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) {
        // Same model name would 404 for every remaining model, and a search-
        // provider failure (rate limit, exhausted credit) won't clear itself
        // mid-run either — both are fatal for the whole run, not a per-model
        // issue, so abort loudly here instead of grinding through the rest
        // of the batch producing zero-grounding "forced unconfirmed" results.
        const remaining = targets.length - i;
        const reason =
          err instanceof SearchProviderError
            ? `Brave Search credit exhausted (HTTP ${err.status}) — ${i} model(s) processed successfully before failure, ${remaining} model(s) remain unprocessed.`
            : err.message;
        console.error(`\n${progress} ${brandName} ${modelName}: FATAL — ${reason}`);
        console.error(
          `\n=== PARTIAL SUMMARY (aborted early) ===\n` +
            `Models processed before abort: ${i} / ${targets.length}\n` +
            `  - writes confirmed:      ${modelsWriteSucceeded}\n` +
            `  - writes failed:         ${modelsWriteFailed}\n` +
            `  - research not found:    ${modelsResearchNotFound}\n` +
            `  - research errored:      ${modelsResearchError}\n` +
            `Variants applied:  ${variantsApplied}\n` +
            `Variants rejected: ${variantsRejected}\n`
        );
        await mongoose.disconnect();
        process.exit(1);
      }
      console.error(`${progress} ${brandName} ${modelName}: unexpected error — ${(err as Error).message} — skipping.`);
      modelsResearchError++;
    }

    if (i < targets.length - 1) await sleep(delayMs);
  }

  console.log(
    `\n=== SUMMARY ===\n` +
      `Models processed:     ${modelsProcessed}\n` +
      `  - writes confirmed: ${modelsWriteSucceeded}\n` +
      `  - writes failed:    ${modelsWriteFailed}\n` +
      `  - research not found: ${modelsResearchNotFound}\n` +
      `  - research errored:   ${modelsResearchError}\n` +
      `Variants applied:  ${variantsApplied}\n` +
      `Variants rejected (schema mismatch): ${variantsRejected}\n`
  );

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
