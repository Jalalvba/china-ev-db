// Shared China price-range formatting — used by both the model detail page
// (app/models/[id]/page.tsx) and the Compare page (app/compare/page.tsx) so
// the two don't drift the way they did before this file existed: the Compare
// page's price row was hand-rolling its own "min ?? '?'" formatting
// independently of the model page's row-rendering conventions, which is how
// a literal "? – ? CNY" made it to the UI when min/max were null.

import type { IPriceRange, IPowertrain } from "@/types";

/** "$18,000 – $24,000", or undefined if min_usd/max_usd aren't both present. Appends "⚠" when the range is flagged unverified. */
export function formatChinaPriceUsd(priceRange: IPriceRange | undefined | null): string | undefined {
  if (!priceRange || priceRange.min_usd == null || priceRange.max_usd == null) return undefined;
  return `$${priceRange.min_usd.toLocaleString()} – $${priceRange.max_usd.toLocaleString()}${
    priceRange.unverified ? " ⚠" : ""
  }`;
}

type TrimPriceFields = Pick<IPowertrain, "trim_price_min" | "trim_price_max" | "trim_price_currency" | "trim_price_confidence">;

/** This trim's own price, e.g. "129,900 – 149,900 CNY" (or a single figure when min===max), or undefined if neither bound is set. Appends "⚠" when unconfirmed — same gating convention as every other researched field. Shared by the model detail page, Tech Search cards, and the Compare page so all three render a trim's price identically. */
export function formatTrimPrice(p: TrimPriceFields | undefined | null): string | undefined {
  if (!p || (p.trim_price_min == null && p.trim_price_max == null)) return undefined;
  const currency = p.trim_price_currency ?? "CNY";
  const label =
    p.trim_price_min != null && p.trim_price_max != null && p.trim_price_min !== p.trim_price_max
      ? `${p.trim_price_min.toLocaleString()} – ${p.trim_price_max.toLocaleString()} ${currency}`
      : `${(p.trim_price_min ?? p.trim_price_max)!.toLocaleString()} ${currency}`;
  return `${label}${p.trim_price_confidence === "unconfirmed" ? " ⚠" : ""}`;
}
