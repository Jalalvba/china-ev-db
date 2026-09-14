// Reusable importer for "deepseek-style" raw spec JSON files. Handles two shapes:
//
//   1. Variant-spec files (array of model entries with `variants`, e.g.
//      deepseek_json_20260911_6957cc.json) — imports Brand + Model + Powertrain.
//   2. Delta-report files (object with numbered sections like
//      "1_missing_brands_entirely", "3_defunct_merged_rebranded", etc., e.g.
//      deepseek_json_20260911_e9d3c6.json) — brand-only metadata, no specs.
//
// Usage:
//   npm run import -- raw-data/geely.json
//
// - Auto-detects brand / sub-brand grouping (variant-spec files: most frequent
//   `brand` field is primary, others are sub-brands; delta-report files: each
//   section supplies its own parent_group / parent_brand).
// - Normalizes Chinese names, 万-denominated prices, range-standard typos
//   (WLTC -> WLTP), transmission naming, Chinese org-name fragments in
//   parent_group strings, and splits a "X / Huawei" parent_group into
//   parent_group "X" + tech_partner "Huawei", via lib/deepseekNormalize.ts.
// - Upserts into MongoDB: existing brands are never overwritten (only filled in
//   via $setOnInsert), existing models/powertrains are matched by name/trim and
//   updated in place, new ones are inserted. Nothing is deleted.

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import { stripLeadingBrandName } from "../lib/priceFetchCore";
import {
  resolveBrandName,
  resolveModelName,
  isModelNameResolvable,
  isBrandNameResolvable,
  resolvePriceRange,
  getCnyPerUsdRate,
  type CanonicalPriceInput,
  parseDcKw,
  parseCombinedRange,
  num,
  correctRangeStandard,
  correctGearbox,
  motorCountFromNumber,
  guessSegment,
  assertValidSegment,
  splitTechPartner,
  resolveMotorType,
  resolveInduction,
  translateBatteryTerms,
  normalizeEnergyType,
  parseBatteryChemistry,
} from "../lib/deepseekNormalize";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

// ---------------------------------------------------------------------------
// Shape 1: variant-spec files (array of model entries with powertrain specs)
// ---------------------------------------------------------------------------

interface RawDetailBlock {
  confidence?: string;
  [key: string]: unknown;
}

interface RawVariant {
  trim: string;
  powertrain: string;
  engine?: (RawDetailBlock & {
    displacement_l?: number;
    cylinders?: number;
    induction?: string;
    max_power_kw?: number;
    
    torque_nm?: number;
  }) | null;
  motor?: (RawDetailBlock & {
    type?: string;
    power_kw?: number;
    torque_nm?: number;
    count?: number;
    drive?: string;
    /** Free-text caveat, e.g. "reported as system power, not motor-only". Passed through verbatim. */
    note?: string;
  }) | null;
  battery?: (RawDetailBlock & {
    chemistry?: string;
    capacity_total_kwh?: number;
    capacity_usable_kwh?: number;
    supplier?: string;
    dc_charge_kw?: unknown;
    ac_charge_kw?: unknown;
    ev_range_km?: number;
    ev_range_standard?: string;
    combined_range_km?: unknown;
    /** Free-text caveat about combined_range_km, e.g. a suspected source mislabeling of the test standard. */
    combined_range_note?: string;
  }) | null;
  transmission?: { type?: string; gears?: number | string; confidence?: string };
  performance?: { accel_0_100_s?: number; top_speed_kmh?: number; confidence?: string };
  source?: string;
  confidence?: string;
}

interface RawVariantEntry {
  brand: string;
  brand_en?: string;
  model: string;
  model_en?: string;
  generation?: string;
  segment?: string;
  body?: string;
  price_rmb_range?: string | CanonicalPriceInput;
  /** Explicit override to flag price_range.unverified even when parsePriceRange succeeds. */
  price_unverified?: boolean;
  production_status?: string;
  variants: RawVariant[];
}

function detectPrimaryBrand(entries: RawVariantEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.brand, (counts.get(e.brand) ?? 0) + 1);
  let best = entries[0].brand;
  let bestCount = 0;
  for (const [brand, count] of counts) {
    if (count > bestCount) {
      best = brand;
      bestCount = count;
    }
  }
  return best;
}

