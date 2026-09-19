// Manual paste-in path for the four newer research categories (market_trend,
// known_issues [both regions], technical_bulletins, recalls) — ONE canonical envelope,
// "research-categories-v1", that works regardless of which external tool (Kimi, Qwen,
// Gemini, Claude, DeepSeek chat…) produced it. The parser validates against this schema
// only, never per-source formats; tool-specific sloppiness is absorbed by the shared
// normalizers in lib/categoryValidators.ts (alias resolution, date/enum cleanup,
// safe-direction confidence downgrades), not by per-tool code.
//
// Deliberately separate from lib/manualResearchImport.ts (the spec/powertrain round-trip,
// schema "canonical-powertrain-v2"): different envelope, different validate/apply routes,
// different panel. Nothing here touches that pipeline's alias/relocation logic.
//
// Semantics match the live-research apply routes: APPEND-and-dedupe (never replace) for
// the three list categories; market_trend replaces its single object. A category key
// that is absent from the envelope means "not researched" and is left completely
// untouched; an empty array / null means "researched, nothing found" and also writes
// nothing (there is no delete path here).

import { extractJsonObject } from "@/lib/categoryResearch";
import {
  bulletinKey,
  issueKey,
  mergeByKey,
  normalizeArray,
  normalizeBulletin,
  normalizeIssue,
  normalizeMarketTrend,
  normalizeRecall,
  normalizeRegion,
  recallKey,
} from "@/lib/categoryValidators";
import type { ItemResult } from "@/lib/categoryValidators";
import { applyModelFields } from "@/lib/applyModelFields";
import { powertrainTextMismatch } from "@/lib/categoryValidators";
import type { TargetModel } from "@/lib/categoryValidators";
import { verifyItemSources } from "@/lib/sourceVerification";
import type { VerifyOptions } from "@/lib/sourceVerification";
import { AFFECTED_SYSTEMS, RESEARCH_CATEGORIES_SCHEMA_VERSION, RESEARCH_CATEGORY_KEYS } from "@/types/researchCategories";
import type { IMarketTrend, IRecall, ITechnicalBulletin, ResearchCategoryKey } from "@/types/researchCategories";
import type { IKnownIssue } from "@/types";
import { MARKET_TREND_TEMPLATE } from "@/lib/marketTrendResearch";
import { BULLETIN_ITEM_TEMPLATE } from "@/lib/bulletinResearch";
import { RECALL_ITEM_TEMPLATE } from "@/lib/recallResearch";

// ---------- envelope template + export prompt ----------

const MANUAL_ISSUE_TEMPLATE = {
  region: "china | global",
  issue_description: "string (concise description of the reported issue/failure pattern, in English)",
  affected_systems: `array of one or more of: ${AFFECTED_SYSTEMS.join(", ")}`,
  frequency_signal: "string | null",
  source: "string (site or publication name)",
  source_url: "string (the actual page URL)",
  confidence: "confirmed | unconfirmed",
};

const CATEGORY_TEMPLATES: Record<ResearchCategoryKey, unknown> = {
  market_trend: MARKET_TREND_TEMPLATE,
  known_issues: [MANUAL_ISSUE_TEMPLATE],
  technical_bulletins: [BULLETIN_ITEM_TEMPLATE],
  recalls: [RECALL_ITEM_TEMPLATE],
};

const CATEGORY_GUIDANCE: Record<ResearchCategoryKey, string> = {
  market_trend:
    'MARKET TREND — Chinese-market sales direction and segment rank. Use Chinese-language sources only (懂车帝, 汽车之家, 易车, 太平洋汽车网). "sales_trend" must be exactly growing/stable/declining/discontinued, supported by actual figures or rank movement over roughly the last 6–12 months. Return null for the whole "market_trend" value if nothing is found.',
  known_issues:
    'KNOWN ISSUES — two DIFFERENT populations, tagged per item with "region", never mixed. region "china": Chinese-market complaints, Chinese-language sources only, prioritizing 车质网 (12365auto.com) and 汽车投诉网 (tousu.99.com). region "global": international/export-market owner and press reports (English/French/Arabic owner forums, motoring press, consumer databases) — do NOT use Chinese complaint platforms for these. Only specific, named issues; no generic statements.',
  technical_bulletins:
    'TECHNICAL BULLETINS — manufacturer technical service bulletins (技术通告 / 技术服务通报). Chinese-language sources or the manufacturer\'s own official service pages only. Most TSBs are dealer-portal-only: an EMPTY array is a correct, expected answer. Do not present recalls, complaints or forum posts as TSBs.',
  recalls:
    'RECALLS — official recall campaigns (SAMR 缺陷产品召回, NHTSA and equivalents, manufacturer press releases, credible press coverage). NOT restricted by language or country; export-market recalls count. Not complaints, not TSBs. required_tools: set only if the remedy text itself indicates tooling (see the field description); otherwise null.',
};

