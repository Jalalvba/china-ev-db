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

(Update 2026-09-13, later same session: Mage and Shine Max were fetched and
confirmed — 269,000 DH each, matching moteur.ma exactly. This follow-up is
resolved. Also fixed in the same pass: Seres 3/Seres E1 were found misfiled
under the DFSK brand instead of the correct, already-existing Seres brand —
moved. `K01` turned out to be two genuinely distinct market variants
(different moteur.ma listings, different prices) rather than one model —
split into `K01h` (109,000 DH) and `K01s` (104,000 DH), same pattern as the
Soueast S06 ICE/DM split.)

## Cross-brand duplicate model pairs found in a full-DB audit (2026-09-13)

Running the same cross-brand-duplicate-name matching logic used by
`preflightCheckCrossBrandDuplicates()` (import-time guard) as a read-only
report across every brand group in the live DB — not just Dongfeng — found
3 more genuine duplicate pairs, now resolved the same way as the Dongfeng
pairs (richer doc kept as canonical, powertrains re-pointed, non-conflicting
fields merged, duplicate deleted, then an audit query for the same
price-confirmed-flag bug Dongfeng's Shine merge hit — came back clean for all
3, no repeat of that bug):

| Model | Canonical doc kept (correct sub-brand) | Duplicate deleted (was under the generic parent brand) |
|---|---|---|
| Aion Y | GAC Aion brand — richer metadata (`name_cn`/`name_en`/real CNY price), but was actually filed under generic "GAC"; re-pointed to the correct "GAC Aion" sub-brand as part of the merge | Was under "GAC Aion" but was the thinner doc (derived-USD-only price, no name_cn/name_en, 1 powertrain moved off it) |
| Galaxy E8 | Geely Galaxy brand — already correctly filed there, richer (3 powertrains, real price) | Was under generic "Geely" (1 powertrain moved, thinner metadata) |
| Galaxy L7 | Geely Galaxy brand — already correctly filed there (2 powertrains) | Was under generic "Geely" (0 powertrains, conflicting but not overwritten price_range/generation — canonical's own values were kept per the same "only merge into `undefined` fields" rule) |

Unlike Dongfeng, **the brands themselves were not merged** — GAC Aion (3
models) and Geely Galaxy (16 models) are real, well-populated, distinct
sub-brands, not empty duplicate shells, so only the duplicate model-level
records were resolved; each canonical doc was re-pointed to its correct
specific sub-brand where it wasn't already there.

### Misfiled (not duplicated) models found, NOT acted on — needs an explicit decision

These models sit under a generic parent brand while a correct, already-
existing, populated specific sub-brand exists for them — the same shape as
the Seres 3/DFSK misfiling fixed above — but no duplicate counterpart exists
under the correct brand, so this is a lower-stakes "should probably move"
call rather than a "must resolve a collision" one. Left as-is pending an
explicit decision, per this session's established conservative-when-unsure
rule:

- `Deepal S7` — under "Changan", but the "Deepal" brand exists with 1 model
  (`L07`) already on file.
- `Avatr 12` — under "Changan", but the "Avatr" brand exists with 1 model
  (`07L`) already on file.
- `Aion V`, `Aion ES` (name_en "GAC Aion S"), `Aion UT`, `Aion RT` — all
  under generic "GAC", but "GAC Aion" (now holding Aion Y after the merge
  above) is the correct, populated sub-brand for these.
- `Hyptec HT`, `Hyptec GT` — under generic "GAC", but a "Hyptec" brand
  exists (currently 0 models) as the correct sub-brand.
- `Landian E5` — under "DFSK", name suggests it belongs under the "Landian"
  brand (currently 0 models, `parent_group: "Seres"`) — same shape as the
  already-fixed Seres 3 case, but not yet moved.

### Other findings from the same audit (no action needed)

- 108 of 148 Brand documents have zero models — overwhelmingly intentional
  per this repo's own established pattern (bare brand-ownership records
  added ahead of model research, e.g. commit "Add DFSK and Exeed as bare
  Brand documents (no models yet)") — not a bug list, not enumerated here.
- The GWM / Haval / ORA / WEY / TANK empty-shell pattern flagged earlier
  this session is confirmed **intentional, already documented** —
  `lib/moroccoBrandAlias.ts`'s own header comment explains these sub-brands
  deliberately live as a model-name prefix under the single GWM brand
  rather than as separate populated Brand docs. No action needed.
- Zero orphaned `Powertrain` documents (`model_id` pointing at a deleted
  Model) and zero `Model` documents with a dangling `brand_id` — checked
  after every merge in this session, including the 3 new ones above.

## Full-DB Morocco price sync run (2026-09-13)

Ran `pnpm sync-prices` with no brand filter across all 230 then-unconfirmed
models. Result: 0 new moteur.ma/wandaloo.com direct matches, 4
gemini-fallback disagreements (Han EV, Emkoo, S7, Jaecoo J7 — all
pre-existing, already known, intentionally left unconfirmed pending human
review), 11 non-exact-match candidates (mostly BYD Han/Seal/Sealion/Tang
trim-badge variants matching a sibling model via substring fallback, plus
GAC GS3 Emzoom and BAIC BJ30), 215 genuinely not-found. Spot-checked one
not-found result (BAIC BJ40) with a fresh isolated single-brand run to rule
out rate-limiting after ~460 HTTP calls in the full run — came back
not-found again, confirming this is real absence from both sites, not a
scraping artifact. Full result list: `raw-data/morocco-sync-2026-09-13T20-35-52-018Z.review.json`.
