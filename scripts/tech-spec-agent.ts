// Batch EXPORT-PROMPT generator for canonical-powertrain-v2 spec research. As of
// 2026-09-21 this script no longer calls any AI/search provider directly (see
// CLAUDE.md's "automated research calls removed" entries) — it finds every Model in
// our DB with zero Powertrain records, or with existing Powertrain records missing
// engine/motor/battery/transmission/performance data (or still marked
// "unconfirmed"), and writes one manual-import export prompt per model to a single
// batch file under raw-data/, reusing the exact same buildExportDocument/
// buildCombinedExportText functions as the per-model "Export for Kimi/DeepSeek"
// button (app/ExportForManualResearchButton.tsx -> app/api/models/[id]/manual-export)
// and the single-model CLI (scripts/export-model-for-manual-research.ts), so there is
// exactly one prompt implementation, not several that can drift.
//
// This script NEVER writes to MongoDB and never calls lib/aiProvider.ts or
// lib/webSearch.ts. Paste each prompt into an external AI chat (Kimi/Gemini/
// DeepSeek), then paste its JSON response into the target model's "Manual research
// import" panel (or POST to /api/models/[id]/manual-import/validate) to validate and
// apply — same reviewed round trip as every other manual import in this project.
//
// Usage:
//   npm run tech-spec-agent                  (full run over every incomplete model)
//   npm run tech-spec-agent -- --limit 5     (only the first 5, for a quick test)
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
import { needsResearch, type PowertrainLean } from "../lib/techSpecResearch";
import { buildCombinedExportText, buildExportDocument, exportFileBase } from "../lib/manualResearchImport";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

interface CliOptions {
  limit?: number;
  /** Restrict targets to these Brand _ids (comma-separated). Unset = every brand, same as before. */
  brandIds?: string[];
  /** Only models with ZERO Powertrain docs — skips the needsResearch() "has some data but it's incomplete/unconfirmed" case entirely, rather than also re-researching partially-populated models. */
  zeroOnly?: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      options.limit = Number(args[++i]);
    } else if (args[i] === "--brand-ids") {
      options.brandIds = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--zero-only") {
      options.zeroOnly = true;
    }
  }
  return options;
}

async function run() {
  const { limit, brandIds, zeroOnly } = parseArgs();

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB.`);

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
  const outPath = path.resolve(`raw-data/tech-spec-batch-prompts-${timestamp}.md`);
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
    const combinedText = buildCombinedExportText(exportDoc);

    console.log(`${progress} ${brandName} ${m.name}: prompt built`);
    sections.push(
      `## ${brandName} ${m.name}\n\n- Model DB id: \`${String(m._id)}\`\n- File base (if exporting individually): \`${exportFileBase(m)}\`\n- Paste the response back into this model's "Manual research import" panel, or POST to \`/api/models/${String(m._id)}/manual-import/validate\`.\n\n\`\`\`\n${combinedText}\n\`\`\`\n`
    );
  }

  fs.writeFileSync(
    outPath,
    `# Tech-spec export prompts — ${timestamp}\n\n${targets.length} model(s) need research (zero or incomplete powertrain data). Generated by scripts/tech-spec-agent.ts. No AI/search provider was called — paste each prompt below into an external AI chat (Kimi/Gemini/DeepSeek), then paste its JSON response into the target model's manual-import panel to validate and apply.\n\n${sections.join(
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
