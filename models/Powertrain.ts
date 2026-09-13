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
const RANGE_STANDARDS = ["CLTC", "WLTP", "WLTC", "NEDC"];
const CONFIDENCE_VALUES = ["confirmed", "unconfirmed"];
const ASPIRATION_VALUES = ["turbo", "naturally-aspirated", "supercharged", "twin-charged", "n/a"];
const FUEL_TYPE_VALUES = ["gasoline", "diesel", "n/a"];
const BATTERY_CHEMISTRY_VALUES = ["LFP", "NMC", "LTO", "semi-solid-state", "other"];

const EngineDetailsSchema = new Schema(
  {
    displacement_l: Number,
    cylinders: Number,
    aspiration: { type: String, enum: ASPIRATION_VALUES },
    fuel_type: { type: String, enum: FUEL_TYPE_VALUES },
    is_range_extender: Boolean,
    power_kw: Number,
    torque_nm: Number,
    confidence: { type: String, enum: CONFIDENCE_VALUES },
  },
  { _id: false }
);

const ElectricMotorDetailsSchema = new Schema(
  {
    type: String,
    power_kw: Number,
    torque_nm: Number,
    count: { type: String, enum: MOTOR_COUNTS },
    drive: { type: String, enum: DRIVE_TYPES },
    note: String,
    confidence: { type: String, enum: CONFIDENCE_VALUES },
  },
  { _id: false }
);

const BatteryDetailsSchema = new Schema(
  {
    chemistry: { type: String, enum: BATTERY_CHEMISTRY_VALUES },
    battery_variant: String,
    capacity_total_kwh: Number,
    capacity_usable_kwh: Number,
    supplier: String,
    dc_charge_kw: Number,
    ac_charge_kw: Number,
    ev_range_km: Number,
    ev_range_standard: { type: String, enum: RANGE_STANDARDS },
    confidence: { type: String, enum: CONFIDENCE_VALUES },
  },
  { _id: false }
);

const TransmissionSchema = new Schema(
  {
    type: { type: String, enum: GEARBOX_TYPES },
    speed_count: Number,
    confidence: { type: String, enum: CONFIDENCE_VALUES },
  },
  { _id: false }
);

const PerformanceSchema = new Schema(
  {
    accel_0_100_s: Number,
    top_speed_kmh: Number,
    confidence: { type: String, enum: CONFIDENCE_VALUES },
  },
  { _id: false }
);

const PowertrainSchema = new Schema<PowertrainDoc>(
  {
    model_id: { type: Schema.Types.ObjectId, ref: "Model", required: true },
    trim_name: { type: String, required: true },
    energy_type: { type: String, enum: ENERGY_TYPES, required: true },
    engine: { type: EngineDetailsSchema },
    motor: { type: ElectricMotorDetailsSchema },
    battery: { type: BatteryDetailsSchema },
    transmission: { type: TransmissionSchema },
    performance: { type: PerformanceSchema },
    combined_range_km: { type: Number },
    combined_range_note: { type: String },
    source: { type: String },
    confidence: { type: String, enum: CONFIDENCE_VALUES },
    unverified: { type: Boolean, default: false },
    /** Set only by lib/applySpecUpdates.ts, only when a write is verified as actually applied — see the comment on IPowertrain.last_researched_at in types/index.ts. */
    last_researched_at: { type: Date },
  },
  { timestamps: true }
);

PowertrainSchema.index({ model_id: 1 });

// See the matching comment in models/Model.ts: `models.Powertrain || model(...)`
// reuses whatever schema is already cached in mongoose's process-global
// registry, and Next.js Fast Refresh does not clear that cache in dev — a
// field added here needs a full dev-server restart before writes to it will
// actually persist, or they silently no-op under strict mode.
export default models.Powertrain || model<PowertrainDoc>("Powertrain", PowertrainSchema);
