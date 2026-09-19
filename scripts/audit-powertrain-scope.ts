// READ-ONLY audit: lists every Powertrain doc that violates the DB's scope (lib/powertrainScope.ts — PHEV only,
// confirmed engine <= 1.5 L), and for each one names the research-log entry that created it
// (raw-data/ui-tech-spec-log.jsonl). Exit code 1 when anything is found, so it can be used as a check.
//
// Run it before any scope cleanup (to get the review list), after one (must report 0), and periodically — the
// write-side guard should make findings impossible, this is the independent check that it does.
//
// Usage:  npm run audit-scope

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import fs from "node:fs";
import { checkVariantScope } from "../lib/powertrainScope";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");

interface LogRow { timestamp: string; kind: string; source?: string; modelDbId?: string; powertrainResults?: { status?: string; trimName?: string; variant?: { trim_name?: string } }[] }

async function main() {
  await mongoose.connect(MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const pts = await db.collection("powertrains").find({}).toArray();
  const models = new Map((await db.collection("models").find({}, { projection: { name: 1, brand_id: 1 } }).toArray()).map((m) => [String(m._id), m]));
  const brands = new Map((await db.collection("brands").find({}, { projection: { name: 1 } }).toArray()).map((b) => [String(b._id), b.name as string]));
  const log: LogRow[] = fs.existsSync("raw-data/ui-tech-spec-log.jsonl") ? fs.readFileSync("raw-data/ui-tech-spec-log.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

  const findings: { p: Record<string, any>; reasons: string[]; flags: string[] }[] = [];
  const energy: Record<string, number> = {};
  let rangeExtenderPhev = 0;
  for (const p of pts) {
    energy[p.energy_type] = (energy[p.energy_type] ?? 0) + 1;
    if (p.energy_type === "PHEV" && p.engine?.is_range_extender) rangeExtenderPhev++;
    const r = checkVariantScope({ energy_type: p.energy_type, engine: p.engine ? { displacement_l: p.engine.displacement_l, confidence: p.engine.confidence } : undefined });
    if (!r.ok || r.flags.length) findings.push({ p, reasons: r.reasons, flags: r.flags });
  }
  const hard = findings.filter((f) => f.reasons.length);

  console.log(`Powertrain docs: ${pts.length} across ${models.size} models | by energy_type: ${JSON.stringify(energy)}`);
  console.log(`Out of scope (hard): ${hard.length} doc(s) on ${new Set(hard.map((f) => String(f.p.model_id))).size} model(s) | flagged only (unconfirmed >1.5L): ${findings.length - hard.length}`);
  for (const f of findings.sort((a, b) => String(a.p.createdAt).localeCompare(String(b.p.createdAt)))) {
    const m = models.get(String(f.p.model_id));
    const created = new Date(f.p.createdAt).getTime();
    // The log line that created it: same model, an apply/manual-apply within a few seconds of the doc's createdAt.
    const src = log.find((l) => l.modelDbId === String(f.p.model_id) && /apply/.test(l.kind) && Math.abs(new Date(l.timestamp).getTime() - created) < 5000);
    console.log(`\n  ${f.reasons.length ? "OUT OF SCOPE" : "flag only   "} | ${brands.get(String(m?.brand_id)) ?? "?"} ${m?.name ?? "?(no model!)"} | "${f.p.trim_name}" | id ${f.p._id}`);
    console.log(`      energy_type=${f.p.energy_type} hybrid_type=${f.p.hybrid_type} displacement=${f.p.engine?.displacement_l ?? "—"}L (${f.p.engine?.confidence ?? "—"}) | created ${new Date(f.p.createdAt).toISOString()}`);
    console.log(`      ${[...f.reasons, ...f.flags].join("; ")}`);
    console.log(`      created by: ${src ? `${src.kind} / ${src.source ?? "ai-update-specs"} @ ${src.timestamp}` : "no matching log entry (seed/import script or older)"}`);
  }
  console.log(`\n(info) PHEV trims carrying engine.is_range_extender=true: ${rangeExtenderPhev} — known open review item, deliberately not treated as out of scope.`);
  await mongoose.disconnect();
  if (hard.length > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
