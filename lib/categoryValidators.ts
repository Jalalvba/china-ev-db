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
  const source_url = resolveSourceUrl(rec.source_url, warnings);

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
  const source_url = resolveSourceUrl(rec.source_url, warnings);
  const frequency_signal = normalizeString(rec.frequency_signal);

  let confidence = gateConfidenceOnUrl(normalizeConfidence(rec.confidence), source_url, warnings);
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
  const source_url = resolveSourceUrl(rec.source_url, warnings);
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
  const source_url = resolveSourceUrl(rec.source_url, warnings);
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

export const ISSUE_ATTESTATION_KEYS = ["applies_to_target_model", "same_generation", "source_model_name", "powertrain_scope"] as const;

/** What the target model actually IS, powertrain-wise, per this DB's own trims (see lib/modelPowertrain.ts). The DB is scoped to PHEV, so a report about the same nameplate's 2.0T ICE or BEV version is off-target even though the model identity matches. */
export interface TargetPowertrain {
  /** Human-readable, goes into the research prompt, e.g. "plug-in hybrid (PHEV), 1.5L engine, i-DM hybrid system, 18.4–29.8 kWh battery". */
  description: string;
  /** Engine displacements (litres) of this model's trims; empty when unknown (no displacement check then). */
  displacementsL: number[];
  energyTypes: string[];
}

export interface TargetModel {
  brandName: string;
  modelName: string;
  modelNameCn?: string;
  /** When set, the filter also enforces powertrain scope (see filterIssuesToTargetModel). */
  powertrain?: TargetPowertrain;
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
 * "300" can't match, or (c) the Chinese name (case-insensitive, powertrain label stripped) as a
 * substring.
 */
export function matchesTargetModel(sourceModelName: string, target: TargetModel): boolean {
  const src = tokenizeName(sourceModelName);
  if (src.length === 0) return false;
  // Chinese name: compared CASE-INSENSITIVELY and with the same trailing powertrain label
  // stripped as English names ("星舰7 EM-i" ≈ "星舰7" ≈ "星舰7 em-i") — a live batch run wrongly
  // rejected a real Starship 7 item because the LLM wrote "em-i" against a stored "EM-i". Still a
  // plain substring match on the compacted text (unchanged looseness: "蓝山" also matches "新蓝山").
  if (target.modelNameCn) {
    const cn = tokenizeName(target.modelNameCn);
    while (cn.length > 1 && POWERTRAIN_SUFFIX_TOKENS.has(cn[cn.length - 1])) cn.pop();
    if (cn.length > 0 && src.join("").includes(cn.join(""))) return true;
  }

  const brand = tokenizeName(target.brandName);
  // "A / B" names are alias pairs for ONE model ("Geely Coolray / Binyue"): a source may use either.
  // A live batch run rejected 9 real Coolray items because sources say just "Geely Coolray".
  for (const alt of modelNameAlternatives(target.modelName)) {
    const full = tokenizeName(alt);
    const core = [...full];
    while (core.length > 1 && POWERTRAIN_SUFFIX_TOKENS.has(core[core.length - 1])) core.pop();
    if (containsSequence(src, core)) return true;

    const distinctive = [...core];
    while (distinctive.length > 1 && brand.includes(distinctive[0])) distinctive.shift();
    if (distinctive.length < core.length && distinctive.join("").length >= 4 && containsSequence(src, distinctive)) return true;
  }
  return false;
}

/** "Geely Coolray / Binyue" → ["Geely Coolray", "Binyue"]; a name without " / " is returned as-is. */
export function modelNameAlternatives(name: string): string[] {
  const parts = name.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [name];
}

// Backstop only — catches the prose the LLM uses when it KNOWS an item is off-model but includes it anyway.
export const OFF_MODEL_PROSE = /\b(related variant|related model|sibling|sister model|different model|other model|predecessor|previous generation|older generation|not the same (model|vehicle))\b|^\s*not\s+[a-z0-9]/i;

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
 * Hard filter applied to the RAW researched array before normalization. (With `target.powertrain`
 * set it ALSO enforces powertrain scope — see the powertrain section below.) Keeps an item only
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

    // Powertrain scope (this DB = PHEV). Only enforced when the caller supplied the target's powertrain.
    let powertrainNotStated = false;
    if (target.powertrain) {
      const mm = powertrainTextMismatch(descRaw, target.powertrain);
      if (mm) return reject(`powertrain mismatch: ${mm}`);
      const scope = normalizePowertrainScope(rec.powertrain_scope) ?? "not_stated"; // missing/garbled = not stated (lenient: a new field LLMs may omit)
      if (scope === "other_powertrain_only") return reject("source restricts this to a different powertrain variant (not the PHEV)");
      powertrainNotStated = scope === "not_stated" && isPowertrainSystemItem(rec);
    }

