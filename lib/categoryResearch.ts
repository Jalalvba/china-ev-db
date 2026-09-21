// Shared prompt/parsing plumbing for the four Model-level research categories
// (market_trend, global known_issues, technical_bulletins, recalls) — prompt-building
// helpers, JSON extraction, and format-rule text reused by both each category's manual
// export-prompt builder and lib/researchCategoriesImport.ts's import validation.
//
// 2026-09-21: the automated live-call orchestrator that used to live here
// (runCategoryResearch, which called lib/groundedResearch.ts's runGroundedResearch) was
// removed — each category's own researchX() automated function was already stripped in
// an earlier pass (see CLAUDE.md), which left this file's orchestrator with zero real
// callers. Only the prompt/parsing helpers below survive, since the manual export/import
// path still needs them.

import type { TargetModel, TargetPowertrain } from "@/lib/categoryValidators";

export interface CategoryResearchInput {
  brandName: string;
  modelName: string;
  brandNameCn?: string;
  modelNameCn?: string;
  /** Model.generation — free text, sometimes prose; only surfaced to prompts when short (see describeTargetModel). */
  generation?: string;
  modelYear?: number;
  /** The model's actual powertrain per this DB's trims (lib/modelPowertrain.ts). When set, prompts state it and the powertrain guard is enforced. */
  powertrain?: TargetPowertrain;
  /** Fetch each item's cited page and check it exists and names the target (lib/sourceVerification.ts). Default true; set false in tests/offline runs. */
  verifySources?: boolean;
}

/** The TargetModel the validators/filters match against. */
export function targetOf(input: CategoryResearchInput): TargetModel {
  return { brandName: input.brandName, modelName: input.modelName, modelNameCn: input.modelNameCn, powertrain: input.powertrain };
}

/** Best Chinese-name string to search with: the model's own name_cn, else brand's Chinese name + English model name, else the plain English pair. */
export function searchName(input: CategoryResearchInput): string {
  return input.modelNameCn ?? (input.brandNameCn ? `${input.brandNameCn} ${input.modelName}` : `${input.brandName} ${input.modelName}`);
}

/** One-line, unambiguous statement of exactly which vehicle is the research target — used by the exact-model rule below. */
export function describeTargetModel(input: CategoryResearchInput): string {
  const cn = input.modelNameCn ? ` (${input.modelNameCn})` : "";
  const gen = input.generation && input.generation.length <= 60 ? `, generation/model year: ${input.generation}` : input.modelYear ? `, model year: ${input.modelYear}` : "";
  // A model's name often already starts with its brand ("WEY Lanshan") — don't print it twice.
  const full = input.modelName.toLowerCase().startsWith(input.brandName.toLowerCase()) ? input.modelName : `${input.brandName} ${input.modelName}`;
  return `"${full}"${cn}${gen}`;
}

/**
 * The EXACT-MODEL RULE paragraph shared by both known-issues passes (China + Global). The
 * prompt states it, the format prompt makes the model attest to it per item, and
 * filterIssuesToTargetModel() (lib/categoryValidators.ts) enforces it in code — prose
 * alone is not trusted. See that function's comment for the incident behind it.
 */
export function exactModelRulePrompt(input: CategoryResearchInput): string {
  return `EXACT-MODEL RULE — a hard requirement, checked in code after you answer. The research target is exactly ${describeTargetModel(input)}. Use ONLY reports that are about this exact model. EXCLUDE reports about: a sibling or similarly named model (e.g. a "Plus", "Pro", "L" or "Max" variant with a different name), an export-market model sold under a different name, or the brand/platform in general. Generation: a report that names the right model but does not state a model year/generation is ACCEPTABLE (mark it "not_stated" — it will be kept as unconfirmed); a report clearly about a different generation is not (mark it "different"). Do NOT include an off-model item and label it "related variant" or "similar model" — an off-model item must be left OUT entirely, not caveated. If the only material found is about other models, return an empty list: an empty list is a correct answer, especially for a recently launched model with little history.${powertrainRulePrompt(input)}`;
}

