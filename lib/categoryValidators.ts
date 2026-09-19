// Single source of truth for validating/normalizing the four Model-level research
// categories (market_trend, known_issues, technical_bulletins, recalls). Used by all
// three ingestion paths — live AI research (lib/*Research.ts), the apply routes, and
// the manual research-categories-v1 importer — so a shape/enum rule can never drift
// between them.
//
// Every normalize* function follows CLAUDE.md's "AI free text needs a normalization
// layer before enum validation" rule: resolve a known alias, and return undefined
// (never a guessed/passthrough value) when nothing matches. Callers decide what an
// unresolved value means for that field (null, or "other" for affected_component).

import { AFFECTED_SYSTEMS, SALES_TRENDS } from "@/types/researchCategories";
import type { AffectedSystem, IMarketTrend, IRecall, ITechnicalBulletin, IssueRegion, SalesTrend } from "@/types/researchCategories";
import type { Confidence, IKnownIssue } from "@/types";
import { isAllowedChineseSource } from "@/lib/chineseSourceGuard";

const AFFECTED_SYSTEM_SET = new Set<string>(AFFECTED_SYSTEMS);
const SALES_TREND_SET = new Set<string>(SALES_TRENDS);

// ---------- primitive normalizers ----------

export function normalizeString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Anything other than exactly "confirmed" is "unconfirmed" — the safe direction. */
export function normalizeConfidence(v: unknown): Confidence {
  return typeof v === "string" && v.trim().toLowerCase() === "confirmed" ? "confirmed" : "unconfirmed";
}

/** Accepts YYYY-MM-DD / YYYY-MM plus the common variants a chat UI returns (YYYY/MM/DD, YYYY.MM.DD, 2024年3月15日, 2024年3月); anything else → undefined. */
export function normalizeDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  const m = t.match(/^(\d{4})[-/.年]\s*(\d{1,2})(?:[-/.月]\s*(\d{1,2})日?)?\s*月?$/);
  if (!m) return undefined;
  const year = m[1];
  const month = Number(m[2]);
  if (month < 1 || month > 12) return undefined;
  const mm = String(month).padStart(2, "0");
  if (m[3] === undefined) return `${year}-${mm}`;
  const day = Number(m[3]);
  if (day < 1 || day > 31) return undefined;
  return `${year}-${mm}-${String(day).padStart(2, "0")}`;
}

const SALES_TREND_ALIASES: Record<SalesTrend, string[]> = {
  growing: ["rising", "increasing", "up", "growth", "surging", "strong growth", "upward", "expanding"],
  stable: ["flat", "steady", "plateau", "plateaued", "unchanged", "consistent"],
  declining: ["falling", "down", "decreasing", "shrinking", "downward", "weakening", "dropping", "decline"],
  discontinued: ["ended", "eol", "end of production", "halted", "stopped", "phased out", "ceased"],
};

export function normalizeSalesTrend(v: unknown): SalesTrend | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (SALES_TREND_SET.has(t)) return t as SalesTrend;
  for (const [canonical, aliases] of Object.entries(SALES_TREND_ALIASES)) {
    if (aliases.includes(t)) return canonical as SalesTrend;
  }
  return undefined;
}

// Ordered: first keyword hit wins, so put the more specific systems before "electronics"/"other".
const COMPONENT_KEYWORDS: [AffectedSystem, string[]][] = [
  ["transmission", ["transmission", "gearbox", "transaxle", "dht", "dct", "cvt", "clutch", "shift"]],
  ["battery", ["battery", "pack", "cell", "bms"]],
  ["motor", ["motor", "e-drive", "edrive", "inverter", "traction"]],
  ["engine", ["engine", "combustion", "turbo", "piston", "cylinder", "fuel"]],
  ["climate", ["climate", "hvac", "air conditioning", "a/c", "heat pump", "compressor", "coolant"]],
  ["chassis", ["chassis", "suspension", "brake", "steering", "axle", "wheel", "tire", "tyre"]],
  ["body", ["body", "door", "window", "glass", "seat", "sunroof", "roof", "paint", "trim", "airbag"]],
  ["electronics", ["electronic", "electrical", "software", "ecu", "wiring", "harness", "sensor", "infotainment", "ota", "display", "screen"]],
];

