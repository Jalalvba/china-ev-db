// Research agent: for every Brand in our DB that has no confirmed Morocco
// distributor yet, asks Gemini (with Google Search grounding enabled) to find
// one, and writes the results to a batch JSON file for human review.
//
// This script NEVER writes to MongoDB. It only produces
// raw-data/morocco-agent-batch-<timestamp>.json, in the same shape consumed
// by `npm run import-morocco -- <file>` — review the file, edit out anything
// wrong, then run it through that existing pipeline like any other Morocco
// data source (atlasdragon.ma, the Chinese-source cross-checks, etc.).
//
// Usage:
//   npm run morocco-agent                  (full run over every un-confirmed brand)
//   npm run morocco-agent -- --limit 5     (only the first 5, for a quick test)
//   npm run morocco-agent -- --model gemini-pro-latest  (override the default flash model)

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { GoogleGenAI, ApiError } from "@google/genai";
import Brand from "../models/Brand";
import MoroccoListing from "../models/MoroccoListing";
import { MOROCCO_BRAND_ALIAS } from "../lib/moroccoBrandAlias";
import { lookupMoteurMa, renderMoteurMaContext, type MoteurMaLookupResult } from "../lib/moteurMaScraper";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error(
    "Missing GEMINI_API_KEY. Get one at https://aistudio.google.com/apikey and set it in .env."
  );
}

// Flash is the default: this is a ~140-brand batch job, and flash is
// materially cheaper/faster than pro for a fairly mechanical "search and
// report back" task. Override with --model if quality turns out to matter
// more than throughput for some brands.
//
// gemini-2.5-flash was retired for new API keys; gemini-3.6-flash is its
// replacement as of this writing. Verified available on this project's key
// via `ai.models.list()` before switching — re-check that call if this
// starts failing again, rather than guessing the next name from an error
// message alone.
const DEFAULT_MODEL = "gemini-3.6-flash";

// Conservative default so a ~140-brand run doesn't hit per-minute rate
// limits on typical Gemini API tiers. Override via GEMINI_AGENT_DELAY_MS.
const DEFAULT_DELAY_MS = 4000;

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

// A 404 here means the model name itself is wrong/retired — every one of the
// ~140 brand queries would hit the exact same error, so this must abort the
// whole run immediately rather than burn the per-brand retry budget (or
// worse, silently log 140 "errors" that are all actually one root cause).
class ModelNotFoundError extends Error {
  constructor(modelName: string) {
    super(
      `Model '${modelName}' is not available; check available models with the API ` +
        `(ai.models.list()) or in Google AI Studio (https://aistudio.google.com/apikey).`
    );
    this.name = "ModelNotFoundError";
  }
}

interface CliOptions {
  limit?: number;
  model: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { model: DEFAULT_MODEL };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      options.limit = Number(args[++i]);
    } else if (args[i] === "--model") {
      options.model = args[++i];
    }
  }
  return options;
}

interface AgentModelEntry {
  model_en: string;
  price_mad_min?: number;
  price_mad_max?: number;
  moteur_ma_price_dh?: number;
  moteur_ma_confirmed?: boolean;
  moteur_ma_url?: string;
}

interface AgentBrandResponse {
  found: boolean;
  dealer_morocco?: string;
  dealer_confidence?: "confirmed" | "unconfirmed";
  models?: AgentModelEntry[];
  notes?: string;
}

interface BatchEntry {
  brand_en: string;
  model_en: string;
  price_mad_min?: number;
  price_mad_max?: number;
  moteur_ma_price_dh?: number;
  moteur_ma_confirmed?: boolean;
  moteur_ma_url?: string;
  dealer_morocco?: string;
  dealer_confidence?: "confirmed" | "unconfirmed";
  source?: string;
  source_url?: string[];
  agent_notes?: string;
  agent_query_brand_db_name: string;
  agent_query_parent_group?: string;
  agent_query_time: string;
  agent_model_used: string;
}

