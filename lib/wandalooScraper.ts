// Real code-level pre-fetch of wandaloo.com (Morocco's other major
// automotive reference site) — an actual HTTP fetch + HTML parse, not a
// prompt instruction asking an LLM to "check" it.
//
// Scrapability, verified directly:
// - No robots.txt (the path 302-redirects to /404.html) — no crawl
//   restriction found.
// - No JS rendering needed: a plain unauthenticated GET returns full
//   server-rendered HTML (confirmed via curl with a declared bot UA). Served
//   through Cloudflare but no CAPTCHA/bot-challenge observed on a plain GET.
// - No JSON-LD on model pages (unlike moteur.ma) — prices are plain markup,
//   e.g. `<p class="prix"> 339.900 - 369.900 <sup>DH *</sup></p>` for the
//   page-level range and one `<p class="prix">339.900 <sup>DH *</sup></p>`
//   per trim row — parsed here with a regex rather than JSON-LD.
// - Brand slugs are simple kebab-case of the brand name (e.g. "byd",
//   "alfa-romeo", "bmw"), verified against wandaloo.com/neuf/{slug}/.

const BASE = "https://www.wandaloo.com";
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

interface BrandLink {
  name: string;
  url: string;
}

/** Parses `<a href="https://www.wandaloo.com/neuf/{slug}/">` links off the top-level /neuf/ catalogue page. Link text is inconsistent (icons, nested spans) so the brand name is derived from the URL slug itself, not the anchor text. */
function extractBrandLinks(html: string): BrandLink[] {
  const re = /href="https:\/\/www\.wandaloo\.com\/neuf\/([a-z0-9-]+)\/"/g;
  const seen = new Set<string>();
  const out: BrandLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: slug.replace(/-/g, " "), url: `${BASE}/neuf/${slug}/` });
  }
  return out;
}

interface ModelLink {
  name: string;
  url: string;
}

/** Parses `<a href="https://www.wandaloo.com/neuf/{brand}/{model-slug}/">` links off a brand's model list page. */
function extractModelLinks(html: string, brandSlug: string): ModelLink[] {
  const re = new RegExp(`href="https://www\\.wandaloo\\.com/neuf/${brandSlug}/([a-z0-9-]+)/"`, "g");
  const seen = new Set<string>();
  const out: ModelLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name: slug.replace(/-/g, " "), url: `${BASE}/neuf/${brandSlug}/${slug}/` });
  }
  return out;
}

/**
 * A model page's own price(s) live inside `<div class="body" id="version">`
 * (the header price plus a `#list-version` per-trim table immediately after
 * it). Everything past that — "coming soon," "popular models," and
 * "comparison" carousels — repeats `class="prix"` markup for OTHER brands'
 * cars entirely, and even non-price content (`08/2026` launch-date strings)
 * that the old whole-page scan mistook for prices. Bounding to this section
 * is what keeps the extraction to this specific model.
 */
function extractModelSectionHtml(html: string): string | undefined {
  const start = html.indexOf('id="version"');
  if (start === -1) return undefined;
  const boundaryMarkers = [
    'id="carousel-similar"', // "les voitures similaires" — other brands' cars, own prices
    'id="tabs-coming"',
    'id="tabs-popular"',
    "<!-- carousel-auto",
    'id="faceIt"',
  ];
  let end = html.length;
  for (const marker of boundaryMarkers) {
    const idx = html.indexOf(marker, start);
    if (idx !== -1) end = Math.min(end, idx);
  }
  return html.slice(start, end);
}

/** Extracts every `<p class="prix">...DH...</p>` price within the target model's own section of the page (see extractModelSectionHtml) and returns the cheapest single value found, in DH. Handles both a plain price ("339.900") and a range ("339.900 - 369.900") by splitting on non-digit-dot runs. `.` is wandaloo's thousands separator, not a decimal point. */
function extractCheapestPriceDh(html: string): number | undefined {
  const section = extractModelSectionHtml(html);
  if (!section) return undefined;
  const re = /<p[^>]*class="prix"[^>]*>([\s\S]*?)<sup>\s*DH/g;
  const prices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    const chunk = m[1];
    const numMatches = chunk.match(/[\d.]{3,}/g);
    if (!numMatches) continue;
    for (const raw of numMatches) {
      const n = Number(raw.replace(/\./g, ""));
      if (Number.isFinite(n) && n > 1000) prices.push(n);
    }
  }
  return prices.length ? Math.min(...prices) : undefined;
}

