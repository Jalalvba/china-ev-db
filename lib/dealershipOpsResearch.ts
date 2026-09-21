// dealership-ops-manual-v1 — ONE brand-level export prompt / paste-back covering dealership after-sales
// operations, routed on import into three destinations:
//   warranty_terms       -> Brand.warranty_terms            (existing shape + validator, single brand-level `source`)
//   workshop_profile     -> BrandPhevSuvWorkshopProfile     (existing shape + validator, per-fact source_url)
//   after_sales_process  -> BrandAfterSalesProcess          (new; every fact { value, source_url|"NOT FOUND" })
// Nothing here calls an AI/search provider. Each section is validated by the SAME function its own
// single-section path uses, so a pasted section can't pass here and fail at its apply route.
//
// NOT here on purpose: recall data (model-level, exact-model identity guard — see types/afterSalesProcess.ts)
// and known-failure patterns (model-level known_issues). campaign_notification is the brand's PROCESS only.

import { WARRANTY_TIER_SHAPE, validateResearchedWarranty, applyWarrantyGroundingGate } from "@/lib/warrantyResearch";
import {
  MANUAL_PROFILE_SHAPE,
  validatePhevSuvWorkshopProfile,
  normalizePhevSuvWorkshopProfile,
  type NormalizedPhevSuvWorkshopProfile,
} from "@/lib/phevSuvWorkshopResearch";
import {
  AFTER_SALES_SECTIONS,
  AFTER_SALES_SECTION_KEYS,
  NOT_FOUND,
  PARTS_MARKETS,
  type AfterSalesSectionKey,
  type IAfterSalesSection,
} from "@/types/afterSalesProcess";

export const DEALERSHIP_OPS_SCHEMA_VERSION = "dealership-ops-manual-v1";

export interface DealershipOpsExportContext {
  brandId: string;
  brandName: string;
  brandNameCn?: string;
  parentGroup?: string;
  /** Names of this brand's models on file (all of them — the DB is not guaranteed PHEV-SUV-only per brand) — context only, so the reply is unambiguous about which brand it concerns. */
  modelNames?: string[];
  /** What is already stored, shown so the reply corrects/extends rather than restarts. Plain summaries, not re-imported. */
  existing?: { warranty?: string; workshop?: string; afterSales?: string };
}

const FACT_SHAPE = `{ "value": string|null, "source_url": "<http(s) URL>"|"ATTACHED: <document title>"|"${NOT_FOUND}" }`;
const PARTS_FACT_SHAPE = `{ "value": string|null, "source_url": "<http(s) URL>"|"ATTACHED: <document title>"|"${NOT_FOUND}", "market": ${PARTS_MARKETS.map((m) => `"${m}"`).join("|")}|null }`;

function sectionShape(section: AfterSalesSectionKey): string {
  const fact = section === "parts_logistics" ? PARTS_FACT_SHAPE : FACT_SHAPE;
  return `{\n${AFTER_SALES_SECTIONS[section].map((k) => `      "${k}": ${fact}`).join(",\n")}\n    }`;
}

// The dealership prompt asks for TIERS only — the legacy flat numbers are not requested (they stay on file until reviewed).
const WARRANTY_SECTION_SHAPE = `{
    "tiers": [ ${WARRANTY_TIER_SHAPE} ],
    "source": string|null,
    "confidence": "confirmed"|"unconfirmed"|null
  }`;

const ENVELOPE_SHAPE = (brandId: string) => `{
  "schema_version": "${DEALERSHIP_OPS_SCHEMA_VERSION}",
  "brand_id": "${brandId}",
  "warranty_terms": ${WARRANTY_SECTION_SHAPE},
  "workshop_profile": ${MANUAL_PROFILE_SHAPE},
  "after_sales_process": {
${AFTER_SALES_SECTION_KEYS.map((s) => `    "${s}": ${sectionShape(s)}`).join(",\n")},
    "confidence": "confirmed"|"unconfirmed"
  },
  "notes": string|null
}`;

