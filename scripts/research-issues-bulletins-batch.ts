// Batch known-issues (China + Global) and technical-bulletins research for a chosen SET of models,
// designed to be run in small attended batches — NOT across all models unattended. READ-ONLY:
// nothing is written to MongoDB. Every result (kept items, filter rejections with reasons,
// warnings, leak flags) goes to a review file under raw-data/; applying is a separate, reviewed step.
//
// Why attended: the first global pass on Song Ultra DM-i padded 8 off-model items, and the
// exact-model filter then needed a three-valued generation check (see CLAUDE.md). This runner adds
// an INDEPENDENT leak check on everything the filter KEPT: prose like "related variant", or an item
// that names another model in the DB but never the target. A HARD flag stops the whole run
// immediately (exit code 2) so the pattern can't propagate through later models. Bulletins have no
// exact-model filter yet, so they are checked by this detector alone.
//
// Recalls are deliberately excluded (automated search can't reach recall notices).
//
// Usage:
//   npx tsx scripts/research-issues-bulletins-batch.ts --label batch1 --models "Song Ultra DM-i,Haval Raptor"
//   add --dry to only print the plan (no research calls); add --passes china_issues,bulletins to run a subset.

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import fs from "node:fs";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import { getDefaultModel, ModelNotFoundError, SearchProviderError, sleep } from "../lib/techSpecResearch";
import { researchIssues } from "../lib/issueResearch";
import { researchGlobalIssues } from "../lib/globalIssueResearch";
import { researchBulletins } from "../lib/bulletinResearch";
import { matchesTargetModel, OFF_MODEL_PROSE, tokenizeName, powertrainTextMismatch } from "../lib/categoryValidators";
import { getModelPowertrain, describePowertrain } from "../lib/modelPowertrain";
import { verifyItemSources } from "../lib/sourceVerification";
import type { SourceCheck } from "../lib/sourceVerification";
import type { TargetModel } from "../lib/categoryValidators";

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const label = arg("--label") ?? "batch";
const names = (arg("--models") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const dry = args.includes("--dry");
const dropHard = args.includes("--drop-hard");
// Optional: run only some passes (e.g. to re-run one that hit a transient error). Default: all three.
const onlyPasses = (arg("--passes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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

const summarizeChecks = (cs: SourceCheck[] | undefined) => cs && cs.reduce<Record<string, number>>((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});

/** True when `inner`'s name is a contiguous word sequence inside `outer`'s (e.g. "Tiggo 8" inside "Tiggo 8 Pro") — mentioning the shorter model is not evidence of a different model. */
function nameInside(inner: string, outer: string): boolean {
  const a = tokenizeName(inner), b = tokenizeName(outer);
  if (a.length === 0 || a.length > b.length) return false;
  for (let i = 0; i <= b.length - a.length; i++) if (a.every((t, j) => b[i + j] === t)) return true;
  return false;
}

const text = (it: Kept) => [it.issue_description, it.component_detail, it.source, it.source_url].filter((x) => typeof x === "string").join(" ");

function leakFlags(items: Kept[], target: TargetModel & { id: string }, others: (TargetModel & { id: string })[]): Flag[] {
  const flags: Flag[] = [];
  for (const it of items) {
    const t = text(it);
    const desc = String(it.issue_description ?? "").slice(0, 110);
    if (OFF_MODEL_PROSE.test(String(it.issue_description ?? ""))) { flags.push({ level: "HARD", reason: "kept item is framed as another/related model", item: desc }); continue; }
    const mentionsTarget = matchesTargetModel(t, target);
    const otherHits = others.filter((o) => o.id !== target.id && o.modelName.replace(/[^a-z0-9]/gi, "").length >= 4 && !nameInside(o.modelName, target.modelName) && matchesTargetModel(t, o)).map((o) => o.modelName);
    if (otherHits.length && !mentionsTarget) flags.push({ level: "HARD", reason: `names other model(s) [${otherHits.slice(0, 3).join(", ")}] but never the target`, item: desc });
    else if (otherHits.length) flags.push({ level: "SOFT", reason: `also mentions other model(s) [${otherHits.slice(0, 3).join(", ")}] (comparison?)`, item: desc });
  }
  return flags;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  void Brand;
  const all = (await ModelSchema.find({}).populate("brand_id", "name name_en name_cn").lean()) as unknown as {
    _id: mongoose.Types.ObjectId; name: string; name_cn?: string; generation?: string; year?: number; brand_id: { name: string; name_en?: string; name_cn?: string };
  }[];
  const asTarget = (m: (typeof all)[number]) => ({ id: String(m._id), brandName: m.brand_id?.name_en ?? m.brand_id?.name ?? "", modelName: m.name, modelNameCn: m.name_cn });
  const others = all.map(asTarget);
  const picked = names.map((n) => { const m = all.filter((x) => x.name === n); if (m.length !== 1) throw new Error(`Model "${n}" matched ${m.length} docs`); return m[0]; });

  console.log(`[${label}] ${picked.length} models: ${names.join(" | ")}${dry ? "  (DRY RUN)" : ""}`);
  if (dry) { await mongoose.disconnect(); return; }

  const ai = getDefaultModel();
  const results: { model: string; brand: string; id: string; passes: PassResult[] }[] = [];
  const outFile = `raw-data/issues-bulletins-${label}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`;
  const save = (extra: object = {}) => fs.writeFileSync(outFile, JSON.stringify({ label, readOnly: true, results, ...extra }, null, 1));
  let stopped: string | null = null;

  outer: for (const m of picked) {
    const target = asTarget(m);
    const powertrain = await getModelPowertrain(String(m._id));
    const input = { brandName: m.brand_id?.name_en ?? m.brand_id?.name ?? "", modelName: m.name, brandNameCn: m.brand_id?.name_cn, modelNameCn: m.name_cn, generation: m.generation, modelYear: m.year, powertrain };
    console.log(`   target powertrain: ${powertrain.description}`);
    const entry = { model: m.name, brand: input.brandName, id: String(m._id), passes: [] as PassResult[] };
    results.push(entry);
    console.log(`\n== ${input.brandName} ${m.name}`);

    const passes: [PassResult["pass"], () => Promise<{ status: string; errorMessage?: string; sourceUrls: string[]; hasGrounding: boolean; items?: Kept[]; known_issues?: Kept[]; dropped?: { index: number; errors: string[] }[]; warnings?: string[]; verification?: SourceCheck[] }>][] = [
      ["china_issues", () => researchIssues(ai, input) as never],
      ["global_issues", () => researchGlobalIssues(ai, input) as never],
      ["bulletins", () => researchBulletins(ai, input) as never],
    ];
    for (const [pass, run] of passes) {
      if (onlyPasses.length > 0 && !onlyPasses.includes(pass)) continue;
      let r: PassResult;
      try {
        const res = await run();
        const kept = (res.items ?? res.known_issues ?? []) as Kept[];
        r = { pass, status: res.status, error: res.errorMessage, sources: res.sourceUrls.length, grounded: res.hasGrounding, kept, rejected: (res.dropped ?? []).map((d) => d.errors.join("; ")), warnings: res.warnings ?? [], flags: leakFlags(kept, target, others), verification: summarizeChecks(res.verification) };
      } catch (err) {
        if (err instanceof SearchProviderError || err instanceof ModelNotFoundError) { stopped = `${(err as Error).name}: ${(err as Error).message} (during ${m.name} / ${pass})`; entry.passes.push({ pass, status: "aborted", error: stopped, sources: 0, grounded: false, kept: [], rejected: [], warnings: [], flags: [] }); break outer; }
        r = { pass, status: "error", error: (err as Error).message, sources: 0, grounded: false, kept: [], rejected: [], warnings: [], flags: [] };
      }
      entry.passes.push(r);
      const hard = r.flags.filter((f) => f.level === "HARD");
      if (dropHard && hard.length) {
        const dropped: { reason: string; item: Kept }[] = [];
        r.kept = r.kept.filter((it) => {
          const f = hard.find((h) => h.item === String(it.issue_description ?? "").slice(0, 110));
          if (f) dropped.push({ reason: f.reason, item: it });
          return !f;
        });
        r.auto_dropped_hard = dropped;
        console.log(`    (--drop-hard) removed ${dropped.length} HARD-flagged item(s), continuing`);
      }
      console.log(`  ${pass.padEnd(14)} ${r.status.padEnd(9)} kept ${r.kept.length} | rejected ${r.rejected.length} | warnings ${r.warnings.length} | sources ${r.sources}${r.verification && Object.keys(r.verification).length ? ` | urls ${JSON.stringify(r.verification)}` : ""}${r.flags.length ? ` | FLAGS hard ${hard.length} soft ${r.flags.length - hard.length}` : ""}${r.error ? ` | ${r.error.slice(0, 100)}` : ""}`);
      save();
      if (hard.length && !dropHard) { stopped = `HARD off-model flag on ${m.name} / ${pass}: ${hard.map((f) => `"${f.item}" — ${f.reason}`).join(" || ")}`; break outer; }
      await sleep(2000);
    }
  }
  save({ stopped });
  console.log(`\nreview file: ${outFile}`);
  if (stopped) { console.log(`\n*** STOPPED: ${stopped}`); process.exitCode = 2; }
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

