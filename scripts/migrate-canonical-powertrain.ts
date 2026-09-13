// One-time migration: renames existing Powertrain sub-document fields to the
// canonical shape in types/canonicalPowertrain.ts (engine/motor/battery with
// unprefixed subfields). Safe to run multiple times — already-migrated docs
// (no old-shaped keys present) are skipped.
//
// Usage: npm run migrate-canonical-powertrain

import dotenv from "dotenv";
dotenv.config({ path: [".env.local", ".env"], quiet: true });
import mongoose from "mongoose";
import Powertrain from "../models/Powertrain";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

const ENGINE_RENAMES: Record<string, string> = {
  max_torque_nm: "torque_nm",
};

const MOTOR_RENAMES: Record<string, string> = {
  motor_type: "type",
  motor_power_kw: "power_kw",
  motor_torque_nm: "torque_nm",
  motor_count: "count",
  drive_type: "drive",
};

const BATTERY_RENAMES: Record<string, string> = {
  battery_chemistry: "chemistry",
  battery_capacity_total_kwh: "capacity_total_kwh",
  battery_capacity_usable_kwh: "capacity_usable_kwh",
  battery_supplier: "supplier",
  charging_speed_dc_kw: "dc_charge_kw",
  charging_speed_ac_kw: "ac_charge_kw",
  electric_range_km: "ev_range_km",
  range_standard: "ev_range_standard",
};

/** Rebuild a sub-document with old keys renamed to new ones (dropping any key not in the map or already correct). */
function renameKeys(block: Record<string, unknown>, renames: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block)) {
    const newKey = renames[key] ?? key;
    out[newKey] = value;
  }
  return out;
}

async function run() {
  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB. Running canonical powertrain migration...\n");

  const docs = await Powertrain.collection.find({}).toArray();
  let updated = 0;

  for (const doc of docs) {
    const engineSrc = (doc.engine ?? doc.engine_details) as Record<string, unknown> | undefined;
    const motorSrc = (doc.motor ?? doc.electric_motor_details) as Record<string, unknown> | undefined;
    const batterySrc = (doc.battery ?? doc.battery_details) as Record<string, unknown> | undefined;

    const needsMigration =
      doc.engine_details !== undefined ||
      doc.electric_motor_details !== undefined ||
      doc.battery_details !== undefined ||
      (engineSrc && "max_power_hp" in engineSrc) ||
      (engineSrc && "max_torque_nm" in engineSrc) ||
      (motorSrc && Object.keys(MOTOR_RENAMES).some((k) => k in motorSrc)) ||
      (batterySrc && Object.keys(BATTERY_RENAMES).some((k) => k in batterySrc));

    if (!needsMigration) continue;

    const set: Record<string, unknown> = {};
    const unset: Record<string, ""> = { engine_details: "", electric_motor_details: "", battery_details: "" };

    if (engineSrc) {
      const { max_power_hp: _drop, ...rest } = engineSrc;
      set.engine = renameKeys(rest, ENGINE_RENAMES);
    }
    if (motorSrc) {
      set.motor = renameKeys(motorSrc, MOTOR_RENAMES);
    }
    if (batterySrc) {
      set.battery = renameKeys(batterySrc, BATTERY_RENAMES);
    }

    await Powertrain.collection.updateOne({ _id: doc._id }, { $set: set, $unset: unset });
    updated++;
  }

  console.log(`Powertrains: migrated ${updated}/${docs.length} to canonical field names.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
