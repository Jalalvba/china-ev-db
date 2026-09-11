export type Segment =
  | "A-segment/City"
  | "B-segment/Compact"
  | "C-segment/Mid-size"
  | "D-segment/Large"
  | "SUV-compact"
  | "SUV-mid"
  | "SUV-full"
  | "MPV"
  | "Pickup"
  | "Sports";

export type ProductionStatus = "in production" | "discontinued" | "upcoming";

export type EnergyType = "ICE" | "HEV" | "PHEV" | "BEV" | "REEV/EREV" | "MHEV";

export type DriveType = "FWD" | "RWD" | "AWD";

export type MotorCount = "single" | "dual" | "tri-motor" | "quad-motor";

export type GearboxType =
  | "single-speed reducer"
  | "CVT"
  | "DCT"
  | "AT"
  | "MT"
  | "AMT"
  | "multi-speed EV transmission";

export type RangeStandard = "CLTC" | "WLTP" | "NEDC";

export type BrandStatus = "active" | "discontinued" | "bankrupt" | "merged";

export type Confidence = "confirmed" | "unconfirmed";

export interface IBrand {
  _id?: string;
  name: string;
  /** Original-language (typically Chinese) name, kept alongside the canonical English `name`. */
  name_cn?: string;
  /** English name — usually identical to `name`, kept as an explicit canonical field per the DeepSeek schema. */
  name_en?: string;
  logo_url?: string;
  parent_group?: string;
  tech_partner?: string;
  country_origin: string;
  founded_year?: number;
  website?: string;
  status?: BrandStatus;
  status_note?: string;
}

export interface IPriceRange {
  min?: number;
  max?: number;
  currency_local: string;
  min_usd?: number;
  max_usd?: number;
  unverified?: boolean;
}

export interface IModel {
  _id?: string;
  brand_id: string;
  name: string;
  /** Original-language (typically Chinese) model name. */
  name_cn?: string;
  /** English model name — usually identical to `name`. */
  name_en?: string;
  generation?: string;
  year?: number;
  segment: Segment;
  body_type: string;
  price_range?: IPriceRange;
  production_status: ProductionStatus;
  unverified?: boolean;
}

export interface IEngineDetails {
  displacement_l?: number;
  cylinders?: number;
  /** Discrete induction type, e.g. "turbo" | "naturally aspirated" — kept separate from fuel_type. */
  induction?: string;
  fuel_type?: string;
  power_kw?: number;
  max_power_hp?: number;
  max_torque_nm?: number;
  confidence?: Confidence;
}

export interface IElectricMotorDetails {
  motor_type?: string;
  motor_power_kw?: number;
  motor_torque_nm?: number;
  motor_count?: MotorCount;
  drive_type?: DriveType;
  /** Free-text caveat, e.g. when power/torque figures are reported as system-level rather than motor-only. */
  note?: string;
  confidence?: Confidence;
}

export interface IBatteryDetails {
  battery_chemistry?: string;
  battery_variant?: string;
  battery_capacity_total_kwh?: number;
  battery_capacity_usable_kwh?: number;
  battery_supplier?: string;
  charging_speed_dc_kw?: number;
  charging_speed_ac_kw?: number;
  electric_range_km?: number;
  range_standard?: RangeStandard;
  confidence?: Confidence;
}

export interface ITransmission {
  type?: GearboxType;
  gears?: number;
  confidence?: Confidence;
}

export interface IPerformance {
  accel_0_100_s?: number;
  top_speed_kmh?: number;
  confidence?: Confidence;
}

export interface IPowertrain {
  _id?: string;
  model_id: string;
  trim_name: string;
  energy_type: EnergyType;
  engine_details?: IEngineDetails;
  electric_motor_details?: IElectricMotorDetails;
  battery_details?: IBatteryDetails;
  transmission?: ITransmission;
  performance?: IPerformance;
  combined_range_km?: number;
  /** Free-text caveat about combined_range_km, e.g. a suspected source mislabeling of the test standard. */
  combined_range_note?: string;
  /** Attribution, e.g. "Autohome / Dongchedi". */
  source?: string;
  unverified?: boolean;
}
