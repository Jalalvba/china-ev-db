// One-time migration: restructures every existing Brand/Model/Powertrain doc
// to match the canonical DeepSeek schema (see the schema-audit conversation).
// Safe to run multiple times (idempotent — already-migrated docs are skipped).
//
// Usage: npm run migrate-schema

import "dotenv/config";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

async function migrateBrands() {
  const brands = await Brand.find({}).lean();
  let updated = 0;
  for (const b of brands) {
    if (b.name_en) continue; // already migrated
    await Brand.updateOne({ _id: b._id }, { $set: { name_en: b.name } });
    updated++;
  }
  console.log(`Brands: set name_en on ${updated}/${brands.length} (name_cn left unset where unknown — not guessed).`);
}

async function migrateModels() {
  const models = await ModelSchema.find({}).lean();
  let nameUpdated = 0;
  let priceUpdated = 0;

  for (const m of models) {
    const set: Record<string, unknown> = {};
    const unset: Record<string, "" > = {};

    if (!m.name_en) {
      set.name_en = m.name;
      nameUpdated++;
    }

    const pr = m.price_range as Record<string, unknown> | undefined;
    if (pr && (pr.min_local !== undefined || pr.max_local !== undefined)) {
      if (pr.min === undefined && pr.min_local !== undefined) set["price_range.min"] = pr.min_local;
      if (pr.max === undefined && pr.max_local !== undefined) set["price_range.max"] = pr.max_local;
      unset["price_range.min_local"] = "";
      unset["price_range.max_local"] = "";
      priceUpdated++;
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue;

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    // strict:false — Mongoose otherwise silently drops $unset on paths no
    // longer declared in the schema (min_local/max_local were removed).
    await ModelSchema.updateOne({ _id: m._id }, update, { strict: false });
  }
  console.log(`Models: set name_en on ${nameUpdated}/${models.length}, restructured price_range on ${priceUpdated}.`);
}

const INDUCTION_SUFFIX = /^Gasoline \(([^)]+)\)$/;

async function migratePowertrains() {
  const powertrains = await Powertrain.find({}).lean();
  let transmissionMoved = 0;
  let performanceMoved = 0;
  let inductionSplit = 0;

  for (const p of powertrains) {
    const doc = p as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = {};

    // gearbox/gearbox_gears -> transmission { type, gears }
    if (doc.gearbox !== undefined || doc.gearbox_gears !== undefined) {
      if (doc.transmission === undefined) {
        set.transmission = {
          type: doc.gearbox,
          gears: doc.gearbox_gears,
        };
      }
      unset.gearbox = "";
      unset.gearbox_gears = "";
      transmissionMoved++;
    }

    // accel_0_100_kmh_s/top_speed_kmh -> performance { accel_0_100_s, top_speed_kmh }
    if (doc.accel_0_100_kmh_s !== undefined || doc.top_speed_kmh !== undefined) {
      if (doc.performance === undefined) {
        set.performance = {
          accel_0_100_s: doc.accel_0_100_kmh_s,
          top_speed_kmh: doc.top_speed_kmh,
        };
      }
      unset.accel_0_100_kmh_s = "";
      unset.top_speed_kmh = "";
      performanceMoved++;
    }

    // engine_details.fuel_type "Gasoline (turbo)" -> induction: "turbo", fuel_type: "Gasoline"
    const engine = doc.engine_details as Record<string, unknown> | undefined;
    if (engine?.fuel_type && typeof engine.fuel_type === "string" && !engine.induction) {
      const m = engine.fuel_type.match(INDUCTION_SUFFIX);
      if (m) {
        set["engine_details.induction"] = m[1];
        set["engine_details.fuel_type"] = "Gasoline";
        inductionSplit++;
      }
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) continue;

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    await Powertrain.updateOne({ _id: p._id }, update, { strict: false });
  }

  console.log(
    `Powertrains: moved ${transmissionMoved} to transmission{}, ${performanceMoved} to performance{}, split induction out of fuel_type on ${inductionSplit}.`
  );
}

async function run() {
  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB. Running schema migration...\n");

  await migrateBrands();
  await migrateModels();
  await migratePowertrains();

  console.log("\nDone.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
