# Retro write-up: the 56 already-kept known-issues items vs the new guards (2026-09-19)

**Working classification: 25 discard, 9 weak / keep-with-care, 22 keep** (was 24 / 10 / 22 before the Turkey verification below moved one item from weak to discard).

Mechanical = applied by the shipped guards (powertrain text check, dead-link removal, source verification). 'My read' = my judgement of items the guards cannot see; approximate and subjective — review before relying on it. 'Verified ICE' = checked against external sources, below. Nothing here was applied to the DB.

## Verification: is the Tiggo 8 Pro sold in Turkey ICE-only? (checked 2026-09-19)
**Yes — the 5 Tiggo 8 Pro *global* items are about the petrol car, not the PHEV this DB covers.**
- Turkish dealer price list for the Tiggo 8 Pro, price validity 08.09.2026–30.09.2026 (chery.yuzbasiogluoto.com.tr): engine 1,598 cc, 183 hp, no hybrid/PHEV variant listed. A second dealer page for the 2026 Tiggo 8 (cherygorkem.com) lists a single powertrain, "1.6 litre TGDI turbo benzinli", 145 HP, 7DCT. Turkish trims (Luxury / Excellent / Avantgarde, "1.6TGDI Benzin Otomatik") match the 'Avangard' in one complaint URL.
- Secondary sources (donanimhaber, teknoseyir, Wikipedia via search): the Tiggo 8 Pro e+ PHEV was *not available in Turkey*.
- sikayetvar.com (Şikayetvar) is Turkey's largest consumer-complaint platform; its `/en/chery-us` listing is titled "Chery Pro 8 Şikayetleri" and the complaints it indexes name the 'Tiggo 8 Pro Max 1.6 TGDI', a timing-chain failure ('zincir arızası') and Chery Türkiye.
- Limit of this check: the sikayetvar pages themselves return HTTP 403 to automated fetches (the same wall the verifier hits), so the verdict rests on the market evidence + the search-indexed titles/snippets, not on reading each complaint. The 7-speed-DCT item (yearstoavoid.co) is separate evidence: the DCT is the petrol gearbox.
- Caveat that generalises: the *Chinese-market* Tiggo 8 Pro is also mostly petrol (1.6/2.0 TGDI) with the PHEV a minority variant — the same trap applies to other nameplates that are mostly ICE worldwide (Coolray, GS4, T2).

