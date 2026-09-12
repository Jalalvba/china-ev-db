// Real code-level pre-fetch of moteur.ma (Morocco's automotive reference
// site) — NOT a prompt instruction asking Gemini to "check" it. This module
// does an actual HTTP fetch + JSON-LD parse of moteur.ma's own pages and
// returns structured, code-verified data (or an explicit "not found"/"fetch
// failed" result) that callers can hand to Gemini as pre-confirmed ground
// truth, distinct from anything Gemini's own search tool self-reports.
//
// Scrapability, verified directly (see the PR/commit discussion this
// shipped with for the raw curl output):
// - robots.txt explicitly `Allow: /` for ClaudeBot (and GPTBot, Googlebot,
//   etc.) — only /vendor/, /storage/, /resources/, /bootstrap/,
//   /node_modules/ are disallowed, none of which are content paths.
// - No JS rendering needed: a plain unauthenticated GET returns full
//   server-rendered HTML, including a `application/ld+json` schema.org block
//   at every level (brand catalogue -> brand's models -> model's trims ->
//   trim's Car+Offer with price in MAD). No bot-blocking/CAPTCHA observed.
// - Brand slugs are simple kebab-case and usually match a naive slugify of
//   the brand name (verified against moteur.ma's own catalogue page) — model
//   slugs are NOT consistently derivable this way (e.g. "atto3" has no
//   hyphen while "atto-2" does), so model slugs are always resolved by
//   fetching the brand's own model list and matching by name, never guessed.
// - An unknown brand slug 302-redirects to `?status=marque_introuvable` —
//   a clean, explicit "not on this site" signal.

const BASE = "https://www.moteur.ma";
// Explicitly allow-listed in moteur.ma's own robots.txt ("User-agent:
// ClaudeBot / Allow: /") — using it here is truthful, not a spoofed UA.
const USER_AGENT = "ClaudeBot/1.0 (+china-ev-db research pipeline)";
const FETCH_TIMEOUT_MS = 10_000;

function normalizeSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string; redirected: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, redirected: res.redirected || res.url !== url };
  } finally {
    clearTimeout(timeout);
  }
}

interface ItemListEntry {
  name: string;
  url: string;
}

/** Pulls every `application/ld+json` block on the page and returns the parsed objects (skipping any that fail to parse — moteur.ma emits several separate blocks per page, only one of which is usually relevant). */
function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      blocks.push(JSON.parse(m[1]));
    } catch {
      // Skip unparseable block rather than failing the whole page.
    }
  }
  return blocks;
}

function findGraphNodesByType(blocks: unknown[], type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const graph = (block as Record<string, unknown>)?.["@graph"];
    if (!Array.isArray(graph)) continue;
    for (const node of graph) {
      if (node && typeof node === "object" && (node as Record<string, unknown>)["@type"] === type) {
        out.push(node as Record<string, unknown>);
      }
    }
  }
  return out;
}

function extractItemList(blocks: unknown[]): ItemListEntry[] {
  const pages = findGraphNodesByType(blocks, "CollectionPage");
  for (const page of pages) {
    const mainEntity = page.mainEntity as Record<string, unknown> | undefined;
    const items = mainEntity?.itemListElement;
    if (Array.isArray(items)) {
      return items
        .map((it) => ({ name: String((it as Record<string, unknown>).name ?? ""), url: String((it as Record<string, unknown>).url ?? "") }))
        .filter((it) => it.name && it.url);
    }
  }
  return [];
}

export interface MoteurMaOffer {
  trimName: string;
  url: string;
  priceDh?: number;
  currency?: string;
  availability?: string;
  bodyType?: string;
  fuelType?: string;
  vehicleModelDate?: string;
}