function buildPrompt(
  brandName: string,
  brandNameCn: string | undefined,
  parentGroup: string | undefined,
  moteurMaContext: string
): string {
  return `You are researching the Moroccan automotive market for a Chinese-vehicle database.

Brand to research: "${brandName}"${brandNameCn ? ` (Chinese: ${brandNameCn})` : ""}${
    parentGroup ? `\nParent group / manufacturer: ${parentGroup}` : ""
  }

${moteurMaContext}

The moteur.ma facts above (if any) were fetched directly from moteur.ma's own pages by this pipeline, NOT found via your search — do not re-search for them, do not contradict them, and do not re-report a moteur.ma price/URL differently than given above. Your job below is everything moteur.ma DIDN'T already cover: the official Moroccan distributor, and any other model/price data.

Search Moroccan automotive press and official sources, PRIORITIZED in this order:
1. Moroccan automotive press and official sources for anything Morocco-market-specific (distributor, launch date, local pricing not already covered above): ${SOURCE_SITES.join(", ")} — plus the brand's own official Morocco website if one exists.
2. Only fall back to generic/global English-language sources if nothing Morocco-specific or Chinese-official exists.

Answer these questions using ONLY what you can find and cite from search results:
1. Is "${brandName}" officially distributed in Morocco right now (or with a confirmed, dated launch)?
2. If yes, who is the official Moroccan importer/distributor?
3. What specific models are sold, and at what price in Moroccan Dirhams (DH)? (Skip re-reporting models/prices already given above from the direct moteur.ma fetch — just include any ADDITIONAL models or corrections your search finds.)

CRITICAL RULES:
- Do NOT infer Morocco distribution from corporate ownership, global press releases, or the fact that a sibling/parent brand is sold in Morocco. Only report a distributor or model as confirmed if you find a Moroccan source that says so directly.
- Do NOT guess a price if you cannot find one; omit price fields rather than estimate.
- If you cannot find a confirmed Moroccan source for ANY of this, set "found": false and explain briefly in "notes" — do not fabricate a plausible-sounding answer.
- Every fact you report must be backed by a search result you actually found (grounding is enabled on this request — only state what your search results support).
- Leave "moteur_ma_price_dh"/"moteur_ma_confirmed"/"moteur_ma_url" null/false for any model already listed in the direct moteur.ma fetch above — this pipeline fills those in from the fetch itself, not from your response, for those models.

Respond with ONLY a single JSON object (no markdown fencing, no prose before or after) in exactly this shape:
{
  "found": boolean,
  "dealer_morocco": string | null,
  "dealer_confidence": "confirmed" | "unconfirmed",
  "models": [ { "model_en": string, "price_mad_min": number | null, "price_mad_max": number | null, "moteur_ma_price_dh": number | null, "moteur_ma_confirmed": boolean, "moteur_ma_url": string | null } ],
  "notes": string
}`;
}

