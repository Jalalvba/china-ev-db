// Removes Powertrain docs that violate the DB's scope (lib/powertrainScope.ts). DRY RUN BY DEFAULT.
//
// Same discipline as every other data fix: backup first, review before delete, preconditions asserted, verify after.
//   npm run cleanup-scope                      -> lists what WOULD be deleted (writes nothing)
//   npm run cleanup-scope -- --apply --ids a,b -> deletes EXACTLY those ids, and only if they are still out of scope AND
//                                                 the current out-of-scope set equals the reviewed set (so a stray added
//                                                 after review can't be deleted unseen).
// Uses the raw driver on purpose (bypasses the Powertrain schema hooks, which exist to block WRITES of such docs).

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import fs from "node:fs";
import { checkVariantScope } from "../lib/powertrainScope";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const idsArg = args[args.indexOf("--ids") + 1];
const fail = (m: string): never => { console.error("ABORT:", m); process.exit(1); };

async function main() {
  await mongoose.connect(MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const pts = db.collection("powertrains");
  const models = new Map((await db.collection("models").find({}, { projection: { name: 1 } }).toArray()).map((m) => [String(m._id), m.name as string]));

  const scan = async () => (await pts.find({}).toArray()).filter((p) => !checkVariantScope({ energy_type: p.energy_type, engine: p.engine ? { displacement_l: p.engine.displacement_l, confidence: p.engine.confidence } : undefined }).ok);
  const found = await scan();
  console.log(`${apply ? "APPLY" : "DRY RUN"} — out-of-scope Powertrain docs: ${found.length}`);
  for (const p of found) console.log(`  ${String(p._id)} | ${models.get(String(p.model_id)) ?? "?"} | "${p.trim_name}" | ${p.energy_type} ${p.engine?.displacement_l ?? "—"}L | created ${new Date(p.createdAt).toISOString()}`);
  const perModel = (arr: Record<string, unknown>[]) => arr.reduce<Record<string, number>>((a, p) => ((a[models.get(String(p.model_id)) ?? "?"] = (a[models.get(String(p.model_id)) ?? "?"] ?? 0) + 1), a), {});
  console.log("by model:", JSON.stringify(perModel(found)));

  if (!apply) { console.log("\nNothing written. To delete after review: npm run cleanup-scope -- --apply --ids <comma-separated ids above>"); await mongoose.disconnect(); return; }

  // ---- preconditions
  if (!idsArg || idsArg.startsWith("--")) fail("--apply requires --ids <the reviewed ids>");
  const reviewed = new Set(idsArg.split(",").map((s) => s.trim()).filter(Boolean));
  const current = new Set(found.map((p) => String(p._id)));
  const unseen = [...current].filter((i) => !reviewed.has(i)), stale = [...reviewed].filter((i) => !current.has(i));
  if (unseen.length) fail(`out-of-scope docs exist that were NOT in the reviewed list: ${unseen.join(", ")} — re-run the dry run and review them first`);
  if (stale.length) fail(`reviewed ids that are no longer out of scope (or don't exist): ${stale.join(", ")}`);

  const before = { total: await pts.countDocuments(), modelsWithTrims: perModel(await pts.find({ model_id: { $in: found.map((p) => p.model_id) } }).toArray()) };
  const file = `backups/scope_cleanup_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`;
  fs.writeFileSync(file, JSON.stringify({ note: "Powertrain docs deleted by scripts/cleanup-out-of-scope-trims.ts (out of PHEV/<=1.5L scope)", deleted: found }, null, 1));
  console.log(`\nbackup: ${file} (${found.length} docs)`);

  const r = await pts.deleteMany({ _id: { $in: found.map((p) => p._id) } });
  console.log(`deleted: ${r.deletedCount}`);
  if (r.deletedCount !== found.length) fail("deleted count != reviewed count");

  // ---- verify
  const after = await scan();
  const total = await pts.countDocuments();
  console.log(`before total ${before.total} -> after ${total} | out-of-scope remaining: ${after.length}`);
  console.log("trims per affected model, before (incl. strays):", JSON.stringify(before.modelsWithTrims), "| after:", JSON.stringify(perModel(await pts.find({ model_id: { $in: found.map((p) => p.model_id) } }).toArray())));
  if (after.length !== 0 || total !== before.total - found.length) fail("post-conditions failed");
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
