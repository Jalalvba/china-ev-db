// Exports one Model + its Powertrain variants as clean JSON for the manual
// Kimi/DeepSeek round-trip workflow (see lib/manualResearchImport.ts) — this
// script NEVER calls an external LLM API and NEVER writes to MongoDB, it
// only produces a JSON export + a companion prompt file for you to paste
// into Kimi/DeepSeek's own chat UI by hand. The response you get back is fed
// to a separate import step (app/api/models/[id]/manual-import/*), never
// straight back into this script.
//
// Usage:
//   npm run export-manual-research -- --id 6aa5d7be8bb7411b4ed17669
//   npm run export-manual-research -- --name "Soueast S06 DM"
//   npm run export-manual-research -- --brand Soueast --model "S06 DM"

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import fs from "fs";
import path from "path";
import mongoose, { Types } from "mongoose";
import "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import type { PowertrainLean } from "../lib/techSpecResearch";
import { buildCombinedExportText, buildExportDocument, exportFileBase } from "../lib/manualResearchImport";
import type { IBrand } from "../types";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function findModel() {
  const id = argValue("--id");
  const name = argValue("--name");
  const brand = argValue("--brand");
  const modelName = argValue("--model");

  if (id) {
    if (!Types.ObjectId.isValid(id)) throw new Error(`--id "${id}" is not a valid ObjectId.`);
    return ModelSchema.findById(id).populate("brand_id", "name name_cn").lean();
  }
  if (name) {
    const matches = await ModelSchema.find({
      $or: [{ name }, { name_en: name }, { name_cn: name }],
    })
      .populate("brand_id", "name name_cn")
      .lean();
    if (matches.length === 0) throw new Error(`No model found matching name "${name}".`);
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous: ${matches.length} models match name "${name}" — use --id instead. Matches: ${matches
          .map((m) => `${String(m._id)} (${m.name_en ?? m.name})`)
          .join(", ")}`
      );
    }
    return matches[0];
  }
  if (brand && modelName) {
    const brandDoc = await mongoose.connection.collection("brands").findOne({
      $or: [{ name: brand }, { name_en: brand }, { name_cn: brand }],
    });
    if (!brandDoc) throw new Error(`No brand found matching "${brand}".`);
    const matches = await ModelSchema.find({
      brand_id: brandDoc._id,
      $or: [{ name: modelName }, { name_en: modelName }, { name_cn: modelName }],
    })
      .populate("brand_id", "name name_cn")
      .lean();
    if (matches.length === 0) throw new Error(`No model found matching "${modelName}" under brand "${brand}".`);
    if (matches.length > 1) throw new Error(`Ambiguous: multiple models match "${modelName}" under brand "${brand}" — use --id instead.`);
    return matches[0];
  }
  throw new Error("Provide --id <modelId>, or --name <exact model name>, or --brand <brand> --model <model name>.");
}

async function main() {
  await mongoose.connect(MONGODB_URI!);

  const modelDoc = await findModel();
  if (!modelDoc) throw new Error("Model not found.");

  const brand = modelDoc.brand_id as unknown as (IBrand & { _id: unknown }) | null;
  const powertrainDocs = (await Powertrain.find({ model_id: modelDoc._id }).lean()) as unknown as (PowertrainLean & Record<string, unknown>)[];

  const exportDoc = buildExportDocument(modelDoc as unknown as Record<string, unknown> & { _id: unknown }, brand, powertrainDocs);
  const combinedText = buildCombinedExportText(exportDoc);

  const dir = path.resolve("raw-data");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${exportFileBase(modelDoc)}.prompt.txt`);
  fs.writeFileSync(filePath, combinedText + "\n");

  console.log(`Exported: ${filePath}`);
  console.log(`\nPaste this file's contents into Kimi/DeepSeek, then save its JSON response and import it via:`);
  console.log(`  the "Manual research import" section on this model's page in the app (also has an "Export for Kimi/DeepSeek" button — no CLI needed), or`);
  console.log(`  POST the response JSON to /api/models/${String(modelDoc._id)}/manual-import/validate first to preview the diff.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
