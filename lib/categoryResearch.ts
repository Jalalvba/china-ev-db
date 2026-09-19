// Shared plumbing for the four newer Model-level research categories
// (market_trend, global known_issues, technical_bulletins, recalls) — the same
// search → grounded-extraction → confidence-gate pattern as lib/issueResearch.ts /
// lib/positioningResearch.ts (runGroundedResearch does the search + two-turn LLM
// call), with the retry loop, JSON extraction, and gate factored out once instead of
// copied four more times. Each category module supplies only its own prompts, search
// queries, source-guard rule, and item normalizer.

import { ModelNotFoundError, SearchProviderError, sleep } from "@/lib/techSpecResearch";
import { runGroundedResearch } from "@/lib/groundedResearch";
import { normalizeArray } from "@/lib/categoryValidators";
import type { ItemResult, TargetModel, TargetPowertrain } from "@/lib/categoryValidators";
import { verifyItemSources } from "@/lib/sourceVerification";
import type { SourceCheck } from "@/lib/sourceVerification";

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

export interface CategoryResearchResult<T> {
  status: "found" | "not_found" | "error";
  errorMessage?: string;
  /** Source URLs that counted as grounding for this category (after that category's source guard). */
  sourceUrls: string[];
  hasGrounding: boolean;
  /** Normalized, gate-applied items (market_trend returns a one-element array). */
  items: T[];
  /** Items the normalizer rejected, with why. */
  dropped: { index: number; errors: string[] }[];
  /** Non-fatal normalization notes (aliases resolved, downgrades, dropped optional fields). */
  warnings: string[];
  /** One entry per distinct cited URL when source verification ran (lib/sourceVerification.ts). */
  verification?: SourceCheck[];
}

function emptyResult<T>(status: "not_found" | "error", errorMessage?: string): CategoryResearchResult<T> {
  return { status, errorMessage, sourceUrls: [], hasGrounding: false, items: [], dropped: [], warnings: [] };
}

interface RunOpts<T extends { confidence?: string }> {
  model: string;
  label: string;
  input: CategoryResearchInput;
  kickoffPrompt: string;
  formatPrompt: string;
  searchQueries: string[];
  /** Key in the parsed JSON holding this category's payload. */
  responseKey: string;
  /** "array" → payload is an array of items; "object" → payload is a single object (or null) wrapped into a one-element array. */
  shape: "array" | "object";
  /** Filters raw Brave URLs down to what counts as grounding for THIS category (Chinese allowlist, manufacturer allowlist, non-Chinese-only, or everything). */
  groundingFilter: (urls: string[]) => string[];
  normalize: (raw: unknown) => ItemResult<T>;
  /** Optional hard filter on the RAW array payload, applied before normalization (array shape only). Rejections are reported in `dropped` as off-model, never silently lost. */
  preFilter?: (raw: unknown) => { kept: unknown[]; rejected: { index: number; reason: string; summary?: string }[]; warnings?: string[] };
  /** Fetch each kept item's cited page and check it exists and names the target (skipped when input.verifySources === false). */
  verify?: boolean;
  /** Called once per item when there is zero grounding, to force it to "unconfirmed" (the confidence field name differs: `confidence` vs market_trend's `_confidence`). */
  forceUnconfirmed: (item: T) => void;
}

export async function runCategoryResearch<T extends { confidence?: string }>(opts: RunOpts<T>): Promise<CategoryResearchResult<T>> {
  const { model, label, input } = opts;
  try {
    const maxAttempts = 3;
    let lastErr: unknown;
    let formattedText = "";
    let rawUrls: string[] = [];
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
      try {
        const r = await runGroundedResearch({
          kickoffPrompt: opts.kickoffPrompt,
          formatPrompt: opts.formatPrompt,
          searchQueries: opts.searchQueries,
          model,
        });
        formattedText = r.formattedText;
        rawUrls = r.sourceUrls;
        ok = true;
      } catch (err) {
        if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
        lastErr = err;
        const backoffMs = 2000 * attempt;
        console.error(`  [retry ${attempt}/${maxAttempts}] ${label} ${input.brandName} ${input.modelName}: ${(err as Error).message} — waiting ${backoffMs}ms`);
        await sleep(backoffMs);
      }
    }
    if (!ok) throw lastErr;

    const parsed = extractJsonObject(formattedText);
    if (!parsed || !(opts.responseKey in parsed)) {
      return emptyResult("error", `Could not parse a "${opts.responseKey}" payload from response (first 300 chars): ${formattedText.slice(0, 300)}`);
    }

    const sourceUrls = opts.groundingFilter(rawUrls);
    const hasGrounding = sourceUrls.length > 0;
    const payload = parsed[opts.responseKey];

    let items: T[] = [];
    let dropped: { index: number; errors: string[] }[] = [];
    let warnings: string[] = [];
    if (opts.shape === "object") {
      if (payload !== null && payload !== undefined) {
        const res = opts.normalize(payload);
        if (res.item) items = [res.item];
        else dropped = [{ index: 0, errors: res.errors }];
        warnings = res.warnings;
      }
    } else {
      const pre = opts.preFilter ? opts.preFilter(payload) : null;
      const res = normalizeArray(pre ? pre.kept : payload, opts.normalize);
      items = res.items;
      // Indices of `dropped` from normalizeArray refer to the filtered array; the off-model rejections carry the ORIGINAL index.
      dropped = [...(pre ? pre.rejected.map((r) => ({ index: r.index, errors: [`off-model: ${r.reason}${r.summary ? ` — "${r.summary}"` : ""}`] })) : []), ...res.dropped];
      warnings = [...(pre?.warnings ?? []), ...res.warnings];
    }

    if (!hasGrounding) items.forEach(opts.forceUnconfirmed);

    let verification: SourceCheck[] | undefined;
    if (opts.verify && input.verifySources !== false && items.length > 0) {
      const v = await verifyItemSources(items as object[], targetOf(input));
      items = v.items as T[];
      warnings = [...warnings, ...v.warnings];
      dropped = [...dropped, ...v.removed.map((r) => ({ index: -1, errors: [r.reason] }))];
      verification = v.checks;
    }
    return {
      status: items.length > 0 ? "found" : "not_found",
      sourceUrls,
      hasGrounding,
      items,
      dropped,
      warnings,
      verification,
    };
  } catch (err) {
    if (err instanceof ModelNotFoundError || err instanceof SearchProviderError) throw err;
    return emptyResult("error", (err as Error).message);
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
