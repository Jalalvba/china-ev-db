// Defense-in-depth domain allowlist for the four Chinese-source-only research
// modules (lib/issueResearch.ts, lib/warrantyResearch.ts,
// lib/positioningResearch.ts, lib/workshopResearch.ts). These categories have
// a hard requirement — see CLAUDE.md-adjacent instructions given for this
// work — that every accepted source is a Chinese-language site; an English or
// third-country source slipping in defeats the whole point (e.g. a Moroccan
// forum's guess about warranty terms getting treated as ground truth). Query
// construction (Chinese search terms) and prompt instructions are the first
// layer; this is the second, code-level layer that doesn't depend on the LLM
// actually following the prompt instruction — it filters the real Brave
// Search result URLs themselves before they're allowed to count as
// "grounding" for the confidence gate.
//
// Not exhaustive by design: an allowlist of known-good Chinese automotive/
// government domains, not a language detector. A genuine Chinese source on an
// unlisted domain will be dropped too (false negative, safe direction) rather
// than risk accepting an English source hosted on a domain that merely looks
// Chinese (false positive, unsafe direction).
const ALLOWED_DOMAINS = [
  "autohome.com.cn",
  "dongchedi.com",
  "pcauto.com.cn",
  "yiche.com",
  "12365auto.com", // 车质网 — official vehicle quality complaint platform
  "12365auto.com.cn",
  "tousu.99.com", // 汽车投诉网
  "12365auto.cn",
  "samr.gov.cn", // 国家市场监督管理总局 — recall database
  "chinaservicenetwork.gov.cn",
  "che168.com",
  "bitauto.com",
  "xchuxing.com",
];

/** True if `url`'s hostname is the allowlisted domain or a subdomain of it (e.g. "www.autohome.com.cn", "car.autohome.com.cn" both match "autohome.com.cn"). Also allows the official-manufacturer-site pattern: any hostname containing "-owner" is out of scope for that heuristic (manufacturers publish 服务/售后 pages on their own primary domains, which can't be enumerated in advance) — see `isLikelyManufacturerServiceUrl`. */
export function isAllowedChineseSource(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Filters a list of source URLs down to only the ones on an allowlisted
 * Chinese-source domain. Callers should compute `sourceUrls` from the
 * allowlisted subset, not the raw Brave results, before deciding
 * hasGrounding / running the confidence gate — an empty result here (all
 * results were non-Chinese) must be treated exactly like zero search results
 * at all: force every confidence field to "unconfirmed".
 */
export function filterToChineseSources(urls: string[]): string[] {
  return urls.filter(isAllowedChineseSource);
}