const REGION_ALIASES: Record<IssueRegion, string[]> = {
  china: ["cn", "chinese", "chinese market", "china market", "domestic", "mainland", "mainland china", "prc"],
  global: ["international", "export", "overseas", "worldwide", "abroad", "non-china", "foreign", "export market"],
};

/** Exact enum value, else a known alias, else undefined — a region is never guessed. */
export function normalizeRegion(v: unknown): IssueRegion | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (t === "china" || t === "global") return t;
  for (const [canonical, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.includes(t)) return canonical as IssueRegion;
  }
  return undefined;
}

/** Exact enum value, else first keyword hit, else undefined (caller falls back to "other" + keeps the original text in component_detail). */
export function normalizeAffectedComponent(v: unknown): AffectedSystem | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (AFFECTED_SYSTEM_SET.has(t)) return t as AffectedSystem;
  for (const [system, words] of COMPONENT_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return system;
  }
  return undefined;
}

export interface NormalizeNotes {
  /** Human-readable notes about anything normalized/dropped, for the review UI. */
  warnings: string[];
}

// ---------- per-item normalize + validate ----------
// Each returns { item, errors, warnings }. `item` is present only when errors is empty.

export interface ItemResult<T> {
  item?: T;
  errors: string[];
  warnings: string[];
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function checkUnknownKeys(rec: Record<string, unknown>, allowed: string[], errors: string[]): void {
  const set = new Set(allowed);
  for (const k of Object.keys(rec)) if (!set.has(k)) errors.push(`${k}: unexpected field, not in canonical shape`);
}

/** Confidence never stays "confirmed" without a real http(s) source URL. */
function gateConfidenceOnUrl(confidence: Confidence, url: string | undefined, warnings: string[]): Confidence {
  if (confidence === "confirmed" && !url) {
    warnings.push("marked confirmed but has no source_url — downgraded to unconfirmed");
    return "unconfirmed";
  }
  return confidence;
}

const MARKET_TREND_KEYS = ["market_share_segment", "sales_trend", "trend_evidence", "source_url", "confidence"];

export function normalizeMarketTrend(raw: unknown, opts: { checkChineseSource?: boolean } = {}): ItemResult<Omit<IMarketTrend, "_last_researched_at">> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rec = asRecord(raw);
  if (!rec) return { errors: ["market_trend is not an object"], warnings };
  checkUnknownKeys(rec, MARKET_TREND_KEYS, errors);

  const sales_trend = normalizeSalesTrend(rec.sales_trend);
  if (rec.sales_trend != null && sales_trend === undefined) warnings.push(`sales_trend ${JSON.stringify(rec.sales_trend)} not recognized — set to null`);
  const source_url = isHttpUrl(rec.source_url) ? rec.source_url : undefined;
  if (rec.source_url != null && !source_url) warnings.push("source_url is not a valid http(s) URL — dropped");

  const market_share_segment = normalizeString(rec.market_share_segment);
  const trend_evidence = normalizeString(rec.trend_evidence);
  if (!market_share_segment && !sales_trend && !trend_evidence) errors.push("market_trend has no content (all of market_share_segment/sales_trend/trend_evidence are empty)");

  let confidence = gateConfidenceOnUrl(normalizeConfidence(rec.confidence), source_url, warnings);
  if (opts.checkChineseSource && confidence === "confirmed" && source_url && !isAllowedChineseSource(source_url)) {
    warnings.push("source_url is not on the Chinese-source allowlist — downgraded to unconfirmed");
    confidence = "unconfirmed";
  }

  if (errors.length > 0) return { errors, warnings };
  return {
    item: {
      ...(market_share_segment ? { market_share_segment } : {}),
      ...(sales_trend ? { sales_trend } : {}),
      ...(trend_evidence ? { trend_evidence } : {}),
      ...(source_url ? { source_url } : {}),
      _confidence: confidence,
    },
    errors: [],
    warnings,
  };
}

const ISSUE_KEYS = ["region", "issue_description", "affected_systems", "frequency_signal", "source", "source_url", "confidence"];

