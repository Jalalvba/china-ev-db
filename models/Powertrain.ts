import { Schema, model, models, Types } from "mongoose";
import type { IPowertrain } from "@/types";

type PowertrainDoc = Omit<IPowertrain, "model_id"> & { model_id: Types.ObjectId };

const ENERGY_TYPES = ["ICE", "HEV", "PHEV", "BEV", "REEV/EREV", "MHEV"];
const DRIVE_TYPES = ["FWD", "RWD", "AWD", "4WD"];
/** Distinct from energy_type (ICE/HEV/PHEV/BEV/REEV-EREV/MHEV, the powertrain's fundamental architecture) — this is a coarser, hybrid-specific classification some sources use. Deliberately kept as its own field rather than aliased to energy_type per the exact filter spec that requested it as a separate axis; expect heavy overlap with energy_type in practice, and expect this to be sparsely populated until a research pass explicitly asks for it. */
const HYBRID_TYPES = ["HEV", "PHEV", "EREV", "Mild hybrid", "Not applicable"];
const EMISSIONS_STANDARDS = ["Euro 5", "Euro 6", "Euro 6d", "China 5", "China 6"];
const HYBRID_ARCHITECTURES = ["parallel", "series_erev", "power_split", "mild"];
const MOTOR_COUNTS = ["single", "dual", "tri-motor", "quad-motor"];
const GEARBOX_TYPES = [
  "single-speed reducer",
  "CVT",
  "DCT",
  "AT",
  "MT",
  "AMT",
  "multi-speed EV transmission",
  "E-CVT",
];
const RANGE_STANDARDS = ["CLTC", "WLTP", "WLTC", "NEDC"];
const CONFIDENCE_VALUES = ["confirmed", "unconfirmed"];
const ASPIRATION_VALUES = ["turbo", "naturally-aspirated", "supercharged", "twin-charged", "n/a"];
const FUEL_TYPE_VALUES = ["gasoline", "diesel", "n/a"];
const BATTERY_CHEMISTRY_VALUES = ["LFP", "NMC", "LTO", "semi-solid-state", "other"];
const COOLING_TIER_VALUES = [0, 1, 2, 3, 4];

const EngineDetailsSchema = new Schema(
  {
    displacement_l: Number,
    cylinders: Number,
    aspiration: { type: String, enum: ASPIRATION_VALUES },
    fuel_type: { type: String, enum: FUEL_TYPE_VALUES },
    is_range_extender: Boolean,
    power_kw: Number,
    torque_nm: Number,
    adblue_required: Boolean,
    dpf_present: Boolean,
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

// Tier definitions — see the matching comment on ICanonicalThermalManagement
// in types/canonicalPowertrain.ts: 0=passive air, 1=active air, 2=active
// liquid (Morocco minimum), 3=refrigerant-coupled/heat pump (recommended),
// 4=hybrid intelligent/PCM (best).
const ThermalManagementSchema = new Schema(
  {
    cooling_tier: { type: Number, enum: COOLING_TIER_VALUES },
    has_liquid_cooling: Boolean,
    has_heat_pump: Boolean,
    morocco_suitable: Boolean,
    thermal_evidence: String,
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
    thermal_management: { type: ThermalManagementSchema },
    transmission: { type: TransmissionSchema },
    performance: { type: PerformanceSchema },
    combined_range_km: { type: Number },
    combined_range_note: { type: String },
    /** Combined ICE+motor system output — only meaningful for a hybrid (HEV/PHEV/REEV); left unset for a pure ICE or pure BEV trim rather than backfilled with engine_kw+motor_kw, since that arithmetic sum isn't always the real published system figure. */
    combined_system_power_kw: { type: Number },
    hybrid_type: { type: String, enum: HYBRID_TYPES },
    hybrid_architecture: { type: String, enum: HYBRID_ARCHITECTURES },
    hybrid_system_name: { type: String },
    architecture_unverified: { type: Boolean },
    emissions_standard: { type: String, enum: EMISSIONS_STANDARDS },
    trim_price_min: { type: Number },
    trim_price_max: { type: Number },
    trim_price_currency: { type: String },
    trim_price_confidence: { type: String, enum: CONFIDENCE_VALUES },
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
