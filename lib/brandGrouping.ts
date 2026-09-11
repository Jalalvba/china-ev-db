import type { IBrand } from "@/types";

/**
 * parent_group is free text collected across many separate import sessions,
 * so the same real-world manufacturer shows up under several spellings
 * ("Geely" vs "Geely Holding Group", "SAIC" vs "SAIC Motor", a literal
 * doubled string "GWM (GWM (Great Wall Motor))", etc). This is a display-only
 * normalization for the homepage grouping — it does not touch the DB.
 */
const GROUP_ALIASES: Record<string, string> = {
  "byd group": "BYD Group",
  byd: "BYD Group",
  "geely holding group": "Geely Holding Group",
  geely: "Geely Holding Group",
  "geely / volvo": "Geely Holding Group",
  "geely / mercedes-benz": "Geely Holding Group",
  "changan automobile": "Changan",
  changan: "Changan",
  "great wall motor": "GWM (Great Wall Motor)",
  "gwm (great wall motor)": "GWM (Great Wall Motor)",
  "gwm (gwm (great wall motor))": "GWM (Great Wall Motor)",
  "chery automobile": "Chery",
  chery: "Chery",
  "chery / jlr": "Chery",
  "dongfeng motor corporation": "Dongfeng",
  dongfeng: "Dongfeng",
  "dongfeng liuzhou motor": "Dongfeng",
  "dongfeng honda": "Dongfeng",
  "dongfeng nissan": "Dongfeng",
  "dongfeng / stellantis (shenlong automobile)": "Dongfeng",
  "saic motor": "SAIC",
  saic: "SAIC",
  "saic-gm-wuling": "SAIC",
  faw: "FAW",
  "faw group": "FAW",
  "faw-volkswagen / chengdu economic development zone": "FAW",
  jac: "JAC",
  "jac auto": "JAC",
  "jac group": "JAC",
  "jac / volkswagen": "JAC",
  gac: "GAC",
  "gac group": "GAC",
  "gac aion": "GAC",
  "gac honda": "GAC",
  jmcg: "JMCG",
  "jmc auto": "JMCG",
  seres: "Seres",
  "seres (seres-invested aiva tech)": "Seres",
};

/** Brands whose own name IS the canonical group label, even though they have no parent_group of their own (they're the flagship the sub-brands point to). */
const ANCHOR_BRAND_TO_GROUP: Record<string, string> = {
  BYD: "BYD Group",
  Geely: "Geely Holding Group",
};

/** Some brands' parent_group was recorded as a combined "Manufacturer / Huawei" string before tech_partner existed as its own field — extract it for display only. */
const LEGACY_TECH_PARTNER_SUFFIX: Record<string, { parent: string; tech: string }> = {
  "seres / huawei (co-developed)": { parent: "Seres", tech: "Huawei" },
};

const TECH_ECOSYSTEM_LABEL: Record<string, string> = {
  Huawei: "Huawei / HIMA Ecosystem",
};

export interface NormalizedBrand extends IBrand {
  displayParentGroup?: string;
  displayTechPartner?: string;
}

export interface BrandGroup {
  key: string;
  label: string;
  isEcosystem: boolean;
  brands: NormalizedBrand[];
}

function canonicalizeParent(raw: string): string {
  const trimmed = raw.trim();
  return GROUP_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function normalize(brand: IBrand): NormalizedBrand {
  const legacy = brand.parent_group ? LEGACY_TECH_PARTNER_SUFFIX[brand.parent_group.trim().toLowerCase()] : undefined;
  return {
    ...brand,
    displayParentGroup: legacy?.parent ?? (brand.parent_group ? canonicalizeParent(brand.parent_group) : undefined),
    displayTechPartner: brand.tech_partner ?? legacy?.tech,
  };
}

/**
 * Groups brands by manufacturer for the homepage. Priority: a Huawei/HIMA-style
 * tech ecosystem groups across manufacturers first (since that's the more
 * relevant cluster for those brands), then parent_group (canonicalized),
 * then a brand's own name if other brands point to it as their parent, else
 * the brand stands alone.
 */
export function groupBrands(brands: IBrand[]): { groups: BrandGroup[]; standalone: NormalizedBrand[] } {
  const normalized = brands.map(normalize);
  const names = new Set(normalized.map((b) => b.name));

  const keyFor = (b: NormalizedBrand): string | undefined => {
    if (b.displayTechPartner) return TECH_ECOSYSTEM_LABEL[b.displayTechPartner] ?? `${b.displayTechPartner} Ecosystem`;
    if (b.displayParentGroup) return b.displayParentGroup;
    if (ANCHOR_BRAND_TO_GROUP[b.name]) return ANCHOR_BRAND_TO_GROUP[b.name];
    return undefined;
  };

  // A brand with no parent of its own still anchors a group if some other
  // brand's canonical parent equals its name (e.g. NIO has no parent_group,
  // but Onvo/Firefly point to "NIO").
  const referencedAsParent = new Set(
    normalized.map((b) => b.displayParentGroup).filter((g): g is string => Boolean(g))
  );

  const byKey = new Map<string, NormalizedBrand[]>();
  const standalone: NormalizedBrand[] = [];

  for (const b of normalized) {
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
