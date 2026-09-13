# Listing Conventions — frozen baseline as of 2026-09-13

Frozen reference for how model/brand listings are filtered/sorted, how power
displays, and how the two search surfaces divide responsibility across the
app. Confirmed correct and locked in — don't regress any of this without an
explicit request to change it.

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

## Compare page: shared Morocco price range filter

`app/compare/page.tsx` has a min/max Morocco-price range filter (`?pmin=`/
`?pmax=` in the URL) that applies to **both** sides of the comparison at
once — one shared budget, not two independent per-side filters — narrowing
`priceConfirmedModels` down to `priceRangeModels` before it reaches either
`ManufacturerBrandModelPicker`. A model selected before the range narrowed
gets cleared automatically rather than left as a stale, invisible selection.
Same "state lives in the URL, so a filtered link is shareable" pattern as
every other Compare page control (`a`/`b`/`ta`/`tb`).

## Power always displays in hp, everywhere — never bare kW

Every place engine/motor power is shown to a user, it's in horsepower
(`lib/units.ts`'s `kwToHp()`), never a bare kW figure with no hp conversion:

- **Model detail page and Compare page's comparison table**: dual format,
  `"150 kW (201 hp)"` — there's room for both, so both are shown.
- **Compare page's trim picker and the technical search's result cards**
  (`lib/specGrouping.ts`'s `compactSpecLabel()`): hp-only, no kW — these
  labels are width-constrained (a narrow mobile `<select>`; see the
  truncation bug this already caused once), so only the unit a reader
  actually thinks in survives the space budget.
- **Technical search's engine/motor power filter inputs**
  (`app/search/specs/page.tsx`): the user types hp; `lib/units.ts`'s
  `hpToKw()` converts to kW client-side before it hits the API, since power
  is stored/queried in kW in the database — the API itself has no concept of
  hp. Battery capacity filters correctly stay in kWh (that's energy
  capacity, not power — unaffected by this rule).

If a new page or component ever displays or accepts engine/motor power,
reuse `kwToHp()`/`hpToKw()` from `lib/units.ts` rather than hand-rolling the
`* 1.34102` conversion factor again.

## Two search surfaces, deliberately different axes

- **`/search`** (`app/search/page.tsx`): model-level fields — brand, segment,
  production status, price. Filters `Model` documents.
- **`/search/specs`** (`app/search/specs/page.tsx`, nav label "Tech Search"):
  technical fields only — energy type, engine power/fuel/aspiration, motor
  power, battery capacity, transmission. Filters `Powertrain` documents
  (results are individual trims, so one model can appear more than once).
  Uses the exact same canonical fields `compactSpecLabel()` builds a trim
  label from, so a spec summary means the same thing on this page as it does
  on the Compare page's trim picker — never a third ad-hoc format.

Both pages show an explicit "active filters" summary rather than relying on
the reader to remember which fields they've set — an unset field is never
silently sent as a real filter value to the API (verified empirically, not
just by code reading, after a report that turned out to be a visibility gap
rather than an actual filtering bug).

`app/api/powertrains/route.ts`'s `GET` refuses an entirely unfiltered
request (`400`) — every real caller (the Compare page's per-model trim
fetch, this search) always has at least one criterion; an empty filter used
to mean "return every powertrain in the DB, double-populated" before this
was closed off, and that's the exact bug class that made the Compare page's
trim picker crash on a cold serverless instance earlier this session.

## Brand simplification: Dongfeng, GAC, Geely

Some manufacturer sub-brand splits that repeatedly caused duplicate-model
bugs have been simplified or reconciled — see `BRAND_TAXONOMY.md` for full
detail per brand. In short: "Dongfeng Aeolus" was merged entirely into
"Dongfeng" (one brand, no split); GAC Aion and Geely Galaxy remain separate,
real sub-brands (not merged — they're large, well-populated, genuinely
distinct), but their duplicate model pairs (`Aion Y`, `Galaxy E8`,
`Galaxy L7`) were reconciled the same careful way Dongfeng's were. Don't
recreate a "Dongfeng Aeolus" brand from a future research pass's own
sub-brand claim without re-confirming with the user first.
