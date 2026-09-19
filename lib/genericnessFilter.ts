// Drops known-issues items that are not a concrete report about the model: keyword TAGS split out of one
// article, generic troubleshooting/"possible causes"/buying-guide EXPLAINERS, unattributed hearsay, and
// items sourced from encyclopedia/SEO pages. Sits after the exact-model filter in both known-issues passes.
//
// Why it exists (2026-09-19, batches 1-2 + the all-guards re-run): even on clean nameplates the pipeline kept
// items like "Tire uneven wear reported as an issue from user complaints/feedback" ×5 from a single Yiche
// article, a qcds.com fault-code glossary, and "engine light — possible causes" explainers. None of the
// identity/powertrain/URL guards can see that: the page names the model and exists, it just doesn't REPORT
// anything. Same principle as the other guards — the LLM attests `report_type` per item, and a deterministic
// check the LLM doesn't control does the enforcing.
//
// Deliberately conservative where a false rejection would cost real data: it rejects on explicit patterns,
// a small denylist of domains that demonstrably produced explainers, and a same-URL tag-split rule — NOT on
// "is this item short", because short specific items ("Adaptive cruise cannot recuperate energy") are real.

import { normalizeSourceUrl } from "@/lib/categoryValidators";
import type { RejectedItem } from "@/lib/categoryValidators";

export type ReportType = "specific_report" | "aggregate_stats" | "generic_explainer" | "tag_list";

const REPORT_TYPE_ALIASES: Record<ReportType, string[]> = {
  specific_report: ["specific", "report", "incident", "owner_report", "complaint", "media_report", "news", "defect_report", "case"],
  aggregate_stats: ["aggregate", "statistics", "stats", "ranking", "complaint_stats", "aggregate_statistics"],
  generic_explainer: ["explainer", "generic", "guide", "advice", "troubleshooting", "seo", "buying_guide", "general_advice", "encyclopedia"],
  tag_list: ["tag", "tags", "keyword", "keywords", "keyword_list", "topic_list", "list"],
};

/** Exact token, else alias; undefined (never a guess) when unrecognized or absent. */
export function normalizeReportType(v: unknown): ReportType | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "specific_report" || t === "aggregate_stats" || t === "generic_explainer" || t === "tag_list") return t;
  for (const [canonical, aliases] of Object.entries(REPORT_TYPE_ALIASES)) if (aliases.includes(t)) return canonical as ReportType;
  return undefined;
}

// "Some owners say…", "reported as an issue from user complaints/feedback" — attribution-free boilerplate.
const HEARSAY_RE = /\b(?:according to )?some (?:owners?|users?|drivers?|customers?|netizens?)\b|\breported as an issue from (?:user )?(?:complaints?|feedback)\b|\bfrom user complaints\/feedback\b|\bowners? (?:generally|commonly|usually) (?:feel|say|report|complain)\b/i;

// Advice / troubleshooting / buying-guide language: describes a CLASS of fault, not an incident on this model.
const EXPLAINER_RE = /\b(?:possible|common|typical|usual|main|likely) (?:causes?|reasons?)\b|\bcan be caused by\b|\b(?:is|are) (?:usually|often|typically|commonly) caused by\b|\bhow to (?:fix|repair|troubleshoot|solve)\b|\byears to avoid\b|\bbuying guide\b|\bwhat to (?:do|check)\b|\blisted as (?:a )?(?:common|typical)\b|\bcommon (?:fault|faults|failure|failures|problem|problems|issue|issues) (?:areas?|on|of)\b|\bon used (?:vehicles|cars)\b|\bcommon (?:no-start|starting) (?:causes?|reasons?)\b/i;