function extractJson(text: string): AgentBrandResponse | null {
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

async function queryBrand(
  ai: GoogleGenAI,
  model: string,
  brandName: string,
  brandNameCn: string | undefined,
  parentGroup: string | undefined,
  moteurMaContext: string
): Promise<{ parsed: AgentBrandResponse | null; sourceUrls: string[]; rawText: string }> {
  const prompt = buildPrompt(brandName, brandNameCn, parentGroup, moteurMaContext);

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const rawText = response.text ?? "";
      const parsed = extractJson(rawText);

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const sourceUrls = groundingChunks
        .map((chunk) => chunk.web?.uri)
        .filter((uri): uri is string => Boolean(uri));

      return { parsed, sourceUrls, rawText };
    } catch (err) {
      // Model-not-found is not transient — retrying hits the same 404 every
      // time. Fail fast on attempt 1 instead of wasting the whole retry
      // budget (and the backoff delay) on a broken model name.
      if (err instanceof ApiError && err.status === 404) {
        throw new ModelNotFoundError(model);
      }

      lastErr = err;
      const backoffMs = 2000 * attempt;
      console.error(`  [retry ${attempt}/${maxAttempts}] ${brandName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const { limit, model } = parseArgs();
  const delayMs = Number(process.env.GEMINI_AGENT_DELAY_MS ?? DEFAULT_DELAY_MS);

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Using model: ${model}, delay: ${delayMs}ms between requests.`);

  const confirmedBrandNames = await getConfirmedBrandNamesLower();
  const allBrands = await Brand.find({}, { name: 1, name_cn: 1, parent_group: 1 }).sort({ name: 1 }).lean();

  let targets = allBrands.filter((b) => !confirmedBrandNames.has(b.name.toLowerCase()));
  if (limit) targets = targets.slice(0, limit);

  console.log(
    `${allBrands.length} total brands, ${confirmedBrandNames.size} already confirmed, ${targets.length} to research${
      limit ? ` (limited to ${limit})` : ""
    }.\n`
  );

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY as string });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`raw-data/morocco-agent-batch-${timestamp}.json`);
  const results: BatchEntry[] = [];

  function flush() {
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  }

  let foundCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  function normalizeName(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  for (let i = 0; i < targets.length; i++) {
    const brand = targets[i];
    const progress = `[${i + 1}/${targets.length}]`;

    try {
      // Real code-level pre-fetch of moteur.ma — an actual HTTP fetch +
      // JSON-LD parse of moteur.ma's own pages, not a prompt asking Gemini
      // to "check" it. Runs before the Gemini call so its result can be
      // handed in as pre-verified context (see buildPrompt) and used below
      // to override whatever Gemini self-reports for moteur.ma fields.
      const moteurLookup: MoteurMaLookupResult = await lookupMoteurMa(brand.name);
      const moteurMaContext = renderMoteurMaContext(moteurLookup);

      const { parsed, sourceUrls, rawText } = await queryBrand(
        ai,
        model,
        brand.name,
        brand.name_cn,
        brand.parent_group,
        moteurMaContext
      );

      // Unmatched moteur.ma models get consumed as we merge them into
      // Gemini's own model list below; whatever's left here (moteur.ma
      // found a model Gemini's response didn't mention at all) still gets
      // its own result row further down, so directly-scraped data is never
      // silently dropped.
      const unmatchedMoteurModels = new Map(moteurLookup.models.map((m) => [normalizeName(m.name), m]));

      if (!parsed) {
        console.log(`${progress} ${brand.name}: error — could not parse JSON from response`);
        console.log(`  raw response (first 300 chars): ${rawText.slice(0, 300)}`);
        errorCount++;
      } else if (!parsed.found || !parsed.dealer_morocco) {
        console.log(`${progress} ${brand.name}: not found${parsed.notes ? ` — ${parsed.notes}` : ""}`);
        notFoundCount++;
      } else {
        // No grounding citations at all means the model's claim isn't
        // actually search-backed, regardless of what it put in
        // dealer_confidence — never trust an ungrounded "confirmed".
        const dealerConfidence: "confirmed" | "unconfirmed" =
          sourceUrls.length > 0 ? (parsed.dealer_confidence ?? "unconfirmed") : "unconfirmed";

        const sourceLabel = sourceUrls.length
          ? `Gemini-grounded research (${sourceUrls.length} source${sourceUrls.length > 1 ? "s" : ""})`
          : "Gemini research — NO grounding citations found, treat as unverified";

        const models = parsed.models?.length ? parsed.models : [{ model_en: "(unspecified)" }];
        for (const m of models) {
          // moteur.ma was directly fetched and parsed by this pipeline, not
          // self-reported by Gemini — it always wins over whatever Gemini
          // put in these three fields for a model it matches.
          const scraped = unmatchedMoteurModels.get(normalizeName(m.model_en));
          if (scraped) unmatchedMoteurModels.delete(normalizeName(m.model_en));

          results.push({
            brand_en: brand.name,
            model_en: m.model_en,
            price_mad_min: m.price_mad_min ?? undefined,
            price_mad_max: m.price_mad_max ?? undefined,
            moteur_ma_price_dh: scraped?.cheapestPriceDh ?? undefined,
            moteur_ma_confirmed: Boolean(scraped),
            moteur_ma_url: scraped?.trims[0]?.url ?? scraped?.url ?? undefined,
            dealer_morocco: parsed.dealer_morocco,
            dealer_confidence: dealerConfidence,
            source: scraped ? `${sourceLabel} + moteur.ma (direct fetch)` : sourceLabel,
            source_url: sourceUrls,
            agent_notes: parsed.notes,
            agent_query_brand_db_name: brand.name,
            agent_query_parent_group: brand.parent_group,
            agent_query_time: new Date().toISOString(),
            agent_model_used: model,
          });
        }
        console.log(
          `${progress} ${brand.name}: found — ${parsed.dealer_morocco} (${dealerConfidence}, ${models.length} model(s), ${sourceUrls.length} source(s))`
        );
        foundCount++;
      }

      // Any moteur.ma model left unmatched above — either Gemini reported
      // "not found" for the brand entirely, or it just didn't mention this
      // specific model — still gets its own row. A directly-scraped fact
      // never gets dropped just because Gemini's own research missed it.
      for (const scraped of unmatchedMoteurModels.values()) {
        results.push({
          brand_en: brand.name,
          model_en: scraped.name,
          moteur_ma_price_dh: scraped.cheapestPriceDh,
          moteur_ma_confirmed: true,
          moteur_ma_url: scraped.trims[0]?.url ?? scraped.url,
          dealer_morocco: parsed?.dealer_morocco ?? undefined,
          dealer_confidence: undefined,
          source: "moteur.ma (direct fetch)",
          source_url: [scraped.url],
          agent_notes: "Found via direct moteur.ma fetch; not mentioned in this run's Gemini research response.",
          agent_query_brand_db_name: brand.name,
          agent_query_parent_group: brand.parent_group,
          agent_query_time: new Date().toISOString(),
          agent_model_used: model,
        });
      }
      if (unmatchedMoteurModels.size > 0 || (parsed?.found && parsed.dealer_morocco)) flush();
    } catch (err) {
      if (err instanceof ModelNotFoundError) {
        // Every remaining brand would hit this same 404 — stop now rather
        // than grinding through the rest logging the same root cause 100+
        // times. Flush first so any results found before the failure aren't
        // lost — results.length may be 0 if this hit on the very first brand.
        console.error(`\n${progress} ${brand.name}: FATAL — ${err.message}`);
        if (results.length > 0) {
          flush();
          console.error(`Stopping the run — this is not a per-brand issue. ${results.length} already-found result(s) saved to ${outPath}.`);
        } else {
          console.error(`Stopping the run — this is not a per-brand issue. No results were found before this failure, so no output file was written.`);
        }
        await mongoose.disconnect();
        process.exit(1);
      }
      console.error(`${progress} ${brand.name}: error — ${(err as Error).message}`);
      errorCount++;
    }

    if (i < targets.length - 1) await sleep(delayMs);
  }

  flush();
  console.log(
    `\nDone. ${foundCount} found, ${notFoundCount} not found, ${errorCount} errors, out of ${targets.length} brands researched.`
  );
  console.log(`Wrote ${results.length} candidate listing(s) to ${outPath}`);
  console.log(`\nThis file was NOT written to MongoDB. Review it, then run:`);
  console.log(`  npm run import-morocco -- ${path.relative(process.cwd(), outPath)}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