/** POWERTRAIN RULE (only when the target's powertrain is known) — this DB covers the plug-in hybrid version only, but nameplates are often also sold as ICE/BEV with different engines. */
export function powertrainRulePrompt(input: CategoryResearchInput): string {
  if (!input.powertrain) return "";
  return `

POWERTRAIN RULE — this database covers ONLY the plug-in hybrid version of a model. The target is: ${input.powertrain.description}. The same nameplate is often also sold as a petrol/ICE, diesel, pure-electric or other variant with a different engine and drivetrain. A report specific to such a variant (e.g. a different engine size such as "2.0T", an ICE-only timing-chain or gearbox complaint, a pure-electric version) does NOT apply and must not be included as an issue of the target. A report about a part shared by all variants (body, paint, infotainment, suspension, seats, cabin) is fine. For every item say in "powertrain_scope" which case it is.`;
}

/**
 * SPECIFICITY RULE for the known-issues passes (China + Global) — enforced in code by lib/genericnessFilter.ts. Live batches
 * kept keyword tags split out of one article, "possible causes" explainers and unattributed "some owners say" boilerplate.
 */
export function specificityRulePrompt(): string {
  return `

SPECIFICITY RULE — every item must be a CONCRETE report about this model: what happened plus its symptom, circumstance, mileage/age or the part involved. Do NOT return: generic advice or troubleshooting ("possible causes of an engine light", "why a car won't start"), buying guides or "years to avoid" lists, bare keywords/tags taken from a list of topics (e.g. "abnormal noise", "seatbelt failure", "poor sound insulation") — especially several of them from one page, or unattributed hearsay ("some owners say…", "reported as an issue from user feedback"). If a page only lists keywords or gives general advice, return nothing for it. Fewer, specific items are better than many vague ones.`;
}

/** Per-item attestation added to the known-issues FORMAT prompts (research-time only; consumed and stripped by filterGenericItems). */
export const ISSUE_SPECIFICITY_TEMPLATE = {
  report_type: "exactly one of: 'specific_report' (a concrete incident/complaint/defect episode about THIS model), 'aggregate_stats' (complaint counts/rankings for THIS model), 'generic_explainer' (advice, possible causes, buying guide, encyclopedia text not tied to this model's own reports), 'tag_list' (a bare keyword from a list of topics)",
};

export const SPECIFICITY_FORMAT_RULE =
  'report_type: set it honestly. Items you would label "generic_explainer" or "tag_list" will be dropped by code — better to leave them out. Never split one article\'s keyword list into several items.';

/** Format-prompt rule line for powertrain_scope, shared by the issue and recall format prompts. */
export const POWERTRAIN_FORMAT_RULE =
  'powertrain_scope: "phev_specific" if the report is about the plug-in hybrid version/system; "all_variants" if it concerns a part shared by every variant; "other_powertrain_only" if the source restricts it to an ICE/diesel/BEV/other version (it will be dropped); "not_stated" if the source does not say which variant. For a powertrain component (engine, gearbox, battery, motor) with no stated variant use "not_stated" — do NOT omit the item for that reason.';

/** Per-item attestation fields added to the known-issues FORMAT prompt (research-time only; stripped in code before anything is stored). */
export const ISSUE_ATTESTATION_TEMPLATE = {
  applies_to_target_model: "boolean — true ONLY if this specific report is about the exact target model named above. Off-model reports must be left out entirely; if you are genuinely unsure whether a report is the exact model, include it with false so the reviewer can see it was rejected",
  same_generation: "exactly one of: 'same' (the source states a model year/generation matching the target), 'not_stated' (the source names the right model but gives no model year/generation), 'different' (the source is about another generation)",
  source_model_name: "string — the vehicle's name EXACTLY as the source itself writes it (e.g. 'Acme Roadster 2.0T'); copy it from the source, never from this prompt",
  powertrain_scope: "exactly one of: 'phev_specific', 'all_variants', 'other_powertrain_only', 'not_stated' (see the POWERTRAIN RULE)",
};

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  const braceStart = candidate.indexOf("{");
  const braceEnd = candidate.lastIndexOf("}");
  if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) return null;
  try {
    const parsed = JSON.parse(candidate.slice(braceStart, braceEnd + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Shared CRITICAL-RULES tail every category's format prompt ends with. */
export function commonFormatRules(extra: string[]): string {
  return `CRITICAL RULES:
- OUTPUT LANGUAGE: every string value must be English (translate any Chinese/other-language source text before writing it), except a site's proper name quoted directly in a "source" field.
${extra.map((r) => `- ${r}`).join("\n")}
- Use null (or an empty array where the shape is an array) for anything you did not actually find. Do NOT pad with generic or plausible-sounding entries.
- Do NOT add, rename, or omit any field from the shape above.`;
}
