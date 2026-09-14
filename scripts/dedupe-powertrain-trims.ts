// Finds powertrains within the same model that share the exact same
// trim_name string (verbatim copy-paste duplicates), and keeps only one
// per (model_id, trim_name) group. Deliberately does NOT dedupe by spec
// fingerprint alone — distinct real trims (different transmissions, seat
// counts, or equipment levels) often share identical engine/motor/battery
// numbers and must not be collapsed.
//
// Usage:
//   npx tsx scripts/dedupe-powertrain-trims.ts           (dry run — prints groups, deletes nothing)
//   npx tsx scripts/dedupe-powertrain-trims.ts --apply    (deletes the non-kept duplicates)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import Powertrain from "../models/Powertrain";
import Model from "../models/Model";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const APPLY = process.argv.includes("--apply");

function fingerprint(pt: Record<string, unknown>): string {
  return String(pt.trim_name).trim();
}

function countPopulatedFields(pt: Record<string, unknown>): number {
  let n = 0;
  for (const block of ["engine", "motor", "battery", "transmission", "performance"]) {
    const val = pt[block] as Record<string, unknown> | undefined;
    if (!val) continue;
    for (const v of Object.values(val)) {
      if (v !== null && v !== undefined) n++;
    }
  }
  return n;
}

function pickCanonical(group: Record<string, unknown>[]): Record<string, unknown> {
  return [...group].sort((a, b) => {
    const aFields = countPopulatedFields(a);
    const bFields = countPopulatedFields(b);
    if (aFields !== bFields) return bFields - aFields;

    // Older doc (smaller ObjectId) wins ties.
    return String(a._id).localeCompare(String(b._id));
  })[0];
}

async function run() {
  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Running dedupe scan (${APPLY ? "APPLY" : "DRY RUN"})...\n`);

  const docs = await Powertrain.collection.find({}).toArray();
  const byModel = new Map<string, Record<string, unknown>[]>();
  for (const d of docs) {
    const key = String(d.model_id);
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key)!.push(d as unknown as Record<string, unknown>);
  }

  let groupsFound = 0;
  let toDelete: mongoose.Types.ObjectId[] = [];

  for (const [modelId, pts] of byModel) {
    const byFingerprint = new Map<string, Record<string, unknown>[]>();
    for (const pt of pts) {
      const fp = fingerprint(pt);
      if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
      byFingerprint.get(fp)!.push(pt);
    }

    for (const group of byFingerprint.values()) {
      if (group.length < 2) continue;
      groupsFound++;
      const model = await Model.collection.findOne({ _id: new mongoose.Types.ObjectId(modelId) });
      const canonical = pickCanonical(group);
      const dropped = group.filter((g) => g !== canonical);

      console.log(`--- ${model?.name ?? modelId} ---`);
      console.log(`  keep:   "${canonical.trim_name}" (${canonical._id})`);
      for (const d of dropped) {
        console.log(`  delete: "${d.trim_name}" (${d._id})`);
        toDelete.push(d._id as mongoose.Types.ObjectId);
      }
    }
  }

  console.log(`\n${groupsFound} duplicate group(s) found, ${toDelete.length} powertrain(s) ${APPLY ? "deleted" : "would be deleted"}.`);

  if (APPLY && toDelete.length > 0) {
    const res = await Powertrain.collection.deleteMany({ _id: { $in: toDelete } });
    console.log(`Deleted ${res.deletedCount} documents.`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