export function buildDealershipOpsExportPrompt(ctx: DealershipOpsExportContext): string {
  const { brandId, brandName, brandNameCn, parentGroup, modelNames, existing } = ctx;
  const cn = brandNameCn ?? brandName;
  const onFile = existing && (existing.warranty || existing.workshop || existing.afterSales)
    ? `\nALREADY ON FILE for this brand (correct or extend it; do not just repeat it):\n${[
        existing.warranty && `- Warranty: ${existing.warranty}`,
        existing.workshop && `- Workshop profile: ${existing.workshop}`,
        existing.afterSales && `- After-sales process: ${existing.afterSales}`,
      ]
        .filter(Boolean)
        .join("\n")}\n`
    : "";

  return `You are a researcher building a database of Chinese-market vehicle brands' dealership after-sales OPERATIONS, for a buyer who will run an authorized service workshop in MOROCCO for this brand's plug-in-hybrid (PHEV) SUVs. This is operational due diligence, not a marketing summary: the buyer needs to know how warranty claims actually get filed and paid, what the workshop must buy, who must be trained and how often, and how parts actually reach a Moroccan dealer.

BRAND: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}   brand_id: "${brandId}"${parentGroup ? `\nPARENT GROUP: ${parentGroup}` : ""}${modelNames?.length ? `\nMODELS ON FILE (context only — every model of this brand in the database; the workshop facts concern its PHEV SUVs): ${modelNames.join(", ")}` : ""}
${onFile}
PRIMARY DOCUMENT: if a document is attached to this chat (e.g. the brand's official after-sales commitment letter), read it FIRST and in full — it is the primary source. Cite it as "ATTACHED: <its title>" in source_url unless you also found it at a public URL, in which case give the URL. Then use your own web search/browsing to fill what it does not cover.

GO PAST SPEC-SHEET CONTENT. Dig for operational detail on each of these:
0. WARRANTY TIERS (warranty_terms) — a warranty policy is rarely one blanket period. Capture EVERY distinct tier the source defines as its own entry in "tiers": the whole-vehicle base warranty, replacement/return terms, core components (battery pack, motor, controller, charger…), special components, and consumables — plus any shorter sub-tier for a subset of parts (e.g. commercial-use-only periods), and any powertrain-specific tier (BEV vs PHEV/EREV differ in km or parts). For each tier: "tier_name" (descriptive English), "kind", "vehicle_use" (household = private/personal use, commercial = operating/for-hire use, all = stated for every use; if a tier lumps official/business-use vehicles in with household or with commercial, choose that side and say so in "conditions"), "powertrain" (PHEV covers plug-in hybrid and range-extended; BEV; or all), the period as "duration_months" (8 years = 96) and "duration_km", "limit_rule" ("whichever_first" when the source says whichever comes first), "covered_parts" listing EVERY named part in the source's list verbatim in English (do not summarize to "and others"), "conditions" (e.g. replacement/return eligibility, repair-only limits for commercial vehicles), and "clause_ref" (the clause/section number where the tier is stated, e.g. "9.3"). If one clause gives different periods to different parts (e.g. tires 6 months, wipers 3 months), make one tier per distinct period. Use "is_lifetime": true only where the source states lifetime coverage. Do NOT put the flat ICE/battery/motor numbers anywhere — tiers replace them.
1. WARRANTY CLAIMS — how a claim is submitted (system/portal, who files), documents required, approval timeline (days), reimbursement terms (labour rate, parts, payment cycle), and rejection/appeal handling.
2. DIAGNOSTIC TOOL — the exact tool/model name, connector type, software platform, whether a dealer account is needed, its PURCHASE COST, and SUBSCRIPTION / licence / update terms (price, period, who bills).
3. TECHNICIAN TRAINING — the actual curriculum (modules, HV content), the certification cycle (how often, recertification), minimum technician headcount, and where/at what cost training is delivered — not just "technicians must be certified".
4. PARTS LOGISTICS FOR MOROCCO / MENA — the Moroccan (or MENA regional) distributor's own documents: distributor name, regional warehouse, ordering system, standard and emergency delivery times TO MOROCCO/MENA, parts-return policy, dealer stocking requirements. DO NOT use China-domestic delivery tiers (e.g. "next-day within 300 km of a Chinese regional centre") as a substitute — they do not describe Morocco. Look for the Moroccan importer/distributor's dealer network documents, dealer-recruitment material and press. If nothing about Morocco/MENA exists, return "${NOT_FOUND}" — do not estimate and do not backfill from China. (A China-network figure such as "delivery within 3 days for under 500 km" or "95% dealer stock rate" is a China-domestic fact: it does NOT belong in parts_logistics.)
5. FACILITY / AUDIT CHECKLIST — the concrete checkpoints a dealer is audited against (tooling, certification, facility, documentation, parts), at checklist-item level.
6. BATTERY CLAIMS — the diagnostic protocol for a battery warranty claim (test steps, evidence required, thresholds for replace vs repair) and how a returned pack/cells are handled and recycled.
7. RECALL / CAMPAIGN NOTIFICATION PROCESS — how the manufacturer notifies dealers of an active recall or service campaign, the dealer's obligations and response deadline, and the duty to contact customers. (This is the PROCESS only. Do NOT list individual recalls — those are researched per model elsewhere.)

Suggested searches (adapt freely): "${cn} 售后服务承诺", "${cn} 质保 索赔 流程", "${cn} 授权维修站 诊断仪 价格", "${cn} 新能源 技师 培训 认证 周期", "${cn} 动力电池 质保 检测 回收", "${brandName} Maroc distributeur pièces de rechange", "${brandName} Morocco authorized dealer after-sales requirements".

SOURCE RULES (hard):
- Every fact needs its own source_url: the http(s) URL of the page/document you actually opened, or "ATTACHED: <title>" for the attached document. If you cannot find a source, the fact is "${NOT_FOUND}" with value null. NEVER estimate, round, infer from a sibling brand or the parent group, or fill a gap with a plausible-sounding number.
- warranty_terms and workshop_profile: Chinese-language sources or the attached document only. after_sales_process: any language — Moroccan/MENA distributor material is expected for parts_logistics.
- warranty_terms uses ONE brand-level "source" for the whole block: put the URL (or "ATTACHED: <title>") of the single document that states the warranty structure; each tier is located inside it by "clause_ref". A tier without a clause_ref makes the whole block "unconfirmed". Use null for any period the document does not state, and omit a tier rather than guess one.
- parts_logistics: every non-null fact must say which "market" it describes ("morocco", "mena" or "other_export"). A fact that only describes mainland China is NOT FOUND for this section — do not include it.
- A fact is "confirmed" only through its source; set the section-level "confidence" to "confirmed" only if EVERY non-null fact in after_sales_process has a real source, otherwise "unconfirmed". Same rule for workshop_profile.confidence and warranty_terms.confidence.

Respond with ONLY this JSON object — no markdown fencing, no prose before or after. Type hints below describe each field, they are not literal values:
${ENVELOPE_SHAPE(brandId)}

CRITICAL RULES:
- Keep "schema_version" and "brand_id" exactly as shown. Do not add, rename or omit any field.
- OUTPUT LANGUAGE: every string value in English (translate Chinese source text first), except workshop_profile.technician_prerequisites[].certification_name_cn, which keeps the original Chinese.
- "value" is a concise factual sentence or figure with units and currency (e.g. "Claims approved within 7 working days of submission"), not a copy-pasted paragraph.
- For a fact you could not source: {"value": null, "source_url": "${NOT_FOUND}"} — keep the key, do not delete it. For an unknown workshop_profile scalar use null; for an unknown list use [].
- If you cannot address a whole top-level section at all, set that section to null (this means "not researched" and writes nothing).`;
}

