# Listing Conventions — Morocco-price-first, cheapest-to-most-expensive

Frozen reference for how model/brand listings are filtered and sorted across the
app. Confirmed correct and locked in on 2026-09-13 — don't regress this without
an explicit request to change it.

## The rule

Everywhere a list of brands or models is shown (homepage, a brand's model grid),
the default view:

1. **Filters to items with a confirmed Morocco price.** `morocco_price_confirmed
   === true` and `morocco_price_dh` present — this app's whole purpose is
   Morocco-market pricing, so an unpriced item is out of scope for the default
   view, not a first-class citizen alongside priced ones.
2. **Sorts cheapest-to-most-expensive** by that price. A brand's own position is
   decided by its *cheapest* model, not alphabetically and not by model count.
3. **Never hides data — only defers it.** Every filtered-out item is still
   reachable via a `?all=1` query param toggle, with a count of how many are
   hidden and why ("no confirmed Morocco price yet, or discontinued/bankrupt").
   Nothing is deleted or excluded from the database by this convention — it's
   presentation-only.

## Where this is implemented

- **Homepage** (`app/page.tsx` + `lib/brandGrouping.ts`): `getCheapestMoroccoPriceByBrandId()`
  computes each brand's cheapest confirmed Morocco price once; `groupBrands()`
  takes that map and sorts brands within each manufacturer group, the groups
  themselves (by their own cheapest brand), and standalone brands, all
  ascending. A brand with no price sorts last via an `Infinity` sentinel.
  `?all=1` reveals brands with no Morocco price and/or a non-"active" status.
- **Brand page** (`app/brands/[id]/page.tsx`): models sorted the same way
  (confirmed price ascending, `Infinity` sentinel for unpriced, alphabetical
  tiebreak), then filtered to priced-only by default. `?all=1` reveals the rest.
- **Brand cards** (`app/BrandGroupList.tsx`) show a `from X DH` line so the
  sort order is visible, not implicit — never sort by a number the user can't see.

## Why "confirmed" specifically, not just "has a price"

`morocco_price_dh` can be set without `morocco_price_confirmed: true` (e.g. a
`gemini-fallback` reconciliation result, intentionally left unconfirmed pending
human review — see `scripts/sync-morocco-prices.ts`). Only a confirmed price is
trustworthy enough to sort/display by default; an unconfirmed one stays hidden
until reviewed, same as an entirely missing price.

## Extending this pattern to a new listing

If a new page lists brands or models and should follow this same convention:
reuse `getCheapestMoroccoPriceByBrandId()`'s query shape (or the equivalent
per-model check) rather than re-deriving it — this project has already hit
real drift bugs from the same logic being hand-rolled in two places (see
`lib/priceDisplay.ts` and `lib/specGrouping.ts`'s own header comments for
other examples of exactly this failure mode).
