// Batch EXPORT-PROMPT generator for the mandatory-field backfill. As of 2026-09-21
// this script no longer calls any AI/search provider directly (see CLAUDE.md's
// "no automated API calls anywhere in the app" entry) — it finds every Model whose
// Powertrain record(s) are missing one of a small, explicitly-named set of
// "mandatory" canonical fields (engine.displacement_l, engine.torque_nm,
// motor.torque_nm, thermal_management — see MANDATORY note below) and writes one
// manual-import export prompt per model to a single batch file under raw-data/,
// reusing the exact same buildExportDocument/buildCombinedExportText functions as
// the per-model "Export for Kimi/DeepSeek" button and scripts/tech-spec-agent.ts,
// so there is exactly one prompt implementation, not several that can drift.
//
// This script NEVER writes to MongoDB and never calls lib/aiProvider.ts or
// lib/webSearch.ts. Paste each prompt into an external AI chat (Kimi/Gemini/
// DeepSeek), then paste its JSON response into the target model's "Manual research
// import" panel (or POST to /api/models/[id]/manual-import/validate) to validate and
// apply — same reviewed round trip as every other manual import in this project.
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
// Usage:
//   npm run fill-missing-mandatory-fields                (full run)
//   npm run fill-missing-mandatory-fields -- --limit 3   (only the first 3 models)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
// Side-effect import only: registers the "Brand" model so ModelSchema.find().populate("brand_id")
// below can resolve it — see the identical comment in scripts/tech-spec-agent.ts.
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
  const { limit } = parseArgs();

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB.`);

  const allPowertrains = (await Powertrain.find(
    {},
    { model_id: 1, trim_name: 1, energy_type: 1, engine: 1, motor: 1, battery: 1, transmission: 1, performance: 1, thermal_management: 1, confidence: 1, unverified: 1 }
  ).lean()) as unknown as PowertrainLean[];

  const powertrainsByModel = new Map<string, PowertrainLean[]>();
  for (const pt of allPowertrains) {
    const key = String(pt.model_id);
    const list = powertrainsByModel.get(key);
    if (list) list.push(pt);
    else powertrainsByModel.set(key, [pt]);
  }

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

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/mandatory-fields-batch-prompts-${timestamp}.md`);
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
      `## ${brandName} ${m.name}\n\n- Model DB id: \`${String(m._id)}\`\n- File base (if exporting individually): \`${exportFileBase(m)}\`\n- Ask specifically for: engine.displacement_l, engine.torque_nm, motor.torque_nm, thermal_management (whichever apply per energy_type) — this model was selected because at least one of these mandatory fields is missing on an existing trim.\n- Paste the response back into this model's "Manual research import" panel, or POST to \`/api/models/${String(m._id)}/manual-import/validate\`.\n\n\`\`\`\n${combinedText}\n\`\`\`\n`
    );
  }

  fs.writeFileSync(
    outPath,
    `# Mandatory-field backfill export prompts — ${timestamp}\n\n${targets.length} model(s) have a Powertrain record missing a mandatory field (engine.displacement_l / engine.torque_nm / motor.torque_nm / thermal_management). Generated by scripts/fill-missing-mandatory-fields.ts. No AI/search provider was called — paste each prompt below into an external AI chat (Kimi/Gemini/DeepSeek), then paste its JSON response into the target model's manual-import panel to validate and apply.\n\n${sections.join(
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