// ---------- parse / validate ----------

function extractJsonObjectLoose(text: string): Record<string, unknown> | null {
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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HTTP_URL = /^https?:\/\/\S+$/i;
const ATTACHED = /^ATTACHED:\s*\S.*$/i;
const isSourced = (s: unknown): s is string => typeof s === "string" && (HTTP_URL.test(s.trim()) || ATTACHED.test(s.trim()));

export interface AfterSalesProcessParsed {
  sections: Partial<Record<AfterSalesSectionKey, IAfterSalesSection>>;
  confidence: "confirmed" | "unconfirmed";
  downgrade_reason?: string;
  /** Keys that came back NOT FOUND / null — shown in review so a gap is visible, not silently absent. */
  not_found: string[];
}

/** Validates + normalizes the after_sales_process block. Drops NOT FOUND facts; a stored fact always has a real source. */
export function parseAfterSalesProcess(raw: unknown): { valid: boolean; errors: string[]; parsed: AfterSalesProcessParsed | null } {
  if (!isObj(raw)) return { valid: false, errors: ["after_sales_process: must be an object"], parsed: null };
  const errors: string[] = [];
  const allowed = new Set<string>([...AFTER_SALES_SECTION_KEYS, "confidence"]);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) errors.push(`after_sales_process.${k}: unexpected field, not in shape`);
  if (raw.confidence != null && raw.confidence !== "confirmed" && raw.confidence !== "unconfirmed")
    errors.push(`after_sales_process.confidence: invalid value ${JSON.stringify(raw.confidence)}`);

  const sections: AfterSalesProcessParsed["sections"] = {};
  const notFound: string[] = [];
  for (const s of AFTER_SALES_SECTION_KEYS) {
    const sec = raw[s];
    if (sec == null) continue; // whole section null/absent = not researched
    if (!isObj(sec)) {
      errors.push(`after_sales_process.${s}: must be an object or null`);
      continue;
    }
    const keys = AFTER_SALES_SECTIONS[s] as readonly string[];
    const out: IAfterSalesSection = {};
    for (const k of Object.keys(sec)) if (!keys.includes(k)) errors.push(`after_sales_process.${s}.${k}: unexpected field, not in shape`);
    for (const k of keys) {
      const path = `after_sales_process.${s}.${k}`;
      const f = sec[k];
      if (f == null) {
        notFound.push(`${s}.${k}`);
        continue;
      }
      if (!isObj(f)) {
        errors.push(`${path}: must be { value, source_url } or null`);
        continue;
      }
      const value = typeof f.value === "string" ? f.value.trim() : f.value;
      const src = typeof f.source_url === "string" ? f.source_url.trim() : f.source_url;
      if (value != null && typeof value !== "string") {
        errors.push(`${path}.value: must be string or null`);
        continue;
      }
      if (value == null || value === "") {
        if (src != null && src !== NOT_FOUND && !isSourced(src)) errors.push(`${path}.source_url: must be a URL, "ATTACHED: <title>" or "${NOT_FOUND}"`);
        notFound.push(`${s}.${k}`);
        continue;
      }
      if (src === NOT_FOUND) {
        errors.push(`${path}: has a value but source_url is "${NOT_FOUND}" — a value without a source is not accepted (set value to null)`);
        continue;
      }
      if (!isSourced(src)) {
        errors.push(`${path}.source_url: must be an http(s) URL or "ATTACHED: <title>" (got ${JSON.stringify(f.source_url)})`);
        continue;
      }
      const fact: IAfterSalesSection[string] = { value: value as string, source_url: src };
      if (s === "parts_logistics") {
        if (typeof f.market !== "string" || !(PARTS_MARKETS as readonly string[]).includes(f.market)) {
          errors.push(`${path}.market: required, one of ${PARTS_MARKETS.join("/")} (China-domestic facts are not accepted here)`);
          continue;
        }
        fact.market = f.market as (typeof PARTS_MARKETS)[number];
      } else if (f.market != null) {
        errors.push(`${path}.market: only valid on parts_logistics`);
        continue;
      }
      out[k] = fact;
    }
    if (Object.keys(out).length > 0) sections[s] = out;
  }
  if (errors.length > 0) return { valid: false, errors, parsed: null };

  const factCount = Object.values(sections).reduce((n, sec) => n + Object.keys(sec ?? {}).length, 0);
  let confidence: "confirmed" | "unconfirmed" = raw.confidence === "confirmed" ? "confirmed" : "unconfirmed";
  let downgrade_reason: string | undefined;
  if (confidence === "confirmed" && factCount === 0) {
    confidence = "unconfirmed";
    downgrade_reason = "nothing was found, so there is nothing to confirm";
  }
  return { valid: true, errors: [], parsed: { sections, confidence, downgrade_reason, not_found: notFound } };
}

