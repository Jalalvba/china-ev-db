// Standalone batch sync of Morocco pricing onto Model documents, using the
// same two scrapers as app/api/models/[id]/fetch-morocco-price/route.ts
// (that endpoint is untouched — it stays for manual one-off re-checks).
//
// Per model: moteur.ma (JSON-LD, structured) first, wandaloo.com (regex)
// second. If only one source has a price, use it. If both have a price,
// compare within a tolerance (prices are rounded/displayed differently by
// convention between the two sites) — on agreement, prefer moteur.ma's
// structured data; on disagreement, or if both failed to parse a price
// despite a successful fetch, fall back to Gemini as a last-resort
// extractor over the raw fetched HTML. A Gemini-derived result is always
// written with morocco_price_confirmed: false and source "gemini-fallback"
// so it never gets treated as scraper-grade confidence — it's flagged for
// manual review instead.
//
// Usage:
//   pnpm sync-prices                          (all models missing a confirmed Morocco price)
//   pnpm sync-prices -- --force               (re-check every model, including already-confirmed ones)
//   pnpm sync-prices -- --brand=Dongfeng       (scope to one brand, for testing)
//   pnpm sync-prices -- --dry-run              (scrape + log only, write nothing, never call Gemini)
//   pnpm sync-prices -- --concurrency=3 --delay=1500

import dotenv from "dotenv";
dotenv.config({ quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { GoogleGenAI, ApiError } from "@google/genai";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import { lookupMoteurMa, type MoteurMaLookupResult } from "../lib/moteurMaScraper";
import { lookupWandaloo, type WandalooLookupResult } from "../lib/wandalooScraper";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

// Only required for the (rare — see AGREEMENT_TOLERANCE) disagreement branch;
// a dry-run never touches this so a missing key doesn't block dry-run testing.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Same model as scripts/morocco-agent.ts / lib/techSpecResearch.ts — see the
// comment there on why gemini-3.6-flash (gemini-2.5-flash's replacement).
const GEMINI_MODEL = "gemini-3.6-flash";

// Two small sites, not a CDN-backed API — keep this conservative by default.
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 1500;

// Prices are rounded/displayed differently by convention between the two
// sites (single starting price vs. a range's low end, etc.) — treat this as
// normal rounding, not disagreement, so it doesn't waste a Gemini call.
const AGREEMENT_TOLERANCE = 0.02;

interface CliOptions {
  force: boolean;
  dryRun: boolean;
  brand?: string;
  concurrency: number;
  delayMs: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    force: false,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
  };
  for (const arg of args) {
    if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--brand=")) opts.brand = arg.slice("--brand=".length);
    else if (arg.startsWith("--concurrency=")) opts.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--delay=")) opts.delayMs = Number(arg.slice("--delay=".length));
  }
  return opts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Outcome =
  | "moteur.ma"
  | "wandaloo.com"
  | "gemini-fallback"
  | "non-exact-match"
  | "ambiguous-multiple-candidates"
  | "not-found"
  | "error";

interface ModelResult {
  brandName: string;
  modelName: string;
  outcome: Outcome;
  moteurPriceDh?: number;
  wandalooPriceDh?: number;
  diffPct?: number;
  finalPriceDh?: number;
  finalUrl?: string;
  note?: string;
}

function pctDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY. Get one at https://aistudio.google.com/apikey and set it in .env.");
  }
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return geminiClient;
}

function extractJson(text: string): { price_dh: number | null; url: string | null; reasoning?: string } | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) return null;
  try {
    return JSON.parse(candidate.slice(braceStart, braceEnd + 1));
  } catch {
    return null;
  }
}

/**
 * Last-resort reconciliation for the (rare, per the tolerance check) case
 * where moteur.ma and wandaloo.com both returned a price for the same model
 * but disagree beyond normal rounding. Not a raw-HTML re-parse: the two
 * scrapers already return trim-level structured data (name, price, fuel
 * type per trim), which is a cleaner and cheaper input than re-feeding raw
 * markup — this asks Gemini to judge which of the two already-extracted
 * numbers is the real "starting price," not to re-scrape from scratch.
 * Never called in --dry-run; never trusted enough to set
 * morocco_price_confirmed: true (see caller).
 */
