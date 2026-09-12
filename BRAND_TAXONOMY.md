# Brand Taxonomy — Frozen Reference

This document records the correct, current brand data model and grouping rules for the
`Brand` collection, following the 2026-09-12 ownership/parent-group correction pass
(consolidating three independent audits: DeepSeek x2, Kimi). Read this before touching
Brand grouping, ownership, or tech-partner logic — in code (`models/Brand.ts`,
`lib/brandGrouping.ts`, `lib/brandResearch.ts`) or in a future data-correction pass.

## 1. Field definitions

- **`parent_group`** — the REAL controlling corporate parent, and *only* that. Never a
  distributor, never a free-text description, never a tech partner. A brand has exactly
  one `parent_group` (a string matching another brand's `name`, so the display layer can
  chain it — see §2), or `null`/unset if the brand is genuinely independent. Never write
  a compound string like `"Chery / JLR"` or `"Geely Holding Group / Mercedes-Benz Group"`
  as a single field — see `relationship_type`/`stake_percentage` below for how to capture
  that nuance instead.

- **`tech_partner`** — ONLY for a genuine, individually-sourced technology partnership
  (e.g. Huawei). Must NEVER be inherited or assumed from a sibling brand or from the
  parent company — every brand's `tech_partner` must be verified on its own, not copied
  down a cluster. Currently-correct set (verified 2026-09-12):
  - `AITO`, `Luxeed`, `Stelato`, `Maestro`, `Shangjie` = `"Huawei"` (the 5 genuine HIMA members)
  - `Yijing`, `Qijing` = `"Huawei"` (real Qiankun-tier partnership, but explicitly NOT HIMA —
    must carry a distinguishing `status_note`, see §3)
  - All other brands = unset, unless individually re-verified with a source.

- **`status` / `status_note`** — lifecycle state (`active`/`discontinued`/`bankrupt`/`merged`)
  and free-text nuance. This is where facts like "Stellantis holds ~20% of Leapmotor" or
  "some models use Huawei ADS/HarmonyOS components, but this is not a brand-level
  partnership" belong. Never smuggle this kind of nuance into `parent_group` or
  `tech_partner` as a compound string.

- **`data_quality_flag`** — `"unverified_existence"` marks a brand whose real-world
  existence or details could not be confirmed by research. Display these distinctly in
  any UI; never silently delete them, and never treat them as equivalent-confidence to a
  verified brand.

- **`relationship_type`** + **`stake_percentage`** — use these (enum: `equity_subsidiary`,
  `jv_brand`, `technology_partner`, `minority_controlling`, `contract_manufactured`,
  `independent`, plus a 0–100 stake) to capture ownership nuance, instead of cramming two
  entities into a single `parent_group` string.

## 2. Grouping rules (homepage / brand-list UI)

