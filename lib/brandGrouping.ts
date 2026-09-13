import type { IBrand } from "@/types";

/**
 * parent_group/tech_partner are canonicalized at the source (see
 * scripts/migrate-parent-groups.ts) — this module just decides how to
 * cluster already-clean brands for the homepage, not how to spell anything.
 *
 * Grouping is strictly by ownership (parent_group), never by tech_partner.
 * tech_partner (e.g. Huawei) is display-only — a badge on the brand card,
 * not a clustering axis — so a brand's group never changes based on who
 * co-develops its tech.
 */

/** Brands whose own name IS the canonical group label, even though they have no parent_group of their own (they're the flagship the sub-brands point to). */
const ANCHOR_BRAND_TO_GROUP: Record<string, string> = {
  BYD: "BYD Group",
  Geely: "Geely Holding Group",
};

export interface BrandGroup {
  key: string;
  label: string;
  brands: IBrand[];
}

/**
 * Groups brands by manufacturer (parent_group) for the homepage. Priority:
 * parent_group as stored (walking the chain when it points at another brand
 * that itself belongs to a bigger group, e.g. Foton Pickup -> "Foton" ->
 * "BAIC"), then a brand's own name if other brands point to it as their
 * parent, else the brand stands alone.
 */
export function groupBrands(
  brands: IBrand[],
  cheapestMoroccoPriceByBrandId?: Record<string, number>
): { groups: BrandGroup[]; standalone: IBrand[] } {
  // Missing price (a brand with no confirmed Morocco price, only reachable
  // via the ?all=1 view) sorts after every priced brand rather than first —
  // Infinity as the "no price" sentinel makes that the natural result of a
  // plain ascending numeric sort with no separate branch needed.
  const priceFor = (b: IBrand): number => (b._id ? cheapestMoroccoPriceByBrandId?.[b._id] : undefined) ?? Infinity;
  const names = new Set(brands.map((b) => b.name));
  const byName = new Map(brands.map((b) => [b.name, b]));

  // parent_group can point at another brand that itself belongs to a bigger
  // group (e.g. Foton Pickup -> "Foton" -> "BAIC") rather than a terminal
  // conglomerate label directly — walk the chain instead of stopping one
  // level up, with a depth cap as a defensive measure against any cycle.
  const keyFor = (b: IBrand, depth = 0): string | undefined => {
    if (b.parent_group) {
      if (depth < 5) {
        const parentBrand = byName.get(b.parent_group);
        if (parentBrand && parentBrand.name !== b.name) {
          const upstream = keyFor(parentBrand, depth + 1);
          if (upstream) return upstream;
        }
      }
      return b.parent_group;
    }
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
    groupBrandsList.sort((a, b) => priceFor(a) - priceFor(b) || a.name.localeCompare(b.name));
    groups.push({ key, label: key, brands: groupBrandsList });
  }

  // Each group's own cheapest brand decides the group's position — same
  // cheapest-to-most-expensive ordering as within a group, just one level up.
  const cheapestInGroup = (g: BrandGroup) => Math.min(...g.brands.map(priceFor));
  groups.sort((a, b) => cheapestInGroup(a) - cheapestInGroup(b) || a.label.localeCompare(b.label));
  standalone.sort((a, b) => priceFor(a) - priceFor(b) || a.name.localeCompare(b.name));

  return { groups, standalone };
}
