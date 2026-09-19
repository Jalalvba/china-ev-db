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

/**
 * Manufacturer official/after-sales sites — accepted ONLY when a caller opts in via
 * `{ includeManufacturer: true }` (currently just technical_bulletins research,
 * lib/bulletinResearch.ts): TSBs are published on the maker's own service portals, not
 * on the auto-media sites above, so without these that category would almost always
 * come back empty. Not exhaustive — add a domain here when a real bulletin source turns
 * up on one that's missing. Deliberately NOT applied to warranty/positioning/issues/
 * market_trend, which keep the stricter media/regulator-only list.
 */
const MANUFACTURER_SERVICE_DOMAINS = [
  "chery.cn",
  "jetour.com.cn",
  "geely.com",
  "lynkco.com.cn",
  "changan.com.cn",
  "gwm.com.cn",
  "byd.com",
  "gac.com.cn",
  "gacmotor.com",
  "dongfeng.com.cn",
  "faw.com.cn",
  "saicmotor.com",
  "baicgroup.com.cn",
];

export interface SourceGuardOptions {
  /** Also accept the manufacturer service-site domains above. Off by default. */
  includeManufacturer?: boolean;
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** True if `url`'s hostname is the allowlisted domain or a subdomain of it (e.g. "www.autohome.com.cn", "car.autohome.com.cn" both match "autohome.com.cn"). With `includeManufacturer`, official manufacturer service-site domains count too — see MANUFACTURER_SERVICE_DOMAINS. */
export function isAllowedChineseSource(url: string, opts: SourceGuardOptions = {}): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostMatches(host, ALLOWED_DOMAINS)) return true;
  return !!opts.includeManufacturer && hostMatches(host, MANUFACTURER_SERVICE_DOMAINS);
}

/**
 * Filters a list of source URLs down to only the ones on an allowlisted
 * Chinese-source domain. Callers should compute `sourceUrls` from the
 * allowlisted subset, not the raw Brave results, before deciding
 * hasGrounding / running the confidence gate — an empty result here (all
 * results were non-Chinese) must be treated exactly like zero search results
 * at all: force every confidence field to "unconfirmed".
 */
export function filterToChineseSources(urls: string[], opts: SourceGuardOptions = {}): string[] {
  return urls.filter((u) => isAllowedChineseSource(u, opts));
}
