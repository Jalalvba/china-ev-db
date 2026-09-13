# Known Issues

## Duplicate model documents: bare "Dongfeng" vs "Dongfeng Aeolus" (2026-09-13)

Eight models existed as two separate DB documents each — one correctly filed
under the **"Dongfeng Aeolus"** brand, one stray duplicate filed under the
parent **"Dongfeng"** brand. One pair (Huge) has been reconciled; the other
seven are not — needs a per-pair diff (spec data may differ between the two
docs, so this isn't a safe blind delete/merge).

**Root cause** (fixed going forward, see below): `resolveBrandName()` in
`lib/deepseekNormalize.ts` resolves a brand purely from the current import
entry's own `brand`/`brand_en` fields, with no cross-check against sibling
brands. `KNOWN_BRANDS["东风"]` maps generically to bare `"Dongfeng"`, and some
import batches tagged Aeolus-badged models with that generic Chinese string
instead of the sub-brand-specific one — so those models landed under the wrong
brand instead of matching the existing "Dongfeng Aeolus" sibling. This was
still recurring as of tonight's own session (`Dongfeng Aeolus L7` was added
under bare "Dongfeng" on 2026-09-13 at 14:51:54, alongside an identically-named
model already correctly filed under "Dongfeng Aeolus" from the day before).

**Fix applied** (2026-09-13, commit after `ca573a9`): `scripts/import-deepseek.ts`
now runs `preflightCheckCrossBrandDuplicates()` after connecting to Mongo and
before any writes — it aborts the whole import if a model resolves to a brand
whose sibling (same `parent_group`) already has a model with a matching name
(checked both ways, `name`/`name_en`, prefix-stripped). Also added
`"东风风神": { name: "Dongfeng Aeolus", parent_group: "Dongfeng Motor Corporation" }`
to `KNOWN_BRANDS` so correctly-tagged source data resolves right without
depending on `explicitEnglish` being supplied every time. This stops new
duplicates; it does not retroactively fix the seven pairs below.

### Resolved

- **Dongfeng Huge**: reconciled 2026-09-13. Canonical doc `6aa58f6c459a4cbe4a9c65d4`
  ("Dongfeng Huge" / "Dongfeng Aeolus") kept its own `name_cn`/`name_en`/
  `generation` (more complete than the duplicate's generic "Huge"/"1st
  Generation"). Merged in from the duplicate: all 11 `Powertrain` docs
  (re-pointed `model_id`), `notable_facts`, `morocco_to_china_price_ratio`,
  and a real scraped `morocco_price_source`/`morocco_price_url`
  (moteur.ma) replacing the earlier `manual-verified` placeholder that had
  no URL. Duplicate doc `6aa58edb459a4cbe4a9c65c8` (bare "Dongfeng" brand)
  deleted after the merge — had no other references (checked
  `moroccolistings` and all other collections).

### The remaining seven duplicate pairs

| Aeolus model (correct brand, keep) | Duplicate under bare "Dongfeng" (needs diff before any merge) |
|---|---|
| Dongfeng Shine (`6aa58f6c459a4cbe4a9c65d1`) | Shine (`6aa58edb459a4cbe4a9c65c4`) |
| Dongfeng Shine GS (`6aa58f6c459a4cbe4a9c65d3`) | Shine GS (`6aa58edb459a4cbe4a9c65c6`) |
| Dongfeng Shine Max (`6aa58f6c459a4cbe4a9c65d2`) | Shine Max (`6aa58edb459a4cbe4a9c65c5`) |
| Dongfeng Mage (`6aa58f6c459a4cbe4a9c65d5`) | Mage (`6aa58edb459a4cbe4a9c65c7`) |
| Dongfeng E70 (`6aa58f6c459a4cbe4a9c65d8`) | E70 (`6aa58edb459a4cbe4a9c65cf`) |
| Dongfeng AX7 (`6aa58f6c459a4cbe4a9c65da`) | AX7 (`6aa58edb459a4cbe4a9c65c9`) |
| Dongfeng Aeolus L7 (`6aa58f6c459a4cbe4a9c65d6`) | Dongfeng Aeolus L7 (`6aa6aa7aa93026dd42b5cb2b` — created 2026-09-13, identical name, wrong brand) |

Not duplicated (genuinely brand-specific, leave as-is):
- Aeolus-only: Dongfeng AX4 (`6aa58f6c459a4cbe4a9c65db`), Dongfeng Aeolus L8 (`6aa58f6c459a4cbe4a9c65d7`), Dongfeng S30 (`6aa58f6c459a4cbe4a9c65dc`), Dongfeng SKY EV01 (`6aa58f6c459a4cbe4a9c65d9`)
- Bare-"Dongfeng"-only (different sub-brands: eπ, Forthing, Joyear, Ruiqi —
  not Aeolus): 007 (`6aa58edb459a4cbe4a9c65ca`), 008 (`6aa58edb459a4cbe4a9c65cb`), Box (`6aa47dd5ee15cebb2bbd5bc5`),
  Rich 6 (`6aa58edb459a4cbe4a9c65cc`), Rich 7 (`6aa58edb459a4cbe4a9c65cd`), SX6 (`6aa58edb459a4cbe4a9c65d0`),
  Z9 (`6aa58edb459a4cbe4a9c65ce`), Dongfeng Forthing T5 EVO (`6aa6aa7aa93026dd42b5cb2c`), Dongfeng Vigo (`6aa6aa7aa93026dd42b5cb2a`)

### Next steps (future session)

1. For each pair, diff all fields (spec data, powertrains, Morocco pricing,
   `unverified`/`confidence` flags) — the two docs may not be identical, so
   this needs a human decision per field, not a blind overwrite.
2. Decide which doc is canonical (default assumption: the "Dongfeng Aeolus"
   one, per `BRAND_TAXONOMY.md`) and merge/delete the other, including any
   `Powertrain` documents pointing at the deleted `model_id`.
3. Re-run `preflightCheckCrossBrandDuplicates` logic (or a one-off script
   using the same matching) across *all* brand groups, not just Dongfeng, to
   check for other sibling-brand duplicates that predate tonight's fix.