- Group by `parent_group` ONLY (see `lib/brandGrouping.ts` — it walks the `parent_group`
  chain by matching against other brands' `name` field). Never group by `tech_partner`.
  Never create a grouping bucket for a technology alliance — **HIMA is not a brand and
  must never exist as a `Brand` document.** (It was deleted from the collection in the
  2026-09-12 pass; if it reappears, delete it again and re-verify how it got re-added.)
- A `parent_group` with only 1 sub-brand still gets its own named group. Never merge
  small groups into a generic "Independent" catch-all just because the count is low.
- Three explicit, separately-labeled sections exist beyond manufacturer clusters — never
  conflate them into one bucket:
  - **(a) "Independent — no corporate parent"** — genuine standalone companies/startups
    (Li Auto, XPeng, Leapmotor, JMC, New Gonow, Polestones, Chuneng Auto, CYAUTO, Guojin,
    LINGBOX, Wanxiang, and legacy/defunct standalones).
  - **(b) "Joint-venture brands (dual/foreign parent)"** — brands with two real parents,
    which is why they don't fit a single manufacturer cluster but are NOT independent:
    `smart`, `Jetta`, `Everus`, `Lingxi`, `Venucia`, `Freelander`.
  - **(c) "Unverified — needs research"** — every brand with
    `data_quality_flag: "unverified_existence"`.

## 3. Known-correct reference data (snapshot as of 2026-09-12)

Use this as the baseline for any future re-research pass. A new claim that contradicts
something below must be treated as a claim to verify, not applied blindly (see §4).

- **The 5 genuine HIMA members and their manufacturers**: AITO (Seres), Luxeed (Chery),
  Stelato (BAIC), Maestro (JAC), Shangjie (SAIC). Luxeed's `founded_year` is 2023
  (launched November 2023 with the S7), not 2024.
- **Yijing (Dongfeng) / Qijing (GAC)** = real Huawei technology partnership, explicitly
  **NOT** HIMA — both carry a status_note distinguishing them from the HIMA-tier brands.
- **Geely has NO Renault ownership relationship.** Only the HORSE Powertrain JV (50/50
  as of 2024, later Renault 45%/Geely 45%/Aramco 10%) plus minority equity stakes in
  Renault Korea (34%) and Renault do Brasil (26.4%, Nov 2025) — informational only,
  recorded in `status_note`, never in `parent_group` or `tech_partner`. No Geely-badged
  vehicle is Renault-powered.
- **Soueast, Exeed → `parent_group: "Chery"`**; **Hongqi → `parent_group: "FAW"`**.
  Canonicalization gotcha: the grouping walk matches on the *exact, full* parent string
  against another brand's `name` — e.g. match `"GWM (Great Wall Motor)"`, not just
  `"GWM"`. A false "GWM/Haval/Wey/Ora/Tank missing" alarm happened during this exact
  cleanup from querying the short form instead of the real stored string.
- **AIVA → `parent_group: "Chongqing Saidou Technology"`** (not `"Seres"` — Seres, CATL,
  and Chongqing state capital are investors/shareholders, not the controlling parent).
- **Jinguo → `parent_group: "Juneyao Group"`** (not `"Jinguo Auto"`, which is not a real
  corporate entity; Juneyao Group is also known for Juneyao Airlines).
- **Cowin → `parent_group: "Yibin State Capital"`**, 80.67% controlling stake, with Chery
  holding an 18% minority stake (Cowin was wholly Chery-owned prior to the 2017
  restructuring).
- **JMC → `parent_group: "JMCG"`**, with Ford Motor Company holding ~32% of listed
  Jiangling Motors Corp. Ltd, alongside JMC Group (JMCG) as the domestic holding company.
- **`JAC`** (renamed from the duplicate-looking `"JAC Group"`) is the one real JAC parent
  record — `Refine`, `SOL`, `Yiwei`, `Maestro` all point to it. There is no separate
  standalone `"JAC"` vs `"JAC Group"` split; don't recreate that duplication.
- **`ROX`** was a duplicate of `Polestones` (parent: Shanghai Luoke Intelligent
  Technology) and was deleted — don't re-add it as a second GWM-adjacent brand.
- **Dongfeng Aeolus** is a wholly-owned mainstream Dongfeng brand with no PSA/Stellantis
  `tech_partner` — that relationship belongs to the separate Dongfeng-PSA JV (Shenlong
  Automobile), not Aeolus.
- **Leapmotor** stays independent (no controlling parent) but carries a status_note:
  Stellantis holds ~20% since 2023, with Leapmotor International as the JV handling
  global expansion outside China.

## 4. Process rule for future corrections

Any future brand/ownership correction claim — from DeepSeek, Gemini, Kimi, or any other
source — must be treated as **a claim to verify against this document**, not applied
blindly. If a new claim contradicts something recorded here as already-verified, **flag
the conflict explicitly** (to the user, in a report, or as a `status_note` caveat) rather
than silently overwriting a previously-confirmed fact. Update this document itself in the
same change whenever a genuinely new, verified correction supersedes something written
here.