/** Clamp a raw confidence string to the schema enum, dropping anything else rather than risking a validation error. */
function normalizeConfidence(v: unknown): "confirmed" | "unconfirmed" | undefined {
  return v === "confirmed" || v === "unconfirmed" ? v : undefined;
}

function normalizeVariant(v: RawVariant) {
  const engine = v.engine
    ? {
        displacement_l: num(v.engine.displacement_l),
        cylinders: num(v.engine.cylinders),
        induction: resolveInduction(v.engine.induction),
        fuel_type: "Gasoline",
        power_kw: num(v.engine.max_power_kw),
        torque_nm: num(v.engine.torque_nm),
        confidence: normalizeConfidence(v.engine.confidence),
      }
    : undefined;

  const motor = v.motor
    ? {
        type: resolveMotorType(v.motor.type),
        power_kw: num(v.motor.power_kw),
        torque_nm: num(v.motor.torque_nm),
        count: motorCountFromNumber(v.motor.count),
        drive: v.motor.drive,
        note: v.motor.note,
        confidence: normalizeConfidence(v.motor.confidence),
      }
    : undefined;

  const chemParsed = parseBatteryChemistry(v.battery?.chemistry);

  const battery = v.battery
    ? {
        chemistry: chemParsed.chemistry,
        battery_variant: chemParsed.battery_variant,
        capacity_total_kwh: num(v.battery.capacity_total_kwh),
        capacity_usable_kwh: num(v.battery.capacity_usable_kwh),
        supplier: translateBatteryTerms(v.battery.supplier) ?? chemParsed.supplier_hint,
        dc_charge_kw: parseDcKw(v.battery.dc_charge_kw),
        ac_charge_kw: parseDcKw(v.battery.ac_charge_kw),
        ev_range_km: num(v.battery.ev_range_km),
        ev_range_standard: correctRangeStandard(v.battery.ev_range_standard),
        confidence: normalizeConfidence(v.battery.confidence),
      }
    : undefined;

  const gearboxType = v.transmission?.type ? correctGearbox(v.transmission.type) : undefined;
  const gearboxGears =
    typeof v.transmission?.gears === "number" ? v.transmission.gears : gearboxType ? 1 : undefined;
  const transmission =
    gearboxType || gearboxGears
      ? {
          type: gearboxType,
          gears: gearboxGears,
          confidence: normalizeConfidence(v.transmission?.confidence),
        }
      : undefined;

  const performance =
    v.performance?.accel_0_100_s !== undefined || v.performance?.top_speed_kmh !== undefined
      ? {
          accel_0_100_s: num(v.performance?.accel_0_100_s),
          top_speed_kmh: num(v.performance?.top_speed_kmh),
          confidence: normalizeConfidence(v.performance?.confidence),
        }
      : undefined;

  const energy_type = normalizeEnergyType(v.powertrain);

  const isUnverified = v.confidence === "unconfirmed";

  return {
    trim_name: v.trim,
    energy_type,
    engine,
    motor,
    battery,
    transmission,
    performance,
    combined_range_km: parseCombinedRange(v.battery?.combined_range_km),
    combined_range_note: v.battery?.combined_range_note,
    source: v.source,
    confidence: normalizeConfidence(v.confidence),
    unverified: isUnverified,
  };
}

async function upsertBrand(brandFields: Record<string, unknown>, name: string) {
  // name_cn/name_en are purely descriptive metadata, not editorial decisions
  // like parent_group/founded_year — always keep them current, even on an
  // already-existing brand, unlike the rest of brandFields (insert-only).
  const { name_cn, name_en, ...insertOnlyFields } = brandFields;
  const alwaysSet = stripUndefined({ name_cn, name_en });

  return Brand.findOneAndUpdate(
    { name },
    { $setOnInsert: { ...insertOnlyFields, name }, ...(Object.keys(alwaysSet).length ? { $set: alwaysSet } : {}) },
    { upsert: true, returnDocument: "after" }
  );
}

