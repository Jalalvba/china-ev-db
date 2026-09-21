// Shared fetch/reconcile core for Morocco pricing lookups. Used by
// scripts/sync-morocco-prices.ts (fetch + write in one pass) and by
// scripts/fetch-all-prices.ts (fetch-only, writes a review file instead of
// Mongo — see scripts/analyze-price-fetch.ts and scripts/import-price-fetch.ts
// for the read-only-analyze / approved-write split built on top of it).
//
// Nothing in this file touches Mongo. `processModel` below does call the
// configured AI provider (a network fetch, not a DB write) when the two
// scrapers disagree — that's unavoidable if callers want the same
// reconciliation behavior, but it never writes anything itself; callers
// decide what to do with the result.

import { ModelNotFoundError } from "./aiProvider";
import { lookupMoteurMa, type MoteurMaLookupResult } from "./moteurMaScraper";
import { lookupWandaloo, type WandalooLookupResult } from "./wandalooScraper";

export { ModelNotFoundError };

// Prices are rounded/displayed differently by convention between the two
// sites (single starting price vs. a range's low end, etc.) — treat this as
// normal rounding, not disagreement, so it doesn't waste an AI call. Also
// used by callers to decide whether a re-fetched price on an already
// confirmed model represents a real change.
export const AGREEMENT_TOLERANCE = 0.02;

export type Outcome =
  | "moteur.ma"
  | "wandaloo.com"
  // Sources disagree beyond tolerance. Name kept as "ai-fallback" for
  // call-site/review-file compatibility even though, as of 2026-09-21, this
  // never triggers an AI call anymore — it's a manual-review-needed outcome
  // now, same posture as "non-exact-match" below (never auto-writes a price).
  | "ai-fallback"
  | "non-exact-match"
  | "ambiguous-multiple-candidates"
  | "not-found"
  | "error";

export interface ModelResult {
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

export function pctDiff(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(a, b);
}

export function extractJson(text: string): { price_dh: number | null; url: string | null; reasoning?: string } | null {
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

// Some DB records duplicate the brand name inside `name`/`name_en` (e.g.
// name_en "DFSK Glory 500" for brand "DFSK", or name "Jaecoo J7" for brand
// "Jaecoo") — neither Morocco site's own model name includes the brand
// prefix, so leaving it in defeats exact matching entirely (the "Fengon
// 500" fix earlier this session hit exactly this). Strip a leading
// brand-name token before any lookup attempt.
export function stripLeadingBrandName(brandName: string, modelName: string): string {
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
export const STRIPPABLE_SUFFIXES = ["EM-P", "PHEV", "HEV", "DM-i", "DM", "EV"];

/** Strips exactly one trailing powertrain-tag suffix, if the name ends with one, else returns null. */
export function stripKnownSuffix(modelName: string): string | null {
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

export async function attemptLookup(brandName: string, modelName: string): Promise<LookupAttempt> {
  const moteurResult = await lookupMoteurMa(brandName, modelName);
  const wandalooResult = await lookupWandaloo(brandName, modelName);
  const moteurMatch = moteurResult.models.find((m) => typeof m.cheapestPriceDh === "number");
  return { moteurResult, wandalooResult, moteurMatch };
}

export function hasExactMatch(attempt: LookupAttempt): boolean {
  return Boolean(attempt.moteurMatch?.isExactMatch) || Boolean(attempt.wandalooResult.isExactMatch);
}

/**
 * Pure fetch + reconcile for one model: two scraper lookups, optional
 * suffix-stripping retry, flags a source disagreement for manual review.
 * Never touches Mongo — callers decide what (if anything) to write based on
 * the returned outcome. `dryRun` is accepted for call-site backward
 * compatibility (scripts pass it) but no longer changes behavior here — it
 * used to gate the now-removed AI reconciliation call.
 */
export async function processModel(
  brandName: string,
  rawModelName: string,
  rawModelNameEn: string | undefined,
  _dryRun: boolean,
  disagreementCounter: { count: number }
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
      // route to manual review regardless of whether an AI call would
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
    // Disagreement beyond tolerance. As of 2026-09-21 this no longer calls the AI
    // provider to auto-reconcile (see CLAUDE.md's "no automated API calls anywhere
    // in the app" entry — this was the last live call left in the codebase, found
    // via a full re-audit after a production incident). Routes to manual review
    // instead, same as every other uncertain case in this function
    // (non-exact-match, ambiguous-multiple-candidates) — never writes a price.
    // `disagreementCounter` (renamed from aiCallCounter; kept as the same
    // by-reference counter object so existing callers' summary logging doesn't
    // need restructuring) still counts how often this branch is hit, now just to
    // report how many models need a human to pick between the two sources.
    disagreementCounter.count++;
    return {
      ...base,
      outcome: "ai-fallback",
      moteurPriceDh,
      wandalooPriceDh,
      diffPct: diff,
      note: "moteur.ma and wandaloo.com disagree beyond tolerance — needs manual reconciliation (AI auto-reconciliation removed, no automated calls).",
    };
  }

  // Neither scraper parsed a price. If either fetch reached the brand/model
  // page at all (as opposed to "brand not found anywhere"), that's a parse
  // failure worth an AI attempt rather than a flat "not found" — but we
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
