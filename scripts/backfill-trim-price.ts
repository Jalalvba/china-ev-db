// Batch EXPORT-PROMPT generator for the trim_price backfill. As of 2026-09-21 this
// script no longer calls any AI/search provider directly (see CLAUDE.md's "no
// automated API calls anywhere in the app" entry — this was the last script still
// carrying the "backfill/QA tooling" exception, and that exception has been
// overturned with no carve-outs left) — it finds every Model with at least one
// Powertrain record missing trim_price_min and writes one manual-import export
// prompt per model to a single batch file under raw-data/, reusing the exact same
// buildExportDocument/buildCombinedExportText functions as the per-model "Export for
// Kimi/DeepSeek" button, scripts/tech-spec-agent.ts, and
// scripts/fill-missing-mandatory-fields.ts, so there is exactly one prompt
// implementation, not several that can drift. A price-focus instruction block is
// appended to each prompt (mirroring what researchModel()'s priceFocus:true used to
// inject server-side) asking specifically for trim_price_min/max with extra
// "<trim name> 价格" search guidance, since most of this DB's trims already have
// other specs filled and only need this one field chased.
//
// This script NEVER writes to MongoDB and never calls lib/aiProvider.ts or
// lib/webSearch.ts. Paste each prompt into an external AI chat (Kimi/Gemini/
// DeepSeek), then paste its JSON response into the target model's "Manual research
// import" panel (or POST to /api/models/[id]/manual-import/validate) to validate and
// apply — same reviewed round trip as every other manual import in this project.
//
// Usage:
//   npm run backfill-trim-price                (full run)
//   npm run backfill-trim-price -- --limit 3   (only the first 3 models)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import type { IBrand } from "../types";
import type { PowertrainLean } from "../lib/techSpecResearch";
import { buildCombinedExportText, buildExportDocument, exportFileBase } from "../lib/manualResearchImport";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

interface CliOptions {
  limit?: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      options.limit = Number(args[++i]);
    }
  }
  return options;
}

interface TrimPricePowertrainLean extends PowertrainLean {
  trim_price_min?: number | null;
}

const PRICE_FOCUS_BLOCK = `\n\n---\n\nPRICE FOCUS: this model was selected specifically because one or more existing trims are missing trim_price_min (and usually trim_price_max/trim_price_currency too). Prioritize finding these over any other field — search "<brand> <model> <trim name> 价格" / "<trim name> 售价" specifically for each trim named above, not just a general spec page. Only report a price you can cite a real source for; leave it null rather than estimate.`;

async function run() {
  const { limit } = parseArgs();

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB.`);

  const allPowertrains = (await Powertrain.find(
    {},
    { model_id: 1, trim_name: 1, energy_type: 1, engine: 1, motor: 1, battery: 1, transmission: 1, performance: 1, thermal_management: 1, confidence: 1, unverified: 1, trim_price_min: 1 }
  ).lean()) as unknown as TrimPricePowertrainLean[];

  const powertrainsByModel = new Map<string, TrimPricePowertrainLean[]>();
  for (const pt of allPowertrains) {
    const key = String(pt.model_id);
    const list = powertrainsByModel.get(key);
    if (list) list.push(pt);
    else powertrainsByModel.set(key, [pt]);
  }

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

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/trim-price-batch-prompts-${timestamp}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const sections: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    const brand = m.brand_id as unknown as IBrand | null;
    const brandName = brand?.name_en ?? brand?.name ?? "Unknown";
    const progress = `[${i + 1}/${targets.length}]`;

    const powertrainDocs = powertrainsByModel.get(String(m._id)) ?? [];
    const exportDoc = buildExportDocument(
      m as unknown as Record<string, unknown> & { _id: unknown },
      brand as unknown as (IBrand & { _id: unknown }) | null,
      powertrainDocs as unknown as (PowertrainLean & Record<string, unknown>)[]
    );
    const combinedText = buildCombinedExportText(exportDoc) + PRICE_FOCUS_BLOCK;

    console.log(`${progress} ${brandName} ${m.name}: prompt built`);
    sections.push(
      `## ${brandName} ${m.name}\n\n- Model DB id: \`${String(m._id)}\`\n- File base (if exporting individually): \`${exportFileBase(m)}\`\n- Ask specifically for: trim_price_min / trim_price_max / trim_price_currency on every trim listed below — this model was selected because at least one existing trim is missing trim_price_min.\n- Paste the response back into this model's "Manual research import" panel, or POST to \`/api/models/${String(m._id)}/manual-import/validate\`.\n\n\`\`\`\n${combinedText}\n\`\`\`\n`
    );
  }

  fs.writeFileSync(
    outPath,
    `# Trim-price backfill export prompts — ${timestamp}\n\n${targets.length} model(s) have at least one Powertrain record missing trim_price_min (${trimsMissingPriceCount} trim(s) total). Generated by scripts/backfill-trim-price.ts. No AI/search provider was called — paste each prompt below into an external AI chat (Kimi/Gemini/DeepSeek), then paste its JSON response into the target model's manual-import panel to validate and apply.\n\n${sections.join(
      "\n---\n\n"
    )}`
  );

  console.log(`\nWrote ${targets.length} export prompt(s) to ${outPath}`);
  console.log(`This file was NOT written to MongoDB and no AI provider was called.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
