// Manufacturer-level BRAND discovery: distinct from lib/brandGroupResearch.ts (which manages
// brands/models ALREADY in the DB under a group). This finds brands/sub-brands that belong to the
// same manufacturer group but don't exist in the DB at all yet (e.g. for "Chery Automobile Co.,
// Ltd." with Soueast/Chery/Exeed already on file, checking for Lepas/Omoda/Jaecoo/etc.).
//
// Reuses lib/brandResearch.ts's validateResearchedBrand/applyBrandGroundingGate for per-item
// identity-field validation — same canonical brand shape, just against a brand that doesn't exist
// yet rather than one being corrected.

import { RELATIONSHIP_TYPES, BRAND_STATUSES } from "@/models/Brand";
import { validateResearchedBrand, applyBrandGroundingGate } from "@/lib/brandResearch";

export const BRAND_DISCOVERY_SCHEMA_VERSION = "brand-discovery-v1";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

const DISCOVERED_BRAND_FIELD_TEMPLATE = {
  name: "string (the brand's own name)",
  name_cn: "string | null (original-language, typically Chinese, name)",
  relationship_type: RELATIONSHIP_TYPES.join(" | ") + " | null",
  stake_percentage: "number | null (parent's equity/control stake, 0-100)",
  tech_partner: "string | null (a technology/co-development partner, distinct from the parent group)",
  country_origin: "string | null",
  founded_year: "number | null",
  status: BRAND_STATUSES.join(" | ") + " | null",
  status_note: "string | null",
  confidence: [...CONFIDENCE_SET].join(" | ") + " | null",
} as const;

export interface BrandDiscoveryExportContext {
  groupKey: string;
  existingBrandNames: string[];
}

/** Builds the export prompt asking for brands/sub-brands NOT already in the DB under this group. */
export function buildBrandDiscoveryExportPrompt(ctx: BrandDiscoveryExportContext): string {
  const { groupKey, existingBrandNames } = ctx;

  const envelope = {
    schema_version: BRAND_DISCOVERY_SCHEMA_VERSION,
    group_key: groupKey,
    discovered_brands: [DISCOVERED_BRAND_FIELD_TEMPLATE],
    notes: "string",
  };

  return `You are a researcher building a database of Chinese-market vehicle manufacturer groups and their sub-brands. Real web search results are provided as you research — base findings ONLY on sources you actually find, do not answer from memory alone.

Manufacturer group: "${groupKey}"

Brands ALREADY in our database under this group (do NOT re-report these):
${existingBrandNames.length ? existingBrandNames.map((n) => `- ${n}`).join("\n") : "(none on file yet)"}

Find any OTHER brands or sub-brands controlled by, owned by, or otherwise affiliated with this same manufacturer group that are NOT in the list above — for example, a joint-venture brand, an export-only brand, a recently-launched sub-brand, or a brand acquired by this group that isn't yet listed. Only include a brand if you can identify a real, currently-or-formerly operating brand — do not invent one.

NO GHOST ENTRIES: only include a brand if it has at least one verifiable, sourced fact confirming it is a real, currently or recently sold PHEV SUV brand — do not include placeholder names, rumored future brands, or brands with no findable product information. A name appearing in a single unconfirmed listing, forum post, or speculative article is NOT enough on its own. If uncertain whether an entry is real, exclude it rather than guess.

For each brand you find, research: its Chinese name (if different), its relationship to the group (ownership/control type, equity stake), any distinct technology partner, country of origin, founding year, and current status.

Respond with ONLY a JSON object (no markdown fencing, no prose before or after) in exactly this envelope. Each value below describes the type the field must have, not a literal example value.
${JSON.stringify(envelope, null, 2)}

CRITICAL RULES:
- Keep "schema_version" and "group_key" exactly as shown.
- Do NOT re-report any brand already listed above as "already in our database."
- If you find no additional brands, return "discovered_brands": [] — do not force a result.
- OUTPUT LANGUAGE: every string value must be English, except "name_cn" (kept in its original script). Translate any Chinese source text before writing it elsewhere.
- Every fact must come from a source you actually opened — do not estimate or infer. Use null for anything you cannot find a sourced value for.
- NO GHOST ENTRIES: do not include a brand unless you found at least one real, verifiable, sourced fact about a product it actually sells (a model, a spec, a price, a sales/availability report, an official announcement). A bare brand name with no findable product information, a rumored/speculative future brand, or a placeholder listing must be excluded entirely.
- "relationship_type" must be exactly one of: ${RELATIONSHIP_TYPES.join(", ")} — or null.
- "status" must be exactly one of: ${BRAND_STATUSES.join(", ")} — or null.
- Do NOT add, rename, or omit any field from the shape above.`;
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

export interface DiscoveredBrandItem {
  key: string;
  fields: Record<string, unknown>; // canonical brand-identity fields, including "name" for display
  valid: boolean;
  errors: string[];
  duplicate: boolean;
  existingBrandId: string | null;
  duplicateInDifferentGroup: boolean;
}

export interface BrandDiscoveryImportResult {
  valid: boolean;
  errors: string[];
  discoveredBrands: DiscoveredBrandItem[];
  notes: string;
}

export interface ExistingBrandForDedup {
  _id: string;
  name: string;
  name_cn?: string;
  parent_group?: string;
}

function namesMatch(name: string, nameCn: string | undefined, existing: ExistingBrandForDedup): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const a = norm(name);
  if (a && norm(existing.name) === a) return true;
  if (nameCn && existing.name_cn && norm(nameCn) === norm(existing.name_cn)) return true;
  return false;
}

