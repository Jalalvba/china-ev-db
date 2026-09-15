// Shared normalization helpers for importing "deepseek-style" raw spec JSON
// (Chinese brand/model names, 万-denominated prices, loosely-typed fields)
// into the app's Brand/Model/Powertrain shape.

import { GEARBOX_TYPE_VALUES } from "../types/canonicalPowertrain";

/**
 * Real CNY->USD exchange rate, fetched from Frankfurter (frankfurter.dev,
 * ECB reference rates, free/no-key) — never hardcoded. Previously this was a
 * hardcoded `CNY_PER_USD = 7.2` constant, silently going stale as the real
 * rate drifted; every model's min_usd/max_usd converted with the old
 * constant was wrong by however much the rate had moved since 7.2 was
 * written. Cached for the lifetime of the process (import runs are one-shot
 * scripts, not long-running servers) so a batch import makes one network
 * call, not one per model. Throws rather than silently falling back to a
 * guessed number — callers must handle the failure explicitly (same
 * "don't guess, flag for review" discipline as the Morocco price scraper).
 */
let cachedRate: { rate: number; date: string } | null = null;

export async function getCnyPerUsdRate(): Promise<{ rate: number; date: string }> {
  if (cachedRate) return cachedRate;
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD");
  if (!res.ok) {
    throw new Error(`Failed to fetch CNY->USD exchange rate: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { rates?: { USD?: number }; date?: string };
  const usdPerCny = data.rates?.USD;
  if (!usdPerCny || !data.date) {
    throw new Error(`Unexpected exchange-rate API response: ${JSON.stringify(data)}`);
  }
  cachedRate = { rate: 1 / usdPerCny, date: data.date };
  return cachedRate;
}

/** Known Chinese brand names -> canonical English brand name + group. Extend as needed. */
export const KNOWN_BRANDS: Record<
  string,
  { name: string; parent_group?: string; founded_year?: number; website?: string; country_origin?: string }
> = {
  "BYD": { name: "BYD", founded_year: 1995, website: "https://www.byd.com" },
  "比亚迪": { name: "BYD", founded_year: 1995, website: "https://www.byd.com" },
  "腾势": { name: "Denza", parent_group: "BYD Group", founded_year: 2010, website: "https://www.denzaauto.com" },
  "仰望": { name: "Yangwang", parent_group: "BYD Group", founded_year: 2022, website: "https://www.yangwangauto.com" },
  "方程豹": { name: "Fangchengbao", parent_group: "BYD Group", founded_year: 2023, website: "https://www.fangchengbao.com" },
  "吉利": { name: "Geely", founded_year: 1986, website: "https://www.geely.com" },
  "几何": { name: "Geometry", parent_group: "Geely Holding Group" },
  "极氪": { name: "Zeekr", parent_group: "Geely Holding Group", founded_year: 2021, website: "https://www.zeekr.com" },
  "领克": { name: "Lynk & Co", parent_group: "Geely Holding Group" },
  "银河": { name: "Geely Galaxy", parent_group: "Geely Holding Group" },
  "吉利银河": { name: "Geely Galaxy", parent_group: "Geely Holding Group" },
  "奇瑞": { name: "Chery", founded_year: 1997, website: "https://www.chery.com" },
  "捷途": { name: "Jetour", parent_group: "Chery Automobile" },
  "长城": { name: "GWM (Great Wall Motor)", founded_year: 1984, website: "https://www.gwm-global.com" },
  "哈弗": { name: "Haval", parent_group: "Great Wall Motor" },
  "长安": { name: "Changan", founded_year: 1862, website: "https://www.globalchangan.com" },
  "深蓝": { name: "Deepal", parent_group: "Changan Automobile" },
  "阿维塔": { name: "Avatr", parent_group: "Changan Automobile" },
  "蔚来": { name: "NIO", founded_year: 2014, website: "https://www.nio.com" },
  "小鹏": { name: "XPeng", founded_year: 2014, website: "https://www.xpeng.com" },
  "理想": { name: "Li Auto", founded_year: 2015, website: "https://www.lixiang.com" },
  "零跑": { name: "Leapmotor", founded_year: 2015, website: "https://www.leapmotor.com" },
  "问界": { name: "AITO", parent_group: "Seres / Huawei (co-developed)", founded_year: 2021 },
  "红旗": { name: "Hongqi", parent_group: "FAW Group", founded_year: 1958 },
  "埃安": { name: "GAC Aion", parent_group: "GAC Group", founded_year: 2017 },
  "东风": { name: "Dongfeng", founded_year: 1969 },
  // Wholly-owned mainstream Dongfeng sub-brand (Shine/Mage/Huge/E70/AX7/L7 etc.) —
  // distinct from the bare "Dongfeng" group brand and from the separate Dongfeng-PSA
  // JV (Shenlong Automobile). See CLAUDE.md (Data model conventions). Source data sometimes tags these
  // models' brand generically as "东风" instead of this sub-brand string, which is
  // exactly the mismatch the cross-brand duplicate preflight check below guards against.
  "东风风神": { name: "Dongfeng Aeolus", parent_group: "Dongfeng Motor Corporation" },
  "荣威": { name: "Roewe", parent_group: "SAIC Motor" },
  "睿蓝": { name: "Livan", parent_group: "Geely", founded_year: 2022 },
  "东风小康": { name: "DFSK", parent_group: "Dongfeng" },
  DFSK: { name: "DFSK", parent_group: "Dongfeng" },
  "星途": { name: "Exeed", parent_group: "Chery" },
  Exeed: { name: "Exeed", parent_group: "Chery" },
  "小米汽车": { name: "Xiaomi Auto", parent_group: "Xiaomi", founded_year: 2021, website: "https://www.xiaomiev.com" },
  "小米澎程": { name: "Xiaomi Pengcheng", parent_group: "Xiaomi", founded_year: 2026 },
  "名爵": { name: "MG", parent_group: "SAIC Motor" },
  "斯柯达": { name: "Škoda", country_origin: "Czech Republic" },
  "智己": { name: "IM Motors", parent_group: "SAIC Motor", founded_year: 2020 },
  "广汽埃安": { name: "GAC Aion", parent_group: "GAC Group", founded_year: 2017 },
  "岚图": { name: "Voyah", parent_group: "Dongfeng", founded_year: 2020 },
  "智界": { name: "Luxeed", parent_group: "Chery / Huawei", founded_year: 2024 },
  "享界": { name: "Stelato", parent_group: "BAIC / Huawei", founded_year: 2024 },
  "尊界": { name: "Maestro", parent_group: "JAC / Huawei", founded_year: 2025 },
  "尚界": { name: "Shangjie", parent_group: "SAIC / Huawei", founded_year: 2025 },
  "昊铂": { name: "Hyptec", parent_group: "GAC", founded_year: 2025 },
  Hyptec: { name: "Hyptec", parent_group: "GAC", founded_year: 2025 },
  "传祺": { name: "Trumpchi", parent_group: "GAC" },
  Trumpchi: { name: "Trumpchi", parent_group: "GAC" },
  "雷达": { name: "Radar", parent_group: "Geely Holding Group" },
  Radar: { name: "Radar", parent_group: "Geely Holding Group" },
  "远程": { name: "Farizon", parent_group: "Geely Holding Group", founded_year: 2016 },
  Farizon: { name: "Farizon", parent_group: "Geely Holding Group", founded_year: 2016 },
};

/**
 * Chinese org-name fragments -> English, for cleaning up parent_group / jv_partners
 * strings that mix Chinese company names with English brand names (e.g.
 * "江淮 / 大众" -> "JAC / Volkswagen"). Applied as best-effort substring
 * replacement, longest keys first to avoid partial-match collisions
 * (e.g. "江淮汽车" before "江淮"). Extend as needed.
 */
export const CHINESE_ORG_TERMS: Record<string, string> = {
  "凯翼汽车": "Cowin Auto",
  "奇瑞控股": "Chery Holding",
  "宜宾国资": "Yibin State Capital",
  "神龙汽车": "Shenlong Automobile",
  "成都经开区": "Chengdu Economic Development Zone",
  "楚能新能源": "Chuneng New Energy",
  "追觅科技": "Dreame Technology",
  "金菓汽车": "Jinguo Auto",
  "比亚迪": "BYD",
  "吉利": "Geely",
  "奇瑞": "Chery",
  "长城": "GWM (Great Wall Motor)",
  "长安": "Changan",
  "北汽": "BAIC",
  "上汽": "SAIC",
  "一汽": "FAW",
  "东风": "Dongfeng",
  "蔚来": "NIO",
  "江淮": "JAC",
  "江铃": "JMC",
  "柳汽": "Liuzhou Motor",
  "赛力斯": "Seres",
  "华为": "Huawei",
  "大众": "Volkswagen",
  "本田": "Honda",
  "日产": "Nissan",
  "沃尔沃": "Volvo",
  "奔驰": "Mercedes-Benz",
  "捷豹路虎": "JLR",
  "五菱": "Wuling",
  "通用": "GM",
  "广汽": "GAC",
  "小米": "Xiaomi",
  "赛豆科技": "AIVA Tech",
  "参股公司": "-invested ",
  "汽车": " Auto",
};

/** Substring-replace every key of `dict` in `text`, longest keys first to avoid partial-match collisions. */
export function translateTerms(text: string, dict: Record<string, string>): string {
  let result = text;
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    result = result.split(key).join(dict[key]);
  }
  return result;
}

/** Normalize full-width Chinese punctuation to plain ASCII and collapse resulting whitespace. */
export function normalizePunctuation(text: string): string {
  return text
    .replace(/\s*（\s*/g, " (")
    .replace(/\s*）\s*/g, ") ")
    .replace(/、/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

/** Best-effort translation of known Chinese org-name fragments inside a mixed-language string. */
export function translateOrgFragments(text: string): string {
  return normalizePunctuation(translateTerms(text, CHINESE_ORG_TERMS));
}

/** Chinese battery chemistry / supplier / proprietary-name fragments -> English. Extend as needed. */
export const BATTERY_TERMS: Record<string, string> = {
  "磷酸铁锂": "LFP",
  "三元锂": "NMC",
  "钠离子": "Sodium-ion",
  "神盾电池": "Shield Battery",
  "宁德时代": "CATL",
  "比亚迪弗迪电池": "BYD FinDreams",
};

/** Translate Chinese battery chemistry/supplier text (e.g. "磷酸铁锂（神盾电池）") to English. */
export function translateBatteryTerms(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  return normalizePunctuation(translateTerms(text, BATTERY_TERMS));
}

/** Chinese base chemistry-family terms -> the schema's chemistry family label. */
const BASE_CHEMISTRY_TERMS: Record<string, string> = {
  "磷酸铁锂电池": "LFP",
  "磷酸铁锂": "LFP",
  "三元锂电池": "NMC",
  "三元锂": "NMC",
  "钠离子": "Sodium-ion",
  // English-language sources describe the same chemistries in prose rather
  // than the LFP/NMC abbreviations directly.
  "ternary lithium battery": "NMC",
  "ternary lithium": "NMC",
  "lithium iron phosphate": "LFP",
};

/** Chinese proprietary battery-product names -> English label, for the battery_variant field. */
const BATTERY_VARIANT_TERMS: Record<string, string> = {
  "麒麟电池": "Qilin",
  "麒麟": "Qilin",
  "金砖电池": "Zeekr Golden Brick",
  "骁遥电池": "CATL Shenyao",
  "神盾电池": "Shield Battery",
  // English equivalents of the same proprietary battery product names.
  "Kirin battery": "Qilin",
  "Kirin": "Qilin",
  "Golden Brick battery": "Zeekr Golden Brick",
  "Shenyao": "CATL Shenyao",
};

export interface ParsedBatteryChemistry {
  chemistry?: string;
  battery_variant?: string;
  /** Supplier name mentioned inline (e.g. "宁德时代") — only set when explicitly stated, never guessed. */
  supplier_hint?: string;
}

/**
 * Split a richer chemistry string like "三元锂电池（103kWh麒麟电池）" or
 * "三元锂电池（115kWh宁德时代6C麒麟电池）" into the base chemistry family
 * (NMC/LFP), a proprietary battery-product name for battery_variant (e.g.
 * "CATL Qilin (6C)"), and — only when explicitly named in the text, never
 * inferred — a supplier hint.
 */
export function parseBatteryChemistry(raw: string | null | undefined): ParsedBatteryChemistry {
  if (!raw) return {};

  const m = raw.match(/^(.*?)[（(]([^)）]*)[)）]\s*$/);
  const basePart = (m ? m[1] : raw).trim();
  const parenPart = m ? m[2].trim() : "";

  let chemistry: string | undefined;
  for (const term of Object.keys(BASE_CHEMISTRY_TERMS).sort((a, b) => b.length - a.length)) {
    if (basePart.includes(term)) {
      chemistry = BASE_CHEMISTRY_TERMS[term];
      break;
    }
  }
  if (!chemistry) {
    if (isAscii(basePart) && basePart) {
      chemistry = basePart;
    } else if (basePart) {
      console.warn(`[import] No English mapping for battery chemistry "${basePart}" — keeping original. Add it to BASE_CHEMISTRY_TERMS in lib/deepseekNormalize.ts.`);
      chemistry = basePart;
    }
  }

  if (!parenPart) return { chemistry };

  let remainder = parenPart.replace(/[\d.]+\s*kWh/gi, "").trim();
  let supplier_hint: string | undefined;
  if (remainder.includes("宁德时代")) {
    supplier_hint = "CATL";
    remainder = remainder.replace("宁德时代", "").trim();
  }

  const fastChargeMatch = remainder.match(/(\d+C)\b/i);

  let battery_variant: string | undefined;
  for (const term of Object.keys(BATTERY_VARIANT_TERMS).sort((a, b) => b.length - a.length)) {
    if (remainder.includes(term)) {
      const label = BATTERY_VARIANT_TERMS[term];
      battery_variant = supplier_hint && !label.includes(supplier_hint) ? `${supplier_hint} ${label}` : label;
      break;
    }
  }
  if (battery_variant && fastChargeMatch) {
    battery_variant += ` (${fastChargeMatch[1]})`;
  }
  if (!battery_variant) {
    const leftover = remainder.replace(/[（）()]/g, "").trim();
    if (leftover && !isAscii(leftover)) {
      console.warn(`[import] Unrecognized battery variant detail "${leftover}" (from "${raw}") — dropping. Add it to BATTERY_VARIANT_TERMS if useful.`);
    } else if (leftover) {
      battery_variant = leftover;
    }
  }

  return { chemistry, battery_variant, supplier_hint };
}

/** Chinese motor-type descriptions -> normalized English label. */
const MOTOR_TYPE_TERMS: Record<string, string> = {
  "前感应/异步 + 后永磁/同步": "Front Induction + Rear PMSM",
  "前永磁/同步 + 后永磁/同步": "Dual PMSM",
  "永磁同步电机": "PMSM",
  "感应电机": "Induction",
  "异步电机": "Induction",
  "SiC油冷电驱": "PMSM (SiC oil-cooled)",
  "48V BSG电机（轻混）": "48V BSG (mild hybrid)",
  // English equivalents of the same compound dual-motor descriptions.
  "front induction/asynchronous + rear permanent magnet/synchronous": "Front Induction + Rear PMSM",
  "front permanent magnet/synchronous + rear permanent magnet/synchronous": "Dual PMSM",
  "permanent magnet synchronous motors": "PMSM",
  "permanent magnet synchronous motor": "PMSM",
  "小米超级三电机 (前V6s+后双V8s)": "Tri-Motor PMSM (front V6s + rear dual V8s)",
};

/** Resolve a raw (possibly Chinese) motor-type description to a normalized label, defaulting to PMSM. */
export function resolveMotorType(raw: string | null | undefined): string {
  if (!raw) return "PMSM";
  for (const [term, en] of Object.entries(MOTOR_TYPE_TERMS)) {
    if (raw.includes(term)) return en;
  }
  if (/induction/i.test(raw)) return "Induction";
  if (isAscii(raw)) return raw;
  console.warn(`[import] No English mapping for motor type "${raw}" — defaulting to PMSM. Add it to MOTOR_TYPE_TERMS in lib/deepseekNormalize.ts.`);
  return "PMSM";
}

/** Chinese engine-induction terms -> English. */
const INDUCTION_TERMS: Record<string, string> = {
  "自然吸气": "naturally aspirated",
  "涡轮增压": "turbo",
  "机械增压+涡轮增压 双增压": "twin-charged (supercharger + turbo)",
  "turbocharged": "turbo",
};

/** Translate a raw (possibly Chinese) induction description, passing through unmapped ASCII text and warning otherwise. */
export function resolveInduction(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const known = INDUCTION_TERMS[raw];
  if (known) return known;
  if (isAscii(raw)) return raw;
  console.warn(`[import] No English mapping for induction type "${raw}" — keeping original. Add it to INDUCTION_TERMS in lib/deepseekNormalize.ts.`);
  return raw;
}

/**
 * Split a parent_group string like "Seres / Huawei" into the manufacturing
 * parent and an optional tech/ecosystem partner (currently only Huawei is
 * treated as a tech partner rather than a co-parent). Also handles the
 * standalone "Huawei ecosystem" label used for umbrella entities like HIMA.
 */
export function splitTechPartner(rawParentGroup: string | undefined): { parent_group?: string; tech_partner?: string } {
  if (!rawParentGroup) return {};
  const translated = translateOrgFragments(rawParentGroup);

  if (/^huawei\s*ecosystem$/i.test(translated.trim())) {
    return { tech_partner: "Huawei" };
  }

  const parts = translated.split("/").map((p) => p.trim().replace(/\s*\([^)]*\)\s*$/, "").trim());
  const huaweiIdx = parts.findIndex((p) => /^huawei$/i.test(p));
  if (huaweiIdx !== -1 && parts.length > 1) {
    const others = parts.filter((_, i) => i !== huaweiIdx);
    return { parent_group: others.join(" / "), tech_partner: "Huawei" };
  }

  return { parent_group: translated };
}

/** Known Chinese model names -> English. Extend as needed; unmapped names pass through unchanged. */
export const KNOWN_MODELS: Record<string, string> = {
  "秦PLUS": "Qin PLUS",
  "宋Ultra EV": "Song Ultra EV",
  "宋Ultra DM-i": "Song Ultra DM-i",
  "汉 EV": "Han EV",
  "汉L EV": "Han L EV",
  "唐L EV": "Tang L EV",
  "海鸥": "Seagull",
  "海豚": "Dolphin",
  "元PLUS": "Yuan PLUS",
  "海豹06GT": "Seal 06 GT",
  "海狮06 EV": "Sealion 06 EV",
  "夏 DM-i": "Xia DM-i",
  "豹5": "Bao 5",
  "豹8": "Bao 8",
  // Geely Galaxy (吉利银河) lineup
  "银河E5": "Galaxy E5",
  "银河E8": "Galaxy E8",
  "银河L6 EM-i": "Galaxy L6 EM-i",
  "银河L7": "Galaxy L7",
  "星愿": "Starwish",
  "星舰7 EM-i": "Starship 7 EM-i",
  "星耀6": "Starlight 6",
  "星耀7": "Starlight 7",
  "银河A7": "Galaxy A7",
  "银河A7 EV": "Galaxy A7 EV",
  "银河M7": "Galaxy M7",
  "银河M9": "Galaxy M9",
  "银河V900": "Galaxy V900",
  "银河TT": "Galaxy TT",
  "银河战舰700": "Galaxy Warship 700",
  "银河星耀8": "Galaxy Starlight 8",
  // Zeekr (极氪) lineup
  "极氪001": "001",
  "极氪007": "007",
  "极氪007GT": "007 GT",
  "极氪X": "X",
  "极氪7X": "7X",
  "极氪009": "009",
  "极氪MIX": "MIX",
  "极氪9X": "9X",
  "极氪8X": "8X",
  // Lynk & Co (领克) lineup
  "领克03": "03",
  "领克03+": "03+",
  "领克06": "06",
  "领克06 EM-P": "06 EM-P",
  "领克07 EM-P": "07 EM-P",
  "领克08 EM-P": "08 EM-P",
  "领克09": "09",
  "领克900": "900",
  "领克Z10": "Z10",
  // Livan (睿蓝) lineup
  "睿蓝7": "Livan 7",
  "睿蓝8": "Livan 8",
  "睿蓝9": "Livan 9",
  "睿蓝X3 PRO": "Livan X3 PRO",
  // Xiaomi Auto lineup
  "小米SU7": "SU7",
  "小米YU7": "YU7",
  // Xiaomi Pengcheng (SkyNomad) lineup
  "小米澎程N70": "N70",
  "小米澎程N90": "N90",
};

const RANGE_STANDARD_CORRECTIONS: Record<string, string> = {
  // WLTC (the drive cycle itself) is NOT the same standard as WLTP (the EU
  // regulatory procedure built on that cycle, with its own correction
  // factors) — a WLTC-reported figure and a WLTP-certified figure for the
  // same car aren't guaranteed to match. Previously this table silently
  // relabeled WLTC as WLTP; that misrepresented which standard actually
  // produced the number, so WLTC is now accepted as its own distinct value
  // (see RANGE_STANDARD_VALUES in types/canonicalPowertrain.ts) rather than
  // corrected here. Do not re-add this alias without re-litigating that
  // decision.
  NEDC2: "NEDC",
  // "工信部" (MIIT-published figure) uses the CLTC test cycle under current
  // Chinese regulation — treated as equivalent, not a literal translation.
  //
  // FLAGGED FOR FUTURE REVIEW (raised during the WLTC/WLTP correction audit
  // — see git history around that change for full context): 工信部 names the
  // *publishing authority*, not a test cycle, and this mapping has the same
  // shape as the WLTC->WLTP alias that was just removed above for
  // misrepresenting which standard actually produced a number. MIIT-
  // published range figures were NEDC-based before China's regulatory
  // switch to CLTC (~2021) — so unconditionally mapping "工信部" to "CLTC"
  // is likely WRONG for any source citing a pre-transition model/figure.
  // Deliberately left as-is for now (not fixed, not scoped) pending a
  // future session researching the actual MIIT methodology transition date,
  // after which this should either be corrected, scoped by model year, or
  // consciously left as a known simplification.
  "工信部": "CLTC",
};

const VALID_RANGE_STANDARDS = new Set(["CLTC", "WLTP", "WLTC", "NEDC"]);

const VALID_SEGMENTS = new Set([
  "A-segment/City",
  "B-segment/Compact",
  "C-segment/Mid-size",
  "D-segment/Large",
  "SUV-compact",
  "SUV-mid",
  "SUV-full",
  "MPV",
  "Pickup",
  "Sports",
]);

const VALID_GEARBOX = new Set([
  "single-speed reducer",
  "CVT",
  "DCT",
  "AT",
  "MT",
  "AMT",
  "multi-speed EV transmission",
]);

const GEARBOX_CORRECTIONS: Record<string, string> = {
  "E-CVT": "CVT",
  "eCVT": "CVT",
  "DHT": "multi-speed EV transmission",
};

/** Values meaning "not yet determined" rather than an actual gearbox type. */
const GEARBOX_PLACEHOLDER_TERMS = ["待确认", "待定", "TBD", "未知"];

const MOTOR_COUNT_MAP: Record<number, string> = {
  1: "single",
  2: "dual",
  3: "tri-motor",
  4: "quad-motor",
};

export function isAscii(s: string): boolean {
  return /^[\x00-\x7F]*$/.test(s);
}

/** Resolve a raw (possibly Chinese) brand name to English + metadata, warning if unmapped. */
export function resolveBrandName(
  raw: string,
  explicitEnglish?: string
): { name: string; parent_group?: string; founded_year?: number; website?: string; country_origin?: string } {
  const known = KNOWN_BRANDS[raw];
  if (known) return known;
  if (explicitEnglish) return { name: explicitEnglish };
  if (isAscii(raw)) return { name: raw };
  console.warn(`[import] No English mapping for brand "${raw}" — keeping original name. Add it to KNOWN_BRANDS in lib/deepseekNormalize.ts.`);
  return { name: raw };
}

/** True if resolveBrandName would resolve this without falling back to a warned-and-passed-through raw name. */
export function isBrandNameResolvable(raw: string, explicitEnglish?: string): boolean {
  return Boolean(KNOWN_BRANDS[raw]) || Boolean(explicitEnglish) || isAscii(raw);
}

/** Resolve a raw (possibly Chinese) model name to English, warning if unmapped. */
export function resolveModelName(raw: string, explicitEnglish?: string): string {
  if (explicitEnglish) return explicitEnglish;
  const known = KNOWN_MODELS[raw];
  if (known) return known;
  if (isAscii(raw)) return raw;
  console.warn(`[import] No English mapping for model "${raw}" — keeping original name. Add it to KNOWN_MODELS in lib/deepseekNormalize.ts.`);
  return raw;
}

/** True if resolveModelName would resolve this without falling back to a warned-and-passed-through raw name. */
export function isModelNameResolvable(raw: string, explicitEnglish?: string): boolean {
  return Boolean(explicitEnglish) || Boolean(KNOWN_MODELS[raw]) || isAscii(raw);
}

/** Parse a "7.98–9.98万" / "22.98万起" / "100.8万" style RMB price string into numeric CNY. `cnyPerUsd` must come from getCnyPerUsdRate() — call it once per import run and pass the result through, rather than fetching per call. */
export function parsePriceRange(
  str: string | null | undefined,
  cnyPerUsd: number
): { min: number; max: number; currency_local: string; min_usd: number; max_usd: number; unverified?: boolean } | undefined {
  if (!str) return undefined;
  const cleaned = str.replace(/,/g, "");
  const nums = cleaned.match(/[\d.]+/g)?.map(Number);
  if (!nums || nums.length === 0) return undefined;
  const isWan = cleaned.includes("万");
  const mult = isWan ? 10000 : 1;
  const min = Math.round(nums[0] * mult);
  const max = Math.round((nums.length > 1 ? nums[1] : nums[0]) * mult);
  return {
    min,
    max,
    currency_local: "CNY",
    min_usd: Math.round(min / cnyPerUsd),
    max_usd: Math.round(max / cnyPerUsd),
  };
}

export interface CanonicalPriceInput {
  min?: number | null;
  max?: number | null;
  unverified?: boolean;
}

/**
 * Resolve price_rmb_range whether it's the legacy raw string ("7.98-9.98万")
 * or the canonical {min, max, unverified} object already in DB-ready form.
 * Falls back to explicitUnverified (e.g. an entry-level price_unverified
 * flag) only when the object/string itself doesn't already carry one.
 * `cnyPerUsd` must come from getCnyPerUsdRate() — call it once per import
 * run and pass the result through, rather than fetching per call.
 */
export function resolvePriceRange(
  input: string | CanonicalPriceInput | null | undefined,
  cnyPerUsd: number,
  explicitUnverified?: boolean
): { min?: number; max?: number; currency_local: string; min_usd?: number; max_usd?: number; unverified?: boolean } | undefined {
  if (!input) return undefined;

  if (typeof input === "string") {
    const parsed = parsePriceRange(input, cnyPerUsd);
    if (parsed && explicitUnverified) parsed.unverified = true;
    return parsed;
  }

  const min = input.min ?? undefined;
  const max = input.max ?? undefined;
  if (min === undefined && max === undefined) {
    return { currency_local: "CNY", unverified: input.unverified ?? explicitUnverified };
  }
  return {
    min,
    max,
    currency_local: "CNY",
    min_usd: min !== undefined ? Math.round(min / cnyPerUsd) : undefined,
    max_usd: max !== undefined ? Math.round(max / cnyPerUsd) : undefined,
    unverified: input.unverified ?? explicitUnverified,
  };
}

/** Extract a numeric kW value from strings like "1000kW (dual-gun)", "megawatt flash charging", "80kW". */
export function parseDcKw(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const s = String(v);
  // Negative lookahead on "h" so "95 kWh" (a capacity mention) isn't
  // misread as a 95kW charging-power figure.
  const m = s.match(/(\d+(?:\.\d+)?)\s*kW(?!h)/i);
  if (m) return Number(m[1]);
  if (/megawatt/i.test(s)) return 1000;
  return undefined;
}

/** Extract a numeric km value from strings like ">1000" or "1163". */
export function parseCombinedRange(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const m = String(v).match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}

export function num(v: unknown): number | undefined {
  return v === null || v === undefined ? undefined : (v as number);
}

// The real, current GEARBOX_TYPE_VALUES, not another hardcoded duplicate
// list — VALID_GEARBOX above is its own separate, older list that's already
// missing "E-CVT" (added to the canonical enum after VALID_GEARBOX was
// written; left alone here since correctGearbox is a separate, already-
// working legacy pipeline not touched by this change). Importing the real
// enum means correctGearboxType can't go stale the same way.
const VALID_GEARBOX_TYPES = new Set<string>(GEARBOX_TYPE_VALUES);

/**
 * Alias/normalization table for transmission.type free text -> the strict
 * GEARBOX_TYPE_VALUES enum — used by the manual Kimi/DeepSeek round-trip
 * (lib/manualResearchImport.ts), same "resolve known aliases, else undefined
 * rather than guess" contract as correctRangeStandard above. Added after a
 * real Geely Coolray/Binyue import where Kimi/DeepSeek returned descriptive
 * strings like "5MT manual" and "7-speed wet DCT" instead of the enum
 * tokens "MT"/"DCT" — the THIRD recurring "AI free text vs. strict enum"
 * friction point in one evening (after ev_range_standard and the
 * thermal_management has_liquid_cooling/has_heat_pump field-naming
 * mismatch) — see the "AI free text needs a normalization layer" note in
 * CLAUDE.md for why this is now a standing pattern to check for on any new
 * enum field, not just this one.
 *
 * Deliberately a SEPARATE function from correctGearbox above rather than a
 * shared core refactor: correctGearbox's contract (fall back to the raw
 * string, unresolved, with a console.warn) is relied on by its existing
 * caller (scripts/import-deepseek.ts) and changing it risks an unrelated
 * regression there; this function's contract (undefined on no match, never
 * a passthrough) is what the strict manual-import validator needs. Some
 * alias overlap between the two is accepted as the cost of not touching a
 * working, differently-contracted pipeline for an unrelated fix.
 */
export function correctGearboxType(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (VALID_GEARBOX_TYPES.has(s)) return s;

  // Exact-match aliases first (whole-string, case-sensitive forms actually
  // seen in practice).
  const exact: Record<string, string> = { eCVT: "E-CVT", "e-CVT": "E-CVT" };
  if (exact[s]) return exact[s];

  // Keyword/substring detection for descriptive strings — ordered so a more
  // specific token (AMT, DHT) is checked before a token it could otherwise
  // be mistaken to contain (MT, CVT's own "variable" family).
  if (/单速/.test(s) || /single.?speed/i.test(s) || (s.includes("电动车") && s.includes("变速箱"))) return "single-speed reducer";
  if (/DHT/i.test(s)) return "multi-speed EV transmission";
  if (/\bE-?CVT\b/i.test(s)) return "E-CVT";
  if (/双离合/.test(s) || /dual.?clutch/i.test(s) || /\bDCT\b/i.test(s)) return "DCT";
  if (/CVT/i.test(s) || /continuously variable/i.test(s)) return "CVT";
  if (/\bAMT\b/i.test(s) || /automated manual/i.test(s)) return "AMT";
  if (/手自一体|自动挡/.test(s) || /\bAT\b/i.test(s) || /\bautomatic\b/i.test(s) || /torque converter/i.test(s)) return "AT";
  if (/手动挡/.test(s) || /\bmanual\b/i.test(s) || /\bMT\b/i.test(s)) return "MT";

  console.warn(`[manual-import] Unknown transmission.type "${v}" — no known alias, leaving unresolved (will be dropped, not guessed).`);
  return undefined;
}

export function correctRangeStandard(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v).toUpperCase();
  const corrected = RANGE_STANDARD_CORRECTIONS[s] ?? s;
  if (!VALID_RANGE_STANDARDS.has(corrected)) {
    console.warn(`[import] Unknown ev_range_standard "${v}" — dropping field.`);
    return undefined;
  }
  return corrected;
}

export function correctGearbox(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v);

  if (GEARBOX_PLACEHOLDER_TERMS.some((t) => s.includes(t))) return undefined;

  // Exact-match corrections first (covers whole-string values like "E-CVT").
  const exact = GEARBOX_CORRECTIONS[s];
  if (exact) return exact;
  if (VALID_GEARBOX.has(s)) return s;

  // Chinese keyword detection for longer descriptive strings, e.g.
  // "电动车单速变速箱" or "E-DHT智能无级11合1混动电驱".
  if (/单速/.test(s) || /single.?speed/i.test(s) || (s.includes("电动车") && s.includes("变速箱"))) return "single-speed reducer";
  if (/DHT/i.test(s)) return "multi-speed EV transmission";
  if (/双离合/.test(s)) return "DCT";
  if (/CVT/i.test(s)) return "CVT";
  if (/AMT/i.test(s)) return "AMT";
  if (/手自一体|自动挡/.test(s)) return "AT";
  if (/手动挡/.test(s)) return "MT";

  console.warn(`[import] Unknown gearbox type "${v}" — keeping as-is; verify against schema enum.`);
  return s;
}

export function motorCountFromNumber(n: unknown): string {
  const key = typeof n === "number" ? n : Number(n);
  return MOTOR_COUNT_MAP[key] || "single";
}

/** Best-effort keyword mapping from free-text Chinese/English segment + body strings to the schema enum. */
export function guessSegment(segmentText: string | undefined, bodyText: string | undefined): string {
  const text = `${segmentText ?? ""} ${bodyText ?? ""}`.toLowerCase();

  if (/mpv/.test(text)) return "MPV";
  if (/pickup|皮卡/.test(text)) return "Pickup";
  if (/sports|coupe|roadster/.test(text)) return "Sports";

  if (/suv/.test(text)) {
    if (/a0+|a\+|city|mini|compact|小型|紧凑/.test(text)) return "SUV-compact";
    if (/full|large|大型|旗舰/.test(text)) return "SUV-full";
    return "SUV-mid";
  }

  if (/d-segment|large sedan|mid-large|大型/.test(text)) return "D-segment/Large";
  if (/c-segment|c\+|mid-size|中型/.test(text)) return "C-segment/Mid-size";
  if (/a0+|city car|微型|小型/.test(text)) return "A-segment/City";
  if (/b-segment|compact|紧凑/.test(text)) return "B-segment/Compact";

  console.warn(`[import] Could not confidently map segment "${segmentText}" / body "${bodyText}" — defaulting to SUV-mid.`);
  return "SUV-mid";
}

export function assertValidSegment(seg: string): string {
  if (!VALID_SEGMENTS.has(seg)) {
    console.warn(`[import] Segment "${seg}" not in schema enum — defaulting to SUV-mid.`);
    return "SUV-mid";
  }
  return seg;
}

const VALID_ENERGY_TYPES = new Set(["ICE", "HEV", "PHEV", "BEV", "REEV/EREV", "MHEV"]);

/** Normalize a raw powertrain/energy-type string (e.g. "REEV", "PHEV (DM-i)") to the schema enum. */
export function normalizeEnergyType(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (VALID_ENERGY_TYPES.has(raw)) return raw;
  if (/^REEV|^EREV/i.test(raw)) return "REEV/EREV";
  if (/^PHEV/i.test(raw)) return "PHEV";
  if (/^HEV/i.test(raw)) return "HEV";
  if (/^MHEV/i.test(raw)) return "MHEV";
  if (/^BEV|^EV/i.test(raw)) return "BEV";
  if (/^ICE/i.test(raw)) return "ICE";
  console.warn(`[import] Unknown energy_type "${raw}" — keeping as-is; verify against schema enum.`);
  return raw;
}
