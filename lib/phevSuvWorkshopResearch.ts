// Brand-level PHEV/REEV-SUV-specific workshop infrastructure research — Chinese-source-only,
// same architecture as lib/workshopResearch.ts / lib/workshopOverrideResearch.ts, but a
// narrower, deliberately separate pipeline: see types/index.ts's IBrandPhevSuvWorkshopProfile
// doc comment for why this doesn't reuse workshop_standards/brand_workshop_overrides.
//
// Four distinct search queries per brand (diagnostic tooling, PPE/equipment, technician
// certification, dealer audit standard) — same "several targeted queries beat one broad
// query" lesson workshopOverrideResearch.ts already encoded for this domain.

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

export interface PhevSuvWorkshopResearchInput {
  brandName: string;
  brandNameCn?: string;
}

const FIELD_TEMPLATE = {
  diagnostic_interface: {
    tool_name: "string | null",
    connector_type: "'J2534 pass-thru' | 'proprietary VCI' | string | null",
    software_platform: "string | null",
    requires_dealer_account: "boolean | null",
    source_url: "string | null",
  },
  lift_spec: {
    type: "string | null",
    min_capacity_kg: "number | null",
    battery_removal_capable: "boolean | null",
    lift_point_notes: "string | null",
    source_url: "string | null",
  },
  ppe_required: "array of { item: string, spec: string|null (e.g. 'Class 0, 1000V'), mandatory: boolean|null, source_url: string|null } — empty array if none found",
  technician_prerequisites:
    "array of { certification_name_cn: string|null, certification_name_en: string|null, issuing_body: string|null, minimum_grade: string|null, hv_endorsement_required: boolean|null, source_url: string|null } — empty array if none found",
  audit_checklist:
    "array of { check_point: string, category: 'tooling'|'certification'|'facility'|'documentation'|null, source_url: string|null } — empty array if none found",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export function buildPhevSuvWorkshopKickoffPrompt(input: PhevSuvWorkshopResearchInput): string {
  const { brandName, brandNameCn } = input;
  const cn = brandNameCn ?? brandName;
  return `You are a researcher building a database of Chinese-market vehicle brands' real, brand-specific after-sales workshop infrastructure requirements for servicing PHEV/REEV SUV models specifically (not ICE, not HEV, not BEV, not other body types) — for a buyer setting up an authorized PHEV/REEV SUV service workshop in Morocco who needs actual manufacturer-specific data, not an industry-generic baseline.

Brand to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language sources (manufacturer 经销商招募/授权维修站 pages, 汽车之家/懂车帝/太平洋汽车网 forum threads, official service-standard documents). If a search result below is in English or from a non-Chinese/reseller-boilerplate site, IGNORE it completely. If you cannot find a Chinese-language source for a fact, report that field as not found (null / empty array) rather than guessing.

Research this brand's official PHEV/REEV SUV after-sales workshop requirements, specifically:
- Diagnostic interface: the name of the OEM diagnostic tool/scan tool, its connector type (J2534 pass-thru vs. proprietary VCI), the software platform name, and whether it requires a dealer account to activate.
- Lift specification: the type of lift required for PHEV/REEV SUV service, minimum capacity in kg, whether it needs to support battery/pack removal, and any lift-point notes.
- PPE (personal protective equipment) required for HV/PHEV service — each item with its spec if published (e.g. insulated gloves rated Class 0/1000V).
- Technician prerequisites: any required certification (Chinese and English name if both exist), the issuing body, minimum grade/level, and whether HV endorsement is specifically required.
- Audit checklist: any published dealer/workshop after-sales audit standard checkpoints (设备/认证/设施/文档 — tooling/certification/facility/documentation).

Search specifically for: "${brandName} PHEV SUV 授权维修站 设备要求", "${brandName} 插电混动 诊断仪 型号", "${cn} 新能源 技师 认证 要求", "${cn} 经销商 售后 审核 标准".

This is expected to have thin coverage for many brands — report exactly what you find, leave everything else null/empty, and do not pad with generic reseller boilerplate or non-brand-specific facts.

Report your findings in plain prose with citations (include the actual URL for each fact) — do not format as JSON yet.`;
}

export function buildPhevSuvWorkshopFormatPrompt(): string {
  const templateJson = JSON.stringify(FIELD_TEMPLATE, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object/strings describe the type each field must have, not literal example values):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English, EXCEPT certification_name_cn which must hold the original Chinese name if one exists.
- Every fact must come from a Chinese-language source you actually found in the search results provided (grounding is enabled) — do not estimate or use a non-Chinese/reseller-boilerplate source.
- Use null for anything you cannot find a sourced value for, and an empty array for ppe_required/technician_prerequisites/audit_checklist if nothing was found. Do NOT guess.
- Do NOT add, rename, or omit any top-level field from the shape above.`;
}

const TOP_LEVEL_KEYS = new Set(Object.keys(FIELD_TEMPLATE));

export interface ResearchedPhevSuvWorkshopProfile {
  diagnostic_interface?: Record<string, unknown>;
  lift_spec?: Record<string, unknown>;
  ppe_required?: Array<Record<string, unknown>>;
  technician_prerequisites?: Array<Record<string, unknown>>;
  audit_checklist?: Array<Record<string, unknown>>;
  confidence?: string;
}

function isStringOrNull(v: unknown): boolean {
  return v === undefined || v === null || typeof v === "string";
}
function isBoolOrNull(v: unknown): boolean {
  return v === undefined || v === null || typeof v === "boolean";
}
function isHttpUrlOrNull(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && /^https?:\/\/\S+$/i.test(v.trim()));
}
const AUDIT_CATEGORIES = new Set(["tooling", "certification", "facility", "documentation"]);

export function validatePhevSuvWorkshopProfile(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["profile is not an object"] };
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }

  if (v.diagnostic_interface !== undefined && v.diagnostic_interface !== null) {
    const d = v.diagnostic_interface as Record<string, unknown>;
    if (typeof d !== "object" || Array.isArray(d)) errors.push("diagnostic_interface: must be an object or null");
    else {
      if (!isStringOrNull(d.tool_name)) errors.push("diagnostic_interface.tool_name: must be string or null");
      if (!isStringOrNull(d.connector_type)) errors.push("diagnostic_interface.connector_type: must be string or null");
      if (!isStringOrNull(d.software_platform)) errors.push("diagnostic_interface.software_platform: must be string or null");
      if (!isBoolOrNull(d.requires_dealer_account)) errors.push("diagnostic_interface.requires_dealer_account: must be boolean or null");
      if (!isHttpUrlOrNull(d.source_url)) errors.push("diagnostic_interface.source_url: must be an http(s) URL or null");
    }
  }

  if (v.lift_spec !== undefined && v.lift_spec !== null) {
    const l = v.lift_spec as Record<string, unknown>;
    if (typeof l !== "object" || Array.isArray(l)) errors.push("lift_spec: must be an object or null");
    else {
      if (!isStringOrNull(l.type)) errors.push("lift_spec.type: must be string or null");
      if (l.min_capacity_kg !== undefined && l.min_capacity_kg !== null && typeof l.min_capacity_kg !== "number")
        errors.push("lift_spec.min_capacity_kg: must be number or null");
      if (!isBoolOrNull(l.battery_removal_capable)) errors.push("lift_spec.battery_removal_capable: must be boolean or null");
      if (!isStringOrNull(l.lift_point_notes)) errors.push("lift_spec.lift_point_notes: must be string or null");
      if (!isHttpUrlOrNull(l.source_url)) errors.push("lift_spec.source_url: must be an http(s) URL or null");
    }
  }

  if (v.ppe_required !== undefined && v.ppe_required !== null) {
    if (!Array.isArray(v.ppe_required)) errors.push("ppe_required: must be an array");
    else
      v.ppe_required.forEach((item, i) => {
        if (typeof item !== "object" || item === null) errors.push(`ppe_required[${i}]: must be an object`);
        else {
          const p = item as Record<string, unknown>;
          if (typeof p.item !== "string") errors.push(`ppe_required[${i}].item: required string`);
          if (!isStringOrNull(p.spec)) errors.push(`ppe_required[${i}].spec: must be string or null`);
          if (!isBoolOrNull(p.mandatory)) errors.push(`ppe_required[${i}].mandatory: must be boolean or null`);
          if (!isHttpUrlOrNull(p.source_url)) errors.push(`ppe_required[${i}].source_url: must be an http(s) URL or null`);
        }
      });
  }

  if (v.technician_prerequisites !== undefined && v.technician_prerequisites !== null) {
    if (!Array.isArray(v.technician_prerequisites)) errors.push("technician_prerequisites: must be an array");
    else
      v.technician_prerequisites.forEach((item, i) => {
        if (typeof item !== "object" || item === null) {
          errors.push(`technician_prerequisites[${i}]: must be an object`);
          return;
        }
        const t = item as Record<string, unknown>;
        for (const k of ["certification_name_cn", "certification_name_en", "issuing_body", "minimum_grade"]) {
          if (!isStringOrNull(t[k])) errors.push(`technician_prerequisites[${i}].${k}: must be string or null`);
        }
        if (!isBoolOrNull(t.hv_endorsement_required)) errors.push(`technician_prerequisites[${i}].hv_endorsement_required: must be boolean or null`);
        if (!isHttpUrlOrNull(t.source_url)) errors.push(`technician_prerequisites[${i}].source_url: must be an http(s) URL or null`);
      });
  }

  if (v.audit_checklist !== undefined && v.audit_checklist !== null) {
    if (!Array.isArray(v.audit_checklist)) errors.push("audit_checklist: must be an array");
    else
      v.audit_checklist.forEach((item, i) => {
        if (typeof item !== "object" || item === null) errors.push(`audit_checklist[${i}]: must be an object`);
        else {
          const a = item as Record<string, unknown>;
          if (typeof a.check_point !== "string") errors.push(`audit_checklist[${i}].check_point: required string`);
          if (a.category != null && !(typeof a.category === "string" && AUDIT_CATEGORIES.has(a.category)))
            errors.push(`audit_checklist[${i}].category: invalid value ${JSON.stringify(a.category)}`);
          if (!isHttpUrlOrNull(a.source_url)) errors.push(`audit_checklist[${i}].source_url: must be an http(s) URL or null`);
        }
      });
  }

  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }

  return { valid: errors.length === 0, errors };
}

export function applyPhevSuvWorkshopGroundingGate(profile: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) profile.confidence = "unconfirmed";
  return profile;
}

// The live-call path (queryPhevSuvWorkshopResearch/researchPhevSuvWorkshopProfile,
// which called lib/groundedResearch.ts directly) was removed 2026-09-21 — see CLAUDE.md.
// Nothing in this file calls an AI/search provider; the manual round trip below is
// export prompt -> paste into an external AI chat -> paste JSON back -> validate -> review -> apply.

// ---------- manual export/import (workshop-manual-v2, single object) ----------

export const WORKSHOP_PROFILE_SCHEMA_VERSION = "workshop-manual-v2";

export interface PhevSuvWorkshopManualExportContext extends PhevSuvWorkshopResearchInput {
  brandId: string;
}

// Same shape as FIELD_TEMPLATE, but scalar "string | null" placeholders are replaced by a terse
// type hint so the envelope stays readable in a chat window. Kept next to FIELD_TEMPLATE's own
// field names via TOP_LEVEL_KEYS-driven validation, not a second hand-maintained key list.
const MANUAL_PROFILE_SHAPE = `{
    "diagnostic_interface": { "tool_name": string|null, "connector_type": string|null, "software_platform": string|null, "requires_dealer_account": boolean|null, "source_url": string|null },
    "lift_spec": { "type": string|null, "min_capacity_kg": number|null, "battery_removal_capable": boolean|null, "lift_point_notes": string|null, "source_url": string|null },
    "ppe_required": [ { "item": string, "spec": string|null, "mandatory": boolean|null, "source_url": string|null } ],
    "technician_prerequisites": [ { "certification_name_cn": string|null, "certification_name_en": string|null, "issuing_body": string|null, "minimum_grade": string|null, "hv_endorsement_required": boolean|null, "source_url": string|null } ],
    "audit_checklist": [ { "check_point": string, "category": "tooling"|"certification"|"facility"|"documentation"|null, "source_url": string|null } ],
    "confidence": "confirmed" | "unconfirmed"
  }`;

export function buildPhevSuvWorkshopManualExportPrompt(ctx: PhevSuvWorkshopManualExportContext): string {
  const { brandName, brandNameCn, brandId } = ctx;
  const cn = brandNameCn ?? brandName;
  return `You are a researcher building a database of Chinese-market vehicle brands' real, brand-specific after-sales workshop requirements for servicing PHEV SUVs (plug-in hybrid only — not ICE, HEV, BEV, REEV/EREV, or other body types), for a buyer setting up an authorized service workshop in Morocco who needs actual manufacturer-specific data, not an industry-generic baseline.

Brand: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}   brand_id: "${brandId}"

SOURCES: Chinese-language sources only (manufacturer 经销商招募/授权维修站 pages, 汽车之家/懂车帝/太平洋汽车网 threads, official service-standard documents). Use your own web search/browsing. If you can't find a Chinese-language source for a fact, use null / [] — do not guess. Thin coverage is expected; report only what you found.

Research: 1) diagnostic interface (OEM tool name, connector type: J2534 pass-thru vs proprietary VCI, software platform, dealer account required?) 2) lift (type, min capacity kg, battery-removal capable?, lift-point notes) 3) PPE for HV service (item + spec, e.g. Class 0 / 1000V) 4) technician prerequisites (CN + EN cert name, issuing body, min grade, HV endorsement required?) 5) dealer audit checkpoints (tooling / certification / facility / documentation).
Suggested searches: "${brandName} PHEV SUV 授权维修站 设备要求", "${brandName} 插电混动 诊断仪 型号", "${cn} 新能源 技师 认证 要求", "${cn} 经销商 售后 审核 标准".