export interface ManualCategoryExportContext {
  brandName: string;
  brandNameCn?: string;
  modelName: string;
  modelNameCn?: string;
  segment: string;
  productionStatus: string;
  modelId: string;
}

export function buildCategoryExportText(ctx: ManualCategoryExportContext, categories: ResearchCategoryKey[]): string {
  const cats = categories.filter((c) => RESEARCH_CATEGORY_KEYS.includes(c));
  const envelope: Record<string, unknown> = { schema_version: RESEARCH_CATEGORIES_SCHEMA_VERSION, model_id: ctx.modelId };
  for (const c of cats) envelope[c] = CATEGORY_TEMPLATES[c];
  // A model's name_cn often already includes the brand (e.g. "捷途大圣") — don't prepend it twice.
  const cnLabel = ctx.modelNameCn ? (ctx.brandNameCn && !ctx.modelNameCn.startsWith(ctx.brandNameCn) ? `${ctx.brandNameCn}${ctx.modelNameCn}` : ctx.modelNameCn) : undefined;

  return `You are a researcher filling in structured research data about one vehicle model, for an after-sales (SAV) operation. Use your web-search/browsing ability to find real sources — do not answer from memory.

Model: ${ctx.brandName} ${ctx.modelName}${cnLabel ? ` (${cnLabel})` : ""}
Segment: ${ctx.segment} · Production status: ${ctx.productionStatus}

Research ONLY these categories:
${cats.map((c) => `- ${CATEGORY_GUIDANCE[c]}`).join("\n")}

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have — it is not a literal example value. Include ONLY the category keys shown; an empty array (or null for market_trend) means "researched, found nothing".
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "model_id" exactly as shown.
- OUTPUT LANGUAGE: every string value must be English (translate Chinese source text first), except a site's proper name in a "source" field.
- Every item needs a real "source_url" you actually opened. Mark "confidence": "confirmed" only if the fact was directly stated at that URL, otherwise "unconfirmed". Never invent an item, a number, a recall/bulletin ID, or a URL.
- Dates: YYYY-MM-DD, or YYYY-MM if the day isn't given. Use null for anything you did not find.
- Enum fields must use exactly the listed tokens (affected_component / affected_systems: ${AFFECTED_SYSTEMS.join(", ")}).
- Do NOT add, rename, or omit any field from the shapes above.`;
}

// ---------- parse / validate ----------

/** Existing DB state the parse diffs against — only the fields this importer touches. */
export interface ExistingCategoryData {
  known_issues?: IKnownIssue[];
  technical_bulletins?: ITechnicalBulletin[];
  recalls?: IRecall[];
  market_trend?: IMarketTrend;
}

export interface CategoryPreview<T> {
  /** Items that passed validation, split by whether the DB already has them. */
  newItems: T[];
  duplicateCount: number;
  dropped: { index: number; errors: string[] }[];
  warnings: string[];
}

export interface MarketTrendPreview {
  /** null when the envelope said `null` ("researched, found nothing"). */
  proposed: Omit<IMarketTrend, "_last_researched_at"> | null;
  current: IMarketTrend | null;
  errors: string[];
  warnings: string[];
}

export interface CategoryImportParseResult {
  /** Envelope-level validity (JSON parsed, version/model match, no unknown keys). Per-item problems don't set this false — they drop that item and are reported in `dropped`. */
  valid: boolean;
  errors: string[];
  categoriesPresent: ResearchCategoryKey[];
  market_trend?: MarketTrendPreview;
  known_issues?: CategoryPreview<IKnownIssue>;
  technical_bulletins?: CategoryPreview<ITechnicalBulletin>;
  recalls?: CategoryPreview<IRecall>;
  /** True when applying would change anything at all. */
  hasChanges: boolean;
}

function preview<T>(raw: unknown, fn: (item: unknown) => ItemResult<T>, existing: T[], keyFn: (t: T) => string): CategoryPreview<T> {
  const { items, dropped, warnings } = normalizeArray(raw, fn);
  const { merged, added } = mergeByKey(existing, items, keyFn);
  return { newItems: merged.slice(existing.length), duplicateCount: items.length - added, dropped, warnings };
}

