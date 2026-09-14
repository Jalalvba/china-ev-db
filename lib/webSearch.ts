// Real web search — fetches actual search results BEFORE any LLM call, so
// every research flow in this codebase can ground its prompts in real
// fetched snippets/URLs instead of trusting a provider's built-in "I
// searched" claim (which is what the previous provider's built-in search tool gave us, and
// what none of DeepSeek/Kimi/Qwen offer natively).
//
// Provider: Brave Search API. Chosen over Tavily/SerpAPI for this project
// because (a) it has the most generous no-cost tier for a hobby-scale
// research pipeline — 2,000 queries/month free vs. Tavily's 1,000/month —
// and (b) it returns real web results (title/url/snippet) directly, no
// LLM-summarization step baked into the search response itself, which
// matters here: this codebase's whole safety model is "the LLM only
// extracts from what was actually fetched," so the search step needs to
// hand back raw snippets, not an already-synthesized answer.
// Get a key at https://api.search.brave.com/app/keys (free tier, no card
// required for the Free plan).

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export class SearchNotConfiguredError extends Error {
  constructor() {
    super("Missing SEARCH_API_KEY. Get a free Brave Search API key at https://api.search.brave.com/app/keys and set it in .env.");
    this.name = "SearchNotConfiguredError";
  }
}

/**
 * Runs one real web search and returns whatever results actually came back
 * (never fabricated) — an empty array means "no real results were found,"
 * which callers must treat as zero grounding (same as the old provider's
 * zero-citation gate: force "unconfirmed" downstream, never fill in a
 * plausible-sounding answer from the model's own training data).
 */
export async function webSearch(query: string, count = 8): Promise<SearchResult[]> {
  const apiKey = process.env.SEARCH_API_KEY;
  if (!apiKey) throw new SearchNotConfiguredError();

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    // A search-provider failure (rate limit, bad key, outage) is not the
    // same as "genuinely found nothing" — surface it so the caller can
    // decide whether to retry/skip, rather than silently treating a 429 as
    // zero real results and forcing every field unconfirmed for a reason
    // that has nothing to do with the actual research question.
    throw new Error(`Brave Search request failed (${res.status}): ${await res.text().catch(() => res.statusText)}`);
  }

  const data = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };

  return (data.web?.results ?? [])
    .filter((r): r is { title: string; url: string; description?: string } => Boolean(r.title && r.url))
    .map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
}

/** Runs several searches (different query phrasings/fields) and merges results, deduping by URL — the multi-query pattern every research prompt in this codebase already asks the LLM to simulate ("run a distinct, targeted search per field") now backed by real fetches instead of the model's own claim to have done so. */
export async function webSearchMulti(queries: string[], countPerQuery = 5): Promise<SearchResult[]> {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const q of queries) {
    let results: SearchResult[];
    try {
      results = await webSearch(q, countPerQuery);
    } catch {
      continue; // one bad query shouldn't sink the whole multi-search batch
    }
    for (const r of results) {
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
    }
  }
  return merged;
}

/** Renders fetched results as a numbered source block for embedding directly into an LLM prompt — the "actual fetched snippets/URLs" the model is told to extract only from. */
export function renderSearchResultsForPrompt(results: SearchResult[]): string {
  if (results.length === 0) return "(No real search results were found for this query.)";
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}
