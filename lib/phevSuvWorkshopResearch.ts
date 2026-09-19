// Brand-level PHEV/REEV-SUV-specific workshop infrastructure research — Chinese-source-only,
// same architecture as lib/workshopResearch.ts / lib/workshopOverrideResearch.ts, but a
// narrower, deliberately separate pipeline: see types/index.ts's IBrandPhevSuvWorkshopProfile
// doc comment for why this doesn't reuse workshop_standards/brand_workshop_overrides.
//
// Four distinct search queries per brand (diagnostic tooling, PPE/equipment, technician
// certification, dealer audit standard) — same "several targeted queries beat one broad
// query" lesson workshopOverrideResearch.ts already encoded for this domain.

import { ModelNotFoundError, SearchProviderError, sleep } from "@/lib/techSpecResearch";
import { runGroundedResearch } from "@/lib/groundedResearch";
import { filterToChineseSources } from "@/lib/chineseSourceGuard";

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
      if (!isStringOrNull(d.source_url)) errors.push("diagnostic_interface.source_url: must be string or null");
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
      if (!isStringOrNull(l.source_url)) errors.push("lift_spec.source_url: must be string or null");
    }
  }

  if (v.ppe_required !== undefined && v.ppe_required !== null) {
    if (!Array.isArray(v.ppe_required)) errors.push("ppe_required: must be an array");
    else
      v.ppe_required.forEach((item, i) => {
        if (typeof item !== "object" || item === null) errors.push(`ppe_required[${i}]: must be an object`);
        else if (typeof (item as Record<string, unknown>).item !== "string") errors.push(`ppe_required[${i}].item: required string`);
      });
  }

  if (v.technician_prerequisites !== undefined && v.technician_prerequisites !== null) {
    if (!Array.isArray(v.technician_prerequisites)) errors.push("technician_prerequisites: must be an array");
  }

  if (v.audit_checklist !== undefined && v.audit_checklist !== null) {
    if (!Array.isArray(v.audit_checklist)) errors.push("audit_checklist: must be an array");
    else
      v.audit_checklist.forEach((item, i) => {
        if (typeof item !== "object" || item === null) errors.push(`audit_checklist[${i}]: must be an object`);
        else if (typeof (item as Record<string, unknown>).check_point !== "string")
          errors.push(`audit_checklist[${i}].check_point: required string`);
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

interface PhevSuvWorkshopAgentResponse {
  diagnostic_interface?: unknown;
  lift_spec?: unknown;
  ppe_required?: unknown;
  technician_prerequisites?: unknown;
  audit_checklist?: unknown;
  confidence?: unknown;
}

function extractJson(text: string): PhevSuvWorkshopAgentResponse | null {
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

async function queryPhevSuvWorkshopResearch(
  model: string,
  input: PhevSuvWorkshopResearchInput
): Promise<{ parsed: PhevSuvWorkshopAgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildPhevSuvWorkshopKickoffPrompt(input);
  const formatPrompt = buildPhevSuvWorkshopFormatPrompt();
  const cn = input.brandNameCn ?? input.brandName;
  const searchQueries = [
    `${input.brandName} PHEV SUV 授权维修站 设备要求`,
    `${input.brandName} 插电混动 诊断仪 型号`,
    `${cn} 新能源 技师 认证 要求`,
    `${cn} 经销商 售后 审核 标准`,
  ];

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { formattedText, sourceUrls } = await runGroundedResearch({ kickoffPrompt, formatPrompt, searchQueries, model });
      return { parsed: extractJson(formattedText), sourceUrls, rawText: formattedText };
    } catch (err) {
      if (err instanceof ModelNotFoundError) throw err;
      if (err instanceof SearchProviderError) throw err;
      lastErr = err;
      const backoffMs = 2000 * attempt;
      console.error(`  [retry ${attempt}/${maxAttempts}] research-phev-suv-workshop ${input.brandName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface PhevSuvWorkshopResearchResult {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  profile?: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export async function researchPhevSuvWorkshopProfile(
  model: string,
  input: PhevSuvWorkshopResearchInput
): Promise<PhevSuvWorkshopResearchResult> {
  try {
    const { parsed, sourceUrls: rawSourceUrls, rawText } = await queryPhevSuvWorkshopResearch(model, input);

    if (!parsed) {
      return {
        status: "error",
        errorMessage: `Could not parse a JSON object from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        valid: false,
        errors: [],
      };
    }

    const sourceUrls = filterToChineseSources(rawSourceUrls);
    const hasGrounding = sourceUrls.length > 0;
    const { valid, errors } = validatePhevSuvWorkshopProfile(parsed);
    if (!valid) {
      return { status: "not_found", sourceUrls, hasGrounding, profile: parsed as Record<string, unknown>, valid, errors };
    }

    const gated = applyPhevSuvWorkshopGroundingGate({ ...(parsed as Record<string, unknown>) }, hasGrounding);

    const hasAnyData =
      Boolean(gated.diagnostic_interface) ||
      Boolean(gated.lift_spec) ||
      (Array.isArray(gated.ppe_required) && gated.ppe_required.length > 0) ||
      (Array.isArray(gated.technician_prerequisites) && gated.technician_prerequisites.length > 0) ||
      (Array.isArray(gated.audit_checklist) && gated.audit_checklist.length > 0);

    return { status: hasAnyData ? "found" : "not_found", sourceUrls, hasGrounding, profile: gated, valid: true, errors: [] };
  } catch (err) {
    if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
    return { status: "error", errorMessage: (err as Error).message, sourceUrls: [], hasGrounding: false, valid: false, errors: [] };
  }
}
