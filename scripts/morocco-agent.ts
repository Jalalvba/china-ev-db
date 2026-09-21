// Batch EXPORT-PROMPT generator for Morocco distributor/pricing research. As of
// 2026-09-21 this script no longer calls any AI/search provider directly (see
// CLAUDE.md's "no automated API calls anywhere in the app" entry) — it no longer
// calls lib/webSearch.ts (Brave) or lib/aiProvider.ts. For every Brand in our DB
// that has no confirmed Morocco distributor yet, it still does a direct,
// non-AI moteur.ma scrape (lib/moteurMaScraper.ts — a real HTTP fetch + JSON-LD
// parse of moteur.ma's own pages, not a search/AI call) and folds that into a
// research prompt, then writes one prompt per brand to a single batch file under
// raw-data/.
//
// This script NEVER writes to MongoDB. Paste each prompt into an external AI chat
// (Kimi/Gemini/DeepSeek) that has its OWN web search/browsing enabled (or do the
// searches yourself and paste the results in first), then paste the JSON response
// into a batch review file in the same shape `npm run import-morocco -- <file>`
// expects — review it, edit out anything wrong, then run it through that existing
// pipeline like any other Morocco data source.
//
// Usage:
//   npm run morocco-agent                  (full run over every un-confirmed brand)
//   npm run morocco-agent -- --limit 5     (only the first 5, for a quick test)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import MoroccoListing from "../models/MoroccoListing";
import { MOROCCO_BRAND_ALIAS } from "../lib/moroccoBrandAlias";
import { lookupMoteurMa, renderMoteurMaContext } from "../lib/moteurMaScraper";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const SOURCE_SITES = [
  "wandaloo.com",
  "atlasdragon.ma",
  "autochine.ma",
  "lematin.ma",
  "le360.ma",
  "ledesk.ma",
  "moteur.ma",
  "autonews.ma",
  "leguideauto.ma",
  "h24info.ma",
  "medias24.com",
  "leseco.ma",
];

interface CliOptions {
  limit?: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") options.limit = Number(args[++i]);
  }
  return options;
}

function buildPrompt(
  brandName: string,
  brandNameCn: string | undefined,
  parentGroup: string | undefined,
  moteurMaContext: string
): string {
  const searchQueries = [
    `${brandName} Maroc distributeur officiel`,
    `${brandName} Morocco distributor`,
    `${brandName} prix Maroc DH`,
    brandNameCn ? `${brandNameCn} 摩洛哥` : `${brandName} wandaloo.com`,
  ];

  return `You are researching the Moroccan automotive market for a Chinese-vehicle database. Use your own web search/browsing capability to find real sources — do not answer from general knowledge alone. Suggested search queries: ${searchQueries
    .map((q) => `"${q}"`)
    .join(", ")}.

Brand to research: "${brandName}"${brandNameCn ? ` (Chinese: ${brandNameCn})` : ""}${
    parentGroup ? `\nParent group / manufacturer: ${parentGroup}` : ""
  }

${moteurMaContext}

The moteur.ma facts above (if any) were fetched directly from moteur.ma's own pages by this pipeline, NOT found via search — do not re-derive them, do not contradict them, and do not re-report a moteur.ma price/URL differently than given above. Your job below is everything moteur.ma DIDN'T already cover: the official Moroccan distributor, and any other model/price data.

Preferred source priority for what you extract: Moroccan automotive press and official sources for anything Morocco-market-specific (distributor, launch date, local pricing not already covered above): ${SOURCE_SITES.join(
    ", "
  )} — plus the brand's own official Morocco website if one exists; fall back to generic/global English-language sources only if nothing Morocco-specific exists.

Answer these questions using ONLY what you can find and cite from real sources:
1. Is "${brandName}" officially distributed in Morocco right now (or with a confirmed, dated launch)?
2. If yes, who is the official Moroccan importer/distributor?
3. What specific models are sold, and at what price in Moroccan Dirhams (DH)? (Skip re-reporting models/prices already given above from the direct moteur.ma fetch — just include any ADDITIONAL models or corrections your search finds.)

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value in your JSON response must be English — "dealer_morocco", "notes", "model_en", everything. If a source (Moroccan French/Arabic press or Chinese press) states a fact in another language, translate it into English before writing it. Never leave a non-English character anywhere in the response.
- Do NOT infer Morocco distribution from corporate ownership, global press releases, or the fact that a sibling/parent brand is sold in Morocco. Only report a distributor or model as confirmed if you find a Moroccan source that says so directly.
- Do NOT guess a price if you cannot find one; omit price fields rather than estimate.
- If you cannot find a confirmed Moroccan source for ANY of this, set "found": false and explain briefly in "notes" — do not fabricate a plausible-sounding answer.
- Every fact you report must be backed by a real source you actually found — only state what those sources actually support, never fill in a plausible-sounding answer from general knowledge.
- Leave "moteur_ma_price_dh"/"moteur_ma_confirmed"/"moteur_ma_url" null/false for any model already listed in the direct moteur.ma fetch above — this pipeline fills those in from the fetch itself, not from your response, for those models.
- List every source URL you actually used under "source_url".

Respond with ONLY a single JSON object (no markdown fencing, no prose before or after) in exactly this shape:
{
  "found": boolean,
  "dealer_morocco": string | null,
  "dealer_confidence": "confirmed" | "unconfirmed",
  "models": [ { "model_en": string, "price_mad_min": number | null, "price_mad_max": number | null, "moteur_ma_price_dh": number | null, "moteur_ma_confirmed": boolean, "moteur_ma_url": string | null } ],
  "source_url": string[],
  "notes": string
}`;
}