    const stripped = { ...rec };
    for (const k of ISSUE_ATTESTATION_KEYS) delete stripped[k];
    if (gen === "not_stated") {
      stripped.confidence = "unconfirmed";
      warnings.push(`Source does not state the model year/generation — kept as unconfirmed, verify before relying on it: "${summary}"`);
    }
    if (powertrainNotStated) {
      stripped.confidence = "unconfirmed";
      warnings.push(`Powertrain component issue, but the source does not say which variant (PHEV vs ICE/other) — kept as unconfirmed, verify before relying on it: "${summary}"`);
    }
    kept.push(stripped);
  });
  return { kept, rejected, warnings };
}

/** Same hard filter, named for non-issue callers (recalls). The raw item needs `issue_description` for the prose backstop; the attestation contract is identical. */
export const filterItemsToTargetModel = filterIssuesToTargetModel;


// ---------- powertrain scope (this DB covers the PHEV version only) ----------
//
// Real incident (2026-09-19, batch 2): Jetour T2 (a PHEV here) came back with engine-oil-leak items
// about the "2.0T four-wheel-drive" ICE, and Coolray/Binyue with 1.4T timing-chain and DCT complaints.
// Model identity matched, so the exact-model filter passed them. Two layers, again because prose
// alone can't be trusted:
//   1. the LLM attests each item's `powertrain_scope` (below), and
//   2. a deterministic text check flags engine sizes / variant words that contradict the target.

/** phev_specific = about the plug-in hybrid system/version; all_variants = a shared part (body, infotainment…) not restricted to another variant; other_powertrain_only = the source restricts it to an ICE/BEV/other version; not_stated = the source doesn't say. */
export type PowertrainScope = "phev_specific" | "all_variants" | "other_powertrain_only" | "not_stated";

const SCOPE_ALIASES: Record<PowertrainScope, string[]> = {
  phev_specific: ["phev", "hybrid", "plug_in", "plugin", "plug_in_hybrid", "dm_i", "dmi", "em_i", "i_dm", "hev"],
  all_variants: ["all", "shared", "any", "general", "common", "all_versions", "every_variant", "not_powertrain_specific", "powertrain_agnostic"],
  other_powertrain_only: ["ice", "petrol", "gasoline", "diesel", "bev", "ev", "electric", "other", "non_phev", "other_powertrain", "ice_only", "different_powertrain"],
  not_stated: ["unknown", "unclear", "unspecified", "not_specified", "not_given", "unstated", "not_mentioned", "none", "n/a", "na"],
};

/** Exact token, else alias; undefined (never a guess) when unrecognized. */
export function normalizePowertrainScope(v: unknown): PowertrainScope | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "phev_specific" || t === "all_variants" || t === "other_powertrain_only" || t === "not_stated") return t;
  for (const [canonical, aliases] of Object.entries(SCOPE_ALIASES)) if (aliases.includes(t)) return canonical as PowertrainScope;
  return undefined;
}

// "1.5T", "2.0T", "1.4TD", "1.6L", "2.0-litre", "1.5升"; NOT "7.5L/100km" (fuel use) or "18.4 kWh".
const DISPLACEMENT_RE = /(?<![\d.])(\d\.\d)\s?(?:T(?:D|DI|SI|GDI)?|L|-?lit(?:re|er)s?|升)(?![a-z0-9/])/gi;
// Words that say "this is the non-hybrid / non-plug-in version".
const NON_PHEV_VARIANT_RE = /\b(?:petrol|gasoline|diesel)[ -](?:only[ -])?(?:version|variant|model|trim|powered)\b|\bICE[ -](?:version|variant|model|only)\b|\bnon-hybrid\b|\bBEV[ -](?:version|variant|model)\b|燃油版|汽油版|柴油版|纯电版|纯电动版/i;

/** A deterministic contradiction between an item's text and the target's powertrain, or undefined. Skips the displacement test when the target's engine size is unknown. */
export function powertrainTextMismatch(text: string, pt: TargetPowertrain | undefined): string | undefined {
  if (!pt) return undefined;
  const variant = text.match(NON_PHEV_VARIANT_RE);
  if (variant) return `text refers to a non-PHEV variant ("${variant[0]}"); this model is ${pt.description}`;
  if (pt.displacementsL.length > 0) {
    for (const m of text.matchAll(DISPLACEMENT_RE)) {
      const d = parseFloat(m[1]);
      if (!pt.displacementsL.some((t) => Math.abs(t - d) < 0.051)) return `mentions a ${m[0].trim()} engine, but this model's engine is ${pt.displacementsL.join("/")}L (${pt.description})`;
    }
  }
  return undefined;
}

const POWERTRAIN_SYSTEMS = new Set(["engine", "transmission", "battery", "motor"]);
/** True when the item is about a powertrain component (so WHICH variant it applies to matters). Body/infotainment/etc. issues are shared across variants. */
export function isPowertrainSystemItem(rec: Record<string, unknown>): boolean {
  const systems = Array.isArray(rec.affected_systems) ? rec.affected_systems : rec.affected_component != null ? [rec.affected_component] : [];
  return systems.some((s) => typeof s === "string" && POWERTRAIN_SYSTEMS.has(s.trim().toLowerCase()));
}

