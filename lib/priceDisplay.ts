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

type TrimPriceFields = Pick<IPowertrain, "trim_price_min_usd" | "trim_price_max_usd" | "trim_price_confidence">;

/**
 * This trim's own price, e.g. "$18,000 – $24,000" (or a single figure when
 * min===max), or undefined if neither USD bound is set. Appends "⚠" when
 * unconfirmed — same gating convention as every other researched field.
 * Shared by the model detail page, Tech Search cards, and the Compare page
 * so all three render a trim's price identically.
 *
 * Deliberately reads ONLY the _usd fields, never the raw
 * trim_price_min/max/currency (always CNY as researched) — those must never
 * be displayed directly anywhere in this app (Morocco's DH figure is the
 * one intentional, explicitly-flagged exception). lib/applySpecUpdates.ts
 * computes trim_price_min_usd/max_usd at write time for every write that
 * includes a trim_price, so a trim with a price but no _usd figures means
 * that write predates the USD-conversion fix (see
 * scripts/backfill-trim-price-usd.ts) rather than a genuinely-priceless trim
 * — correctly shows nothing rather than a wrong/unconverted number either way.
 */
export function formatTrimPrice(p: TrimPriceFields | undefined | null): string | undefined {
  if (!p || (p.trim_price_min_usd == null && p.trim_price_max_usd == null)) return undefined;
  const label =
    p.trim_price_min_usd != null && p.trim_price_max_usd != null && p.trim_price_min_usd !== p.trim_price_max_usd
      ? `$${p.trim_price_min_usd.toLocaleString()} – $${p.trim_price_max_usd.toLocaleString()}`
      : `$${(p.trim_price_min_usd ?? p.trim_price_max_usd)!.toLocaleString()}`;
  return `${label}${p.trim_price_confidence === "unconfirmed" ? " ⚠" : ""}`;
}