async function geminiReconcile(context: {
  brandName: string;
  modelName: string;
  moteurResult: MoteurMaLookupResult;
  wandalooResult: WandalooLookupResult;
}): Promise<{ priceDh: number; url?: string } | null> {
  const ai = getGeminiClient();
  const moteurModel = context.moteurResult.models.find((m) => typeof m.cheapestPriceDh === "number");

  const prompt = `Two Moroccan car-listing sites disagree on the starting price for the "${context.brandName} ${context.modelName}".

moteur.ma (structured JSON-LD data, fetched directly):
${moteurModel ? JSON.stringify({ url: moteurModel.url, trims: moteurModel.trims }, null, 2) : "no matching model found"}

wandaloo.com (fetched directly):
${context.wandalooResult.modelFound ? JSON.stringify({ url: context.wandalooResult.modelUrl, cheapestPriceDh: context.wandalooResult.cheapestPriceDh }, null, 2) : "no matching model found"}

Both were fetched moments ago by this pipeline — do not search the web, only judge from the data given above. Decide which single price (in Moroccan Dirhams) is the more plausible current starting price for this exact model in Morocco, or null if neither looks trustworthy (e.g. clearly a different model/trim, or an implausible value like a date or a NaN).

Respond with ONLY a single JSON object, no markdown fencing, no prose:
{ "price_dh": number | null, "url": string | null, "reasoning": string }`;

  const response = await ai.models.generateContent({ model: GEMINI_MODEL, contents: prompt });
  const parsed = extractJson(response.text ?? "");
  if (!parsed || typeof parsed.price_dh !== "number") return null;
  return { priceDh: parsed.price_dh, url: parsed.url ?? undefined };
}

