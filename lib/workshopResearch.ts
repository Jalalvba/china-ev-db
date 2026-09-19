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

import { ModelNotFoundError, SearchProviderError, sleep } from "@/lib/techSpecResearch";
import { runGroundedResearch } from "@/lib/groundedResearch";
import { filterToChineseSources } from "@/lib/chineseSourceGuard";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

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

interface WorkshopAgentResponse {
  workshop_requirements?: unknown;
}

function extractJson(text: string): WorkshopAgentResponse | null {
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

async function queryWorkshopResearch(
  model: string,
  input: WorkshopResearchInput
): Promise<{ parsed: WorkshopAgentResponse | null; sourceUrls: string[]; rawText: string }> {
  const kickoffPrompt = buildWorkshopKickoffPrompt(input);
  const formatPrompt = buildWorkshopFormatPrompt();
  const searchQueries = [
    `${input.brandName} 经销商招募`,
    `${input.brandName} 服务网络招募`,
    `${input.brandNameCn ?? input.brandName} 售后服务标准`,
    `${input.brandNameCn ?? input.brandName} 特约维修 工具`,
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
      console.error(`  [retry ${attempt}/${maxAttempts}] research-workshop ${input.brandName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

export interface WorkshopResearchResult {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  sourceUrls: string[];
  hasGrounding: boolean;
  workshop_requirements?: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}

export async function researchWorkshop(model: string, input: WorkshopResearchInput): Promise<WorkshopResearchResult> {
  try {
    const { parsed, sourceUrls: rawSourceUrls, rawText } = await queryWorkshopResearch(model, input);

    if (!parsed || !parsed.workshop_requirements) {
      return {
        status: "error",
        errorMessage: `Could not parse a workshop_requirements object from response (first 300 chars): ${rawText.slice(0, 300)}`,
        sourceUrls: [],
        hasGrounding: false,
        valid: false,
        errors: [],
      };
    }

    const sourceUrls = filterToChineseSources(rawSourceUrls);
    const hasGrounding = sourceUrls.length > 0;
    const { valid, errors } = validateResearchedWorkshop(parsed.workshop_requirements);
    if (!valid) {
      return { status: "not_found", sourceUrls, hasGrounding, workshop_requirements: parsed.workshop_requirements as Record<string, unknown>, valid, errors };
    }

    const gated = applyWorkshopGroundingGate({ ...(parsed.workshop_requirements as Record<string, unknown>) }, hasGrounding);
    return { status: "found", sourceUrls, hasGrounding, workshop_requirements: gated, valid: true, errors: [] };
  } catch (err) {
    if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
    return { status: "error", errorMessage: (err as Error).message, sourceUrls: [], hasGrounding: false, valid: false, errors: [] };
  }
}
