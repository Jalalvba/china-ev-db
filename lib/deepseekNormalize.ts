// Shared normalization helpers for importing "deepseek-style" raw spec JSON
// (Chinese brand/model names, 万-denominated prices, loosely-typed fields)
// into the app's Brand/Model/Powertrain shape.

export const CNY_PER_USD = 7.2;

/** Known Chinese brand names -> canonical English brand name + group. Extend as needed. */
export const KNOWN_BRANDS: Record<
  string,
  { name: string; parent_group?: string; founded_year?: number; website?: string; country_origin?: string }
> = {
  "BYD": { name: "BYD", founded_year: 1995, website: "https://www.byd.com" },
  "腾势": { name: "Denza", parent_group: "BYD Group", founded_year: 2010, website: "https://www.denzaauto.com" },
  "仰望": { name: "Yangwang", parent_group: "BYD Group", founded_year: 2022, website: "https://www.yangwangauto.com" },
  "方程豹": { name: "Fangchengbao", parent_group: "BYD Group", founded_year: 2023, website: "https://www.fangchengbao.com" },
  "吉利": { name: "Geely", founded_year: 1986, website: "https://www.geely.com" },
  "几何": { name: "Geometry", parent_group: "Geely Holding Group" },
  "极氪": { name: "Zeekr", parent_group: "Geely Holding Group", founded_year: 2021, website: "https://www.zeekr.com" },
  "领克": { name: "Lynk & Co", parent_group: "Geely Holding Group" },
  "银河": { name: "Geely Galaxy", parent_group: "Geely Holding Group" },
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
  "荣威": { name: "Roewe", parent_group: "SAIC Motor" },
  "名爵": { name: "MG", parent_group: "SAIC Motor" },
  "斯柯达": { name: "Škoda", country_origin: "Czech Republic" },
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

/** Best-effort translation of known Chinese org-name fragments inside a mixed-language string. */
export function translateOrgFragments(text: string): string {
  let result = text;
  const keys = Object.keys(CHINESE_ORG_TERMS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    result = result.split(key).join(CHINESE_ORG_TERMS[key]);
  }
  // Normalize full-width Chinese punctuation to plain ASCII and collapse
  // resulting whitespace, so translated strings never surface CJK punctuation.
  result = result
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/、/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
  return result;
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
};

const RANGE_STANDARD_CORRECTIONS: Record<string, string> = {
  WLTC: "WLTP",
  NEDC2: "NEDC",
};

const VALID_RANGE_STANDARDS = new Set(["CLTC", "WLTP", "NEDC"]);

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

/** Resolve a raw (possibly Chinese) model name to English, warning if unmapped. */
export function resolveModelName(raw: string, explicitEnglish?: string): string {
  if (explicitEnglish) return explicitEnglish;
  const known = KNOWN_MODELS[raw];
  if (known) return known;
  if (isAscii(raw)) return raw;
  console.warn(`[import] No English mapping for model "${raw}" — keeping original name. Add it to KNOWN_MODELS in lib/deepseekNormalize.ts.`);
  return raw;
}

/** Parse a "7.98–9.98万" / "22.98万起" / "100.8万" style RMB price string into numeric CNY. */
export function parsePriceRange(str: string | null | undefined):
  | { min_local: number; max_local: number; currency_local: string; min_usd: number; max_usd: number }
  | undefined {
  if (!str) return undefined;
  const cleaned = str.replace(/,/g, "");
  const nums = cleaned.match(/[\d.]+/g)?.map(Number);
  if (!nums || nums.length === 0) return undefined;
  const isWan = cleaned.includes("万");
  const mult = isWan ? 10000 : 1;
  const min_local = Math.round(nums[0] * mult);
  const max_local = Math.round((nums.length > 1 ? nums[1] : nums[0]) * mult);
  return {
    min_local,
    max_local,
    currency_local: "CNY",
    min_usd: Math.round(min_local / CNY_PER_USD),
    max_usd: Math.round(max_local / CNY_PER_USD),
  };
}

/** Extract a numeric kW value from strings like "1000kW (dual-gun)", "megawatt flash charging", "80kW". */
export function parseDcKw(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  const s = String(v);
  const m = s.match(/(\d+(?:\.\d+)?)\s*kW/i);
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

export function kwToHp(kw: number | undefined): number | undefined {
  return kw === undefined ? undefined : Math.round(kw * 1.341);
}

export function correctRangeStandard(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v).toUpperCase();
  const corrected = RANGE_STANDARD_CORRECTIONS[s] ?? s;
  if (!VALID_RANGE_STANDARDS.has(corrected)) {
    console.warn(`[import] Unknown range_standard "${v}" — dropping field.`);
    return undefined;
  }
  return corrected;
}

export function correctGearbox(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v);
  const corrected = GEARBOX_CORRECTIONS[s] ?? s;
  if (!VALID_GEARBOX.has(corrected)) {
    console.warn(`[import] Unknown gearbox type "${v}" — keeping as-is; verify against schema enum.`);
    return corrected;
  }
  return corrected;
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
    if (/a00|city|mini|compact|小型|紧凑/.test(text)) return "SUV-compact";
    if (/full|large|大型|旗舰/.test(text)) return "SUV-full";
    return "SUV-mid";
  }

  if (/d-segment|large sedan|大型/.test(text)) return "D-segment/Large";
  if (/c-segment|c\+|mid-size|中型/.test(text)) return "C-segment/Mid-size";
  if (/a00|city car|微型/.test(text)) return "A-segment/City";
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
