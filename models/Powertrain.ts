import { Schema, model, models, Types } from "mongoose";
import type { IPowertrain } from "@/types";

type PowertrainDoc = Omit<IPowertrain, "model_id"> & { model_id: Types.ObjectId };

const ENERGY_TYPES = ["ICE", "HEV", "PHEV", "BEV", "REEV/EREV", "MHEV"];
const DRIVE_TYPES = ["FWD", "RWD", "AWD"];
const MOTOR_COUNTS = ["single", "dual", "tri-motor", "quad-motor"];
const GEARBOX_TYPES = [
  "single-speed reducer",
  "CVT",
  "DCT",
  "AT",
  "MT",
  "AMT",
  "multi-speed EV transmission",
];
const RANGE_STANDARDS = ["CLTC", "WLTP", "NEDC"];

const EngineDetailsSchema = new Schema(
  {
    displacement_l: Number,
    cylinders: Number,
    fuel_type: String,
    max_power_hp: Number,
    max_torque_nm: Number,
  },
  { _id: false }
);

const ElectricMotorDetailsSchema = new Schema(
  {
    motor_type: String,
    motor_power_kw: Number,
    motor_torque_nm: Number,
    motor_count: { type: String, enum: MOTOR_COUNTS },
    drive_type: { type: String, enum: DRIVE_TYPES },
    note: String,
  },
  { _id: false }
);

const BatteryDetailsSchema = new Schema(
  {
    battery_chemistry: String,
    battery_variant: String,
    battery_capacity_total_kwh: Number,
    battery_capacity_usable_kwh: Number,
    battery_supplier: String,
    charging_speed_dc_kw: Number,
    charging_speed_ac_kw: Number,
    electric_range_km: Number,
    range_standard: { type: String, enum: RANGE_STANDARDS },
  },
  { _id: false }
);

const PowertrainSchema = new Schema<PowertrainDoc>(
  {
    model_id: { type: Schema.Types.ObjectId, ref: "Model", required: true },
    trim_name: { type: String, required: true },
    energy_type: { type: String, enum: ENERGY_TYPES, required: true },
    engine_details: { type: EngineDetailsSchema },
    electric_motor_details: { type: ElectricMotorDetailsSchema },
    battery_details: { type: BatteryDetailsSchema },
    gearbox: { type: String, enum: GEARBOX_TYPES },
    gearbox_gears: { type: Number },
    combined_range_km: { type: Number },
    combined_range_note: { type: String },
    accel_0_100_kmh_s: { type: Number },
    top_speed_kmh: { type: Number },
    unverified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

PowertrainSchema.index({ model_id: 1 });

export default models.Powertrain || model<PowertrainDoc>("Powertrain", PowertrainSchema);
