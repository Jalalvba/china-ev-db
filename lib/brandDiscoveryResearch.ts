// Manufacturer-level BRAND discovery: the per-item validation/dedup logic for finding brands/
// sub-brands that belong to a manufacturer group but don't exist in the DB at all yet (e.g. for
// "Chery Automobile Co., Ltd." with Soueast/Chery/Exeed already on file, checking for Lepas/Omoda/
// Jaecoo/etc.). As of 2026-09-21 this is no longer a standalone export/import feature with its own
// button — it was merged into lib/brandGroupResearch.ts's brand-group-manual-v2 envelope as the
// optional `discovered_brands` section, sharing one export prompt / one paste box with the
// existing-brand/model research (see that file's own header comment and CLAUDE.md's dated entry).
// This file now just owns the field template and the reusable per-item validator, imported by
// brandGroupResearch.ts's parser — kept separate because the discovery validation (two-tiered
// duplicate detection) is a distinct enough concern to not inline into the group parser directly.
//
// Reuses lib/brandResearch.ts's validateResearchedBrand/applyBrandGroundingGate for per-item
// identity-field validation — same canonical brand shape, just against a brand that doesn't exist
// yet rather than one being corrected.

import { RELATIONSHIP_TYPES, BRAND_STATUSES } from "@/models/Brand";
import { validateResearchedBrand, applyBrandGroundingGate } from "@/lib/brandResearch";

const CONFIDENCE_SET = new Set(["confirmed", "unconfirmed"]);

export const DISCOVERED_BRAND_FIELD_TEMPLATE = {
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

/** Prose block folded into brandGroupResearch.ts's combined kickoff prompt — kept here so the
 * discovery-specific instructions live next to the field template/validator they describe. */
export const BRAND_DISCOVERY_PROMPT_BLOCK = `Find any OTHER brands or sub-brands controlled by, owned by, or otherwise affiliated with this manufacturer group that are NOT already listed above — for example, a joint-venture brand, an export-only brand, a recently-launched sub-brand, or a brand acquired by this group that isn't yet listed. Only include a brand if you can identify a real, currently-or-formerly operating brand — do not invent one.

NO GHOST ENTRIES: only include a brand if it has at least one verifiable, sourced fact confirming it is a real, currently or recently sold PHEV SUV brand — do not include placeholder names, rumored future brands, or brands with no findable product information. A name appearing in a single unconfirmed listing, forum post, or speculative article is NOT enough on its own. If uncertain whether an entry is real, exclude it rather than guess.

For each brand you find, research: its Chinese name (if different), its relationship to the group (ownership/control type, equity stake), any distinct technology partner, country of origin, founding year, and current status.`;

/** Rule bullets folded into brandGroupResearch.ts's combined CRITICAL RULES list. */
export const BRAND_DISCOVERY_RULES_BLOCK = `- If you find no additional brands, return "discovered_brands": [] — do not force a result.
- NO GHOST ENTRIES: do not include a discovered brand unless you found at least one real, verifiable, sourced fact about a product it actually sells (a model, a spec, a price, a sales/availability report, an official announcement). A bare brand name with no findable product information, a rumored/speculative future brand, or a placeholder listing must be excluded entirely.
- "discovered_brands[].relationship_type" must be exactly one of: ${RELATIONSHIP_TYPES.join(", ")} — or null.
- "discovered_brands[].status" must be exactly one of: ${BRAND_STATUSES.join(", ")} — or null.`;

export interface DiscoveredBrandItem {
  key: string;
  fields: Record<string, unknown>; // canonical brand-identity fields, including "name" for display
  valid: boolean;
  errors: string[];
  duplicate: boolean;
  existingBrandId: string | null;
  duplicateInDifferentGroup: boolean;
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
 * Validates a `discovered_brands` array from a pasted brand-group-manual-v2 reply.
 * `existingBrandsInGroup` and `allExistingBrands` are both resolved server-side (never trusted
 * from the paste) — a discovered brand matching a name already in THIS group is a plain duplicate;
 * matching a name elsewhere in the DB under a DIFFERENT parent_group is flagged distinctly
 * (duplicateInDifferentGroup) since that's a likely misattribution worth a reviewer's attention,
 * not a simple re-suggestion. `notes` is the top-level envelope's own notes field — hasEvidence is
 * decided once for the whole response, same convention as brand-manual-v1's confidence gate.
 */
export function validateDiscoveredBrandItems(
  rawDiscovered: unknown[],
  existingBrandsInGroup: ExistingBrandForDedup[],
  allExistingBrands: ExistingBrandForDedup[],
  hasEvidence: boolean
): DiscoveredBrandItem[] {
  const inGroupOutsideGroup = allExistingBrands.filter(
    (b) => !existingBrandsInGroup.some((g) => g._id === b._id)
  );

  return rawDiscovered.map((raw, idx) => {
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
}
