// Shared instruction text embedded verbatim into every research prompt that
// touches the canonical Powertrain shape: the automated two-turn pipeline
// (lib/techSpecResearch.ts, "🔄 Research this model") AND the manual Kimi/
// DeepSeek round-trip prompt (lib/manualResearchImport.ts, "📋 Export for
// Kimi/DeepSeek"). These two paths are NOT the same prompt end-to-end — they
// solve genuinely different problems (one formats already-fetched Brave
// search results in a two-turn API call with no model-level fields; the
// other is a single-shot prompt handed to a human to paste into an external
// chat UI that does its own search, and additionally round-trips model-level
// fields like segment/price_range via byte-for-byte _id matching instead of
// trim_name matching) — see each file's own header comment. Forcing them
// into one literal prompt string would break one workflow or the other.
//
// What CAN and must be identical is the substantive research instructions
// that both prompts need to give equally well: don't lose real data by
// mistranslating/renaming a value that has to match something on our side.
// Before this file existed, each prompt hand-wrote its own version of these
// rules and they drifted — e.g. the manual prompt's trim_name/Chinese-
// character exception was already correctly worded while the automated
// prompt's was not, until a live research run on BYD Qin PLUS proved it by
// creating duplicate trims. Both prompts now interpolate the exact same
// strings from here, so a future fix to one of these rules can't land in
// only one of the two paths again.

/**
 * The core "don't translate/reword a value that must match an existing
 * record" instruction — used for trim_name (both paths) and, in the manual
 * path, extended to _id as well (that path's own text adds the _id half;
 * this covers only the trim_name half both paths share).
 */
export const TRIM_NAME_FIDELITY_RULE =
  'An existing trim_name must be reused EXACTLY as given, byte-for-byte, including any Chinese characters (e.g. "DM-i 128KM 进取型" must come back as "DM-i 128KM 进取型", never translated to "DM-i 128KM Progressive") — a reworded, translated, or detail-appended trim_name for what is really the same trim is treated as a data-loss bug downstream (it creates a duplicate database record instead of updating the real one), not a helpful improvement.';

/**
 * The OUTPUT LANGUAGE rule, parametrized by extra exceptions beyond the one
 * every path needs (an existing trim_name that must be reproduced
 * unchanged). The manual path adds one more exception (name_cn) via
 * `extraExceptions`; the automated path passes none.
 */
export function buildOutputLanguageRule(extraExceptions: string[] = []): string {
  const exceptions = [
    "an EXISTING trim_name you must reproduce unchanged is exempt — including any Chinese characters, if that's how it's stored — copying it byte-for-byte is required, not something to translate away",
    ...extraExceptions,
  ];
  return `OUTPUT LANGUAGE: every string value in your JSON response must be English — notes, source names, "thermal_evidence", every field — with these exceptions only: ${exceptions.join(
    "; "
  )}. Never leave a single Chinese (or other non-English) character in the output outside those exceptions. If a source is in Chinese, translate the fact/term into English before writing it (e.g. a spec sheet says "液冷" -> write "liquid cooling", not "液冷"). This applies even to fields whose earlier guidance shows a Chinese example — those examples describe what to look FOR in the source, not what to write in the response.`;
}

/** thermal_management mandatory-block rule, identical wording in both prompts. */
export const THERMAL_MANAGEMENT_MANDATORY_RULE =
  'thermal_management is MANDATORY for every trim with a battery (i.e. energy_type !== "ICE"): 0=passive air, 1=active air, 2=active liquid (Morocco minimum), 3=refrigerant-coupled/heat pump (recommended), 4=hybrid intelligent/PCM (best). If genuinely unknown after searching, set thermal_evidence to "UNKNOWN" and morocco_suitable to false — do NOT omit the thermal_management block.';

/**
 * Deliberately the OPPOSITE of "convert to USD yourself" — every price field
 * in this schema (trim_price_min/max, price_range.min/max) must reflect the
 * REAL currency the source actually published, almost always CNY for a
 * Chinese-market vehicle, never a self-converted USD guess. This app already
 * computes USD server-side from a live, real exchange rate (see
 * lib/deepseekNormalize.ts's getCnyPerUsdRate(), used by
 * lib/applySpecUpdates.ts for every price write) specifically so the USD
 * figure a user sees is never an LLM's own unverifiable arithmetic — an
 * AI-guessed rate would drift from the live rate and produce two different
 * USD figures for the same underlying CNY fact depending on which path
 * converted it, and would turn "confirmed" (source-backed CNY price) into
 * "confirmed CNY fact plus trusted-but-uncitable AI math," undermining the
 * same confidence-gating this app requires of every other field. Report the
 * price exactly as published, in its real currency, and let the app convert
 * it — do not do that conversion yourself under any circumstances.
 */
export const CURRENCY_SOURCE_FIDELITY_RULE =
  'CURRENCY: every price field must reflect the REAL currency the source actually published — almost always CNY (元/人民币) for a Chinese-market vehicle. Set the currency field (trim_price_currency) to that real currency code, e.g. "CNY". Do NOT convert any price to USD yourself, do NOT report a USD figure, and do NOT set a currency field to "USD" — this application converts every price to USD separately, server-side, using a live exchange rate; a self-converted or estimated USD figure from you would be unverifiable and would conflict with that live-rate conversion. If you cannot determine what currency a price is actually denominated in, leave the price null rather than guessing.';
