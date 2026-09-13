# Known Issues

## Duplicate model documents: bare "Dongfeng" vs "Dongfeng Aeolus" (2026-09-13) — RESOLVED

All eight pairs are now resolved. The underlying two-brand split itself was also
eliminated: the user decided to stop maintaining "Dongfeng Aeolus" as a separate
brand entirely (it kept causing this exact class of bug faster than upstream
fixes could keep up) — see `BRAND_TAXONOMY.md`'s Dongfeng Aeolus entry for the
full reasoning. Every model formerly under "Dongfeng Aeolus" now lives under the
single `Dongfeng` brand; the "Dongfeng Aeolus" Brand document no longer exists.

**Root cause** (fixed going forward): `resolveBrandName()` in
`lib/deepseekNormalize.ts` resolves a brand purely from the current import
entry's own `brand`/`brand_en` fields, with no cross-check against sibling
brands. `KNOWN_BRANDS["东风"]` maps generically to bare `"Dongfeng"`, and some
import batches tagged Aeolus-badged models with that generic Chinese string
instead of the sub-brand-specific one — so those models landed under the wrong
brand instead of matching the existing "Dongfeng Aeolus" sibling. This was
still recurring as of that same session (`Dongfeng Aeolus L7` was added under
bare "Dongfeng" on 2026-09-13 at 14:51:54, alongside an identically-named model
already correctly filed under "Dongfeng Aeolus" from the day before).

**Preflight fix applied** (2026-09-13, commit after `ca573a9`):
`scripts/import-deepseek.ts` now runs `preflightCheckCrossBrandDuplicates()`
after connecting to Mongo and before any writes — it aborts the whole import if
a model resolves to a brand whose sibling (same `parent_group`) already has a
model with a matching name (checked both ways, `name`/`name_en`,
prefix-stripped). This guard is now largely moot for Dongfeng specifically
(there's only one Dongfeng brand to resolve to), but stays in place as a
general safety net for any other manufacturer with a similar sub-brand split
(e.g. a future GAC/GAC Aion-style pairing).

### All eight pairs, resolved

For each pair: the doc with richer `name_cn`/`name_en`/`generation`/
`notable_facts` was kept as canonical; `Powertrain` docs were re-pointed from
the duplicate's `model_id` to the canonical one; any Morocco-price/
`morocco_to_china_price_ratio` fields present on the duplicate but missing on
the canonical were merged in; the duplicate was then deleted. Both docs were
re-pointed to (or already on) the single surviving `Dongfeng` brand.

| Model | Canonical doc kept | Duplicate deleted | Notes |
|---|---|---|---|
| Huge | `6aa58f6c459a4cbe4a9c65d4` | `6aa58edb459a4cbe4a9c65c8` | Reconciled first (see git history for full detail: 11 powertrains, notable_facts, real moteur.ma source/url merged in) |
| Shine | `6aa58f6c459a4cbe4a9c65d1` | `6aa58edb459a4cbe4a9c65c4` | Morocco price (179,000 DH) merged in; `morocco_price_confirmed` had to be fixed separately afterward (see below) |
| Shine GS | `6aa58f6c459a4cbe4a9c65d3` | `6aa58edb459a4cbe4a9c65c6` | No fields to merge |
| Shine Max | `6aa58f6c459a4cbe4a9c65d2` | `6aa58edb459a4cbe4a9c65c5` | Price-ratio field only; still has no Morocco price on file at all — needs a fresh fetch |
| Mage | `6aa58f6c459a4cbe4a9c65d5` | `6aa58edb459a4cbe4a9c65c7` | Price-ratio field only; still has no Morocco price on file at all — needs a fresh fetch |
| E70 | `6aa58f6c459a4cbe4a9c65d8` | `6aa58edb459a4cbe4a9c65cf` | No fields to merge |
| AX7 | `6aa58f6c459a4cbe4a9c65da` | `6aa58edb459a4cbe4a9c65c9` | No fields to merge |
| Aeolus L7 | `6aa58f6c459a4cbe4a9c65d6` | `6aa6aa7aa93026dd42b5cb2b` | No fields to merge |

**Bug caught during this merge**: the merge script only copied a field from the
duplicate onto the canonical doc when the canonical's own value was `undefined`
— but `morocco_price_confirmed` on the Shine canonical doc was explicitly
`false` (not `undefined`), so the price merged in but the confirmed flag
didn't, leaving a priced-but-unconfirmed record. Caught by an audit query
(`morocco_price_dh` set but `morocco_price_confirmed` not `true`) right after
the merge and fixed directly; the other 6 pairs were checked the same way and
came back clean.

Not duplicated (genuinely distinct models, now all just under one `Dongfeng`
brand): AX4, Aeolus L8, S30, SKY EV01 (formerly Aeolus-only), and 007, 008, Box
(eπ box), Rich 6, Rich 7, SX6, Z9, Forthing T5 EVO, Vigo (formerly
bare-Dongfeng-only — different Dongfeng-group sub-brands: eπ, Forthing, Joyear,
Ruiqi, none of them Aeolus).

### Follow-up still open

Mage and Shine Max both currently have **no Morocco price on file at all** —
confirmed missing from the live moteur.ma listing check on 2026-09-13 (moteur.ma
shows Mage at 269,000 DH and Shine Max at 269,000 DH, neither yet in our DB).
Needs a price fetch/confirm pass, same as any other unpriced model.