/** Mirrors the homepage's own brand->dealer resolution (lib/moroccoBrandAlias.ts)
 * so this script skips exactly the brands the UI already shows a confirmed
 * badge for, rather than re-researching brands whose data lives under a
 * differently-named MoroccoListing row (e.g. Haval rolling up to GWM). */
async function getConfirmedBrandNamesLower(): Promise<Set<string>> {
  const confirmedListings = await MoroccoListing.find(
    { dealer_confidence: "confirmed", dealer_morocco: { $exists: true, $ne: null } },
    { brand_en: 1 }
  ).lean();

  const confirmed = new Set<string>();
  for (const listing of confirmedListings) {
    const resolvedName = MOROCCO_BRAND_ALIAS[listing.brand_en] ?? listing.brand_en;
    confirmed.add(resolvedName.toLowerCase());
  }
  return confirmed;
}

async function run() {
  const { limit } = parseArgs();

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB.`);

  const confirmedBrandNames = await getConfirmedBrandNamesLower();
  const allBrands = await Brand.find({}, { name: 1, name_cn: 1, parent_group: 1 }).sort({ name: 1 }).lean();

  let targets = allBrands.filter((b) => !confirmedBrandNames.has(b.name.toLowerCase()));
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `${allBrands.length} total brands, ${confirmedBrandNames.size} already confirmed, ${targets.length} to research${
      limit ? ` (limited to ${limit})` : ""
    }.\n`
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/morocco-agent-batch-prompts-${timestamp}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const sections: string[] = [];
  for (let i = 0; i < targets.length; i++) {
    const brand = targets[i];
    const progress = `[${i + 1}/${targets.length}]`;

    // Real code-level pre-fetch of moteur.ma — an actual HTTP fetch + JSON-LD
    // parse of moteur.ma's own pages, not an AI/search-provider call — kept as-is
    // since it's out of scope for this ban (see CLAUDE.md).
    const moteurLookup = await lookupMoteurMa(brand.name);
    const moteurMaContext = renderMoteurMaContext(moteurLookup);
    const prompt = buildPrompt(brand.name, brand.name_cn, brand.parent_group, moteurMaContext);

    console.log(`${progress} ${brand.name}: prompt built`);
    sections.push(
      `## ${brand.name}\n\n- Brand DB id: \`${String(brand._id)}\`\n- Paste this brand's JSON response into a batch review file (same shape as \`npm run import-morocco -- <file>\` expects), review it, then run it through that pipeline.\n\n\`\`\`\n${prompt}\n\`\`\`\n`
    );
  }

  fs.writeFileSync(
    outPath,
    `# Morocco distributor/pricing research prompts — ${timestamp}\n\n${targets.length} brand(s) have no confirmed Morocco distributor yet. Generated by scripts/morocco-agent.ts. No AI/search provider was called — paste each prompt below into an external AI chat with web search/browsing enabled, collect the JSON responses into one array, review them, then run:\n\n\`\`\`\nnpm run import-morocco -- <your-reviewed-file>.json\n\`\`\`\n\n${sections.join(
      "\n---\n\n"
    )}`
  );

  console.log(`\nWrote ${targets.length} prompt(s) to ${outPath}`);
  console.log(`This file was NOT written to MongoDB and no AI/search provider was called.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