export function parseCategoryImport(rawText: string, modelId: string, existing: ExistingCategoryData): CategoryImportParseResult {
  const fail = (errors: string[]): CategoryImportParseResult => ({ valid: false, errors, categoriesPresent: [], hasChanges: false });

  const obj = extractJsonObject(rawText);
  if (!obj) return fail(["Could not find a JSON object in the pasted text."]);

  const errors: string[] = [];
  if (obj.schema_version !== RESEARCH_CATEGORIES_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${RESEARCH_CATEGORIES_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}) — this importer only accepts the research-categories envelope, not the spec/powertrain export format.`);
  }
  if (obj.model_id !== modelId) errors.push(`model_id ${JSON.stringify(obj.model_id)} does not match this model (${modelId}) — pasted into the wrong model's page?`);
  const allowedTop = new Set<string>(["schema_version", "model_id", ...RESEARCH_CATEGORY_KEYS]);
  for (const k of Object.keys(obj)) if (!allowedTop.has(k)) errors.push(`${k}: unexpected top-level key`);
  const categoriesPresent = RESEARCH_CATEGORY_KEYS.filter((k) => k in obj);
  if (categoriesPresent.length === 0) errors.push("No research category keys present (expected at least one of: " + RESEARCH_CATEGORY_KEYS.join(", ") + ").");
  if (errors.length > 0) return { ...fail(errors), categoriesPresent };

  const result: CategoryImportParseResult = { valid: true, errors: [], categoriesPresent, hasChanges: false };

  if ("market_trend" in obj) {
    if (obj.market_trend === null) {
      result.market_trend = { proposed: null, current: existing.market_trend ?? null, errors: [], warnings: [] };
    } else {
      const r = normalizeMarketTrend(obj.market_trend, { checkChineseSource: true });
      result.market_trend = { proposed: r.item ?? null, current: existing.market_trend ?? null, errors: r.errors, warnings: r.warnings };
      if (r.item) result.hasChanges = true;
    }
  }

  if ("known_issues" in obj) {
    // region is required per item here (the one array carries both populations) — resolved via normalizeRegion, never guessed.
    result.known_issues = preview(
      obj.known_issues,
      (raw) => {
        const rec = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
        if (!rec) return { errors: ["not an object"], warnings: [] };
        const region = normalizeRegion(rec.region);
        if (!region) return { errors: [`region: required, must be "china" or "global" (got ${JSON.stringify(rec.region)})`], warnings: [] };
        return normalizeIssue({ ...rec, region }, region, { checkChineseSource: region === "china" });
      },
      existing.known_issues ?? [],
      issueKey
    );
    if (result.known_issues.newItems.length > 0) result.hasChanges = true;
  }

  if ("technical_bulletins" in obj) {
    result.technical_bulletins = preview(obj.technical_bulletins, (raw) => normalizeBulletin(raw, { checkChineseSource: true }), existing.technical_bulletins ?? [], bulletinKey);
    if (result.technical_bulletins.newItems.length > 0) result.hasChanges = true;
  }

  if ("recalls" in obj) {
    result.recalls = preview(obj.recalls, (raw) => normalizeRecall(raw), existing.recalls ?? [], recallKey);
    if (result.recalls.newItems.length > 0) result.hasChanges = true;
  }

  return result;
}

// ---------- apply ----------

export interface CategoryApplyOutcome {
  category: ResearchCategoryKey;
  applied: boolean;
  added?: number;
  error?: string;
}

/**
 * Re-parses `rawText` against the CURRENT DB state (never trusts whatever preview the
 * client saw), then writes each category that has changes via applyModelFields — one
 * verified write per category, so one failing doesn't mask the others' outcomes.
 */
export async function applyCategoryImport(
  modelId: string,
  rawText: string,
  existing: ExistingCategoryData,
  /** Async step between parse and write (source verification) — same one the validate route ran, so what is applied is what was previewed. */
  postParse?: (p: CategoryImportParseResult) => Promise<CategoryImportParseResult>
): Promise<{ parse: CategoryImportParseResult; outcomes: CategoryApplyOutcome[] }> {
  let parse = parseCategoryImport(rawText, modelId, existing);
  if (postParse && parse.valid) parse = await postParse(parse);
  const outcomes: CategoryApplyOutcome[] = [];
  if (!parse.valid) return { parse, outcomes };
  const now = new Date();

  if (parse.market_trend?.proposed) {
    const r = await applyModelFields(modelId, { market_trend: { ...parse.market_trend.proposed, _last_researched_at: now } });
    outcomes.push({ category: "market_trend", ...(r.applied ? { applied: true } : { applied: false, error: r.error }) });
  }

  if (parse.known_issues && parse.known_issues.newItems.length > 0) {
    const fresh = parse.known_issues.newItems;
    const stamps: Record<string, Date> = { known_issues_last_researched_at: now };
    for (const region of new Set(fresh.map((i) => i.region ?? "china"))) stamps[`known_issues_${region}_last_researched_at`] = now;
    const r = await applyModelFields(modelId, { known_issues: [...(existing.known_issues ?? []), ...fresh], ...stamps });
    outcomes.push({ category: "known_issues", ...(r.applied ? { applied: true, added: fresh.length } : { applied: false, error: r.error }) });
  }

  if (parse.technical_bulletins && parse.technical_bulletins.newItems.length > 0) {
    const fresh = parse.technical_bulletins.newItems;
    const r = await applyModelFields(modelId, { technical_bulletins: [...(existing.technical_bulletins ?? []), ...fresh], technical_bulletins_last_researched_at: now });
    outcomes.push({ category: "technical_bulletins", ...(r.applied ? { applied: true, added: fresh.length } : { applied: false, error: r.error }) });
  }

  if (parse.recalls && parse.recalls.newItems.length > 0) {
    const fresh = parse.recalls.newItems;
    const r = await applyModelFields(modelId, { recalls: [...(existing.recalls ?? []), ...fresh], recalls_last_researched_at: now });
    outcomes.push({ category: "recalls", ...(r.applied ? { applied: true, added: fresh.length } : { applied: false, error: r.error }) });
  }

  return { parse, outcomes };
}


