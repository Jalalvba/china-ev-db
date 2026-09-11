// Reusable importer for "deepseek-style" raw spec JSON files (see
// deepseek_json_20260911_6957cc.json for the reference shape).
//
// Usage:
//   npm run import -- raw-data/geely.json
//
// - Auto-detects brand / sub-brand grouping from the `brand` field on each entry
//   (the most frequent brand in the file is treated as primary; others become
//   sub-brands with parent_group `${primary} Group`, unless KNOWN_BRANDS in
//   lib/deepseekNormalize.ts already says otherwise).
// - Normalizes Chinese names, 万-denominated prices, range-standard typos
//   (WLTC -> WLTP), transmission naming, etc. via lib/deepseekNormalize.ts.
// - Upserts into MongoDB: existing brands are never overwritten (only filled in
//   via $setOnInsert), existing models/powertrains are matched by name/trim and
//   updated in place, new ones are inserted. Nothing is deleted.

import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";
import {
  resolveBrandName,
  resolveModelName,
  parsePriceRange,
  parseDcKw,
  parseCombinedRange,
  num,
  kwToHp,
  correctRangeStandard,
  correctGearbox,
  motorCountFromNumber,
  guessSegment,
  assertValidSegment,
} from "../lib/deepseekNormalize";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

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
    max_power_hp?: number;
    max_torque_nm?: number;
  }) | null;
  motor?: (RawDetailBlock & {
    type?: string;
    power_kw?: number;
    torque_nm?: number;
    count?: number;
    drive?: string;
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
  }) | null;
  transmission?: { type?: string; gears?: number | string };
  performance?: { accel_0_100_s?: number; top_speed_kmh?: number };
  confidence?: string;
}

interface RawEntry {
  brand: string;
  model: string;
  model_en?: string;
  generation?: string;
  segment?: string;
  body?: string;
  price_rmb_range?: string;
  production_status?: string;
  variants: RawVariant[];
}

function loadEntries(filePath: string): RawEntry[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("Expected the input JSON to be an array of model entries.");
  }
  return raw as RawEntry[];
}

function detectPrimaryBrand(entries: RawEntry[]): string {
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

function normalizeVariant(v: RawVariant) {
  const engine = v.engine
    ? {
        displacement_l: num(v.engine.displacement_l),
        cylinders: num(v.engine.cylinders),
        fuel_type: v.engine.induction ? `Gasoline (${v.engine.induction})` : "Gasoline",
        max_power_hp: num(v.engine.max_power_hp) ?? kwToHp(num(v.engine.max_power_kw)),
        max_torque_nm: num(v.engine.max_torque_nm),
      }
    : undefined;

  const motor = v.motor
    ? {
        motor_type: v.motor.type?.toLowerCase().includes("induction") ? "Induction" : "PMSM",
        motor_power_kw: num(v.motor.power_kw),
        motor_torque_nm: num(v.motor.torque_nm),
        motor_count: motorCountFromNumber(v.motor.count),
        drive_type: v.motor.drive,
      }
    : undefined;

  const battery = v.battery
    ? {
        battery_chemistry: v.battery.chemistry,
        battery_capacity_total_kwh: num(v.battery.capacity_total_kwh),
        battery_capacity_usable_kwh: num(v.battery.capacity_usable_kwh),
        battery_supplier: v.battery.supplier,
        charging_speed_dc_kw: parseDcKw(v.battery.dc_charge_kw),
        charging_speed_ac_kw: parseDcKw(v.battery.ac_charge_kw),
        electric_range_km: num(v.battery.ev_range_km),
        range_standard: correctRangeStandard(v.battery.ev_range_standard),
      }
    : undefined;

  const gearbox = v.transmission?.type ? correctGearbox(v.transmission.type) : undefined;
  const gearbox_gears = typeof v.transmission?.gears === "number" ? v.transmission.gears : gearbox ? 1 : undefined;

  const energy_type = v.powertrain?.startsWith("PHEV") ? "PHEV" : v.powertrain;

  const isUnverified = v.confidence === "unconfirmed";

  return {
    trim_name: v.trim,
    energy_type,
    engine_details: engine,
    electric_motor_details: motor,
    battery_details: battery,
    gearbox,
    gearbox_gears,
    combined_range_km: parseCombinedRange(v.battery?.combined_range_km),
    accel_0_100_kmh_s: num(v.performance?.accel_0_100_s),
    top_speed_kmh: num(v.performance?.top_speed_kmh),
    unverified: isUnverified,
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripUndefined(v as Record<string, unknown>) : v;
  }
  return out as T;
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run import -- <path-to-json-file>");
    process.exit(1);
  }

  const entries = loadEntries(filePath);
  const primaryRaw = detectPrimaryBrand(entries);
  const primaryResolved = resolveBrandName(primaryRaw);

  await mongoose.connect(MONGODB_URI as string);
  console.log(`Connected to MongoDB. Importing ${entries.length} model entries from ${filePath}`);

  let brandsTouched = 0;
  let modelsUpserted = 0;
  let powertrainsUpserted = 0;

  for (const entry of entries) {
    const isSubBrand = entry.brand !== primaryRaw;
    const resolved = isSubBrand ? resolveBrandName(entry.brand) : primaryResolved;
    const brandFields = stripUndefined({
      name: resolved.name,
      parent_group: resolved.parent_group ?? (isSubBrand ? `${primaryResolved.name} Group` : undefined),
      country_origin: "China",
      founded_year: resolved.founded_year,
      website: resolved.website,
    });

    // Never overwrite an existing brand's fields — only fill in on first insert.
    const brand = await Brand.findOneAndUpdate(
      { name: resolved.name },
      { $setOnInsert: brandFields },
      { upsert: true, returnDocument: "after" }
    );
    brandsTouched++;

    const englishModelName = resolveModelName(entry.model, entry.model_en);
    const segment = assertValidSegment(guessSegment(entry.segment, entry.body));
    const price_range = parsePriceRange(entry.price_rmb_range);

    const modelFields = stripUndefined({
      generation: entry.generation,
      segment,
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
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