/** `region` is stamped by the caller (the research route / apply route knows which region it is); a region present in the raw item must agree with it. */
export function normalizeIssue(raw: unknown, region: IssueRegion, opts: { checkChineseSource?: boolean } = {}): ItemResult<IKnownIssue> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rec = asRecord(raw);
  if (!rec) return { errors: ["not an object"], warnings };
  checkUnknownKeys(rec, ISSUE_KEYS, errors);
  if (rec.region != null && rec.region !== region) errors.push(`region: ${JSON.stringify(rec.region)} does not match the "${region}" pass this item is being applied under`);

  const issue_description = normalizeString(rec.issue_description);
  if (!issue_description) errors.push("issue_description: required non-empty string");

  const rawSystems = Array.isArray(rec.affected_systems) ? rec.affected_systems : rec.affected_systems != null ? [rec.affected_systems] : [];
  const systems: AffectedSystem[] = [];
  for (const s of rawSystems) {
    const norm = normalizeAffectedComponent(s);
    systems.push(norm ?? "other");
    if (norm === undefined) warnings.push(`affected_systems value ${JSON.stringify(s)} not recognized — set to "other"`);
  }
  const affected_systems = [...new Set(systems)];
  if (affected_systems.length === 0) errors.push("affected_systems: must be a non-empty array");

  const source = normalizeString(rec.source);
  if (!source) errors.push("source: required non-empty string");
  const source_url = isHttpUrl(rec.source_url) ? rec.source_url : undefined;
  if (rec.source_url != null && !source_url) warnings.push("source_url is not a valid http(s) URL — dropped");
  const frequency_signal = normalizeString(rec.frequency_signal);

  let confidence = normalizeConfidence(rec.confidence);
  if (opts.checkChineseSource && confidence === "confirmed" && source_url && !isAllowedChineseSource(source_url)) {
    warnings.push("source_url is not on the Chinese-source allowlist — downgraded to unconfirmed");
    confidence = "unconfirmed";
  }
  if (region === "global" && source_url && isAllowedChineseSource(source_url)) {
    warnings.push('global issue cites a Chinese-market complaint source — that population belongs under region "china"');
  }

  if (errors.length > 0) return { errors, warnings };
  return {
    item: {
      region,
      issue_description: issue_description!,
      affected_systems,
      ...(frequency_signal ? { frequency_signal } : {}),
      source: source!,
      ...(source_url ? { source_url } : {}),
      confidence,
    },
    errors: [],
    warnings,
  };
}

function resolveComponent(rec: Record<string, unknown>, errors: string[], warnings: string[]): { affected_component: AffectedSystem; component_detail?: string } {
  const detailIn = normalizeString(rec.component_detail);
  const norm = normalizeAffectedComponent(rec.affected_component);
  if (norm) return { affected_component: norm, ...(detailIn ? { component_detail: detailIn } : {}) };
  const original = normalizeString(rec.affected_component);
  if (!original) {
    errors.push("affected_component: required");
    return { affected_component: "other" };
  }
  warnings.push(`affected_component ${JSON.stringify(original)} not recognized — set to "other", original kept in component_detail`);
  return { affected_component: "other", component_detail: detailIn ?? original };
}

const BULLETIN_KEYS = ["bulletin_id", "issue_description", "affected_component", "component_detail", "issued_date", "source_url", "confidence"];

export function normalizeBulletin(raw: unknown, opts: { checkChineseSource?: boolean } = {}): ItemResult<ITechnicalBulletin> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rec = asRecord(raw);
  if (!rec) return { errors: ["not an object"], warnings };
  checkUnknownKeys(rec, BULLETIN_KEYS, errors);

  const issue_description = normalizeString(rec.issue_description);
  if (!issue_description) errors.push("issue_description: required non-empty string");
  const component = resolveComponent(rec, errors, warnings);
  const source_url = isHttpUrl(rec.source_url) ? rec.source_url : undefined;
  if (!source_url) errors.push("source_url: required valid http(s) URL");
  const issued_date = normalizeDate(rec.issued_date);
  if (rec.issued_date != null && issued_date === undefined) warnings.push(`issued_date ${JSON.stringify(rec.issued_date)} not a recognizable date — set to null`);
  const bulletin_id = normalizeString(rec.bulletin_id);

  let confidence = normalizeConfidence(rec.confidence);
  if (opts.checkChineseSource && confidence === "confirmed" && source_url && !isAllowedChineseSource(source_url, { includeManufacturer: true })) {
    warnings.push("source_url is not on the Chinese/manufacturer-source allowlist — downgraded to unconfirmed");
    confidence = "unconfirmed";
  }

  if (errors.length > 0) return { errors, warnings };
  return {
    item: {
      ...(bulletin_id ? { bulletin_id } : {}),
      issue_description: issue_description!,
      ...component,
      ...(issued_date ? { issued_date } : {}),
      source_url: source_url!,
      confidence,
    },
    errors: [],
    warnings,
  };
}

