// One-time migration: canonicalizes Brand.parent_group at the source, using
// the exact same alias table and legacy-string extraction the homepage
// grouping display layer (lib/brandGrouping.ts) was already using to do
// this at render time. Also extracts tech_partner from AITO's pre-tech_partner-field
// combined parent_group string.
//
// Does NOT touch: brands with no parent_group (BYD, Geely themselves stay
// null — they're the flagship, not a subsidiary of a synthetic "BYD Group"/
// "Geely Holding Group" label; that grouping is a display-only construct
// that stays in the frontend).
//
// Usage:
//   npm run migrate-parent-groups -- --dry-run   (prints the diff, writes nothing)
//   npm run migrate-parent-groups                (prints the diff, then applies it)

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import mongoose from "mongoose";
import Brand from "../models/Brand";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

// This was the display-layer alias table in lib/brandGrouping.ts before this
// migration ran (moved here since the display layer no longer needs it —
// parent_group is canonical at the source now). Kept here as the historical
// record of exactly what this one-time migration normalized.
const GROUP_ALIASES: Record<string, string> = {
  "byd group": "BYD Group",
  byd: "BYD Group",
  "geely holding group": "Geely Holding Group",
  geely: "Geely Holding Group",
  "geely / volvo": "Geely Holding Group",
  "geely / mercedes-benz": "Geely Holding Group",
  "changan automobile": "Changan",
  changan: "Changan",
  "great wall motor": "GWM (Great Wall Motor)",
  "gwm (great wall motor)": "GWM (Great Wall Motor)",
  "gwm (gwm (great wall motor))": "GWM (Great Wall Motor)",
  "chery automobile": "Chery",
  chery: "Chery",
  "chery / jlr": "Chery",
  "dongfeng motor corporation": "Dongfeng",
  dongfeng: "Dongfeng",
  "dongfeng liuzhou motor": "Dongfeng",
  "dongfeng honda": "Dongfeng",
  "dongfeng nissan": "Dongfeng",
  "dongfeng / stellantis (shenlong automobile)": "Dongfeng",
  "saic motor": "SAIC",
  saic: "SAIC",
  "saic-gm-wuling": "SAIC",
  faw: "FAW",
  "faw group": "FAW",
  "faw-volkswagen / chengdu economic development zone": "FAW",
  jac: "JAC",
  "jac auto": "JAC",
  "jac group": "JAC",
  "jac / volkswagen": "JAC",
  gac: "GAC",
  "gac group": "GAC",
  "gac aion": "GAC",
  "gac honda": "GAC",
  jmcg: "JMCG",
  "jmc auto": "JMCG",
  seres: "Seres",
  "seres (seres-invested aiva tech)": "Seres",
};

const LEGACY_TECH_PARTNER_SUFFIX: Record<string, { parent: string; tech: string }> = {
  "seres / huawei (co-developed)": { parent: "Seres", tech: "Huawei" },
};

function canonicalizeParent(raw: string): string {
  const trimmed = raw.trim();
  return GROUP_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

interface Diff {
  name: string;
  beforeParent?: string;
  afterParent?: string;
  beforeTech?: string;
  afterTech?: string;
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. ${dryRun ? "[DRY RUN — no writes]" : "[LIVE — will write]"}\n`);

  const brands = await Brand.find({ parent_group: { $exists: true, $ne: null } }).lean();
  const diffs: Diff[] = [];

  for (const b of brands) {
    const raw = (b.parent_group as string).trim();
    const legacy = LEGACY_TECH_PARTNER_SUFFIX[raw.toLowerCase()];

    const afterParent = legacy?.parent ?? canonicalizeParent(raw);
    const afterTech = b.tech_partner ?? legacy?.tech;

    const parentChanged = afterParent !== b.parent_group;
    const techChanged = afterTech !== b.tech_partner;

    if (parentChanged || techChanged) {
      diffs.push({
        name: b.name,
        beforeParent: b.parent_group as string,
        afterParent,
        beforeTech: b.tech_partner as string | undefined,
        afterTech,
      });

      if (!dryRun) {
        const set: Record<string, unknown> = {};
        if (parentChanged) set.parent_group = afterParent;
        if (techChanged && afterTech) set.tech_partner = afterTech;
        await Brand.updateOne({ _id: b._id }, { $set: set });
      }
    }
  }

  console.log(`${diffs.length} brand(s) ${dryRun ? "would change" : "changed"}:\n`);
  console.log(
    diffs
      .map((d) => {
        const parentLine = d.beforeParent !== d.afterParent ? `  parent_group: "${d.beforeParent}" -> "${d.afterParent}"` : "";
        const techLine = d.beforeTech !== d.afterTech ? `  tech_partner: ${d.beforeTech ? `"${d.beforeTech}"` : "(unset)"} -> "${d.afterTech}"` : "";
        return `${d.name}\n${[parentLine, techLine].filter(Boolean).join("\n")}`;
      })
      .join("\n\n")
  );

  if (dryRun) {
    console.log(`\nDry run only — no documents were modified. Re-run without --dry-run to apply.`);
  } else {
    console.log(`\nDone. ${diffs.length} document(s) updated.`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
