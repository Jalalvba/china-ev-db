// Brand-specific workshop-override research — replaces the old per-brand,
// single-query, free-text lib/workshopResearch.ts pipeline (still present but no
// longer wired into any UI, see app/workshop/page.tsx). Two real differences:
//
// 1. Output shape matches IBrandWorkshopOverride.overrides (technician_certification/
//    lift_requirements/special_tools — the same structured shape as
//    workshop_standards), not the old flat free-text fields, so it can be merged by
//    lib/workshopResolution.ts.
// 2. Three deliberately distinct search queries per brand instead of one generic
//    pass (see buildOverrideSearchQueries) — the earlier single-query approach's
//    thin coverage was a big part of why the per-model version got deprecated; this
//    doesn't fix source scarcity (some brands are just never going to have a public
//    dedicated document), but widens the net before concluding "nothing found".
//
// Same Chinese-source-only hard constraint as lib/workshopResearch.ts,
// lib/warrantyResearch.ts, lib/positioningResearch.ts, lib/issueResearch.ts — see
// lib/chineseSourceGuard.ts's header for the shared reasoning.

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

export interface OverrideResearchInput {
  brandName: string;
  brandNameCn?: string;
}

export function buildOverrideSearchQueries(input: OverrideResearchInput): string[] {
  const name = input.brandNameCn ?? input.brandName;
  return [
    `${input.brandName} 经销商招募 售后服务标准`,
    `${name} 特约维修站 认证要求`,
    `${name} 新能源 维修资质 培训`,
  ];
}

