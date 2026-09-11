import type { IBrand } from "@/types";

/**
 * parent_group/tech_partner are canonicalized at the source (see
 * scripts/migrate-parent-groups.ts) — this module just decides how to
 * cluster already-clean brands for the homepage, not how to spell anything.
 */

/** Brands whose own name IS the canonical group label, even though they have no parent_group of their own (they're the flagship the sub-brands point to). */
const ANCHOR_BRAND_TO_GROUP: Record<string, string> = {
  BYD: "BYD Group",
  Geely: "Geely Holding Group",
};

const TECH_ECOSYSTEM_LABEL: Record<string, string> = {
  Huawei: "Huawei / HIMA Ecosystem",
};

export interface BrandGroup {
  key: string;
  label: string;
  isEcosystem: boolean;
  brands: IBrand[];
}

/**
 * Groups brands by manufacturer for the homepage. Priority: a Huawei/HIMA-style
 * tech ecosystem groups across manufacturers first (since that's the more
 * relevant cluster for those brands), then parent_group as stored, then a
 * brand's own name if other brands point to it as their parent, else the
 * brand stands alone.
 */
export function groupBrands(brands: IBrand[]): { groups: BrandGroup[]; standalone: IBrand[] } {
  const names = new Set(brands.map((b) => b.name));

  const keyFor = (b: IBrand): string | undefined => {
    if (b.tech_partner) return TECH_ECOSYSTEM_LABEL[b.tech_partner] ?? `${b.tech_partner} Ecosystem`;
    if (b.parent_group) return b.parent_group;
    if (ANCHOR_BRAND_TO_GROUP[b.name]) return ANCHOR_BRAND_TO_GROUP[b.name];
    return undefined;
  };

  // A brand with no parent of its own still anchors a group if some other
  // brand's parent_group equals its name (e.g. NIO has no parent_group, but
  // Onvo/Firefly point to "NIO").
  const referencedAsParent = new Set(brands.map((b) => b.parent_group).filter((g): g is string => Boolean(g)));

  const byKey = new Map<string, IBrand[]>();
  const standalone: IBrand[] = [];

  for (const b of brands) {
    let key = keyFor(b);
    if (!key && names.has(b.name) && referencedAsParent.has(b.name)) key = b.name;
    if (!key) {
      standalone.push(b);
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(b);
  }

  const groups: BrandGroup[] = [];
  for (const [key, groupBrandsList] of byKey) {
    if (groupBrandsList.length < 2) {
      // Only one brand ended up under this key (e.g. a one-off parent_group
      // string with no siblings) — no value in a group wrapper for it.
      standalone.push(...groupBrandsList);
      continue;
    }
    const isEcosystem = Object.values(TECH_ECOSYSTEM_LABEL).includes(key) || key.endsWith(" Ecosystem");
    groupBrandsList.sort((a, b) => {
      const aAnchor = a.name === key || ANCHOR_BRAND_TO_GROUP[a.name] === key;
      const bAnchor = b.name === key || ANCHOR_BRAND_TO_GROUP[b.name] === key;
      if (aAnchor !== bAnchor) return aAnchor ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    groups.push({ key, label: key, isEcosystem, brands: groupBrandsList });
  }

  groups.sort((a, b) => b.brands.length - a.brands.length || a.label.localeCompare(b.label));
  standalone.sort((a, b) => a.name.localeCompare(b.name));

  return { groups, standalone };
}