/**
 * Parses + validates a pasted brand-discovery-v1 reply. `existingBrandsInGroup` and
 * `allExistingBrands` are both resolved server-side (never trusted from the paste) — a discovered
 * brand matching a name already in THIS group is a plain duplicate; matching a name elsewhere in
 * the DB under a DIFFERENT parent_group is flagged distinctly (duplicateInDifferentGroup) since
 * that's a likely misattribution worth a reviewer's attention, not a simple re-suggestion.
 */
export function parseBrandDiscoveryImport(
  rawText: string,
  groupKey: string,
  existingBrandsInGroup: ExistingBrandForDedup[],
  allExistingBrands: ExistingBrandForDedup[]
): BrandDiscoveryImportResult {
  const empty = { discoveredBrands: [], notes: "" };
  const obj = extractJsonObjectLoose(rawText);
  if (!obj) return { valid: false, errors: ["Could not find a JSON object in the pasted text."], ...empty };

  const errors: string[] = [];
  if (obj.schema_version !== BRAND_DISCOVERY_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${BRAND_DISCOVERY_SCHEMA_VERSION}" (got ${JSON.stringify(obj.schema_version)}).`);
  }
  if (obj.group_key !== groupKey) {
    errors.push(`group_key ${JSON.stringify(obj.group_key)} does not match this group (${groupKey}) — pasted into the wrong group?`);
  }
  if (errors.length > 0) return { valid: false, errors, ...empty };

  const notes = typeof obj.notes === "string" ? obj.notes : "";
  const hasEvidence = notes.trim() !== "";

  const inGroupOutsideGroup = allExistingBrands.filter(
    (b) => !existingBrandsInGroup.some((g) => g._id === b._id)
  );

  const rawDiscovered = Array.isArray(obj.discovered_brands) ? obj.discovered_brands : [];
  const discoveredBrands: DiscoveredBrandItem[] = rawDiscovered.map((raw, idx) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const nameCn = typeof r.name_cn === "string" ? r.name_cn : undefined;
    const key = `${idx}`;

    if (!name) {
      return { key, fields: r, valid: false, errors: ["name: missing"], duplicate: false, existingBrandId: null, duplicateInDifferentGroup: false };
    }

    // Strip "name" (routing/display-only, not part of the canonical brand-identity shape) before
    // validating against the same field set brand-manual-v1 uses.
    const { name: _name, ...fields } = r;
    void _name;
    const { valid, errors: itemErrors } = validateResearchedBrand(fields);
    if (!valid) {
      return { key, fields: { name, ...fields }, valid: false, errors: itemErrors, duplicate: false, existingBrandId: null, duplicateInDifferentGroup: false };
    }

    const gated = applyBrandGroundingGate({ ...fields }, hasEvidence) as Record<string, unknown>;

    const inGroupMatch = existingBrandsInGroup.find((b) => namesMatch(name, nameCn, b));
    const outsideGroupMatch = !inGroupMatch ? inGroupOutsideGroup.find((b) => namesMatch(name, nameCn, b)) : undefined;

    return {
      key,
      fields: { name, ...gated },
      valid: true,
      errors: [],
      duplicate: !!inGroupMatch,
      existingBrandId: inGroupMatch?._id ?? outsideGroupMatch?._id ?? null,
      duplicateInDifferentGroup: !!outsideGroupMatch,
    };
  });

  return { valid: true, errors: [], discoveredBrands, notes };
}