| model / pass | verdict | why | confidence (old -> new) | item |
|---|---|---|---|---|
| Starship 7 EM-i / china_issues | WEAK (keep only with care) | a subjective test-drive opinion, not a failure pattern | unconfirmed | Test-drive critique that the second row feels unsafe and the rear body |
| Starship 7 EM-i / china_issues | WEAK (keep only with care) | vague forum reply | unconfirmed | Forum reply discussing possible surface rust on iron parts. |
| Starship 7 EM-i / global_issues | WEAK (keep only with care) | a customization annoyance, not a defect | unconfirmed | Head-up display (HUD) language is set to Chinese; dealer says changing |
| Haval Raptor / global_issues | keep | verified | unconfirmed | Water accumulation beneath the trunk floor in specific units of the Ha |
| WEY Lanshan / china_issues | keep | verified | unconfirmed | Vehicle suddenly displayed multiple fault codes; after dealer inspecti |
| WEY Lanshan / china_issues | keep | verified | unconfirmed | Instrument panel / dashboard cracking, described as an instrument pane |
| WEY Lanshan / china_issues | WEAK (keep only with care) | a warranty/free-replacement statement about the same dashboard episode as the other item (duplicate) | unconfirmed | Instrument panel cracking controversy; the manufacturer reportedly pro |
| WEY Lanshan / china_issues | keep | page couldn't be verified | unconfirmed | Chassis damper noise over cement roads: owner reports the suspension m |
| WEY Lanshan / china_issues | keep | verified | unconfirmed | Under adaptive cruise control mode, the vehicle cannot perform kinetic |
| 08 EM-P / china_issues | DISCARD (mechanical) | DEAD LINK (discard) | unconfirmed | Pirelli tire cracking: owner reports sidewall cracks on the left front |
| 08 EM-P / china_issues | keep | verified | unconfirmed | Auxiliary battery not secured, causing whole-vehicle power loss; the s |
| 08 EM-P / china_issues | DISCARD (mechanical) | DEAD LINK (discard) | unconfirmed | Sudden loss of power and steering control while driving normally in th |
| 08 EM-P / china_issues | keep | verified | unconfirmed | Ambient light LED beads turning white; the owner had the ambient light |
| 08 EM-P / china_issues | keep | verified | unconfirmed | Engine malfunction light illuminated, but the component replaced was t |
| Landian E5 / china_issues | keep | verified | unconfirmed | Brake master cylinder failure (刹车总泵故障) discussed for the 蓝电E5. |
| Landian E5 / china_issues | keep | verified | unconfirmed | After about one year of ownership, battery fault with battery warning |
| Landian E5 / china_issues | DISCARD (my read) | generic troubleshooting explainer (a fault-code glossary), not a report about this model | unconfirmed | Motor controller fault (电机控制器故障), with software fault listed as a comm |
| Landian E5 / china_issues | DISCARD (my read) | one-word tag split out of a single Yiche article — no specifics | unconfirmed | Tire uneven wear (轮胎偏磨). |
| Landian E5 / china_issues | DISCARD (my read) | one-word tag from the same article | unconfirmed | Abnormal noise (异响). |
| Landian E5 / china_issues | DISCARD (my read) | one-word tag from the same article | unconfirmed | Seatbelt failure (安全带故障). |
| Landian E5 / china_issues | DISCARD (my read) | one-word tag from the same article | unconfirmed | Infotainment system lag (车机系统卡顿). |
| Landian E5 / china_issues | DISCARD (my read) | one-word tag from the same article | unconfirmed | Poor sound insulation (隔音效果). |
| T2 / china_issues | DISCARD (mechanical) | POWERTRAIN-MISMATCH (discard) | unconfirmed | Engine oil leak reported on 2.0T four-wheel-drive 捷途旅行者 vehicles, incl |
| T2 / china_issues | DISCARD (my read) | about the 2.0T 4WD ICE Traveller, not the 1.5T PHEV (no engine size stated, so the text check missed it) | unconfirmed | Engine oil leak found at first maintenance on a four-wheel-drive 捷途旅行者 |
| T2 / china_issues | keep | verified | unconfirmed | New car transmission fault: the instrument cluster lit a transmission |
| T2 / china_issues | DISCARD (my read) | early-production ICE high-pressure oil pipe / sound-insulation change (ICE-era) | unconfirmed | Clear electrical/current noise when starting and applying throttle, re |
| T2 / china_issues | keep | page couldn't be verified | unconfirmed | Paint peeling/paint quality problems and differential-lock mode assemb |
| T2 / china_issues | WEAK (keep only with care) | 'common fault areas on USED cars' explainer, not a complaint pattern | unconfirmed | Window lift system failure and warning lights are listed as common fau |
| T2 / china_issues | keep | verified | unconfirmed | Owner reported vehicle noise, paint peeling, and fault codes over seve |
| T2 / china_issues | WEAK (keep only with care) | headline only; the snippet gives no cause, count or system | unconfirmed | Headline reports successive rollover accidents involving 捷途旅行者; the sn |
| T2 / global_issues | keep | page couldn't be verified | confirmed -> unconfirmed | Vehicle pulls/steers to the left on its own; alignment issues remain a |
| T2 / global_issues | WEAK (keep only with care) | TikTok discover hub page, one off-road anecdote | unconfirmed | 4x4 system did not engage; only the front tires were rotating during a |
| T2 / global_issues | DISCARD (my read) | alibaba.com buying-guide SEO page, generic | unconfirmed | Owner-reported infotainment lag, electrical faults, and transmission b |
| Tiggo 8 Pro / global_issues | DISCARD (verified ICE) | VERIFIED ICE: sikayetvar.com is Turkey's complaints platform; Turkey sells ONLY the 1.6 TGDI petrol Tiggo 8 Pro (dealer price list valid 8-30 Sep 2026: 1,598 cc / 183 hp, no hybrid) — see 'Verification' below | unconfirmed | Start-stop system is not functioning; owner describes this as the most |
| Tiggo 8 Pro / global_issues | DISCARD (verified ICE) | VERIFIED ICE: the 7-speed DCT is the petrol Tiggo 8 Pro's gearbox (the PHEV has a multi-speed hybrid transmission); page is an SEO 'years to avoid' listicle, and was marked CONFIRMED | confirmed | Seven-speed dual-clutch automatic transmission is not smooth in lower |
| Tiggo 8 Pro / global_issues | DISCARD (verified ICE) | VERIFIED ICE: sikayetvar.com is Turkey's complaints platform; Turkey sells ONLY the 1.6 TGDI petrol Tiggo 8 Pro (dealer price list valid 8-30 Sep 2026: 1,598 cc / 183 hp, no hybrid) — see 'Verification' below | confirmed -> unconfirmed | Owner of a 2023 Chery Tiggo 8 Pro with 60,500 km reports a serious iss |
| Tiggo 8 Pro / global_issues | DISCARD (verified ICE) | VERIFIED ICE: sikayetvar.com is Turkey's complaints platform; Turkey sells ONLY the 1.6 TGDI petrol Tiggo 8 Pro (dealer price list valid 8-30 Sep 2026: 1,598 cc / 183 hp, no hybrid) — see 'Verification' below | unconfirmed | Engine failure reported, with warranty denied due to service misguidan |
| Tiggo 8 Pro / global_issues | DISCARD (verified ICE) | VERIFIED ICE: sikayetvar.com is Turkey's complaints platform; Turkey sells ONLY the 1.6 TGDI petrol Tiggo 8 Pro (dealer price list valid 8-30 Sep 2026: 1,598 cc / 183 hp, no hybrid) — see 'Verification' below | unconfirmed | Dashboard, radio, and screen malfunctions: radio does not work, screen |
| 06 EM-P / china_issues | keep | verified | unconfirmed | Dealer allegedly delivered a defective vehicle without proper PDI insp |
| 06 EM-P / china_issues | keep | page couldn't be verified | unconfirmed | Owner reported that after about ten days of ownership, the vehicle sho |
| 06 EM-P / china_issues | keep | page couldn't be verified | unconfirmed | Owner asked about a 06 hybrid where the brake pedal felt hard and was |
| 06 EM-P / global_issues | keep | page couldn't be verified | unconfirmed | Native Bluetooth connectivity problem reported with many Samsung Galax |
| Geely Coolray / Binyue / china_issues | WEAK (keep only with care) | one-line tag from a complaint LISTING page; ICE-era | unconfirmed | Exhaust pipe abnormal noise. |
| Geely Coolray / Binyue / china_issues | DISCARD (my read) | timing chain + fuel consumption = the ICE 1.4T/1.5T Coolray, not the PHEV | unconfirmed | Abnormal noise under 20,000 km and timing chain problems; high fuel co |
| Geely Coolray / Binyue / china_issues | DISCARD (mechanical) | POWERTRAIN-MISMATCH (discard) | unconfirmed | Severe transmission jerk/shudder, body abnormal noise, very poor sound |
| Geely Coolray / Binyue / china_issues | WEAK (keep only with care) | 'not a high failure rate' — a reassurance, not an issue | unconfirmed | Minor faults such as window air leak, central control screen lag, and |
| Geely Coolray / Binyue / china_issues | DISCARD (mechanical) | DEAD LINK (discard) | unconfirmed | Window air leak due to loose rubber seals; central control screen free |
| Geely Coolray / Binyue / china_issues | DISCARD (my read) | a 2019 Zhihu article — an older ICE-era Coolray | unconfirmed | Customers report strong steering wheel shake during hard braking; serv |
| Geely Coolray / Binyue / china_issues | DISCARD (my read) | generic 'possible causes of an engine light' explainer | unconfirmed | Engine malfunction indicator light commonly seen; possible causes incl |
| Geely Coolray / Binyue / china_issues | DISCARD (my read) | generic 'why a car won't start' explainer | unconfirmed | No-start common causes: low/damaged battery, ignition system fault (sp |
| Geely Coolray / Binyue / global_issues | DISCARD (my read) | avtomir.site SEO page about the ICE DCT (68% figure unsourced); PHEV uses a different transmission | unconfirmed | The wet dual-clutch transmission is the most criticised weak point of |
| Haval Raptor / china_issues | keep | page doesn't name the model (downgrade) | confirmed -> unconfirmed | Infotainment/HiCar abnormal noise; owner requests repair. |
| Haval Raptor / china_issues | keep | verified | unconfirmed | Complaint data for the model concentrated on engine/electric motor ins |
| Haval Raptor / china_issues | keep | page couldn't be verified | unconfirmed | Owner reported that after a repair, while driving normally, the half-s |
| Haval Raptor / china_issues | keep | verified | unconfirmed | Owner reports seat ventilation only works on the cushion and not the b |
| Haval Raptor / china_issues | DISCARD (my read) | bk.taobao.com encyclopedia SEO page, 'some owners' with no source | unconfirmed | According to some owner feedback, reported issues include unstable bat |
