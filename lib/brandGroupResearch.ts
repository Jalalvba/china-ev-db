// Manufacturer-group manual export/import: the same Tier-1 brand-identity +
// model-discovery research as lib/brandResearch.ts / lib/modelDiscovery.ts,
// but covering an ENTIRE ownership group (e.g. "Chery Automobile Co., Ltd."
// with Soueast/Chery/Exeed/Lepas) in one prompt/paste round trip, plus two
// group-only questions neither single-brand path asks: cross-brand
// relationships (shared platforms, badge-engineering) and a group-wide
// positioning summary. Reuses lib/brandResearch.ts's BRAND_FIELD_TEMPLATE/
// validateResearchedBrand and lib/modelDiscovery.ts's DISCOVERY_FIELD_TEMPLATE/
// validateDiscoveredModel per-item — this file only adds the group envelope,
// per-brand/per-model routing validation, and the two new group-only sections.
//
// group_relationships/group_positioning are DISPLAY-ONLY in this first pass —
// no Brand/Model field is a good fit for either (Brand.status_note is a
// single free-text slot already meaning "why this brand's own status is what
// it is," not a place for cross-brand facts or a positioning essay), so
// nothing here writes them to Mongo. The review UI shows them for the person
// to record manually (e.g. into status_note by hand, or elsewhere) if useful.
// See CLAUDE.md's 2026-09-21 entry for this decision.

import { RELATIONSHIP_TYPES, BRAND_STATUSES } from "@/models/Brand";
import { SEGMENTS, PRODUCTION_STATUSES } from "@/models/Model";
import { validateResearchedBrand } from "@/lib/brandResearch";
import { validateDiscoveredModel, applyDiscoveryGroundingGate } from "@/lib/modelDiscovery";

export const BRAND_GROUP_MANUAL_SCHEMA_VERSION = "brand-group-manual-v1";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

