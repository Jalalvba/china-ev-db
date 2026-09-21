// Batch EXPORT-PROMPT generator for known-issues (China + Global) and technical-bulletins
// research on a chosen SET of models. As of 2026-09-21 this script no longer calls any
// AI/search provider directly (see CLAUDE.md's "automated research calls removed" entries) —
// it writes one `research-categories-v1` export prompt per model to a single batch file under
// raw-data/, for a human to paste into an external AI chat (Kimi/Gemini/DeepSeek) and then
// run back through the existing manual-categories importer
// (app/api/models/[id]/manual-categories/{validate,apply}, `ManualCategoryImporter`) exactly
// like a single-model export. NEVER writes to MongoDB and never calls lib/aiProvider.ts or
// lib/webSearch.ts.
//
// Recalls are deliberately excluded from the generated prompts, same as before (automated
// search couldn't reach recall notices reliably; the per-model manual export button already
// covers recalls on its own if wanted).
//
// The leak-detection/verification machinery below (leakFlags, --retro) is preserved AS-IS: it
// operates on review files already sitting in raw-data/ from before this change, or on
// whatever the human pastes back through the manual importer — it never itself calls an AI
// provider, so it stays in scope.
//
// Usage:
//   npx tsx scripts/research-issues-bulletins-batch.ts --label batch1 --models "Song Ultra DM-i,Haval Raptor"
//   add --dry to only print the plan (no file written)
//   --retro <file1,file2>  (unchanged: re-checks items already in earlier review files, no LLM, no writes)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import fs from "node:fs";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import { powertrainTextMismatch } from "../lib/categoryValidators";
import { getModelPowertrain, describePowertrain } from "../lib/modelPowertrain";
import { verifyItemSources } from "../lib/sourceVerification";
import type { SourceCheck } from "../lib/sourceVerification";
import { buildCategoryExportText } from "../lib/researchCategoriesImport";

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const label = arg("--label") ?? "batch";
const names = (arg("--models") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const dry = args.includes("--dry");
if (names.length === 0 && !args.includes("--retro")) throw new Error('Pass --models "Name A,Name B" (exact Model.name values), or --retro file1,file2.');
if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI");

type Kept = Record<string, unknown>;
interface Flag { level: "HARD" | "SOFT"; reason: string; item: string }
interface PassResult {
  pass: "china_issues" | "global_issues" | "bulletins";
  status: string;
  error?: string;
  sources: number;
  grounded: boolean;
  kept: Kept[];
  rejected: string[];
  warnings: string[];
  flags: Flag[];
  /** Items removed from `kept` because a HARD leak flag fired (--drop-hard mode); kept here for review. */
  auto_dropped_hard?: { reason: string; item: Kept }[];
  /** Distinct cited URLs by verification status (lib/sourceVerification.ts). */
  verification?: Record<string, number>;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  void Brand;
  const all = (await ModelSchema.find({}).populate("brand_id", "name name_en name_cn segment production_status").lean()) as unknown as {
    _id: mongoose.Types.ObjectId; name: string; name_cn?: string; segment: string; production_status: string; brand_id: { name: string; name_en?: string; name_cn?: string };
  }[];
  const picked = names.map((n) => { const m = all.filter((x) => x.name === n); if (m.length !== 1) throw new Error(`Model "${n}" matched ${m.length} docs`); return m[0]; });

  console.log(`[${label}] ${picked.length} models: ${names.join(" | ")}${dry ? "  (DRY RUN)" : ""}`);
  if (dry) { await mongoose.disconnect(); return; }

  const prompts = picked.map((m) => {
    const ctx = {
      brandName: m.brand_id?.name_en ?? m.brand_id?.name ?? "",
      brandNameCn: m.brand_id?.name_cn,
      modelName: m.name,
      modelNameCn: m.name_cn,
      segment: m.segment,
      productionStatus: m.production_status,
      modelId: String(m._id),
    };
    return { model: m.name, brand: ctx.brandName, id: String(m._id), prompt: buildCategoryExportText(ctx, ["known_issues", "technical_bulletins"]) };
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = `raw-data/issues-bulletins-prompts-${label}-${timestamp}.md`;
  const body = prompts
    .map((p) => `## ${p.brand} ${p.model}\n\n- Model DB id: \`${p.id}\`\n- Paste the response back into that model's known-issues/bulletins manual importer.\n\n\`\`\`\n${p.prompt}\n\`\`\`\n`)
    .join("\n---\n\n");
  fs.writeFileSync(
    outFile,
    `# Known-issues + bulletins export prompts — ${label} (${timestamp})\n\nGenerated by scripts/research-issues-bulletins-batch.ts. No AI/search provider was called — paste each prompt below into an external AI chat (Kimi/Gemini/DeepSeek), then paste its JSON response into the target model's manual-categories importer (\`ManualCategoryImporter\`) to validate and apply.\n\n${body}`
  );
  console.log(`\nWrote ${prompts.length} export prompt(s) to ${outFile}.`);
  await mongoose.disconnect();
}

// ---------------- --retro: re-check items ALREADY sitting in earlier review files (no LLM, no writes) ----------------
// Applies the guards that did not exist when those files were produced: the deterministic powertrain text check and
// source verification (fetches every cited page). Answers "how much of what was already kept must be discarded/downgraded".
async function retro(files: string[]) {
  await mongoose.connect(process.env.MONGODB_URI as string);
  void Brand;
  const cache = new Map<string, Promise<SourceCheck>>();
  const tally: Record<string, number> = { kept_total: 0, was_confirmed: 0, powertrain_text_mismatch: 0, dead_link_removed: 0, hub_or_unrelated_page_downgraded: 0, unverifiable_page: 0, verified: 0, no_url: 0, confirmed_lost: 0 };
  const rows: string[] = [];
  const all = (await ModelSchema.find({}).populate("brand_id", "name name_en").lean()) as unknown as { _id: mongoose.Types.ObjectId; name: string; name_cn?: string; brand_id: { name: string; name_en?: string } }[];
  for (const file of files) {
    const d = JSON.parse(fs.readFileSync(file, "utf8")) as { results: { model: string; id: string; passes: PassResult[] }[] };
    for (const r of d.results) {
      const doc = all.find((x) => String(x._id) === r.id);
      if (!doc) continue;
      const target = { brandName: doc.brand_id?.name_en ?? doc.brand_id?.name ?? "", modelName: doc.name, modelNameCn: doc.name_cn, powertrain: await getModelPowertrain(r.id) };
      for (const p of r.passes) {
        const items = p.kept.map((k) => JSON.parse(JSON.stringify(k)) as Kept);
        if (items.length === 0) continue;
        const ptBad = new Set<number>();
        items.forEach((it, i) => { if (powertrainTextMismatch(String(it.issue_description ?? ""), target.powertrain)) ptBad.add(i); });
        const rest = items.filter((_, i) => !ptBad.has(i));
        const wasConfirmed = items.filter((i) => i.confidence === "confirmed").length;
        const v = await verifyItemSources(rest, target, { cache });
        const statusOf = (it: Kept) => {
          const url = String(it.source_url ?? "").match(/https?:\/\/[^\s;]+/)?.[0];
          if (!url) return "no_url";
          return v.checks.find((c) => c.url === url)?.status ?? "no_url";
        };
        const removedSet = new Set(v.removed.map((x) => x.item));
        items.forEach((it, i) => {
          tally.kept_total++;
          if (p.kept[i].confidence === "confirmed") tally.was_confirmed++;
          let verdict: string;
          if (ptBad.has(i)) { verdict = "POWERTRAIN-MISMATCH (discard)"; tally.powertrain_text_mismatch++; }
          else if (removedSet.has(it)) { verdict = "DEAD LINK (discard)"; tally.dead_link_removed++; }
          else {
            const st = statusOf(it);
            if (st === "no_target_mention") { verdict = "page doesn't name the model (downgrade)"; tally.hub_or_unrelated_page_downgraded++; }
            else if (st === "unverifiable") { verdict = "page couldn't be verified"; tally.unverifiable_page++; }
            else if (st === "verified") { verdict = "verified"; tally.verified++; }
            else { verdict = "no url"; tally.no_url++; }
          }
          if (p.kept[i].confidence === "confirmed" && !ptBad.has(i) && !removedSet.has(it) && it.confidence !== "confirmed") tally.confirmed_lost++;
          rows.push(`${r.model} / ${p.pass} | ${verdict} | ${p.kept[i].confidence}${it.confidence !== p.kept[i].confidence ? ` -> ${it.confidence}` : ""} | ${String(it.issue_description).slice(0, 70)} | ${String(it.source_url ?? "").slice(0, 70)}`);
        });
        void wasConfirmed;
      }
    }
  }
  const out = `raw-data/retro-check-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`;
  fs.writeFileSync(out, JSON.stringify({ files, tally, rows, checks: [...(await Promise.all(cache.values()))] }, null, 1));
  console.log(rows.join("\n"));
  console.log("\nTALLY", JSON.stringify(tally, null, 1));
  console.log("retro file:", out);
  await mongoose.disconnect();
}
void describePowertrain;

if (args.includes("--retro")) retro((arg("--retro") ?? "").split(",").filter(Boolean)).catch((e) => { console.error(e); process.exit(1); });
else main().catch((e) => { console.error(e); process.exit(1); });