function extractCarOffer(blocks: unknown[]): MoteurMaOffer | null {
  const cars = findGraphNodesByType(blocks, "Car");
  if (cars.length === 0) return null;
  const car = cars[0];
  const offer = car.offers as Record<string, unknown> | undefined;
  return {
    trimName: String(car.name ?? ""),
    url: String(offer?.url ?? ""),
    priceDh: typeof offer?.price === "number" ? offer.price : undefined,
    currency: typeof offer?.priceCurrency === "string" ? offer.priceCurrency : undefined,
    availability: typeof offer?.availability === "string" ? offer.availability.replace("https://schema.org/", "") : undefined,
    bodyType: typeof car.bodyType === "string" ? car.bodyType : undefined,
    fuelType: typeof car.fuelType === "string" ? car.fuelType : undefined,
    vehicleModelDate: typeof car.vehicleModelDate === "string" ? car.vehicleModelDate : undefined,
  };
}

// In-memory cache for the single run of a batch script — the brand
// catalogue rarely changes mid-run and this avoids re-fetching it once per
// brand in a ~140-brand loop.
let brandCatalogueCache: ItemListEntry[] | null = null;

async function getBrandCatalogue(): Promise<ItemListEntry[]> {
  if (brandCatalogueCache) return brandCatalogueCache;
  const { ok, text } = await fetchText(`${BASE}/fr/neuf/voiture/`);
  if (!ok) {
    brandCatalogueCache = [];
    return brandCatalogueCache;
  }
  brandCatalogueCache = extractItemList(extractJsonLdBlocks(text));
  return brandCatalogueCache;
}

async function findBrandSlug(brandName: string): Promise<string | null> {
  const target = normalizeForMatch(brandName);
  // Fast path: naive slugify usually matches moteur.ma's own slug directly
  // (verified for byd, mercedes-benz, land-rover, etc.) — try it before
  // paying for the full catalogue fetch.
  const guess = normalizeSlug(brandName);
  const { status, redirected } = await fetchText(`${BASE}/fr/neuf/voiture/${guess}/`);
  if (status === 200 && !redirected) return guess;

  // Fall back to the catalogue's own brand list for anything the naive
  // guess didn't match exactly.
  const catalogue = await getBrandCatalogue();
  const match = catalogue.find((b) => normalizeForMatch(b.name) === target);
  if (!match) return null;
  const slugMatch = match.url.match(/\/voiture\/([^/]+)\/?$/);
  return slugMatch ? slugMatch[1] : null;
}

export interface MoteurMaModelSummary {
  name: string;
  url: string;
  trims: MoteurMaOffer[];
  cheapestPriceDh?: number;
  /** False when this entry was resolved via the substring fallback rather than an exact name match to the query — callers should not auto-confirm a price from a non-exact match, since it may belong to a different (similarly-named) model. */
  isExactMatch: boolean;
}

export interface MoteurMaLookupResult {
  attempted: true;
  scrapedAt: string;
  /** Set if the fetch itself failed (network error, timeout, non-200 unrelated to "not found") — callers should fall back to Gemini search and flag that the direct scrape didn't succeed, per the pipeline's graceful-degradation rule. */
  fetchError?: string;
  brandFound: boolean;
  brandUrl?: string;
  models: MoteurMaModelSummary[];
}

/**
 * Looks up a brand (and optionally narrows to one model) on moteur.ma via
 * real HTTP fetches + JSON-LD parsing — never a prompt asking an LLM to do
 * this itself. Always resolves (never throws): a network failure surfaces
 * as `fetchError` so callers can fall back to Gemini-search-based research
 * without the whole pipeline breaking.
 */