async function runVariantImport(entries: RawVariantEntry[], filePath: string) {
  const primaryRaw = detectPrimaryBrand(entries);
  const primaryBrandEn = entries.find((e) => e.brand === primaryRaw)?.brand_en;
  const primaryResolved = resolveBrandName(primaryRaw, primaryBrandEn);

  console.log(`Importing ${entries.length} model entries (variant-spec shape) from ${filePath}`);

  const { rate: cnyPerUsd, date: rateDate } = await getCnyPerUsdRate();
  console.log(`Using CNY->USD rate ${cnyPerUsd.toFixed(4)} (Frankfurter, dated ${rateDate})`);

  let brandsTouched = 0;
  let modelsUpserted = 0;
  let powertrainsUpserted = 0;

  for (const entry of entries) {
    const isSubBrand = entry.brand !== primaryRaw;
    const resolved = isSubBrand ? resolveBrandName(entry.brand, entry.brand_en) : primaryResolved;
    const brandFields = stripUndefined({
      name_cn: entry.brand,
      name_en: resolved.name,
      parent_group: resolved.parent_group ?? (isSubBrand ? `${primaryResolved.name} Group` : undefined),
      country_origin: resolved.country_origin ?? "China",
      founded_year: resolved.founded_year,
      website: resolved.website,
    });

    const brand = await upsertBrand(brandFields, resolved.name);
    brandsTouched++;

    const englishModelName = resolveModelName(entry.model, entry.model_en);
    const segment = assertValidSegment(guessSegment(entry.segment, entry.body));
    const price_range = resolvePriceRange(entry.price_rmb_range, cnyPerUsd, entry.price_unverified);

    const modelFields = stripUndefined({
      name_cn: entry.model,
      name_en: englishModelName,
      generation: entry.generation,
      segment,
      // guessSegment() is a keyword-regex heuristic over the delta report's
      // free-text segment/body strings, never a real search result of its
      // own — this import path has no grounded citation for the segment
      // classification specifically, so it's always "inferred", never
      // "confirmed", regardless of how confident the keyword match looks.
      segment_confidence: "inferred",
      body_type: entry.body ?? "Unknown",
      production_status: entry.production_status ?? "in production",
      unverified: entry.variants.some((v) => v.confidence === "unconfirmed"),
      price_range,
    });

    const modelDoc = await ModelSchema.findOneAndUpdate(
      { brand_id: brand._id, name: englishModelName },
      { $set: modelFields, $setOnInsert: { brand_id: brand._id, name: englishModelName } },
      { upsert: true, returnDocument: "after", runValidators: true }
    );
    modelsUpserted++;

    for (const variant of entry.variants) {
      const { trim_name: _trimName, ...restPowertrainFields } = stripUndefined(normalizeVariant(variant));
      await Powertrain.findOneAndUpdate(
        { model_id: modelDoc._id, trim_name: variant.trim },
        { $set: restPowertrainFields, $setOnInsert: { model_id: modelDoc._id, trim_name: variant.trim } },
        { upsert: true, returnDocument: "after", runValidators: true }
      );
      powertrainsUpserted++;
    }
  }

  console.log(
    `Done. Touched ${brandsTouched} brand refs, upserted ${modelsUpserted} models and ${powertrainsUpserted} powertrains.`
  );
}

// ---------------------------------------------------------------------------
// Shape 2: delta-report files (brand-only metadata, sectioned)
// ---------------------------------------------------------------------------

interface DeltaBrandEntry {
  brand_cn: string;
  brand_en: string;
  parent_group?: string;
  market_position?: string;
  sub_brands?: DeltaBrandEntry[];
}

interface DeltaSubBrandGroup {
  parent_brand: string;
  missing_sub_brands: { brand_cn: string; brand_en: string; note?: string }[];
}

interface DeltaStatusEntry {
  brand_cn: string;
  brand_en: string;
  status: string;
}

interface DeltaJvEntry {
  brand_cn: string;
  brand_en: string;
  jv_partners?: string;
  market_position?: string;
}

interface DeltaCommercialEntry {
  brand_cn: string;
  brand_en: string;
  parent_group?: string;
  passenger_brands?: string[];
  note?: string;
}

