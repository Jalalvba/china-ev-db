// One-time backfill: tags every existing Model.known_issues item that has no `region`
// as region: "china".
//
// Why "china" is safe: before the region field existed, every known_issues item was
// written by the Chinese-source-only pipeline (lib/issueResearch.ts + chineseSourceGuard's
// allowlist), so all of them are Chinese-market data by construction. The dry-run prints
// the distinct `source` values so that assumption can be eyeballed before writing.
//
// Metadata-only: does NOT touch known_issues_last_researched_at or the per-region
// timestamps (nothing was re-researched), and never changes an item that already has a
// region. Reads are always safe; writes require --apply.
//
// Usage:
//   npm run backfill-known-issue-region              # dry run (default): counts + sources, writes nothing
//   npm run backfill-known-issue-region -- --apply   # actually tag the items, then re-fetch and verify

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import ModelSchema from "../models/Model";
import Brand from "../models/Brand";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");

const apply = process.argv.includes("--apply");

interface LeanIssue {
  region?: string;
  source?: string;
  source_url?: string;
}

async function main() {
  await mongoose.connect(MONGODB_URI as string);
  void Brand; // registers the Brand model (mirrors other scripts) — not queried here

  const models = (await ModelSchema.find({ "known_issues.0": { $exists: true } }, { name: 1, known_issues: 1 }).lean()) as unknown as {
    _id: mongoose.Types.ObjectId;
    name: string;
    known_issues: LeanIssue[];
  }[];

  let totalItems = 0;
  let alreadyTagged = 0;
  const toTag: { id: mongoose.Types.ObjectId; name: string; count: number }[] = [];
  const sourceCounts = new Map<string, number>();
  const nonChineseLooking: string[] = [];

  for (const m of models) {
    totalItems += m.known_issues.length;
    const untagged = m.known_issues.filter((i) => !i.region);
    alreadyTagged += m.known_issues.length - untagged.length;
    if (untagged.length === 0) continue;
    toTag.push({ id: m._id, name: m.name, count: untagged.length });
    for (const i of untagged) {
      const src = i.source ?? "(no source)";
      sourceCounts.set(src, (sourceCounts.get(src) ?? 0) + 1);
      if (i.source_url && !/\.(cn|com\.cn)\b|12365auto|tousu\.99|autohome|dongchedi|yiche|pcauto/i.test(i.source_url)) nonChineseLooking.push(`${m.name}: ${i.source_url}`);
    }
  }

  const itemsToTag = toTag.reduce((n, t) => n + t.count, 0);
  console.log(`${apply ? "APPLY" : "DRY RUN"} — backfill known_issues[].region = "china"`);
  console.log(`Models with known_issues:        ${models.length}`);
  console.log(`Total known_issues items:        ${totalItems}`);
  console.log(`Already tagged (left alone):     ${alreadyTagged}`);
  console.log(`Items to tag "china":            ${itemsToTag}   (across ${toTag.length} models)`);
  console.log(`\nDistinct sources among items to tag (sanity check — expect only Chinese platforms):`);
  for (const [src, n] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${src}`);
  if (nonChineseLooking.length > 0) {
    console.log(`\nWARNING: ${nonChineseLooking.length} item(s) have a source_url that does not look Chinese — review before applying:`);
    nonChineseLooking.forEach((l) => console.log(`  ${l}`));
  }
  console.log(`\nPer model:`);
  for (const t of toTag.sort((a, b) => a.name.localeCompare(b.name))) console.log(`  ${String(t.count).padStart(3)}  ${t.name}`);

  if (!apply) {
    console.log(`\nDry run only — nothing written. Re-run with --apply to tag these ${itemsToTag} item(s).`);
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const t of toTag) {
    await ModelSchema.updateOne({ _id: t.id }, { $set: { "known_issues.$[i].region": "china" } }, { arrayFilters: [{ "i.region": { $exists: false } }] });
    written += t.count;
  }

  // Re-fetch and verify — a Mongoose call not throwing does not mean the field persisted (CLAUDE.md "Write safety").
  const after = (await ModelSchema.find({ "known_issues.0": { $exists: true } }, { known_issues: 1 }).lean()) as unknown as { known_issues: LeanIssue[] }[];
  const stillUntagged = after.reduce((n, m) => n + m.known_issues.filter((i) => !i.region).length, 0);
  const chinaNow = after.reduce((n, m) => n + m.known_issues.filter((i) => i.region === "china").length, 0);
  console.log(`\nWrote region="china" to ${written} item(s). Verify: ${stillUntagged} still untagged, ${chinaNow} tagged china.`);
  if (stillUntagged > 0) {
    console.error("VERIFICATION FAILED — some items did not persist a region.");
    process.exitCode = 1;
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