export async function lookupMoteurMa(brandName: string, modelName?: string): Promise<MoteurMaLookupResult> {
  const scrapedAt = new Date().toISOString();
  try {
    const brandSlug = await findBrandSlug(brandName);
    if (!brandSlug) {
      return { attempted: true, scrapedAt, brandFound: false, models: [] };
    }
    const brandUrl = `${BASE}/fr/neuf/voiture/${brandSlug}/`;
    const { ok, text } = await fetchText(brandUrl);
    if (!ok) {
      return { attempted: true, scrapedAt, brandFound: true, brandUrl, models: [], fetchError: `Brand page fetch returned non-OK status` };
    }

    let modelEntries = extractItemList(extractJsonLdBlocks(text));
    let exactMatchNames: Set<string> | null = null;
    if (modelName) {
      const target = normalizeForMatch(modelName);
      // Exact match first: substring matching alone conflates distinct
      // models sharing a prefix (e.g. querying "Shine Max" — normalized
      // "shinemax" — would substring-match the separate "Shine" model too,
      // since "shinemax".includes("shine")). Only fall back to substring
      // matching when nothing matches exactly, for genuinely fuzzy cases
      // (trim suffixes, spacing differences) the exact check won't catch.
      const exact = modelEntries.filter((m) => normalizeForMatch(m.name) === target);
      if (exact.length) {
        modelEntries = exact;
        exactMatchNames = new Set(exact.map((m) => normalizeForMatch(m.name)));
      } else {
        modelEntries = modelEntries.filter((m) => {
          const n = normalizeForMatch(m.name);
          return n.includes(target) || target.includes(n);
        });
        exactMatchNames = new Set(); // fallback matches — none are exact
      }
    }

    const models: MoteurMaModelSummary[] = [];
    for (const entry of modelEntries) {
      const { ok: modelOk, text: modelHtml } = await fetchText(entry.url);
      if (!modelOk) continue;
      const trimEntries = extractItemList(extractJsonLdBlocks(modelHtml));
      const trims: MoteurMaOffer[] = [];
      for (const trimEntry of trimEntries) {
        const { ok: trimOk, text: trimHtml } = await fetchText(trimEntry.url);
        if (!trimOk) continue;
        const offer = extractCarOffer(extractJsonLdBlocks(trimHtml));
        if (offer) trims.push(offer);
      }
      const prices = trims.map((t) => t.priceDh).filter((p): p is number => typeof p === "number");
      models.push({
        name: entry.name,
        url: entry.url,
        trims,
        cheapestPriceDh: prices.length ? Math.min(...prices) : undefined,
        // No modelName query at all (brand-only lookup) counts as exact —
        // there was nothing to fuzzy-match against.
        isExactMatch: exactMatchNames ? exactMatchNames.has(normalizeForMatch(entry.name)) : true,
      });
    }

    return { attempted: true, scrapedAt, brandFound: true, brandUrl, models };
  } catch (err) {
    return {
      attempted: true,
      scrapedAt,
      brandFound: false,
      models: [],
      fetchError: (err as Error).message ?? "Unknown fetch error",
    };
  }
}

/**
 * Renders a lookup result as a plain-language block to inject into a Gemini
 * prompt as pre-verified, confirmed context — explicitly telling the model
 * not to re-search for what this already found. This is the piece that
 * makes the data "ground truth passed in" rather than "ask the model to go
 * find it," which a prompt instruction alone can never guarantee.
 */
export function renderMoteurMaContext(result: MoteurMaLookupResult): string {
  if (result.fetchError) {
    return `moteur.ma direct lookup was attempted but failed (${result.fetchError}) — treat moteur.ma as any other source to search for below, it was NOT pre-verified this run.`;
  }
  if (!result.brandFound) {
    return `moteur.ma direct lookup: this brand is NOT listed on moteur.ma as of ${result.scrapedAt} (checked directly, not via search) — do not report Moroccan availability via moteur.ma for it.`;
  }
  if (result.models.length === 0) {
    return `moteur.ma direct lookup: brand page found (${result.brandUrl}) but no matching model page — moteur.ma does not currently list this specific model.`;
  }
  const lines = result.models.map((m) => {
    if (m.trims.length === 0) return `- ${m.name}: listed at ${m.url}, but no trim/price data found.`;
    const trimLines = m.trims
      .map((t) => `${t.trimName}: ${t.priceDh ? `${t.priceDh.toLocaleString()} DH` : "price not listed"}${t.availability ? ` (${t.availability})` : ""}`)
      .join("; ");
    return `- ${m.name} (${m.url}): ${trimLines}`;
  });
  return `moteur.ma direct lookup (fetched and parsed directly as of ${result.scrapedAt} — treat as CONFIRMED ground truth for Morocco pricing/availability, do not re-verify these specific facts, just cite moteur.ma):\n${lines.join("\n")}`;
}
