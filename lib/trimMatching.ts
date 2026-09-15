// Shared trim-name matching, used by BOTH the review screen
// (app/TechSpecUpdater.tsx) and the actual write path
// (lib/applySpecUpdates.ts) — one implementation, so the match the user sees
// in review is guaranteed to be the match the write path acts on.
//
// Why this exists: the AI does not reliably reproduce an existing trim name
// character-for-character across separate research passes, even when told
// the exact existing name (e.g. stored "1.6T" came back as
// "1.6T (290T / 1.6TGDI)" on a re-research pass). Matching Powertrain writes
// on exact `trim_name` string equality alone would silently create a
// duplicate trim doc instead of updating the existing one. Positional/
// ordinal matching was considered and rejected: it breaks the moment the AI
// returns trims in a different order or count, which is the common case for
// a partial re-research pass, not the exception.

/** Lowercase, strip parenthetical asides and punctuation, collapse whitespace — makes "1.6T (290T / 1.6TGDI)" and "1.6T" compare equal. */
export function normalizeTrimName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/[·•\-–—_,.:;!?"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface TrimMatchResult {
  /** The EXISTING stored trim_name this new name matches, or null if no confident match was found (including an ambiguous multi-match — never guessed). */
  matchedTrimName: string | null;
  /** True if the match was an exact, un-normalized string match. */
  exact: boolean;
  /**
   * Set (to the existing trim_name it's suspected of being a translation of)
   * only when matchedTrimName is null AND heuristicallyLikelyTranslation()
   * fires — the AI's response looks like a rewritten/translated version of an
   * existing trim rather than a genuinely new one (see that function's
   * comment for the heuristic and why prompt instructions alone aren't
   * trustworthy here: this was caught live — DeepSeek translated Chinese
   * trim_names to English despite an explicit "reuse verbatim" instruction,
   * which silently created duplicate Powertrain docs before this flag
   * existed). Never auto-resolved either way — surfaced to the reviewer
   * (app/TechSpecUpdater.tsx) as an unchecked-by-default warning instead of
   * matched or silently created as new.
   */
  likelyTranslationOf: string | null;
}

const CJK_RE = /[一-鿿]/;

/** Pulls out standalone numbers/codes (e.g. "128", "210", "DM-i", "AWD") — the parts of a trim badge that survive translation even when the surrounding words don't. */
function structuralTokens(name: string): Set<string> {
  const matches = name.match(/[A-Za-z]+-?[A-Za-z0-9]*|\d+/g) ?? [];
  return new Set(matches.map((t) => t.toLowerCase()));
}

/**
 * Cheap heuristic for "this looks like a translation of an existing trim,
 * not a genuinely new one" — not a translation API, just a structural
 * signal: one side has CJK characters and the other doesn't (a real
 * character-set flip, not just wording), AND they share at least one
 * structural token (a shared number or alnum code like "128" or "DM-i"),
 * which a truly unrelated new trim wouldn't have any particular reason to
 * share. Deliberately conservative — false negatives (missing a real
 * translation case) just fall through to today's "no match, create new"
 * behavior; a false positive only costs the reviewer one extra glance at a
 * flagged card, never a silent wrong auto-match.
 */
export function isLikelyTranslation(newTrimName: string, existingTrimName: string): boolean {
  const newHasCjk = CJK_RE.test(newTrimName);
  const existingHasCjk = CJK_RE.test(existingTrimName);
  if (newHasCjk === existingHasCjk) return false; // both or neither — not a script flip
  const newTokens = structuralTokens(newTrimName);
  const existingTokens = structuralTokens(existingTrimName);
  if (newTokens.size === 0 || existingTokens.size === 0) return false;
  for (const t of newTokens) {
    if (existingTokens.has(t)) return true;
  }
  return false;
}

/** Matches a newly-researched trim name against a model's existing trim names: exact string match first, then a normalized match — but ONLY if exactly one existing trim normalizes to the same form (an ambiguous match is reported as no match, never guessed). Falls back to isLikelyTranslation() as a flagged (not auto-resolved) possibility when no confident match is found. */
export function matchTrimName(newTrimName: string, existingTrimNames: string[]): TrimMatchResult {
  if (existingTrimNames.includes(newTrimName)) {
    return { matchedTrimName: newTrimName, exact: true, likelyTranslationOf: null };
  }
  const normalizedNew = normalizeTrimName(newTrimName);
  const normalizedMatches = existingTrimNames.filter((t) => normalizeTrimName(t) === normalizedNew);
  if (normalizedMatches.length === 1) {
    return { matchedTrimName: normalizedMatches[0], exact: false, likelyTranslationOf: null };
  }
  const translationCandidates = existingTrimNames.filter((t) => isLikelyTranslation(newTrimName, t));
  return {
    matchedTrimName: null,
    exact: false,
    likelyTranslationOf: translationCandidates.length === 1 ? translationCandidates[0] : null,
  };
}