const OVERRIDE_FIELD_TEMPLATE = {
  technician_certification: {
    level: "string | null (e.g. a named cert tier or grade this brand specifically requires)",
    body: "string | null (certifying body, if brand-specific rather than the generic national one)",
    required_for: "string[] | null (what this cert gates, e.g. ['HV battery service'])",
    retraining_interval_months: "number | null",
  },
  lift_requirements: {
    type: "string | null",
    min_capacity_kg: "number | null",
    lift_points_note: "string | null",
    battery_removal_capable: "boolean | null",
  },
  special_tools: [
    {
      name: "string (required — the tool's name)",
      category: "string | null",
      mandatory: "boolean | null",
      notes: "string | null",
    },
  ],
  source: "string | null (which Chinese source this came from)",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export function buildOverrideKickoffPrompt(input: OverrideResearchInput): string {
  const { brandName, brandNameCn } = input;
  return `You are a researcher building a database of Chinese-market vehicle brands' official after-sales workshop requirements, for an after-sales (SAV) operation setting up a workshop in Morocco.

Brand to research: "${brandName}"${brandNameCn ? ` (${brandNameCn})` : ""}

CHINESE SOURCES ONLY — this is a hard requirement, not a preference: only use results from Chinese-language sources (manufacturer 经销商招募/服务网络 pages, 售后服务标准 documents, 汽车之家, 懂车帝). If a search result below is in English or from a non-Chinese site, IGNORE it completely. If you cannot find a Chinese-language source for a fact, report that field as not found (null) rather than guessing or using a non-Chinese source.

Research this brand's official after-sales WORKSHOP requirements — specifically anything BEYOND generic industry-standard requirements (a generic national EV-technician certification baseline and generic lift/tooling classes are already covered elsewhere; only report something here if it is a real, brand-specific requirement or number):
- Any named technician certification tier THIS BRAND specifically requires (not just "authorized technician" boilerplate — a named level, a specific training program, a specific retraining cadence)
- Any specific lift type or minimum capacity this brand's service standard calls out
- Any named special/OEM tool this brand requires beyond generic tools (e.g. a proprietary diagnostic rig, a named battery-service fixture)

Do NOT report generic reseller/dealer-network boilerplate ("official authorized dealer", "4S store network", "genuine parts only") as if it were a workshop requirement — that is marketing language, not a tooling/cert/lift fact, and should be treated as not found.

This is likely to have thin coverage for many brands — dealer/service network recruitment pages (经销商招募) and after-sales service standard documents (售后服务标准) are not always public. Search for them anyway, but if truly nothing brand-specific is found, that is an expected, reportable outcome (return null/empty fields), not a failure to try harder.

Report your findings in plain prose with citations (include the actual URL for each fact) — do not format as JSON yet.`;
}

export function buildOverrideFormatPrompt(): string {
  const templateJson = JSON.stringify({ overrides: OVERRIDE_FIELD_TEMPLATE }, null, 2);
  return `Convert your findings above into ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this shape (the inner object is a field-by-field description of the type each field must have, not a literal example value):
${templateJson}

CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese source text before writing it) — except keep any named Chinese certification/program title's original characters alongside an English gloss if useful, e.g. "Level 2 Technician (二级技师)".
- Every fact must come from a Chinese-language source you actually found in the search results provided (grounding is enabled) — do not estimate or use a non-Chinese source.
- Do NOT report generic dealer/reseller boilerplate as a fact — see the rule in the previous prompt.
- Use null (or an empty array for special_tools) for anything you cannot find a sourced, brand-specific value for. Do NOT guess.
- Do NOT add, rename, or omit any top-level field from the shape above.`;
}

export interface ResearchedOverrideFields {
  technician_certification?: {
    level?: string;
    body?: string;
    required_for?: string[];
    retraining_interval_months?: number;
  };
  lift_requirements?: {
    type?: string;
    min_capacity_kg?: number;
    lift_points_note?: string;
    battery_removal_capable?: boolean;
  };
  special_tools?: { name: string; category?: string; mandatory?: boolean; notes?: string }[];
  source?: string;
  confidence?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateResearchedOverride(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isPlainObject(raw)) return { valid: false, errors: ["overrides is not an object"] };
  const v = raw;
  const TOP_LEVEL = new Set(["technician_certification", "lift_requirements", "special_tools", "source", "confidence"]);
  for (const key of Object.keys(v)) {
    if (!TOP_LEVEL.has(key)) errors.push(`${key}: unexpected field, not in canonical shape`);
  }
  if (v.technician_certification !== undefined && v.technician_certification !== null && !isPlainObject(v.technician_certification)) {
    errors.push("technician_certification: must be an object or null");
  }
  if (v.lift_requirements !== undefined && v.lift_requirements !== null && !isPlainObject(v.lift_requirements)) {
    errors.push("lift_requirements: must be an object or null");
  }
  if (v.special_tools !== undefined && v.special_tools !== null) {
    if (!Array.isArray(v.special_tools)) {
      errors.push("special_tools: must be an array or null");
    } else {
      v.special_tools.forEach((t, i) => {
        if (!isPlainObject(t) || typeof t.name !== "string" || !t.name.trim()) {
          errors.push(`special_tools[${i}]: must be an object with a non-empty "name"`);
        }
      });
    }
  }
  if (v.source !== undefined && v.source !== null && typeof v.source !== "string") {
    errors.push("source: must be a string or null");
  }
  if (v.confidence !== undefined && v.confidence !== null && (typeof v.confidence !== "string" || !CONFIDENCE_SET.has(v.confidence))) {
    errors.push(`confidence: invalid value ${JSON.stringify(v.confidence)}`);
  }
  return { valid: errors.length === 0, errors };
}

// Boilerplate the model sometimes reports as a "fact" despite the prompt's explicit
// instruction not to — a second, code-level gate rather than trusting the LLM alone
// (same defense-in-depth reasoning as lib/chineseSourceGuard.ts's domain allowlist).
const BOILERPLATE_TOOL_NAME = /^(official|authorized|genuine)\s+(dealer|reseller|parts|tools?)$/i;

/**
 * True only if the researched overrides contain at least one real, specific fact —
 * a named certification level, a numeric lift capacity, or a special tool whose
 * name isn't generic boilerplate. Reject a response that's technically
 * schema-valid but empty/boilerplate-only ("official authorized dealer network"
 * dressed up as a workshop requirement) — see the brief's requirement to gate on
 * "actually contains cert/tool/lift specifics", not just non-null fields.
 */
export function passesSpecificityGate(overrides: ResearchedOverrideFields): boolean {
  if (overrides.technician_certification?.level?.trim()) return true;
  if (overrides.lift_requirements?.min_capacity_kg !== undefined && overrides.lift_requirements?.min_capacity_kg !== null) return true;
  if (overrides.lift_requirements?.type?.trim() && !/^(standard|generic|regular)/i.test(overrides.lift_requirements.type.trim())) return true;
  const realTools = (overrides.special_tools ?? []).filter((t) => t.name?.trim() && !BOILERPLATE_TOOL_NAME.test(t.name.trim()));
  if (realTools.length > 0) return true;
  return false;
}

// The live-call path (queryOverrideResearch/researchBrandWorkshopOverride, which
// called lib/groundedResearch.ts directly) was removed 2026-09-21 — see CLAUDE.md.
// This is a script-only feature with no UI button anywhere in the app, so no
// manual-import panel was built for it; scripts/research-brand-workshop-overrides.ts
// now writes buildOverrideKickoffPrompt/FormatPrompt's text to a batch file for
// manual processing, and a human pastes the resulting JSON straight into
// `npm run apply-workshop-overrides-batch` (validateResearchedOverride/
// passesSpecificityGate above still gate that write).
