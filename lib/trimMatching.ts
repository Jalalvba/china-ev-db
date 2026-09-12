// Shared trim-name matching, used by BOTH the review screen
// (app/TechSpecUpdater.tsx) and the actual write path
// (lib/applySpecUpdates.ts) — one implementation, so the match the user sees
// in review is guaranteed to be the match the write path acts on.
//
// Why this exists: Gemini does not reliably reproduce an existing trim name
// character-for-character across separate research passes, even when told
// the exact existing name (e.g. stored "1.6T" came back as
// "1.6T (290T / 1.6TGDI)" on a re-research pass). Matching Powertrain writes
// on exact `trim_name` string equality alone would silently create a
// duplicate trim doc instead of updating the existing one. Positional/
// ordinal matching was considered and rejected: it breaks the moment Gemini
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
}

/** Matches a newly-researched trim name against a model's existing trim names: exact string match first, then a normalized match — but ONLY if exactly one existing trim normalizes to the same form (an ambiguous match is reported as no match, never guessed). */
export function matchTrimName(newTrimName: string, existingTrimNames: string[]): TrimMatchResult {
  if (existingTrimNames.includes(newTrimName)) {
    return { matchedTrimName: newTrimName, exact: true };
  }
  const normalizedNew = normalizeTrimName(newTrimName);
  const normalizedMatches = existingTrimNames.filter((t) => normalizeTrimName(t) === normalizedNew);
  if (normalizedMatches.length === 1) {
    return { matchedTrimName: normalizedMatches[0], exact: false };
  }
  return { matchedTrimName: null, exact: false };
}