const RECALL_KEYS = [
  "recall_id",
  "issue_description",
  "affected_component",
  "component_detail",
  "recall_date",
  "remedy_description",
  "affected_scope",
  "issuing_body",
  "required_tools",
  "source_url",
  "confidence",
];
const REQUIRED_TOOLS_KEYS = ["uses_brand_diagnostic_interface", "special_tool_names", "extra_tool_note"];

export function normalizeRecall(raw: unknown): ItemResult<IRecall> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rec = asRecord(raw);
  if (!rec) return { errors: ["not an object"], warnings };
  checkUnknownKeys(rec, RECALL_KEYS, errors);

  const issue_description = normalizeString(rec.issue_description);
  if (!issue_description) errors.push("issue_description: required non-empty string");
  const remedy_description = normalizeString(rec.remedy_description);
  if (!remedy_description) errors.push("remedy_description: required non-empty string");
  const component = resolveComponent(rec, errors, warnings);
  const source_url = isHttpUrl(rec.source_url) ? rec.source_url : undefined;
  if (!source_url) errors.push("source_url: required valid http(s) URL");
  const recall_date = normalizeDate(rec.recall_date);
  if (rec.recall_date != null && recall_date === undefined) warnings.push(`recall_date ${JSON.stringify(rec.recall_date)} not a recognizable date — set to null`);

  let required_tools: IRecall["required_tools"];
  if (rec.required_tools != null) {
    const rt = asRecord(rec.required_tools);
    if (!rt) {
      errors.push("required_tools: must be an object or null");
    } else {
      checkUnknownKeys(rt, REQUIRED_TOOLS_KEYS, errors);
      if (typeof rt.uses_brand_diagnostic_interface !== "boolean") {
        errors.push("required_tools.uses_brand_diagnostic_interface: required boolean");
      } else {
        const names = Array.isArray(rt.special_tool_names) ? rt.special_tool_names.map(normalizeString).filter((n): n is string => !!n) : [];
        const note = normalizeString(rt.extra_tool_note);
        required_tools = {
          uses_brand_diagnostic_interface: rt.uses_brand_diagnostic_interface,
          ...(names.length > 0 ? { special_tool_names: names } : {}),
          ...(note ? { extra_tool_note: note } : {}),
        };
      }
    }
  }

  const recall_id = normalizeString(rec.recall_id);
  const affected_scope = normalizeString(rec.affected_scope);
  const issuing_body = normalizeString(rec.issuing_body);
  const confidence = normalizeConfidence(rec.confidence);

  if (errors.length > 0) return { errors, warnings };
  return {
    item: {
      ...(recall_id ? { recall_id } : {}),
      issue_description: issue_description!,
      ...component,
      ...(recall_date ? { recall_date } : {}),
      remedy_description: remedy_description!,
      ...(affected_scope ? { affected_scope } : {}),
      ...(issuing_body ? { issuing_body } : {}),
      ...(required_tools ? { required_tools } : {}),
      source_url: source_url!,
      confidence,
    },
    errors: [],
    warnings,
  };
}

// ---------- array helpers ----------

export interface ArrayResult<T> {
  items: T[];
  /** Per-input-index errors for dropped items. */
  dropped: { index: number; errors: string[] }[];
  warnings: string[];
}

export function normalizeArray<T>(raw: unknown, fn: (item: unknown) => ItemResult<T>): ArrayResult<T> {
  if (!Array.isArray(raw)) return { items: [], dropped: [{ index: -1, errors: ["not an array"] }], warnings: [] };
  const items: T[] = [];
  const dropped: { index: number; errors: string[] }[] = [];
  const warnings: string[] = [];
  raw.forEach((r, i) => {
    const res = fn(r);
    if (res.item) items.push(res.item);
    else dropped.push({ index: i, errors: res.errors });
    res.warnings.forEach((w) => warnings.push(`[${i}] ${w}`));
  });
  return { items, dropped, warnings };
}

