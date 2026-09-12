// Single source of truth for the Powertrain document shape. Both the Mongoose
// schema (models/Powertrain.ts) and any script that writes Powertrain data
// (e.g. an AI spec-population agent) must conform to these interfaces rather
// than assume field names independently.

import type {
  Confidence,
  DriveType,
  MotorCount,
  GearboxType,
  RangeStandard,
  EnergyType,
  AspirationType,
  FuelType,
  BatteryChemistry,
} from "./index";

export const ENERGY_TYPE_VALUES: EnergyType[] = ["ICE", "HEV", "PHEV", "BEV", "REEV/EREV", "MHEV"];
export const DRIVE_TYPE_VALUES: DriveType[] = ["FWD", "RWD", "AWD"];
export const MOTOR_COUNT_VALUES: MotorCount[] = ["single", "dual", "tri-motor", "quad-motor"];
export const GEARBOX_TYPE_VALUES: GearboxType[] = [
  "single-speed reducer",
  "CVT",
  "DCT",
  "AT",
  "MT",
  "AMT",
  "multi-speed EV transmission",
];
export const RANGE_STANDARD_VALUES: RangeStandard[] = ["CLTC", "WLTP", "NEDC"];
export const CONFIDENCE_VALUES: Confidence[] = ["confirmed", "unconfirmed"];
export const ASPIRATION_VALUES: AspirationType[] = ["turbo", "naturally-aspirated", "supercharged", "twin-charged", "n/a"];
export const FUEL_TYPE_VALUES: FuelType[] = ["gasoline", "diesel", "n/a"];
export const BATTERY_CHEMISTRY_VALUES: BatteryChemistry[] = ["LFP", "NMC", "LTO", "semi-solid-state", "other"];

export interface ICanonicalEngine {
  displacement_l?: number;
  cylinders?: number;
  /** Discrete induction type. "n/a" for a non-ICE trim's engine block (rare — usually there's no engine block at all instead). */
  aspiration?: AspirationType;
  fuel_type?: FuelType;
  /** Orthogonal to fuel_type on purpose — a REEV/EREV's engine is still `fuel_type: "gasoline"`, this just flags that it drives a generator rather than the wheels directly. Kept independent so a price-prediction model can weigh it as its own feature rather than a compound fuel_type bucket. */
  is_range_extender?: boolean;
  power_kw?: number;
  torque_nm?: number;
  confidence?: Confidence;
}

export interface ICanonicalMotor {
  type?: string;
  power_kw?: number;
  torque_nm?: number;
  count?: MotorCount;
  drive?: DriveType;
  /** Free-text caveat, e.g. when power/torque figures are reported as system-level rather than motor-only. */
  note?: string;
  confidence?: Confidence;
}

export interface ICanonicalBattery {
  chemistry?: BatteryChemistry;
  /** Proprietary product name / sub-variant detail, e.g. "Blade", "800V", "2nd gen" — already the home for exactly this kind of qualifier, so the migration folds the old free-text chemistry parenthetical (e.g. "LFP (Blade, 2nd gen)" -> chemistry: "LFP", battery_variant: "Blade, 2nd gen") in here rather than adding a second overlapping field. */
  battery_variant?: string;
  capacity_total_kwh?: number;
  capacity_usable_kwh?: number;
  supplier?: string;
  dc_charge_kw?: number;
  ac_charge_kw?: number;
  ev_range_km?: number;
  ev_range_standard?: RangeStandard;
  confidence?: Confidence;
}

export interface ICanonicalTransmission {
  type?: GearboxType;
  speed_count?: number;
  confidence?: Confidence;
}

export interface ICanonicalPerformance {
  accel_0_100_s?: number;
  top_speed_kmh?: number;
  confidence?: Confidence;
}