const BRAND_FIELD_TEMPLATE = {
  name_cn: "string | null (original-language, typically Chinese, name)",
  parent_group: "string | null (the controlling company/group, if any)",
  relationship_type: RELATIONSHIP_TYPES.join(" | ") + " | null",
  stake_percentage: "number | null (parent's equity/control stake, 0-100)",
  tech_partner: "string | null (a technology/co-development partner, distinct from parent_group)",
  country_origin: "string | null",
  founded_year: "number | null",
  status: BRAND_STATUSES.join(" | ") + " | null",
  status_note: "string | null",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

const DISCOVERY_FIELD_TEMPLATE = {
  name: "string (export/international name if exported anywhere, else domestic name)",
  name_cn: "string | null (domestic Chinese name, if different from `name`)",
  name_en: "string | null",
  generation: "string | null",
  segment: SEGMENTS.join(" | ") + " (never null — infer if unsourced, see rules below)",
  segment_confidence: "\"confirmed\" | \"inferred\"",
  body_type: "string | null",
  production_status: PRODUCTION_STATUSES.join(" | ") + " | null",
} as const;

export interface BrandGroupMember {
  brandId: string;
  brandName: string;
  brandNameCn?: string;
  currentParentGroup?: string;
  existingModelNames: string[];
}

export interface BrandGroupExportContext {
  groupKey: string;
  members: BrandGroupMember[];
}

/** Builds ONE combined prompt covering every sub-brand in the group. */
export function buildBrandGroupManualExportPrompt(ctx: BrandGroupExportContext): string {
  const { groupKey, members } = ctx;

  const perBrandBlocks = members
    .map(
      (m) => `- ${m.brandName}${m.brandNameCn ? ` (${m.brandNameCn})` : ""} — brand_id: "${m.brandId}"${
        m.currentParentGroup ? `, currently on file parent group: ${m.currentParentGroup}` : ""
      }${
        m.existingModelNames.length
          ? `\n  Already on file (do not re-report as new): ${m.existingModelNames.join(", ")}`
          : "\n  No models on file yet for this brand."
      }`
    )
    .join("\n");

  const brandsEnvelope = members.map((m) => ({ brand_id: m.brandId, name: m.brandName, ...BRAND_FIELD_TEMPLATE }));
  const envelope = {
    schema_version: BRAND_GROUP_MANUAL_SCHEMA_VERSION,
    group_key: groupKey,
    brands: brandsEnvelope,
    models: [{ model_id: "string | null (null = a NEW model you're proposing; never invent an id for an existing model)", brand_id: "string (must be one of the brand_id values above)", ...DISCOVERY_FIELD_TEMPLATE }],
    group_relationships: [
      {
        description: "string (e.g. shared platform, badge-engineering, shared factory)",
        brands_involved: ["string (brand_id, must be one of the brand_id values above)"],
        confidence: [...CONFIDENCE_SET].join(" | "),
        source_url: "string | null",
      },
    ],
    group_positioning: {
      summary: "string (how this manufacturer group positions its brands relative to each other and the market)",
      confidence: [...CONFIDENCE_SET].join(" | "),
    },
    notes: "string",
  };

  return `You are a researcher building a database of Chinese-market vehicle manufacturer groups, their sub-brands, and model lineups. Real web search results are provided as you research — base findings ONLY on sources you actually find, do not answer from memory alone.

Manufacturer group to research: "${groupKey}", covering these sub-brands:
${perBrandBlocks}

For EACH sub-brand above, research (same scope as single-brand Tier-1 identity research):
- Ownership/control relationship to the group and to each other, equity/control stake, any distinct technology partner, country of origin, founding year, current status.

Then research questions that only make sense at the GROUP level:
1. MODEL GAPS: for each sub-brand, find any current-production, exported (any export market, not just Morocco) model NOT already listed as "on file" above. Only include export-relevant models (sold outside mainland China currently or historically) — exclude domestic-only models. Route each discovered model to the correct sub-brand via its "brand_id".
2. CROSS-BRAND RELATIONSHIPS: shared platforms, badge-engineering (the same underlying vehicle sold under two of this group's brands), shared factories, or other structural links between these specific sub-brands — not generic industry facts.
3. GROUP-WIDE POSITIONING: how does this manufacturer group position its sub-brands relative to each other (e.g. one brand for budget, one for premium, one for exports)?

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have, not a literal example value.
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "group_key" exactly as shown.
- Every "brand_id" you use (in "brands", "models", and "group_relationships.brands_involved") MUST be one of the brand_id values listed above — never invent one or use a brand outside this group.
- OUTPUT LANGUAGE: every string value must be English, except "name_cn" (kept in its original script). Translate any Chinese source text before writing it elsewhere.
- Every fact must come from a source you actually opened — do not estimate or infer from similar brands/models, except "segment" on a discovered model, which is mandatory even when unsourced (use "segment_confidence": "inferred" in that case).
- Use null for anything you cannot find a sourced value for. Do NOT guess.
- "relationship_type" must be exactly one of: ${RELATIONSHIP_TYPES.join(", ")} — or null.
- "status" must be exactly one of: ${BRAND_STATUSES.join(", ")} — or null.
- Do NOT add, rename, or omit any field from the shape above.
- Do not re-report a model already listed as "on file" for its brand unless you have new/corrected details.`;
}

// ---------- parse + validate ----------

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

export interface BrandGroupBrandItem {
  brand_id: string;
  brand: Record<string, unknown> | null;
  valid: boolean;
  errors: string[];
}

export interface BrandGroupModelItem {
  brand_id: string;
  model: Record<string, unknown>;
  valid: boolean;
  errors: string[];
  duplicate: boolean;
  existingModelId: string | null;
  unsupported?: string; // set when model_id was non-null — updating existing models isn't supported via this path
}

export interface BrandGroupRelationshipItem {
  description: string;
  brands_involved: string[];
  confidence: string;
  source_url: string | null;
  valid: boolean;
  errors: string[];
}

export interface BrandGroupPositioning {
  summary: string;
  confidence: string;
}

export interface BrandGroupManualImportResult {
  valid: boolean;
  errors: string[];
  brands: BrandGroupBrandItem[];
  models: BrandGroupModelItem[];
  relationships: BrandGroupRelationshipItem[];
  positioning: BrandGroupPositioning | null;
  notes: string;
}

function namesMatch(a: string, existing: { name?: string; name_cn?: string; name_en?: string }): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(a);
  if (!target) return false;
  return [existing.name, existing.name_cn, existing.name_en].some((n) => typeof n === "string" && norm(n) === target);
}

/**
 * Parses + validates a pasted brand-group-manual-v1 reply. `validBrandIds` is the group's real
 * membership (from groupBrands() server-side, not trusted from the paste) — any brand_id outside
 * this set is rejected at the item level rather than failing the whole import.
 * `existingModelsByBrandId` keys by brand_id so duplicate detection is scoped per sub-brand, not
 * one shared pool across the group.
 */
