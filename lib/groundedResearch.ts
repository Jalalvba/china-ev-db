// Shared "real search first, then LLM extracts only from what was fetched"
// orchestration — replaces the previous provider's built-in search-grounding tool
// (removed entirely, see lib/aiProvider.ts's header comment) for every
// research flow in this codebase (tech-spec, brand, model-discovery). None
// of DeepSeek/Kimi/Qwen (lib/aiProvider.ts's three direct providers) have a
// native, trustable "I actually searched" signal, so grounding now happens
// at this layer instead: real web results are fetched BEFORE any LLM call
// and embedded directly into the prompt, and "source URLs" downstream is
// always the literal list of URLs Brave Search actually returned — never
// something the model claims to have visited.

import { webSearchMulti, renderSearchResultsForPrompt } from "./webSearch";
import { completeTwoTurn, ModelNotFoundError } from "./aiProvider";

export { ModelNotFoundError };

const REAL_SEARCH_HEADER =
  "=== REAL SEARCH RESULTS (fetched for you before this prompt was built) ===\n" +
  "Extract facts ONLY from the snippets and sources below — do not use any other knowledge, and do not invent or assume a fact that isn't actually present in one of these results. If a fact you need isn't covered by any result below, report it as not found (null) rather than guessing.\n\n";

export interface GroundedResearchResult {
  kickoffText: string;
  formattedText: string;
  /** The real URLs Brave Search actually returned across every query run — the only thing "grounding" means now. Empty means zero real results were found. */
  sourceUrls: string[];
}

/**
 * Runs the shared two-turn research pattern: (1) real multi-query web
 * search, (2) a "kickoff" prose research turn that sees the fetched results
 * embedded directly in its prompt, (3) a "format" turn (same conversation)
 * that reformats turn 2's grounded findings into strict JSON. `searchQueries`
 * should be a handful of distinct, targeted query strings (e.g. brand+model
 * name + "参数配置", + "配置表", + a specific missing spec) — callers already
 * know what they're researching, so they build the query list; this function
 * just does the fetching + prompt-wiring + LLM calls.
 */
export async function runGroundedResearch(opts: {
  kickoffPrompt: string;
  formatPrompt: string;
  searchQueries: string[];
  model?: string;
}): Promise<GroundedResearchResult> {
  const results = await webSearchMulti(opts.searchQueries);
  const sourceUrls = results.map((r) => r.url);

  const augmentedKickoffPrompt = `${opts.kickoffPrompt}\n\n${REAL_SEARCH_HEADER}${renderSearchResultsForPrompt(results)}`;

  const { kickoffText, formattedText } = await completeTwoTurn(augmentedKickoffPrompt, opts.formatPrompt, {
    model: opts.model,
  });

  return { kickoffText, formattedText, sourceUrls };
}

/** Standard Chinese-source-first query set for "research this vehicle" — shared across tech-spec/brand/model-discovery so all three search the same way rather than drifting into slightly different query shapes. Callers may add more targeted queries (e.g. for a specific missing field) on top of this base set. */
export function buildVehicleSearchQueries(brandName: string, modelName: string, brandNameCn?: string, modelNameCn?: string): string[] {
  const cnName = modelNameCn ?? (brandNameCn ? `${brandNameCn} ${modelName}` : undefined);
  const queries = [`${brandName} ${modelName} 参数配置`, `${brandName} ${modelName} 配置表`, `${brandName} ${modelName} specs`];
  if (cnName) queries.push(`${cnName} 参数配置`, `${cnName} 价格`);
  return queries;
}