export interface ICanonicalPowertrain {
  _id?: string;
  model_id: string;
  trim_name: string;
  energy_type: EnergyType;
  engine?: ICanonicalEngine;
  motor?: ICanonicalMotor;
  battery?: ICanonicalBattery;
  transmission?: ICanonicalTransmission;
  performance?: ICanonicalPerformance;
  combined_range_km?: number;
  /** Free-text caveat about combined_range_km, e.g. a suspected source mislabeling of the test standard. */
  combined_range_note?: string;
  /** Attribution, e.g. "Autohome / Dongchedi". */
  source?: string;
  /** Top-level confidence for the powertrain record as a whole, distinct from each sub-block's own confidence. */
  confidence?: Confidence;
  unverified?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime field template, for prompt-building and response validation. Kept
// in this file (not duplicated in the agent script) so it can only ever
// describe the interfaces above — see the compile-time drift guard below.
// ---------------------------------------------------------------------------

/** One canonical powertrain variant, described field-by-field for embedding literally into an LLM prompt. Every key here must exactly match a key of ICanonicalPowertrain (or a nested block interface) — see TemplateKeysMatchSchema. */
export const CANONICAL_POWERTRAIN_FIELD_TEMPLATE = {
  trim_name: "string",
  energy_type: ENERGY_TYPE_VALUES.join(" | "),
  engine: {
    displacement_l: "number | null",
    cylinders: "number | null",
    aspiration: ASPIRATION_VALUES.join(" | ") + " | null",
    fuel_type: FUEL_TYPE_VALUES.join(" | ") + " | null",
    is_range_extender: "boolean | null (true only for a REEV/EREV whose engine drives a generator, not the wheels — independent of fuel_type)",
    power_kw: "number | null",
    torque_nm: "number | null",
    confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
  },
  motor: {
    type: "string | null (e.g. \"PMSM\")",
    power_kw: "number | null",
    torque_nm: "number | null",
    count: MOTOR_COUNT_VALUES.join(" | ") + " | null",
    drive: DRIVE_TYPE_VALUES.join(" | ") + " | null",
    note: "string | null",
    confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
  },
  battery: {
    chemistry: BATTERY_CHEMISTRY_VALUES.join(" | ") + " | null",
    battery_variant: "string | null (proprietary product name / sub-variant detail, e.g. \"Blade\", \"800V\", \"2nd gen\")",
    capacity_total_kwh: "number | null",
    capacity_usable_kwh: "number | null",
    supplier: "string | null",
    dc_charge_kw: "number | null",
    ac_charge_kw: "number | null",
    ev_range_km: "number | null",
    ev_range_standard: RANGE_STANDARD_VALUES.join(" | ") + " | null",
    confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
  },
  transmission: {
    type: GEARBOX_TYPE_VALUES.join(" | ") + " | null",
    speed_count: "number | null",
    confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
  },
  performance: {
    accel_0_100_s: "number | null",
    top_speed_kmh: "number | null",
    confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
  },
  combined_range_km: "number | null",
  combined_range_note: "string | null",
  source: "string | null (e.g. \"Autohome\", \"official manufacturer site\")",
  confidence: CONFIDENCE_VALUES.join(" | ") + " | null",
} as const;

type KeysEqual<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
type Expect<T extends true> = T;

// If a field is ever renamed/added/removed on ICanonicalPowertrain or one of
// its nested block interfaces without updating CANONICAL_POWERTRAIN_FIELD_TEMPLATE
// above, one of these fails to type-check — catching prompt/schema drift at
// build time (`npx tsc --noEmit`) instead of silently at review time.
type _CheckTopLevelKeys = Expect<
  KeysEqual<typeof CANONICAL_POWERTRAIN_FIELD_TEMPLATE, Required<Omit<ICanonicalPowertrain, "_id" | "model_id" | "unverified">>>
>;
type _CheckEngineKeys = Expect<KeysEqual<typeof CANONICAL_POWERTRAIN_FIELD_TEMPLATE.engine, Required<ICanonicalEngine>>>;
type _CheckMotorKeys = Expect<KeysEqual<typeof CANONICAL_POWERTRAIN_FIELD_TEMPLATE.motor, Required<ICanonicalMotor>>>;
type _CheckBatteryKeys = Expect<KeysEqual<typeof CANONICAL_POWERTRAIN_FIELD_TEMPLATE.battery, Required<ICanonicalBattery>>>;
type _CheckTransmissionKeys = Expect<
  KeysEqual<typeof CANONICAL_POWERTRAIN_FIELD_TEMPLATE.transmission, Required<ICanonicalTransmission>>
>;
type _CheckPerformanceKeys = Expect<
  KeysEqual<typeof CANONICAL_POWERTRAIN_FIELD_TEMPLATE.performance, Required<ICanonicalPerformance>>
>;