export interface DealershipOpsImportResult {
  /** Envelope-level validity (JSON found, schema_version, brand_id). Section problems are reported per section so one bad section doesn't block the others. */
  valid: boolean;
  errors: string[];
  warranty_terms: { status: "not_researched" | "ok" | "invalid"; errors: string[]; value: Record<string, unknown> | null };
  workshop_profile: { status: "not_researched" | "ok" | "invalid"; errors: string[]; value: NormalizedPhevSuvWorkshopProfile | null; downgrade_reason?: string };
  after_sales_process: { status: "not_researched" | "ok" | "invalid"; errors: string[]; value: AfterSalesProcessParsed | null };
  notes: string | null;
}

/** Parses + validates a pasted dealership-ops-manual-v1 reply. Preview only — never writes. */
export function parseDealershipOpsImport(rawText: string, brandId: string): DealershipOpsImportResult {
  const empty = { status: "not_researched" as const, errors: [] as string[], value: null };
  const result: DealershipOpsImportResult = {
    valid: false,
    errors: [],
    warranty_terms: { ...empty },
    workshop_profile: { ...empty },
    after_sales_process: { ...empty },
    notes: null,
  };
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { ...result, errors: ["Could not find a JSON object in the pasted text."] };
  if (obj.schema_version !== DEALERSHIP_OPS_SCHEMA_VERSION)
    result.errors.push(`schema_version must be "${DEALERSHIP_OPS_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  if (obj.brand_id !== brandId) result.errors.push(`brand_id ${JSON.stringify(obj.brand_id)} does not match this brand (${brandId}) — pasted into the wrong brand's page?`);
  for (const k of Object.keys(obj))
    if (!["schema_version", "brand_id", "warranty_terms", "workshop_profile", "after_sales_process", "notes"].includes(k))
      result.errors.push(`${k}: unexpected top-level field, not in envelope`);
  if (result.errors.length > 0) return result;
  result.valid = true;
  result.notes = typeof obj.notes === "string" ? obj.notes : null;

  if (obj.warranty_terms != null) {
    if (!isObj(obj.warranty_terms)) result.warranty_terms = { status: "invalid", errors: ["warranty_terms: must be an object or null"], value: null };
    else {
      const { valid, errors } = validateResearchedWarranty(obj.warranty_terms);
      result.warranty_terms = valid
        ? { status: "ok", errors: [], value: applyWarrantyGroundingGate({ ...obj.warranty_terms }, !!obj.warranty_terms.source) }
        : { status: "invalid", errors, value: null };
    }
  }
  if (obj.workshop_profile != null) {
    if (!isObj(obj.workshop_profile)) result.workshop_profile = { status: "invalid", errors: ["workshop_profile: must be an object or null"], value: null };
    else {
      const { valid, errors } = validatePhevSuvWorkshopProfile(obj.workshop_profile);
      if (!valid) result.workshop_profile = { status: "invalid", errors, value: null };
      else {
        const { profile, downgradeReason } = normalizePhevSuvWorkshopProfile(obj.workshop_profile);
        result.workshop_profile = { status: "ok", errors: [], value: profile, downgrade_reason: downgradeReason };
      }
    }
  }
  if (obj.after_sales_process != null) {
    const { valid, errors, parsed } = parseAfterSalesProcess(obj.after_sales_process);
    result.after_sales_process = valid ? { status: "ok", errors: [], value: parsed } : { status: "invalid", errors, value: null };
  }
  return result;
}