// ---------- merge keys (dedupe) ----------

export function issueKey(i: { region?: string; issue_description: string }): string {
  return `${i.region ?? "china"}::${i.issue_description}`;
}
export function bulletinKey(b: { bulletin_id?: string; issue_description: string }): string {
  return b.bulletin_id ? `id::${b.bulletin_id}` : `desc::${b.issue_description}`;
}
export function recallKey(r: { recall_id?: string; issue_description: string }): string {
  return r.recall_id ? `id::${r.recall_id}` : `desc::${r.issue_description}`;
}

/** Append `incoming` to `existing`, skipping incoming items whose key already exists. Returns the merged array and how many were actually added. */
export function mergeByKey<T>(existing: T[], incoming: T[], keyFn: (t: T) => string): { merged: T[]; added: number } {
  const seen = new Set(existing.map(keyFn));
  const fresh: T[] = [];
  for (const item of incoming) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(item);
  }
  return { merged: [...existing, ...fresh], added: fresh.length };
}

// ---------- exact-model gate for known_issues research ----------
//
// Real incident (2026-09-19): the first global pass on "Song Ultra DM-i" returned 8
// items, 7 of them prose-framed as "Related variant (BYD Song Plus DM-i …)" and one a
// Qin PLUS recall, all stored as if they were Song Ultra issues. Prompt wording alone
// can't be trusted to prevent that (same lesson as the Soueast S06 mismatch), so every
// researched issue must carry an explicit attestation AND survive a code-level check the
// LLM doesn't control. The attestation fields are research-time only: they are stripped
// here and never reach the UI, the apply route, or the schema.

export const ISSUE_ATTESTATION_KEYS = ["applies_to_target_model", "same_generation", "source_model_name"] as const;

export interface TargetModel {
  brandName: string;
  modelName: string;
  modelNameCn?: string;
}

// Trailing powertrain-label tokens that a source may legitimately omit ("Song Ultra" for "Song Ultra DM-i").
const POWERTRAIN_SUFFIX_TOKENS = new Set(["dm", "i", "dmi", "phev", "hev", "em", "p", "ev", "ehs", "hi4", "hybrid"]);

/** Lowercased alphanumeric word tokens; "300L" stays one token, "DM-i" → dm, i. CJK characters are kept as-is (never split). */
export function tokenizeName(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((t, j) => hay[i + j] === t)) return true;
  }
  return false;
}

/**
 * True only if the model name a source used IS the target model, not a sibling. Token-
 * sequence match, not substring: "Tank 300" does not match "Tank 300L New Energy", and
 * "Song Ultra" does not match "Song Plus". Accepts (a) the full name minus a trailing
 * powertrain label ("Song Ultra DM-i" ≈ "Song Ultra"), (b) the name with the brand
 * prefix stripped ("WEY Lanshan" ≈ "Lanshan") when what's left is ≥4 chars so a bare
 * "300" can't match, or (c) the Chinese name as a substring.
 */
export function matchesTargetModel(sourceModelName: string, target: TargetModel): boolean {
  const src = tokenizeName(sourceModelName);
  if (src.length === 0) return false;
  if (target.modelNameCn && sourceModelName.includes(target.modelNameCn)) return true;

  const full = tokenizeName(target.modelName);
  const core = [...full];
  while (core.length > 1 && POWERTRAIN_SUFFIX_TOKENS.has(core[core.length - 1])) core.pop();
  if (containsSequence(src, core)) return true;

  const brand = tokenizeName(target.brandName);
  const distinctive = [...core];
  while (distinctive.length > 1 && brand.includes(distinctive[0])) distinctive.shift();
  if (distinctive.length < core.length && distinctive.join("").length >= 4 && containsSequence(src, distinctive)) return true;
  return false;
}

// Backstop only — catches the prose the LLM uses when it KNOWS an item is off-model but includes it anyway.
const OFF_MODEL_PROSE = /\b(related variant|related model|sibling|sister model|different model|other model|predecessor|previous generation|older generation|not the same (model|vehicle))\b|^\s*not\s+[a-z0-9]/i;