interface DeltaReport {
  "1_missing_brands_entirely"?: Record<string, DeltaBrandEntry[]>;
  "2_missing_sub_brands_within_existing_list"?: DeltaSubBrandGroup[];
  "3_defunct_merged_rebranded"?: Record<string, DeltaStatusEntry[]>;
  "4_joint_venture_specific_brands"?: DeltaJvEntry[];
  "5_commercial_vehicle_makers_with_passenger_cars"?: DeltaCommercialEntry[];
  [key: string]: unknown;
}

function isDeltaReport(raw: unknown): raw is DeltaReport {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && "1_missing_brands_entirely" in raw;
}

interface PendingBrand {
  brand_cn: string;
  brand_en: string;
  parent_group_raw?: string;
  status: "active" | "discontinued" | "bankrupt" | "merged";
  status_note?: string;
  market_position?: string;
}

/** Try to pull a clean brand-name pair out of a loosely-formatted "X (Y)" string. */
function parseNamePair(text: string): { brand_cn: string; brand_en: string } | undefined {
  const asciiFirst = text.match(/^([A-Za-z0-9\-\s&]+)\s*\(([^)]+)\)$/);
  if (asciiFirst && /[A-Za-z]/.test(asciiFirst[1])) {
    return { brand_en: asciiFirst[1].trim(), brand_cn: asciiFirst[2].trim() };
  }
  const cjkFirst = text.match(/^([一-龥]+)\s*\(([A-Za-z0-9\-\s&]+)\)$/);
  if (cjkFirst && /[A-Za-z]/.test(cjkFirst[2])) {
    return { brand_cn: cjkFirst[1].trim(), brand_en: cjkFirst[2].trim() };
  }
  return undefined;
}

const STATUS_CATEGORY_LABEL: Record<string, string> = {
  defunct_production_license_frozen_miit_2026: "License frozen (MIIT, 2026)",
  bankrupt_or_ceased_ev_startups: "Bankrupt/ceased operations",
  exited_china_market: "Exited China market",
};

function flattenDeltaReport(report: DeltaReport): PendingBrand[] {
  const pending: PendingBrand[] = [];

  // Section 1: new independent brands + missing sub-brands, always active.
  const section1 = report["1_missing_brands_entirely"];
  if (section1) {
    for (const entries of Object.values(section1)) {
      for (const entry of entries) {
        pending.push({
          brand_cn: entry.brand_cn,
          brand_en: entry.brand_en,
          parent_group_raw: entry.parent_group,
          status: "active",
          market_position: entry.market_position,
        });
        if (entry.sub_brands) {
          for (const sub of entry.sub_brands) {
            pending.push({
              brand_cn: sub.brand_cn,
              brand_en: sub.brand_en,
              parent_group_raw: sub.parent_group,
              status: "active",
              market_position: sub.market_position,
            });
          }
        }
      }
    }
  }

  // Section 2: sub-brands grouped by parent, always active. Duplicates entries
  // already covered in section 1 for some brands — harmless, upsert is idempotent.
  const section2 = report["2_missing_sub_brands_within_existing_list"];
  if (section2) {
    for (const group of section2) {
      for (const sub of group.missing_sub_brands) {
        pending.push({
          brand_cn: sub.brand_cn,
          brand_en: sub.brand_en,
          parent_group_raw: group.parent_brand,
          status: "active",
          market_position: sub.note,
        });
      }
    }
  }

  // Section 3: defunct / bankrupt / exited / merged. Status-bearing.
  const section3 = report["3_defunct_merged_rebranded"];
  if (section3) {
    for (const [category, entries] of Object.entries(section3)) {
      for (const entry of entries) {
        if (category === "merged_or_restructuring") {
          // Composite entries like "Avatr + Deepal" reference multiple existing
          // brands merging operations — not a new single brand, and not
          // "defunct". Skip rather than create a bogus combined brand row.
          if (entry.brand_en.includes(" + ") || entry.brand_cn.includes("+")) {
            console.warn(
              `[import] Skipping composite merger entry "${entry.brand_en}" — references multiple existing brands; update them manually if desired.`
            );
            continue;
          }
          // Single-brand restructuring note (e.g. Geely internal consolidation):
          // the brand itself is still active, just record the note. Because
          // brand fields are only ever set via $setOnInsert, this is a safe
          // no-op for brands that already exist (won't flip Geely to inactive).
          pending.push({
            brand_cn: entry.brand_cn,
            brand_en: entry.brand_en,
            status: "active",
            status_note: `Restructuring — ${entry.status}`,
          });
          continue;
        }

        const label = STATUS_CATEGORY_LABEL[category] ?? category;
        pending.push({
          brand_cn: entry.brand_cn,
          brand_en: entry.brand_en,
          status: "discontinued",
          status_note: `${label} — ${entry.status}`,
        });
      }
    }
  }

  // Section 4: JV-specific brands, active.
  const section4 = report["4_joint_venture_specific_brands"];
  if (section4) {
    for (const entry of section4) {
      pending.push({
        brand_cn: entry.brand_cn,
        brand_en: entry.brand_en,
        parent_group_raw: entry.jv_partners,
        status: "active",
        market_position: entry.market_position,
      });
    }
  }

  // Section 5: commercial makers with passenger lines, active. The maker
  // itself, plus any cleanly-name-shaped entries in `passenger_brands`.
  const section5 = report["5_commercial_vehicle_makers_with_passenger_cars"];
  if (section5) {
    for (const entry of section5) {
      pending.push({
        brand_cn: entry.brand_cn,
        brand_en: entry.brand_en,
        parent_group_raw: entry.parent_group,
        status: "active",
        market_position: entry.note,
      });

      for (const raw of entry.passenger_brands ?? []) {
        const pair = parseNamePair(raw);
        if (!pair) {
          console.warn(
            `[import] Skipping passenger_brands entry "${raw}" under ${entry.brand_en} — not a clean "Name (Name)" pair, needs manual review.`
          );
          continue;
        }
        pending.push({
          brand_cn: pair.brand_cn,
          brand_en: pair.brand_en,
          parent_group_raw: entry.brand_en,
          status: "active",
        });
      }
    }
  }

  return pending;
}

