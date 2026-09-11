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

export interface IBrand {
  _id?: string;
  name: string;
  logo_url?: string;
  parent_group?: string;
  country_origin: string;
  founded_year?: number;
  website?: string;
}

export interface IPriceRange {
  min_local?: number;
  max_local?: number;
  currency_local: string;
  min_usd?: number;
  max_usd?: number;
}

export interface IModel {
  _id?: string;
  brand_id: string;
  name: string;
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
  fuel_type?: string;
  max_power_hp?: number;
  max_torque_nm?: number;
}

export interface IElectricMotorDetails {
  motor_type?: string;
  motor_power_kw?: number;
  motor_torque_nm?: number;
  motor_count?: MotorCount;
  drive_type?: DriveType;
}

export interface IBatteryDetails {
  battery_chemistry?: string;
  battery_capacity_total_kwh?: number;
  battery_capacity_usable_kwh?: number;
  battery_supplier?: string;
  charging_speed_dc_kw?: number;
  charging_speed_ac_kw?: number;
  electric_range_km?: number;
  range_standard?: RangeStandard;
}

export interface IPowertrain {
  _id?: string;
  model_id: string;
  trim_name: string;
  energy_type: EnergyType;
  engine_details?: IEngineDetails;
  electric_motor_details?: IElectricMotorDetails;
  battery_details?: IBatteryDetails;
  gearbox?: GearboxType;
  gearbox_gears?: number;
  combined_range_km?: number;
  accel_0_100_kmh_s?: number;
  top_speed_kmh?: number;
  unverified?: boolean;
}