Respond with ONLY this JSON (no markdown fencing, no prose before or after). Every fact needs its own source_url (the actual page you read). Type hints below are not literal values:
{
  "schema_version": "${WORKSHOP_PROFILE_SCHEMA_VERSION}",
  "brand_id": "${brandId}",
  "workshop_profile": ${MANUAL_PROFILE_SHAPE},
  "notes": string|null
}

RULES:
- Keep "schema_version" and "brand_id" exactly as shown.
- English only, except certification_name_cn (original Chinese).
- null for unknown scalars, [] for unknown lists. Do not add, rename or omit any field.
- "confirmed" only if every filled fact has a Chinese-source source_url you read; otherwise "unconfirmed".`;
}

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

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Drops null/empty-string keys from a flat object; returns undefined when nothing is left (so an all-null block reads as "Not found", not as an empty object). */
function compactObject(o: unknown): Record<string, unknown> | undefined {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!isEmptyValue(v)) out[k] = typeof v === "string" ? v.trim() : v;
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface NormalizedPhevSuvWorkshopProfile {
  diagnostic_interface?: Record<string, unknown>;
  lift_spec?: Record<string, unknown>;
  ppe_required: Array<Record<string, unknown>>;
  technician_prerequisites: Array<Record<string, unknown>>;
  audit_checklist: Array<Record<string, unknown>>;
  confidence: "confirmed" | "unconfirmed";
}

/**
 * Strips nulls (the schema stores absent, not null — app/workshop-phev-suv/page.tsx tests
 * `requires_dealer_account !== undefined`, so a stored null would render as "No dealer account
 * required") and applies the source rule: "confirmed" survives only if EVERY filled fact carries
 * its own http(s) source_url. Input must already have passed validatePhevSuvWorkshopProfile.
 */
export function normalizePhevSuvWorkshopProfile(raw: Record<string, unknown>): { profile: NormalizedPhevSuvWorkshopProfile; downgradeReason?: string } {
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : []).map(compactObject).filter((x): x is Record<string, unknown> => x !== undefined);
  const profile: NormalizedPhevSuvWorkshopProfile = {
    diagnostic_interface: compactObject(raw.diagnostic_interface),
    lift_spec: compactObject(raw.lift_spec),
    ppe_required: list(raw.ppe_required),
    technician_prerequisites: list(raw.technician_prerequisites),
    audit_checklist: list(raw.audit_checklist),
    confidence: raw.confidence === "confirmed" ? "confirmed" : "unconfirmed",
  };

  const facts: Array<[string, Record<string, unknown>]> = [];
  if (profile.diagnostic_interface) facts.push(["diagnostic_interface", profile.diagnostic_interface]);
  if (profile.lift_spec) facts.push(["lift_spec", profile.lift_spec]);
  profile.ppe_required.forEach((f, i) => facts.push([`ppe_required[${i}]`, f]));
  profile.technician_prerequisites.forEach((f, i) => facts.push([`technician_prerequisites[${i}]`, f]));
  profile.audit_checklist.forEach((f, i) => facts.push([`audit_checklist[${i}]`, f]));

  let downgradeReason: string | undefined;
  if (profile.confidence === "confirmed") {
    if (facts.length === 0) downgradeReason = "nothing was found, so there is nothing to confirm";
    else {
      const missing = facts.filter(([, f]) => !f.source_url).map(([name]) => name);
      if (missing.length > 0) downgradeReason = `no source_url on: ${missing.join(", ")}`;
    }
    if (downgradeReason) profile.confidence = "unconfirmed";
  }
  return { profile, downgradeReason };
}

export interface PhevSuvWorkshopManualImportResult {
  valid: boolean;
  errors: string[];
  workshop_profile: NormalizedPhevSuvWorkshopProfile | null;
  /** Set when a pasted "confirmed" was downgraded — shown in review, not an error. */
  downgrade_reason?: string;
  notes?: string | null;
}

/** Parses + validates a pasted workshop-manual-v2 reply. Preview only — never writes. */
export function parsePhevSuvWorkshopManualImport(rawText: string, brandId: string): PhevSuvWorkshopManualImportResult {
  const fail = (errors: string[]): PhevSuvWorkshopManualImportResult => ({ valid: false, errors, workshop_profile: null });
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return fail(["Could not find a JSON object in the pasted text."]);
  const errors: string[] = [];
  if (obj.schema_version !== WORKSHOP_PROFILE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${WORKSHOP_PROFILE_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.brand_id !== brandId) errors.push(`brand_id ${JSON.stringify(obj.brand_id)} does not match this brand (${brandId}) — pasted into the wrong brand's page?`);
  if (errors.length > 0) return fail(errors);

  const raw = obj.workshop_profile;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fail(["workshop_profile is missing or not an object."]);
  const { valid, errors: itemErrors } = validatePhevSuvWorkshopProfile(raw);
  if (!valid) return fail(itemErrors);

  const { profile, downgradeReason } = normalizePhevSuvWorkshopProfile(raw as Record<string, unknown>);
  return {
    valid: true,
    errors: [],
    workshop_profile: profile,
    downgrade_reason: downgradeReason,
    notes: typeof obj.notes === "string" ? obj.notes : null,
  };
}