async function runDeltaImport(pending: PendingBrand[], filePath: string) {
  console.log(`Importing ${pending.length} brand entries (delta-report shape) from ${filePath}`);

  let created = 0;
  let touched = 0;

  for (const item of pending) {
    const resolved = resolveBrandName(item.brand_cn, item.brand_en);
    const { parent_group, tech_partner } = splitTechPartner(item.parent_group_raw ?? resolved.parent_group);

    const brandFields = stripUndefined({
      name_cn: item.brand_cn,
      name_en: resolved.name,
      parent_group,
      tech_partner,
      country_origin: resolved.country_origin ?? "China",
      founded_year: resolved.founded_year,
      website: resolved.website,
      status: item.status,
      status_note: item.status_note,
    });

    const before = await Brand.findOne({ name: resolved.name }).lean();
    await upsertBrand(brandFields, resolved.name);
    touched++;
    if (!before) created++;
  }

  console.log(`Done. Touched ${touched} brand refs (${created} newly created, ${touched - created} already existed and were left as-is).`);
}

// ---------------------------------------------------------------------------
// Shared helpers + entry point
// ---------------------------------------------------------------------------

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripUndefined(v as Record<string, unknown>) : v;
  }
  return out as T;
}

function loadRaw(filePath: string): unknown {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

/**
 * Scan a variant-spec file for model names that resolveModelName would fall
 * back on (unmapped, non-ASCII, no model_en override) and abort before any
 * DB connection or write happens. This is the whole point: every import so
 * far that skipped this check wrote stray Chinese-named model docs on a
 * first failed pass, requiring manual cleanup before a clean re-run. Failing
 * fast here means KNOWN_MODELS entries get added once, up front, instead of
 * insert-then-cleanup-then-retry.
 */
function preflightCheckModelNames(entries: RawVariantEntry[]): void {
  const unmapped = new Map<string, string>(); // raw name -> example model_en if any nearby entry has one

  for (const entry of entries) {
    if (!isModelNameResolvable(entry.model, entry.model_en)) {
      unmapped.set(entry.model, entry.model_en ?? "");
    }
  }

  if (unmapped.size === 0) return;

  console.error(`\n[preflight] Aborting: ${unmapped.size} model name(s) have no KNOWN_MODELS mapping and are not plain ASCII.`);
  console.error("[preflight] Add these to KNOWN_MODELS in lib/deepseekNormalize.ts, then re-run:\n");
  for (const [raw] of unmapped) {
    console.error(`  "${raw}": "",`);
  }
  console.error("\n[preflight] No brand, model, or powertrain documents were written.");
  process.exit(1);
}

/**
 * Same idea as preflightCheckModelNames, but for brand names: scans for raw
 * brand names that resolveBrandName would silently fall back on (unmapped,
 * non-ASCII, no explicit English override) and aborts before any DB
 * connection or write, instead of quietly creating a Chinese-named Brand doc.
 */
function preflightCheckBrandNames(inputs: { raw: string; explicitEnglish?: string }[]): void {
  const unmapped = new Map<string, string>();

  for (const { raw, explicitEnglish } of inputs) {
    if (!isBrandNameResolvable(raw, explicitEnglish)) {
      unmapped.set(raw, explicitEnglish ?? "");
    }
  }

  if (unmapped.size === 0) return;

  console.error(`\n[preflight] Aborting: ${unmapped.size} brand name(s) have no KNOWN_BRANDS mapping and are not plain ASCII.`);
  console.error("[preflight] Add these to KNOWN_BRANDS in lib/deepseekNormalize.ts, then re-run:\n");
  for (const [raw] of unmapped) {
    console.error(`  "${raw}": { name: "" },`);
  }
  console.error("\n[preflight] No brand, model, or powertrain documents were written.");
  process.exit(1);
}

/**
 * Guards against the exact bug that created the "Dongfeng" / "Dongfeng
 * Aeolus" duplicate pairs (see CLAUDE.md's Data model conventions section): brand resolution is purely
 * per-entry (resolveBrandName only looks at *this* entry's own brand/brand_en
 * fields), and the model upsert is scoped to `{ brand_id, name }` — so if an
 * entry's source data tags a sub-brand model generically (e.g. "东风"
 * instead of "东风风神"), it silently resolves to the wrong sibling brand
 * and inserts a fresh duplicate model doc instead of matching the existing
 * one. Requires a live DB connection (unlike the other preflight checks),
 * so it runs after mongoose.connect() but strictly before any writes.
 */
async function preflightCheckCrossBrandDuplicates(entries: RawVariantEntry[]): Promise<void> {
  const primaryRaw = detectPrimaryBrand(entries);
  const primaryBrandEn = entries.find((e) => e.brand === primaryRaw)?.brand_en;
  const primaryResolved = resolveBrandName(primaryRaw, primaryBrandEn);

  const conflicts: string[] = [];
  // Cache sibling-brand lookups per parent_group so a batch of many entries
  // for the same brand doesn't re-query Mongo per entry.
  const siblingCache = new Map<string, { _id: unknown; name: string }[]>();

  for (const entry of entries) {
    const isSubBrand = entry.brand !== primaryRaw;
    const resolved = isSubBrand ? resolveBrandName(entry.brand, entry.brand_en) : primaryResolved;
    // Prefer the *actual* Brand doc's parent_group (set at seed/taxonomy
    // time, e.g. "Dongfeng" -> "Dongfeng Motor Corporation") over
    // resolved.parent_group from the static KNOWN_BRANDS map, which is
    // frequently left unset for a group's own top-level brand entry (e.g.
    // "东风" -> { name: "Dongfeng" }, no parent_group) — exactly the case
    // that would otherwise let this check silently skip the real bug.
    const existingBrandDoc = await Brand.findOne({ name: resolved.name }, { parent_group: 1 }).lean();
    const parentGroup =
      existingBrandDoc?.parent_group ?? resolved.parent_group ?? (isSubBrand ? `${primaryResolved.name} Group` : undefined);
    // No parent_group to scope against (e.g. a genuinely standalone brand) —
    // nothing to safely compare siblings against, skip rather than risk a
    // false positive across unrelated manufacturers.
    if (!parentGroup) continue;

    let siblingBrands = siblingCache.get(parentGroup);
    if (!siblingBrands) {
      siblingBrands = await Brand.find({ parent_group: parentGroup, name: { $ne: resolved.name } }, { name: 1 }).lean();
      siblingCache.set(parentGroup, siblingBrands);
    }
    if (siblingBrands.length === 0) continue;

    const englishModelName = resolveModelName(entry.model, entry.model_en);
    // Compare against both `name` (often the local-market nameplate, e.g.
    // "Huge") and `name_en` (often the China-market/pinyin name, e.g.
    // "Dongfeng Aeolus Haoji") on both sides — the same real model can be
    // tagged inconsistently between the two, as Dongfeng Huge itself is.
    // Also try stripping the *group's* bare brand name (e.g. "Dongfeng"),
    // not just the specific sub-brand ("Dongfeng Aeolus"): sub-brand model
    // names in this dataset are inconsistently prefixed with either — the
    // existing "Dongfeng Huge" doc's own `name` field is a real example.
    const stripPrefixes = (name: string, brandNames: string[]): string => {
      for (const b of brandNames) {
        const stripped = stripLeadingBrandName(b, name);
        if (stripped !== name) return stripped.toLowerCase();
      }
      return name.toLowerCase();
    };
    const targetBrandNames = [resolved.name, primaryResolved.name];
    const targetNames = new Set(
      [englishModelName, entry.model_en].filter((n): n is string => Boolean(n)).map((n) => stripPrefixes(n, targetBrandNames))
    );

    const siblingIds = siblingBrands.map((b) => b._id);
    const candidateModels = await ModelSchema.find({ brand_id: { $in: siblingIds } }, { name: 1, name_en: 1, brand_id: 1 }).lean();
    for (const m of candidateModels) {
      const siblingBrand = siblingBrands.find((b) => String(b._id) === String(m.brand_id));
      if (!siblingBrand) continue;
      const candidateBrandNames = [siblingBrand.name, primaryResolved.name];
      const candidateNames = new Set(
        [m.name, m.name_en].filter((n): n is string => Boolean(n)).map((n) => stripPrefixes(n, candidateBrandNames))
      );
      const isMatch = [...targetNames].some((t) => candidateNames.has(t));
      if (isMatch) {
        conflicts.push(
          `"${englishModelName}" (entry brand "${entry.brand}"${entry.brand_en ? `/"${entry.brand_en}"` : ""} -> resolved "${resolved.name}") ` +
            `looks like a duplicate of existing "${m.name}" (${m._id}) under sibling brand "${siblingBrand.name}" — both in parent_group "${parentGroup}".`
        );
      }
    }
  }

  if (conflicts.length === 0) return;

  console.error(`\n[preflight] Aborting: ${conflicts.length} model(s) look like duplicates of an existing model under a sibling brand.`);
  for (const c of conflicts) console.error(`  - ${c}`);
  console.error(
    "\n[preflight] This is the exact bug that created the Dongfeng/\"Dongfeng Aeolus\" duplicate pairs — see CLAUDE.md's Data model conventions section."
  );
  console.error(
    "[preflight] If this is genuinely a new/different model, rename it to disambiguate from the sibling. If it should attach to\n" +
      "the existing sibling brand instead, fix this entry's brand/brand_en so resolveBrandName resolves to that brand."
  );
  console.error("\n[preflight] No brand, model, or powertrain documents were written.");
  process.exit(1);
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run import -- <path-to-json-file>");
    process.exit(1);
  }

  const raw = loadRaw(filePath);

  let pendingDelta: PendingBrand[] | undefined;

  if (Array.isArray(raw)) {
    const entries = raw as RawVariantEntry[];
    preflightCheckModelNames(entries);
    preflightCheckBrandNames(entries.map((e) => ({ raw: e.brand, explicitEnglish: e.brand_en })));
  } else if (isDeltaReport(raw)) {
    pendingDelta = flattenDeltaReport(raw);
    preflightCheckBrandNames(pendingDelta.map((p) => ({ raw: p.brand_cn, explicitEnglish: p.brand_en })));
  }

  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB.");

  if (Array.isArray(raw)) {
    await preflightCheckCrossBrandDuplicates(raw as RawVariantEntry[]);
    await runVariantImport(raw as RawVariantEntry[], filePath);
  } else if (pendingDelta) {
    await runDeltaImport(pendingDelta, filePath);
  } else {
    throw new Error(
      "Unrecognized input shape: expected either an array of model entries or a delta-report object with a '1_missing_brands_entirely' section."
    );
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