export interface RejectedItem {
  index: number;
  reason: string;
  /** First ~110 chars of the rejected item's own description, so a reviewer can see WHAT was dropped, not just why. */
  summary?: string;
}

/** Tri-state generation attestation. `not_stated` = the source names the right model but gives no model year/generation. */
export type GenerationMatch = "same" | "not_stated" | "different";

/** Exact token, else known alias; undefined (never a guess) when unrecognized — a missing/garbled attestation is a rejection, not a "not_stated". */
export function normalizeGenerationMatch(v: unknown): GenerationMatch | undefined {
  if (v === true) return "same";
  if (v === false) return "different";
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "same" || t === "not_stated" || t === "different") return t;
  if (["true", "match", "matches", "same_generation", "yes"].includes(t)) return "same";
  if (["unknown", "unclear", "unspecified", "not_specified", "not_given", "unstated", "not_mentioned", "n/a", "na"].includes(t)) return "not_stated";
  if (["false", "no", "other", "older", "newer", "previous", "different_generation", "mismatch"].includes(t)) return "different";
  return undefined;
}

/**
 * Hard filter applied to the RAW researched array before normalization. Keeps an item only
 * if ALL hold:
 *   1. applies_to_target_model === true (strict boolean, not "true");
 *   2. same_generation resolves (normalizeGenerationMatch) to "same" or "not_stated" —
 *      "different" is rejected, and a missing/unrecognized value is rejected;
 *   3. source_model_name is non-empty and matches the target by matchesTargetModel();
 *   4. the description doesn't read as off-model prose.
 * Model identity (1, 3, 4) is unchanged from the original filter — that is the gate that
 * caught the Song Plus / Seal U / Qin PLUS mix-up. Only the generation check is
 * three-valued: a "not_stated" item is KEPT but forced to confidence "unconfirmed" and
 * reported in `warnings`, since sources often omit the model year (WEY Lanshan live test,
 * 2026-09-19: a strict boolean made the LLM drop 4 real, cited issues).
 * Returns kept items with the attestation keys stripped, every rejection with its reason
 * and item summary, and one warning per downgraded item.
 */
export function filterIssuesToTargetModel(raw: unknown, target: TargetModel): { kept: unknown[]; rejected: RejectedItem[]; warnings: string[] } {
  if (!Array.isArray(raw)) return { kept: [], rejected: [], warnings: [] };
  const kept: unknown[] = [];
  const rejected: RejectedItem[] = [];
  const warnings: string[] = [];
  // Model names often already start with the brand ("WEY Lanshan") — don't print it twice in messages.
  const targetLabel = target.modelName.toLowerCase().startsWith(target.brandName.toLowerCase()) ? target.modelName : `${target.brandName} ${target.modelName}`;
  raw.forEach((item, index) => {
    const rec = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    if (!rec) return void rejected.push({ index, reason: "not an object" });
    const descRaw = typeof rec.issue_description === "string" ? rec.issue_description : "";
    const summary = descRaw.replace(/\s+/g, " ").slice(0, 110);
    const reject = (reason: string) => void rejected.push({ index, reason, summary });

    if (rec.applies_to_target_model !== true) return reject("not attested as applying to the target model");
    const gen = normalizeGenerationMatch(rec.same_generation);
    if (gen === undefined) return reject("same_generation attestation missing or unrecognized (expected same / not_stated / different)");
    if (gen === "different") return reject("source is about a different generation");
    const srcModel = normalizeString(rec.source_model_name);
    if (!srcModel) return reject("source_model_name missing");
    if (!matchesTargetModel(srcModel, target)) return reject(`source is about "${srcModel}", not ${targetLabel}`);
    if (OFF_MODEL_PROSE.test(descRaw)) return reject("description is framed as another/related model");

    const stripped = { ...rec };
    for (const k of ISSUE_ATTESTATION_KEYS) delete stripped[k];
    if (gen === "not_stated") {
      stripped.confidence = "unconfirmed";
      warnings.push(`Source does not state the model year/generation — kept as unconfirmed, verify before relying on it: "${summary}"`);
    }
    kept.push(stripped);
  });
  return { kept, rejected, warnings };
}

/** Same hard filter, named for non-issue callers (recalls). The raw item needs `issue_description` for the prose backstop; the attestation contract is identical. */
export const filterItemsToTargetModel = filterIssuesToTargetModel;
