// Shared China price-range formatting — used by both the model detail page
// (app/models/[id]/page.tsx) and the Compare page (app/compare/page.tsx) so
// the two don't drift the way they did before this file existed: the Compare
// page's price row was hand-rolling its own "min ?? '?'" formatting
// independently of the model page's row-rendering conventions, which is how
// a literal "? – ? CNY" made it to the UI when min/max were null.

import type { IPriceRange } from "@/types";

/** "18,000 – 24,000 CNY", or undefined if min/max aren't both present — never emits a literal "?" for a missing bound. Appends "⚠" when the range is flagged unverified. */
export function formatChinaPriceCny(priceRange: IPriceRange | undefined | null): string | undefined {
  if (!priceRange || priceRange.min == null || priceRange.max == null) return undefined;
  return `${priceRange.min.toLocaleString()} – ${priceRange.max.toLocaleString()} ${priceRange.currency_local}${
    priceRange.unverified ? " ⚠" : ""
  }`;
}

/** "$18,000 – $24,000", or undefined if min_usd/max_usd aren't both present. Appends "⚠" when the range is flagged unverified. */
export function formatChinaPriceUsd(priceRange: IPriceRange | undefined | null): string | undefined {
  if (!priceRange || priceRange.min_usd == null || priceRange.max_usd == null) return undefined;
  return `$${priceRange.min_usd.toLocaleString()} – $${priceRange.max_usd.toLocaleString()}${
    priceRange.unverified ? " ⚠" : ""
  }`;
}