// Some DB records duplicate the brand name inside `name`/`name_en` (e.g.
// name_en "DFSK Glory 500" for brand "DFSK", or name "Jaecoo J7" for brand
// "Jaecoo") — neither Morocco site's own model name includes the brand
// prefix, so leaving it in defeats exact matching entirely (the "Fengon
// 500" fix earlier this session hit exactly this). Strip a leading
// brand-name token before any lookup attempt.
function stripLeadingBrandName(brandName: string, modelName: string): string {
  const re = new RegExp(`^${brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
  const stripped = modelName.replace(re, "");
  return stripped || modelName;
}

// Pure powertrain/drivetrain tags — not trim, generation, or body-style
// words (those can denote a genuinely different real model, e.g. "Seal 06
// GT" / "Shine GS" / "Han L" are NOT the same car as "Seal" / "Shine" /
// "Han", so "GT"/"GS"/"L" deliberately are NOT in this list). Order matters
// only in that each is tried independently; a name should only ever match
// one of these at its tail.
const STRIPPABLE_SUFFIXES = ["EM-P", "PHEV", "HEV", "DM-i", "DM", "EV"];

/** Strips exactly one trailing powertrain-tag suffix, if the name ends with one, else returns null. */
function stripKnownSuffix(modelName: string): string | null {
  for (const suffix of STRIPPABLE_SUFFIXES) {
    const re = new RegExp(`\\s+${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    if (re.test(modelName)) return modelName.replace(re, "");
  }
  return null;
}

interface LookupAttempt {
  moteurResult: MoteurMaLookupResult;
  wandalooResult: WandalooLookupResult;
  moteurMatch: MoteurMaLookupResult["models"][number] | undefined;
}

async function attemptLookup(brandName: string, modelName: string): Promise<LookupAttempt> {
  const moteurResult = await lookupMoteurMa(brandName, modelName);
  const wandalooResult = await lookupWandaloo(brandName, modelName);
  const moteurMatch = moteurResult.models.find((m) => typeof m.cheapestPriceDh === "number");
  return { moteurResult, wandalooResult, moteurMatch };
}

function hasExactMatch(attempt: LookupAttempt): boolean {
  return Boolean(attempt.moteurMatch?.isExactMatch) || Boolean(attempt.wandalooResult.isExactMatch);
}

async function processModel(
  brandName: string,
  rawModelName: string,
  rawModelNameEn: string | undefined,
  dryRun: boolean,
  geminiCallCounter: { count: number }
): Promise<ModelResult> {
  const modelName = stripLeadingBrandName(brandName, rawModelName);
  const modelNameEn = rawModelNameEn ? stripLeadingBrandName(brandName, rawModelNameEn) : undefined;

  // Morocco sites list cars under the locally-marketed nameplate (e.g.
  // "Shine", "Huge"), not the manufacturer's global/China-market name
  // (name_en, e.g. "Aeolus Yixuan", "Aeolus Haoji") — try `name` first and
  // only fall back to `name_en` if that finds nothing on either site.
  let { moteurResult, wandalooResult, moteurMatch } = await attemptLookup(brandName, modelName);

  if (!moteurMatch && !wandalooResult.modelFound && modelNameEn && modelNameEn !== modelName) {
    ({ moteurResult, wandalooResult, moteurMatch } = await attemptLookup(brandName, modelNameEn));
  }

  // Second pass: only when neither source produced an EXACT match (a
  // one-source, one-price non-exact match is still worth trying to upgrade
  // to exact via suffix-stripping, so this checks hasExactMatch, not
  // "found nothing at all"). Strips exactly one known powertrain-tag suffix
  // and requires a fresh EXACT match on the stripped name — no substring
  // fallback at this stage. If that doesn't land exactly either, the
  // original (unstripped) attempt's results are kept for reporting, so a
  // human reviewing non-exact-match still sees the real query that was made.
  if (!hasExactMatch({ moteurResult, wandalooResult, moteurMatch })) {
    const stripped = stripKnownSuffix(modelName);
    if (stripped && stripped !== modelName) {
      const second = await attemptLookup(brandName, stripped);
      if (hasExactMatch(second)) {
        ({ moteurResult, wandalooResult, moteurMatch } = second);
      }
    }
  }

  const moteurPriceDh = moteurMatch?.cheapestPriceDh;
  const moteurUrl = moteurMatch?.url;
  const moteurExact = moteurMatch?.isExactMatch ?? true; // no match at all -> not applicable, treat as non-blocking
  const wandalooPriceDh = wandalooResult.modelFound ? wandalooResult.cheapestPriceDh : undefined;
  const wandalooUrl = wandalooResult.modelUrl;
  const wandalooExact = wandalooResult.isExactMatch ?? true;

  // Report under the original DB name, not the brand-prefix-stripped query,
  // so review output stays recognizable against the DB record.
  const base = { brandName, modelName: rawModelName };

  // A bare/ambiguous base name (e.g. "S06") can substring-match MORE THAN
  // ONE real listing on a site (e.g. both "S06 ICE" and "S06 DM") — that's a
  // genuinely different situation from a single uncertain guess: it usually
  // means this DB record should be split into separate documents per real
  // market variant, not that the name needs a tweak. Surface it distinctly.
  const moteurAmbiguous = !moteurExact && moteurResult.models.length > 1 ? moteurResult.models.map((m) => ({ name: m.name, url: m.url })) : undefined;
  const wandalooAmbiguous = wandalooResult.ambiguousCandidates;
  if (moteurAmbiguous || wandalooAmbiguous) {
    return {
      ...base,
      outcome: "ambiguous-multiple-candidates",
      moteurPriceDh,
      wandalooPriceDh,
      note: `Multiple real candidates found, not a single uncertain guess — likely needs a DB split. moteur.ma: ${
        moteurAmbiguous ? JSON.stringify(moteurAmbiguous) : "n/a"
      } | wandaloo.com: ${wandalooAmbiguous ? JSON.stringify(wandalooAmbiguous) : "n/a"}`,
    };
  }

  // Only moteur.ma has a price.
  if (typeof moteurPriceDh === "number" && typeof wandalooPriceDh !== "number") {
    if (!moteurExact) {
      // Fallback/substring match, not an exact name match — e.g. querying
      // "Shine GS" resolving to the separate "Shine" page. Never auto-confirm
      // a price that may belong to a different, similarly-named model —
      // route to manual review regardless of whether a Gemini call would
      // otherwise have been needed.
      return { ...base, outcome: "non-exact-match", moteurPriceDh, note: `Non-exact moteur.ma match (${moteurUrl}) — needs manual confirmation.` };
    }
    return { ...base, outcome: "moteur.ma", moteurPriceDh, finalPriceDh: moteurPriceDh, finalUrl: moteurUrl };
  }

  // Only wandaloo.com has a price.
  if (typeof wandalooPriceDh === "number" && typeof moteurPriceDh !== "number") {
    if (!wandalooExact) {
      return { ...base, outcome: "non-exact-match", wandalooPriceDh, note: `Non-exact wandaloo.com match (${wandalooUrl}) — needs manual confirmation.` };
    }
    return { ...base, outcome: "wandaloo.com", wandalooPriceDh, finalPriceDh: wandalooPriceDh, finalUrl: wandalooUrl };
  }

  // Both have a price — compare.
  if (typeof moteurPriceDh === "number" && typeof wandalooPriceDh === "number") {
    const diff = pctDiff(moteurPriceDh, wandalooPriceDh);
    if (!moteurExact || !wandalooExact) {
      return {
        ...base,
        outcome: "non-exact-match",
        moteurPriceDh,
        wandalooPriceDh,
        diffPct: diff,
        note: "At least one source matched via substring fallback, not an exact name match — needs manual confirmation.",
      };
    }
    if (diff <= AGREEMENT_TOLERANCE) {
      // Agree within tolerance — prefer moteur.ma's structured JSON-LD data.
      return {
        ...base,
        outcome: "moteur.ma",
        moteurPriceDh,
        wandalooPriceDh,
        diffPct: diff,
        finalPriceDh: moteurPriceDh,
        finalUrl: moteurUrl,
      };
    }
    // Disagreement beyond tolerance — Gemini reconciliation.
    geminiCallCounter.count++;
    if (dryRun) {
      return {
        ...base,
        outcome: "gemini-fallback",
        moteurPriceDh,
        wandalooPriceDh,
        diffPct: diff,
        note: "DRY RUN — would call Gemini to reconcile (not called)",
      };
    }
    try {
      const reconciled = await geminiReconcile({ brandName, modelName, moteurResult, wandalooResult });
      return {
        ...base,
        outcome: "gemini-fallback",
        moteurPriceDh,
        wandalooPriceDh,
        diffPct: diff,
        finalPriceDh: reconciled?.priceDh,
        finalUrl: reconciled?.url,
      };
    } catch (err) {
      // A 404 means the model name itself is wrong/retired — every remaining
      // Gemini call would hit the same error, so bubble this up to abort the
      // whole run rather than burning through it logging the same cause
      // repeatedly (mirrors scripts/morocco-agent.ts's ModelNotFoundError).
      if (err instanceof ApiError && err.status === 404) throw err;
      return { ...base, outcome: "error", moteurPriceDh, wandalooPriceDh, diffPct: diff, note: (err as Error).message };
    }
  }

  // Neither scraper parsed a price. If either fetch reached the brand/model
  // page at all (as opposed to "brand not found anywhere"), that's a parse
  // failure worth a Gemini attempt rather than a flat "not found" — but we
  // don't currently retain the raw HTML from the lib functions (they return
  // parsed summaries only), so for now this routes to "not-found" unless a
  // future change threads raw HTML back out of the scrapers for this branch.
  if (moteurResult.brandFound || wandalooResult.brandFound) {
    return {
      ...base,
      outcome: "not-found",
      note: "Brand page found on at least one site but no price parsed for this model — needs manual check.",
    };
  }

  return { ...base, outcome: "not-found", note: moteurResult.fetchError ?? wandalooResult.fetchError };
}

async function run() {
  const opts = parseArgs();
  await mongoose.connect(MONGODB_URI as string);
  console.log(
    `Connected. force=${opts.force} dryRun=${opts.dryRun} brand=${opts.brand ?? "(all)"} concurrency=${opts.concurrency} delay=${opts.delayMs}ms\n`
  );

  const brandFilter: Record<string, unknown> = {};
  if (opts.brand) brandFilter.name = new RegExp(`^${opts.brand}$`, "i");
  const brands = await Brand.find(brandFilter, { name: 1, name_en: 1 }).lean();
  const brandById = new Map(brands.map((b) => [String(b._id), b]));

  const modelFilter: Record<string, unknown> = { brand_id: { $in: brands.map((b) => b._id) } };
  if (!opts.force) modelFilter.morocco_price_confirmed = { $ne: true };

  const targets = await ModelSchema.find(modelFilter, {
    name: 1,
    name_en: 1,
    brand_id: 1,
    morocco_price_dh: 1,
    morocco_price_source: 1,
    morocco_price_confirmed: 1,
  }).lean();

  console.log(`${targets.length} model(s) to process.\n`);

  const results: ModelResult[] = [];
  const geminiCallCounter = { count: 0 };
  let httpCalls = 0; // rough count: 2 scraper lookups per model, each internally does more, but this tracks top-level calls

  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      const model = targets[idx++];
      const brand = brandById.get(String(model.brand_id));
      if (!brand) continue;

      const result = await processModel(brand.name, model.name, model.name_en, opts.dryRun, geminiCallCounter);
      httpCalls += 2;
      results.push(result);

      const diffStr = typeof result.diffPct === "number" ? ` diff=${(result.diffPct * 100).toFixed(1)}%` : "";
      console.log(
        `[${brand.name} / ${model.name}] -> ${result.outcome}${diffStr}` +
          (result.finalPriceDh ? ` price=${result.finalPriceDh}DH` : "") +
          (result.note ? ` (${result.note})` : "")
      );

      if (!opts.dryRun && result.finalPriceDh && (result.outcome === "moteur.ma" || result.outcome === "wandaloo.com")) {
        await ModelSchema.findByIdAndUpdate(model._id, {
          $set: {
            morocco_price_dh: result.finalPriceDh,
            morocco_price_source: result.outcome,
            morocco_price_url: result.finalUrl,
            morocco_price_confirmed: true,
          },
        });
      } else if (!opts.dryRun && result.outcome === "gemini-fallback") {
        await ModelSchema.findByIdAndUpdate(model._id, {
          $set: {
            morocco_price_dh: result.finalPriceDh,
            morocco_price_source: "gemini-fallback",
            morocco_price_url: result.finalUrl,
            morocco_price_confirmed: false,
          },
        });
      } else if (!opts.dryRun && result.outcome === "not-found") {
        await ModelSchema.findByIdAndUpdate(model._id, {
          $set: { morocco_price_confirmed: false },
          $unset: { morocco_price_dh: "", morocco_price_source: "", morocco_price_url: "" },
        });
      }
      // "non-exact-match" writes nothing — leave whatever was in the DB
      // untouched and surface it in the review file instead. The match
      // itself is too uncertain (may belong to a different, similarly-named
      // model) to either confirm it or to justify clearing an existing value.

      if (idx < targets.length) await sleep(opts.delayMs);
    }
  }

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, () => worker());
  const start = Date.now();
  await Promise.all(workers);
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);

  const counts: Record<Outcome, number> = {
    "moteur.ma": 0,
    "wandaloo.com": 0,
    "gemini-fallback": 0,
    "non-exact-match": 0,
    "ambiguous-multiple-candidates": 0,
    "not-found": 0,
    error: 0,
  };
  for (const r of results) counts[r.outcome]++;

  console.log(`\n--- Summary ---`);
  console.log(`Scanned:               ${results.length}`);
  console.log(`Updated via moteur.ma:  ${counts["moteur.ma"]}`);
  console.log(`Updated via wandaloo:   ${counts["wandaloo.com"]}`);
  console.log(`Gemini-fallback (review): ${counts["gemini-fallback"]}`);
  console.log(`Non-exact match (review): ${counts["non-exact-match"]}`);
  console.log(`Ambiguous, multiple candidates (review): ${counts["ambiguous-multiple-candidates"]}`);
  console.log(`Failed both / no data:  ${counts["not-found"]}`);
  console.log(`Errors:                 ${counts.error}`);
  console.log(`Total scraper HTTP calls (top-level): ~${httpCalls}`);
  console.log(`Total Gemini calls: ${geminiCallCounter.count}${opts.dryRun ? " (dry-run — not actually called)" : ""}`);
  console.log(`Elapsed: ${elapsedSec}s`);

  const reviewNeeded = results.filter(
    (r) =>
      r.outcome === "gemini-fallback" ||
      r.outcome === "non-exact-match" ||
      r.outcome === "ambiguous-multiple-candidates" ||
      r.outcome === "not-found" ||
      r.outcome === "error"
  );
  if (reviewNeeded.length > 0 && !opts.dryRun) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = path.resolve(`raw-data/morocco-sync-${timestamp}.review.json`);
    fs.writeFileSync(outPath, JSON.stringify(reviewNeeded, null, 2) + "\n");
    console.log(`\nWrote ${reviewNeeded.length} item(s) needing manual review to ${outPath}`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