export function parseBrandGroupManualImport(
  rawText: string,
  groupKey: string,
  validBrandIds: Set<string>,
  existingModelsByBrandId: Map<string, { _id: string; name?: string; name_cn?: string; name_en?: string }[]>
): BrandGroupManualImportResult {
  const empty = { brands: [], models: [], relationships: [], positioning: null, notes: "" };
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], ...empty };

  const errors: string[] = [];
  if (obj.schema_version !== BRAND_GROUP_MANUAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${BRAND_GROUP_MANUAL_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.group_key !== groupKey) {
    errors.push(`group_key ${JSON.stringify(obj.group_key)} does not match this group (${groupKey}) — pasted into the wrong group?`);
  }
  if (errors.length > 0) return { valid: false, errors, ...empty };

  const notes = typeof obj.notes === "string" ? obj.notes : "";
  const hasEvidence = notes.trim() !== "";

  // brands[]
  const rawBrands = Array.isArray(obj.brands) ? obj.brands : [];
  const brands: BrandGroupBrandItem[] = rawBrands.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const brandId = typeof r.brand_id === "string" ? r.brand_id : "";
    if (!brandId || !validBrandIds.has(brandId)) {
      return { brand_id: brandId, brand: null, valid: false, errors: [`brand_id ${JSON.stringify(brandId)} is not a member of this group — rejected.`] };
    }
    // Strip the human-readable "name" field (routing-only) before validating against the
    // canonical brand-field shape, same as brand-manual-v1's single-object validator expects.
    const { name: _name, brand_id: _bid, ...fields } = r;
    void _name;
    void _bid;
    const { valid, errors: itemErrors } = validateResearchedBrand(fields);
    if (!valid) return { brand_id: brandId, brand: null, valid: false, errors: itemErrors };
    const gated = { ...fields } as Record<string, unknown>;
    if (!hasEvidence && !gated.status_note) gated.confidence = "unconfirmed";
    return { brand_id: brandId, brand: gated, valid: true, errors: [] };
  });

  // models[]
  const rawModels = Array.isArray(obj.models) ? obj.models : [];
  const models: BrandGroupModelItem[] = rawModels.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const brandId = typeof r.brand_id === "string" ? r.brand_id : "";
    const modelId = r.model_id;
    if (!brandId || !validBrandIds.has(brandId)) {
      return { brand_id: brandId, model: r, valid: false, errors: [`brand_id ${JSON.stringify(brandId)} is not a member of this group — rejected.`], duplicate: false, existingModelId: null };
    }
    if (modelId !== null && modelId !== undefined) {
      return {
        brand_id: brandId,
        model: r,
        valid: false,
        errors: ["Updating an existing model (non-null model_id) is not supported via group import — use the per-model spec page."],
        duplicate: false,
        existingModelId: typeof modelId === "string" ? modelId : null,
        unsupported: "existing-model-update",
      };
    }
    const { model_id: _mid, brand_id: _bid2, ...modelFields } = r;
    void _mid;
    void _bid2;
    const { valid, errors: itemErrors } = validateDiscoveredModel(modelFields);
    if (!valid) return { brand_id: brandId, model: modelFields, valid: false, errors: itemErrors, duplicate: false, existingModelId: null };

    const gated = applyDiscoveryGroundingGate({ ...modelFields }, hasEvidence);
    const name = typeof gated.name === "string" ? gated.name : "";
    const existingForBrand = existingModelsByBrandId.get(brandId) ?? [];
    const match = existingForBrand.find((m) => namesMatch(name, m));

    return { brand_id: brandId, model: gated, valid: true, errors: [], duplicate: !!match, existingModelId: match?._id ?? null };
  });

  // group_relationships[]
  const rawRelationships = Array.isArray(obj.group_relationships) ? obj.group_relationships : [];
  const relationships: BrandGroupRelationshipItem[] = rawRelationships.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const description = typeof r.description === "string" ? r.description : "";
    const brandsInvolved = Array.isArray(r.brands_involved) ? (r.brands_involved.filter((b) => typeof b === "string") as string[]) : [];
    const itemErrors: string[] = [];
    if (!description.trim()) itemErrors.push("description: missing");
    const badIds = brandsInvolved.filter((b) => !validBrandIds.has(b));
    if (badIds.length > 0) itemErrors.push(`brands_involved: ${JSON.stringify(badIds)} not in this group — rejected.`);
    if (brandsInvolved.length === 0) itemErrors.push("brands_involved: must name at least one brand_id");
    const sourceUrl = typeof r.source_url === "string" && r.source_url.trim() !== "" ? r.source_url : null;
    let confidence = typeof r.confidence === "string" && CONFIDENCE_SET.has(r.confidence) ? r.confidence : "unconfirmed";
    if (!sourceUrl) confidence = "unconfirmed";
    return { description, brands_involved: brandsInvolved, confidence, source_url: sourceUrl, valid: itemErrors.length === 0, errors: itemErrors };
  });

  // group_positioning
  let positioning: BrandGroupPositioning | null = null;
  if (obj.group_positioning && typeof obj.group_positioning === "object") {
    const gp = obj.group_positioning as Record<string, unknown>;
    const summary = typeof gp.summary === "string" ? gp.summary : "";
    if (summary.trim()) {
      let confidence = typeof gp.confidence === "string" && CONFIDENCE_SET.has(gp.confidence) ? gp.confidence : "unconfirmed";
      if (!hasEvidence) confidence = "unconfirmed";
      positioning = { summary, confidence };
    }
  }

  return { valid: true, errors: [], brands, models, relationships, positioning, notes };
}