// ---------- verification of a pasted import (the model-identity + URL check the manual path lacked) ----------

/**
 * The manual path used to accept a pasted item's stated `confidence` as-is, with no model-identity check and
 * no check that a cited URL even exists (live test 2026-09-19: an off-model Song Plus thread, a Google-redirect
 * URL and a fake Reddit URL all sailed through as "confirmed"). This runs, per new item:
 *   1. the deterministic powertrain text check (an item about the 2.0T ICE is dropped for a PHEV model);
 *   2. source verification — the cited page is fetched: dead link => item dropped; page doesn't name the model
 *      (hub/listing/other model's thread) or can't be seen => "confirmed" downgraded; and the model-identity
 *      question is answered by the PAGE, not by the pasting tool's say-so.
 * Returns a NEW parse result (does not mutate the input's arrays).
 */
export async function verifyImportedItems(parse: CategoryImportParseResult, target: TargetModel, opts: VerifyOptions = {}): Promise<CategoryImportParseResult> {
  if (!parse.valid) return parse;
  const out: CategoryImportParseResult = { ...parse };
  const cache = opts.cache ?? new Map();
  const runList = async <T extends object>(p: CategoryPreview<T> | undefined): Promise<CategoryPreview<T> | undefined> => {
    if (!p || p.newItems.length === 0) return p;
    const dropped = [...p.dropped];
    const warnings = [...p.warnings];
    const passed: T[] = [];
    for (const it of p.newItems) {
      const desc = String((it as { issue_description?: unknown }).issue_description ?? "");
      const mm = powertrainTextMismatch(desc, target.powertrain);
      if (mm) dropped.push({ index: -1, errors: [`powertrain mismatch: ${mm} — "${desc.slice(0, 80)}"`] });
      else passed.push(it);
    }
    const v = await verifyItemSources(passed, target, { ...opts, cache });
    v.removed.forEach((r) => dropped.push({ index: -1, errors: [r.reason] }));
    return { ...p, newItems: v.items, dropped, warnings: [...warnings, ...v.warnings] };
  };
  out.known_issues = await runList(parse.known_issues);
  out.technical_bulletins = await runList(parse.technical_bulletins);
  out.recalls = await runList(parse.recalls);

  if (parse.market_trend?.proposed?.source_url) {
    const item = { ...parse.market_trend.proposed, confidence: parse.market_trend.proposed._confidence };
    const v = await verifyItemSources([item], target, { ...opts, cache });
    out.market_trend = v.items.length === 0
      ? { ...parse.market_trend, proposed: null, errors: [...parse.market_trend.errors, ...v.removed.map((r) => r.reason)] }
      : { ...parse.market_trend, proposed: { ...parse.market_trend.proposed, source_url: v.items[0].source_url, _confidence: v.items[0].confidence as "confirmed" | "unconfirmed" }, warnings: [...parse.market_trend.warnings, ...v.warnings] };
  }
  out.hasChanges = !!out.market_trend?.proposed || (out.known_issues?.newItems.length ?? 0) > 0 || (out.technical_bulletins?.newItems.length ?? 0) > 0 || (out.recalls?.newItems.length ?? 0) > 0;
  return out;
}

/** Builds the identity/powertrain target the verification step checks a pasted import against. */
export async function targetForModelDoc(
  modelDoc: { _id: unknown; name: string; name_cn?: string; brand_id: unknown },
  loaders: { brandName: (brandId: unknown) => Promise<{ name: string; name_en?: string } | null>; powertrain: (modelId: string) => Promise<TargetModel["powertrain"]> }
): Promise<TargetModel> {
  const brand = await loaders.brandName(modelDoc.brand_id);
  return { brandName: brand?.name_en ?? brand?.name ?? "", modelName: modelDoc.name, modelNameCn: modelDoc.name_cn, powertrain: await loaders.powertrain(String(modelDoc._id)) };
}