/** Deterministic-only version for categories with no LLM attestation (technical bulletins). */
export function filterByPowertrainText(raw: unknown, pt: TargetPowertrain | undefined): { kept: unknown[]; rejected: RejectedItem[]; warnings: string[] } {
  if (!Array.isArray(raw) || !pt) return { kept: Array.isArray(raw) ? raw : [], rejected: [], warnings: [] };
  const kept: unknown[] = [];
  const rejected: RejectedItem[] = [];
  raw.forEach((item, index) => {
    const desc = typeof (item as Record<string, unknown> | null)?.issue_description === "string" ? String((item as Record<string, unknown>).issue_description) : "";
    const mm = powertrainTextMismatch(desc, pt);
    if (mm) rejected.push({ index, reason: `powertrain mismatch: ${mm}`, summary: desc.replace(/\s+/g, " ").slice(0, 110) });
    else kept.push(item);
  });
  return { kept, rejected, warnings: [] };
}


// ---------- source URLs ----------

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/gi;
/** Redirect wrappers whose real target is only known by following them (resolved during verification). */
export function isRedirectWrapper(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "vertexaisearch.cloud.google.com";
  } catch {
    return false;
  }
}

function unwrapGoogleRedirect(url: string): string | undefined {
  try {
    const u = new URL(url);
    if ((u.hostname === "google.com" || u.hostname === "www.google.com") && u.pathname === "/url") {
      const target = u.searchParams.get("q") ?? u.searchParams.get("url");
      if (target && /^https?:\/\//i.test(target)) return target;
    }
  } catch {
    /* not a URL */
  }
  return undefined;
}

export interface NormalizedSourceUrl {
  /** The single URL to store (the first one found), or undefined if there is none. */
  url?: string;
  /** Every distinct http(s) URL found in the raw value. */
  all: string[];
  /** What was cleaned up, for the review UI. */
  notes: string[];
}

/**
 * Turns whatever a chat tool pasted into source_url into a real URL: extracts the URL from markdown
 * `[text](url)` / angle brackets / surrounding prose, unwraps Google `google.com/url?q=` redirects, trims
 * trailing punctuation, and keeps the first of several. Pure (no network) — whether the page EXISTS is
 * lib/sourceVerification.ts's job.
 */
export function normalizeSourceUrl(raw: unknown): NormalizedSourceUrl {
  if (typeof raw !== "string") return { all: [], notes: [] };
  const notes: string[] = [];
  const found: string[] = [];
  for (const m of raw.matchAll(URL_IN_TEXT)) {
    let u = m[0].replace(/[.,;:!?]+$/, "");
    const unwrapped = unwrapGoogleRedirect(u);
    if (unwrapped) {
      notes.push("unwrapped a Google redirect link");
      u = unwrapped.replace(/[.,;:!?]+$/, "");
    }
    try {
      new URL(u);
    } catch {
      continue;
    }
    if (!found.includes(u)) found.push(u);
  }
  if (found.length > 0 && raw.trim() !== found[0]) notes.push("extracted the URL from surrounding text/markdown");
  if (found.length > 1) notes.push(`${found.length} URLs given — kept the first`);
  return { url: found[0], all: found, notes };
}

function resolveSourceUrl(raw: unknown, warnings: string[]): string | undefined {
  if (raw == null || raw === "") return undefined;
  const n = normalizeSourceUrl(raw);
  if (!n.url) {
    warnings.push("source_url is not a valid http(s) URL — dropped");
    return undefined;
  }
  n.notes.forEach((x) => warnings.push(`source_url: ${x}`));
  return n.url;
}

/**
 * Stricter than matchesTargetModel, for LONG page text: a bare "08" (from "Lynk & Co 08 EM-P") or "T2"
 * would match dates/measurements all over a page. Requires the FULL model name, or brand + core name, or
 * a long-enough distinctive name (≥6 chars), or the Chinese name.
 */
export function pageMentionsTarget(pageText: string, target: TargetModel): boolean {
  const src = tokenizeName(pageText);
  if (src.length === 0) return false;
  if (target.modelNameCn) {
    const cn = tokenizeName(target.modelNameCn);
    while (cn.length > 1 && POWERTRAIN_SUFFIX_TOKENS.has(cn[cn.length - 1])) cn.pop();
    if (cn.length > 0 && src.join("").includes(cn.join(""))) return true;
  }
  const brand = tokenizeName(target.brandName);
  for (const alt of modelNameAlternatives(target.modelName)) {
    const full = tokenizeName(alt);
    if (containsSequence(src, full)) return true;
    const core = [...full];
    while (core.length > 1 && POWERTRAIN_SUFFIX_TOKENS.has(core[core.length - 1])) core.pop();
    if (containsSequence(src, [...brand, ...core])) return true;
    if (core.join("").length >= 6 && containsSequence(src, core)) return true;
    const distinctive = [...core];
    while (distinctive.length > 1 && brand.includes(distinctive[0])) distinctive.shift();
    if (distinctive.length < core.length && distinctive.join("").length >= 6 && containsSequence(src, distinctive)) return true;
  }
  return false;
}