// Domains/paths that DEMONSTRABLY produced explainers/SEO in the live batches (qcds fault-code glossary, encyclopedia
// entries, Taobao/Alibaba SEO pages, "years to avoid" listicles). Kept small on purpose; extend from evidence, not guesses.
const EXPLAINER_HOST_RE = /(?:^|\.)(?:qcds\.com|bk\.taobao\.com|alibaba\.com|yearstoavoid\.co|avtomir\.site|cyargpt\.com)$|^baike\./i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const urlKey = (raw: unknown): string | undefined => {
  const u = normalizeSourceUrl(raw).url;
  if (!u) return undefined;
  try {
    const x = new URL(u);
    return `${x.hostname}${x.pathname}`.replace(/\/$/, "");
  } catch {
    return undefined;
  }
};
const hostOf = (raw: unknown): string | undefined => {
  const u = normalizeSourceUrl(raw).url;
  try {
    return u ? new URL(u).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};

/** A same-URL group of at least this many items is a tag-split candidate; it is rejected when the items are short. */
export const TAG_SPLIT_MIN_GROUP = 3;
export const TAG_SPLIT_MAX_MEDIAN_WORDS = 14;

/**
 * Applies the specificity rules to items that already passed the exact-model filter. Returns the survivors (with the
 * research-time `report_type` attestation stripped) and every rejection with its reason and the item's own text.
 */
export function filterGenericItems(raw: unknown[]): { kept: unknown[]; rejected: RejectedItem[]; warnings: string[] } {
  const rejected: RejectedItem[] = [];
  const stage1: { rec: Record<string, unknown>; index: number }[] = [];

  raw.forEach((item, index) => {
    const rec = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    if (!rec) return void stage1.push({ rec: item as never, index });
    const desc = typeof rec.issue_description === "string" ? rec.issue_description : "";
    const summary = desc.replace(/\s+/g, " ").slice(0, 110);
    const reject = (reason: string) => void rejected.push({ index, reason, summary });

    const type = normalizeReportType(rec.report_type);
    if (type === "generic_explainer") return reject("source is a generic explainer/advice page, not a report about this model (attested)");
    if (type === "tag_list") return reject("bare keyword from a list of topics, not a concrete report (attested)");
    if (HEARSAY_RE.test(desc)) return reject("unattributed hearsay/boilerplate ('some owners say…', 'reported as an issue from user feedback')");
    if (EXPLAINER_RE.test(desc)) return reject("reads as a generic explainer (possible causes / buying guide / used-car fault list), not an incident");
    const host = hostOf(rec.source_url);
    if (host && EXPLAINER_HOST_RE.test(host)) return reject(`source is an encyclopedia/SEO/explainer site (${host})`);
    stage1.push({ rec, index });
  });

  // Tag-split: several SHORT items from one URL = one article's keyword list turned into items.
  const groups = new Map<string, typeof stage1>();
  for (const s of stage1) {
    const k = urlKey(s.rec?.source_url);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const dropSet = new Set<number>();
  for (const [key, g] of groups) {
    if (g.length < TAG_SPLIT_MIN_GROUP) continue;
    const med = median(g.map((s) => words(typeof s.rec.issue_description === "string" ? s.rec.issue_description : "")));
    if (med >= TAG_SPLIT_MAX_MEDIAN_WORDS) continue;
    for (const s of g) {
      dropSet.add(s.index);
      const desc = typeof s.rec.issue_description === "string" ? s.rec.issue_description : "";
      rejected.push({ index: s.index, reason: `one of ${g.length} short items from a single page (${key}) — a keyword list split into items, median ${med} words`, summary: desc.replace(/\s+/g, " ").slice(0, 110) });
    }
  }

  const kept = stage1
    .filter((s) => !dropSet.has(s.index))
    .map((s) => {
      if (!s.rec || typeof s.rec !== "object") return s.rec;
      const { report_type: _rt, ...rest } = s.rec;
      void _rt;
      return rest;
    });
  return { kept, rejected, warnings: [] };
}

// ---------- the combined known-issues item filter (exact-model + powertrain, THEN specificity) ----------
import { filterIssuesToTargetModel } from "@/lib/categoryValidators";
import type { TargetModel } from "@/lib/categoryValidators";

/**
 * The one filter both known-issues passes (China + Global) apply to raw researched items: the exact-model/powertrain
 * filter first (which keeps `report_type` untouched), then the specificity filter (which strips it). Specificity
 * rejections are labelled "too generic:" so a reviewer can tell them from off-model ones.
 */
export function filterIssueItems(raw: unknown, target: TargetModel): { kept: unknown[]; rejected: RejectedItem[]; warnings: string[] } {
  const identity = filterIssuesToTargetModel(raw, target);
  const generic = filterGenericItems(identity.kept);
  return {
    kept: generic.kept,
    rejected: [...identity.rejected, ...generic.rejected.map((r) => ({ ...r, index: -1, reason: `too generic: ${r.reason}` }))],
    warnings: identity.warnings,
  };
}

/** Label for a rejection in the review UI: "off-model: …" vs "too generic: …". */
export function rejectionLabel(r: RejectedItem): string {
  return `${r.reason.startsWith("too generic:") ? "" : "off-model: "}${r.reason}${r.summary ? ` — "${r.summary}"` : ""}`;
}
