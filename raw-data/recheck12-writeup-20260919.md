# Write-up: the 39 items kept by the ALL-GUARDS-LIVE re-run (recheck12, 2026-09-19)

Same 12 models as batches 1–2, re-run fresh with all four guards live (scope guard, exact-model filter, powertrain guard, URL verification). **My read: 16 discard, 10 weak, 13 keep** (of 39). This is the residual contamination that gets through the guards — judgement, to be reviewed by the user; nothing was applied.

## Compared with the original 56 (old guards)
| | discard | weak | keep |
|---|---|---|---|
| original 56 (mostly pre-guard; 25 / 9 / 22 after Turkey verification) | 25 (45%) | 9 | 22 |
| re-run, 39 kept (all guards live) | 16 (41%) | 10 | 13 |

**The guards did NOT materially lower the contamination rate of what gets through** (≈45% before → ≈41% after, by my read). They removed different things than the residue: they drop dead links, explicit-engine-size mismatches and identity mismatches; what remains is:
- **6 tag-split / generic-explainer items** (Landian E5): no guard checks that an item is a real, specific report — the parked 'genericness' filter (#4).
- **9 ICE-variant / other-market items with no stated engine size** (T2 ×1, Tiggo 8 Pro ×2, Coolray ×6): the powertrain attestation lets `not_stated` through (it only downgrades confidence), and nameplates that are mostly petrol worldwide (Tiggo 8 Pro, Coolray) leak petrol-car complaints.
- **3 dead links** that verification called 'unverifiable' during the run but are real 404s on re-check → **verification results vary run to run; a final re-verify must run immediately before anything is applied.**
- Only **13 of 39** (33%) are clean keeps.

| # | model / pass | verdict | why | item | url |
|---|---|---|---|---|---|
| 1 | Haval Raptor / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | During normal driving, the half-shaft detached and the rear motor was damaged. The vehicle was left  | https://hao.yiche.com/wenzhang/89130899/ |
| 2 | Haval Raptor / global | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Water ingress ('aquatic mode') reported on the Haval Raptor PHEV; Haval/GWM offered a free fix and s | https://carnewschina.com/2025/10/15/haval-raptor-phev-adds-unexpected-aquatic-mo |
| 3 | WEY Lanshan / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Instrument panel/dashboard decorative panel cracking ('crackgate'; instrument panel cracks). | https://chejiahao.m.autohome.com.cn/info/24550830 |
| 4 | WEY Lanshan / china | WEAK | same dashboard-crack episode as #3 (warranty/free-replacement angle) — duplicate | Instrument panel/dashboard cracking controversy; manufacturer reportedly offered free replacement un | https://www.news18a.com/news/storys_214265.html |
| 5 | WEY Lanshan / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Chassis/CDC suspension makes loud rumbling/clunking noises on cement roads. | https://www.dongchedi.com/community/6206/quality |
| 6 | WEY Lanshan / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Lidar failure causing multiple fault codes and loss of safety-driving functions; replacement part un | https://www.12365auto.com/zlts/20250715/1461521.shtml |
| 7 | WEY Lanshan / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Adaptive cruise control mode cannot perform energy recuperation. | https://club.m.autohome.com.cn/bbs/thread/74da69d504c70f47/105565041-1.html |
| 8 | 08 EM-P / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Auxiliary battery not secured, causing full vehicle power loss; the same complaint also reports a dr | https://m.12365auto.com/zlts/20250715/1461213.shtml |
| 9 | 08 EM-P / china | WEAK | engine light but the replaced part was an A/C condenser — odd, from a series listing page | Engine malfunction light was on, but the replaced part was an air-conditioning condenser. | https://m.12365auto.com/series/z3690_3_1.shtml |
| 10 | 08 EM-P / china | WEAK | minor cosmetic (ambient-light LEDs) | Ambient light LED beads turning white; the ambient light panel was replaced at a 4S service center. | https://club.m.autohome.com.cn/bbs/thread/32ec6477964e6a2f/111662920-1.html |
| 11 | Landian E5 / china | WEAK | a Q&A asking whether a brake master cylinder failure is a quality problem — not a report | Brake master cylinder failure reported; a 车质网 expert Q&A asks whether it is a quality problem. | https://www.12365auto.com/zjdy/20250104/198859.shtml |
| 12 | Landian E5 / china | DISCARD | one-word tag from a single Yiche article — no specifics | Tire uneven wear reported as an issue from user complaints/feedback. | https://hao.yiche.com/wenzhang/99197562 |
| 13 | Landian E5 / china | DISCARD | one-word tag, same article | Abnormal noise reported as an issue from user complaints/feedback. | https://hao.yiche.com/wenzhang/99197562 |
| 14 | Landian E5 / china | DISCARD | one-word tag, same article | Seatbelt failure reported as an issue from user complaints/feedback. | https://hao.yiche.com/wenzhang/99197562 |
| 15 | Landian E5 / china | DISCARD | one-word tag, same article | Infotainment system lag reported as an issue from user complaints/feedback. | https://hao.yiche.com/wenzhang/99197562 |
| 16 | Landian E5 / china | DISCARD | one-word tag, same article | Sound insulation issue reported as an issue from user complaints/feedback. | https://hao.yiche.com/wenzhang/99197562 |
| 17 | Landian E5 / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | After one year of ownership, battery fault with battery warning, engine red light, 'red turtle' powe | https://club.autohome.com.cn/bbs/thread/ab436d291cad0af1/112240696-1.html |
| 18 | Landian E5 / china | DISCARD | generic fault-code explainer (qcds.com), not about this model | Motor controller failure; source discusses causes and lists software fault as 30% of cases. | https://q.qcds.com/content-detail/my0B9 |
| 19 | T2 / china | WEAK | 'common faults on USED vehicles' explainer, split into two items | Window lift system failure reported as a common fault on used 捷途旅行者 vehicles. | https://www.autohome.com.cn/ask/21577642.html |
| 20 | T2 / china | WEAK | same used-vehicle explainer | Illumination of warning lights reported as a common fault on used 捷途旅行者 vehicles. | https://www.autohome.com.cn/ask/22607197.html |
| 21 | T2 / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Owner reported quality problems including vehicle abnormal noises, paint peeling, and fault codes. | https://tousu.sina.com.cn/complaint/view/17378601004?sld=4cb40cc11afcf48b8fd71d7 |
| 22 | T2 / china | DISCARD | early-production ICE high-pressure oil pipe / sound-insulation change — ICE-era T2 | Noticeable electric current noise when accelerating from a standstill, widespread on the first batch | https://news.qq.com/rain/a/20240607A09PD100 |
| 23 | T2 / china | WEAK | transmission light on delivery — the variant (petrol vs PHEV) isn't stated | New vehicle had transmission fault light on and unable to accelerate on the day of delivery. | https://m.12365auto.com/zlts/20250728/1469472.shtml |
| 24 | T2 / global | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Alignment issue causing the vehicle to steer to the left on its own; repeated attempts to fix it wer | https://www.reddit.com/r/chinesecarsuae/comments/1spbcjj/what_are_the_realworld_ |
| 25 | T2 / global | WEAK | TikTok discover hub page, one off-road anecdote; 4x4 system is likely the petrol layout | 4x4 system not engaging, with only the front tires rotating during a recovery attempt in sand. | https://www.tiktok.com/discover/jetour-t2-issues |
| 26 | Tiggo 8 Pro / global | DISCARD | VERIFIED ICE: Turkish sikayetvar complaint; Turkey sells only the 1.6 TGDI petrol Tiggo 8 Pro | Dashboard, radio, and screen malfunctions: the radio does not work, the screen completely shuts off, | https://www.sikayetvar.com/en/chery-us/chery-tiggo-8-pro-dashboard-radio-and-scr |
| 27 | Tiggo 8 Pro / global | DISCARD | Russian-market crash claim via a TikTok discover page (Russia sells the petrol car); vague, no engine, hub page | Airbags reportedly failed to deploy in a crash of a Chery Tiggo 8 Pro in Russia; the claim is presen | https://www.tiktok.com/discover/fallas-chery-tiggo-8-pro |
| 28 | 06 EM-P / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Owner reported delivery of a problem car with incomplete PDI; the 360-degree panoramic camera remain | https://www.12365auto.com/zlts/20250512/1428976.shtml |
| 29 | 06 EM-P / china | WEAK | an owner's question about a hard brake pedal on a '06 hybrid' | An owner of a 06 hybrid reported a hard brake pedal accompanied by a clicking sound like phone typin | https://www.dongchedi.com/community/4340/maintenance |
| 30 | 06 EM-P / china | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | An owner reported that after about ten days, the vehicle developed severe whole-body shaking at 6–7  | https://www.dongchedi.com/community/4340/maintenance |
| 31 | 06 EM-P / global | keep | specific, model-relevant, cited page names the model or is a plausible PHEV-shared fault | Native Bluetooth connectivity/compatibility issue reported with many Samsung Galaxy devices; one own | https://www.reddit.com/r/LynkCo/comments/1qvp6s4/lynk_co_06_emp_latam/ |
| 32 | Geely Coolray / Binyue / china | DISCARD | cited baike.pcauto.com.cn/30431.html is a real HTTP 404 (re-verified); it was only 'unverifiable' during the run | Window/door seal air leak, allowing wind to be felt inside the cabin. | https://baike.pcauto.com.cn/30431.html |
| 33 | Geely Coolray / Binyue / china | DISCARD | same dead baike URL | Central infotainment screen freezes or lags after the vehicle has been driven for a period; head uni | https://baike.pcauto.com.cn/30431.html |
| 34 | Geely Coolray / Binyue / china | DISCARD | same dead baike URL | Abnormal noise from the brake system. | https://baike.pcauto.com.cn/30431.html |
| 35 | Geely Coolray / Binyue / china | DISCARD | a 2019 Zhihu article — the original ICE-era Coolray | Steering wheel shakes noticeably during hard braking. | https://zhuanlan.zhihu.com/p/69823910 |
| 36 | Geely Coolray / Binyue / china | DISCARD | from the dongchedi 2023 1.4T Coolray quality page — ICE | Body rattles/abnormal noises from the body. | https://www.dongchedi.com/community/730029750000000/quality |
| 37 | Geely Coolray / Binyue / china | DISCARD | same 1.4T ICE page | Very poor cabin sound insulation. | https://www.dongchedi.com/community/730029750000000/quality |
| 38 | Geely Coolray / Binyue / china | DISCARD | same 1.4T ICE page | Paint is very thin. | https://www.dongchedi.com/community/730029750000000/quality |
| 39 | Geely Coolray / Binyue / china | WEAK | exhaust noise — one line from a series listing page; can't tell the variant | Exhaust pipe abnormal noise. | https://www.12365auto.com/series/v-2407-1-0.shtml |