async function findBrandSlug(brandName: string): Promise<string | null> {
  const target = normalizeForMatch(brandName);
  const guess = normalizeSlug(brandName);
  const { status, redirected } = await fetchText(`${BASE}/neuf/${guess}/`);
  if (status === 200 && !redirected) return guess;

  const { ok, text } = await fetchText(`${BASE}/neuf/`);
  if (!ok) return null;
  const brands = extractBrandLinks(text);
  const match = brands.find((b) => normalizeForMatch(b.name) === target);
  if (!match) return null;
  const slugMatch = match.url.match(/\/neuf\/([^/]+)\/?$/);
  return slugMatch ? slugMatch[1] : null;
}

export interface WandalooLookupResult {
  attempted: true;
  scrapedAt: string;
  /** Set if the fetch itself failed (network error, timeout, non-200 unrelated to "not found"). */
  fetchError?: string;
  brandFound: boolean;
  brandUrl?: string;
  modelFound: boolean;
  modelUrl?: string;
  cheapestPriceDh?: number;
  /** False when modelUrl was resolved via the substring fallback rather than an exact name match — callers should not auto-confirm a price from a non-exact match. */
  isExactMatch?: boolean;
  /** Set when the substring fallback found MORE THAN ONE real candidate on the page (e.g. a bare "S06" query matching both the real "S06 ICE" and "S06 DM" listings) — a genuinely ambiguous case, distinct from a single uncertain guess. `modelUrl`/`cheapestPriceDh` above are just the first candidate; callers should treat this as needing a DB-level split, not a name fix. */
  ambiguousCandidates?: { name: string; url: string }[];
}

/**
 * Looks up a brand+model on wandaloo.com via real HTTP fetches + regex price
 * parsing — never a prompt asking an LLM to do this itself. Always resolves
 * (never throws): a network failure surfaces as `fetchError`.
 */
export async function lookupWandaloo(brandName: string, modelName: string): Promise<WandalooLookupResult> {
  const scrapedAt = new Date().toISOString();
  try {
    const brandSlug = await findBrandSlug(brandName);
    if (!brandSlug) {
      return { attempted: true, scrapedAt, brandFound: false, modelFound: false };
    }
    const brandUrl = `${BASE}/neuf/${brandSlug}/`;
    const { ok, text } = await fetchText(brandUrl);
    if (!ok) {
      return { attempted: true, scrapedAt, brandFound: true, brandUrl, modelFound: false, fetchError: "Brand page fetch returned non-OK status" };
    }

    const target = normalizeForMatch(modelName);
    const modelLinks = extractModelLinks(text, brandSlug);
    // Exact match first — substring alone would match "Shine" for a "Shine
    // Max" query (normalized "shinemax".includes("shine")), same class of
    // bug as moteur.ma's model matching (see lib/moteurMaScraper.ts).
    const exactMatch = modelLinks.find((mo) => normalizeForMatch(mo.name) === target);
    const substringMatches = exactMatch
      ? []
      : modelLinks.filter((mo) => {
          const n = normalizeForMatch(mo.name);
          return n.includes(target) || target.includes(n);
        });
    const match = exactMatch ?? substringMatches[0];
    if (!match) {
      return { attempted: true, scrapedAt, brandFound: true, brandUrl, modelFound: false };
    }
    const isExactMatch = Boolean(exactMatch);
    // More than one real candidate on the page for this query — e.g. a bare
    // "S06" matching both "S06 ICE" and "S06 DM" — is a genuine ambiguity
    // between two distinct listings, not just an uncertain single guess.
    const ambiguousCandidates = substringMatches.length > 1 ? substringMatches.map((c) => ({ name: c.name, url: c.url })) : undefined;

    const { ok: modelOk, text: modelHtml } = await fetchText(match.url);
    if (!modelOk) {
      return {
        attempted: true,
        scrapedAt,
        brandFound: true,
        brandUrl,
        modelFound: true,
        modelUrl: match.url,
        isExactMatch,
        ambiguousCandidates,
        fetchError: "Model page fetch returned non-OK status",
      };
    }

    const cheapestPriceDh = extractCheapestPriceDh(modelHtml);
    return { attempted: true, scrapedAt, brandFound: true, brandUrl, modelFound: true, modelUrl: match.url, cheapestPriceDh, isExactMatch, ambiguousCandidates };
  } catch (err) {
    return {
      attempted: true,
      scrapedAt,
      brandFound: false,
      modelFound: false,
      fetchError: (err as Error).message ?? "Unknown fetch error",
    };
  }
}
