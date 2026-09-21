// Brand-level workshop/SAV-requirements research — Chinese-source-only,
// same architecture as lib/warrantyResearch.ts. See that file's header for
// the shared reasoning on the Chinese-source hard constraint and the
// allowlist defense-in-depth layer (lib/chineseSourceGuard.ts).
//
// This category is expected to have thinner source coverage than the other
// three — workshop-standard documents (经销商招募 / 售后服务标准) are less
// commonly public than consumer-facing specs or warranty pages. Callers
// should not treat a low hit-rate here as a bug; see the source-availability
// note this module's first real run produced (reported back to the user
// separately, not encoded here).

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);
export const WORKSHOP_MANUAL_SCHEMA_VERSION = "workshop-manual-v1";

export interface WorkshopResearchInput {
  brandName: string;
  brandNameCn?: string;
}

const WORKSHOP_FIELD_TEMPLATE = {
  special_tools_list: "string[] | null (names of special/OEM tools required, e.g. HV insulation tester, battery lift)",
  hv_safety_requirements: "string | null (free text describing HV safety/PPE/lockout requirements for PHEV/BEV service)",
  diagnostic_software_name: "string | null (name of the OEM diagnostic software/tool)",
  technician_certification_required: "string | null (free text describing any required certification)",
  source: "string | null (which Chinese source this came from)",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export function buildWorkshopKickoffPrompt(input: WorkshopResearchInput): string {
  const { brandName, brandNameCn } = input;
  return `You are a researcher building a database of Chinese-market vehicle brands' official after-sales workshop/service requirements, for an after-sales (SAV) operation setting up a workshop in Morocco.

Brand to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language sources (manufacturer 经销商招募/服务网络 pages, 售后服务标准 documents, 汽车之家, 懂车帝). If a search result below is in English or from a non-Chinese site, IGNORE it completely. If you cannot find a Chinese-language source for a fact, report that field as not found (null) rather than guessing or using a non-Chinese source.

Research this brand's official after-sales WORKSHOP requirements, specifically:
- Special/OEM tools required for service (beyond generic tools) — e.g. HV insulation testers, battery service lifts, specific torque tools
- HV safety requirements for PHEV/BEV service — PPE, lockout/isolation procedures, dedicated bay requirements, if published
- The name of the OEM's diagnostic software/tool (their equivalent of a proprietary scan tool)
- Any technician certification the manufacturer requires before HV/battery work is authorized

This is likely to have thin coverage — dealer/service network recruitment pages (经销商招募, 服务网络招募) and after-sales service standard documents (售后服务标准) are not always public. Search for them anyway, but if truly nothing is found, that is an expected, reportable outcome (return null fields), not a failure to try harder.

Report your findings in plain prose with citations (include the actual URL for each fact) — do not format as JSON yet.`;
}

export function buildWorkshopFormatPrompt(): string {
  const templateJson = JSON.stringify({ workshop_requirements: WORKSHOP_FIELD_TEMPLATE }, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object is a field-by-field description of the type each field must have, not a literal example value):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese source text before writing it).
- Every fact must come from a Chinese-language source you actually found in the search results provided (grounding is enabled) — do not estimate or use a non-Chinese source.
- Use null (or an empty array for special_tools_list) for anything you cannot find a sourced Chinese value for. Do NOT guess.
- Do NOT add, rename, or omit any field from the shape above.`;
}

const TOP_LEVEL_KEYS = new Set(Object.keys(WORKSHOP_FIELD_TEMPLATE));

export interface ResearchedWorkshopRequirements {
  special_tools_list?: string[];
  hv_safety_requirements?: string;
  diagnostic_software_name?: string;
  technician_certification_required?: string;
  source?: string;
  confidence?: string;
}

export function validateResearchedWorkshop(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, errors: ["workshop_requirements is not an object"] };
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }
  if (v.special_tools_list !== undefined && v.special_tools_list !== null) {
    if (!Array.isArray(v.special_tools_list) || v.special_tools_list.some((t) => typeof t !== "string")) {
      errors.push("special_tools_list: must be a string array or null");
    }
  }
  for (const strField of ["hv_safety_requirements", "diagnostic_software_name", "technician_certification_required", "source"]) {
    if (v[strField] !== undefined && v[strField] !== null && typeof v[strField] !== "string") {
      errors.push(`${strField}: must be a string or null`);
    }
  }
  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }
  return { valid: errors.length === 0, errors };
}

export function applyWorkshopGroundingGate(workshop: Record<string, unknown>, hasGrounding: boolean): Record<string, unknown> {
  if (!hasGrounding) workshop.confidence = "unconfirmed";
  return workshop;
}

// ---------- manual export/import (research-categories-v1-style envelope, single object) ----------

export interface WorkshopManualExportContext extends WorkshopResearchInput {
  brandId: string;
}

export function buildWorkshopManualExportPrompt(ctx: WorkshopManualExportContext): string {
  const envelope = { schema_version: WORKSHOP_MANUAL_SCHEMA_VERSION, brand_id: ctx.brandId, workshop_requirements: WORKSHOP_FIELD_TEMPLATE };
  return `${buildWorkshopKickoffPrompt(ctx)}

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have, not a literal example value.
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "brand_id" exactly as shown.
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese source text before writing it).
- Every fact must come from a Chinese-language source you actually opened — do not estimate or use a non-Chinese source.
- Use null (or an empty array for special_tools_list) for anything you cannot find a sourced Chinese value for. Do NOT guess.
- Do NOT add, rename, or omit any field from the shape above.`;
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

export interface WorkshopManualImportResult {
  valid: boolean;
  errors: string[];
  workshop_requirements: Record<string, unknown> | null;
}

/** Parses + validates a pasted workshop-manual-v1 reply. Confidence forced "unconfirmed" if no "source" is given (mirrors applyWorkshopGroundingGate's zero-citation rule). */
export function parseWorkshopManualImport(rawText: string, brandId: string): WorkshopManualImportResult {
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], workshop_requirements: null };
  const errors: string[] = [];
  if (obj.schema_version !== WORKSHOP_MANUAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${WORKSHOP_MANUAL_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.brand_id !== brandId) errors.push(`brand_id ${JSON.stringify(obj.brand_id)} does not match this brand (${brandId}) — pasted into the wrong brand's page?`);
  if (errors.length > 0) return { valid: false, errors, workshop_requirements: null };

  const req = obj.workshop_requirements as Record<string, unknown> | null | undefined;
  if (!req || typeof req !== "object") return { valid: true, errors: [], workshop_requirements: null };
  const { valid, errors: itemErrors } = validateResearchedWorkshop(req);
  if (!valid) return { valid: false, errors: itemErrors, workshop_requirements: null };

  const gated = applyWorkshopGroundingGate({ ...req }, !!req.source);
  return { valid: true, errors: [], workshop_requirements: gated };
}
