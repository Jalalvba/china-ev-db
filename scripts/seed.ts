import "dotenv/config";
import mongoose from "mongoose";
import Brand from "../models/Brand";
import ModelSchema from "../models/Model";
import Powertrain from "../models/Powertrain";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI. Copy .env.example to .env and set it.");
}

type SeedPowertrain = Omit<InstanceType<typeof Powertrain>, "model_id" | "_id"> & Record<string, unknown>;

interface SeedModel {
  name: string;
  generation?: string;
  year?: number;
  segment: string;
  body_type: string;
  price_range?: {
    min_local?: number;
    max_local?: number;
    currency_local: string;
    min_usd?: number;
    max_usd?: number;
  };
  production_status: string;
  unverified?: boolean;
  powertrains: Record<string, unknown>[];
}

interface SeedBrand {
  name: string;
  parent_group?: string;
  country_origin: string;
  founded_year?: number;
  website?: string;
  models: SeedModel[];
}

const DATA: SeedBrand[] = [
  {
    name: "BYD",
    country_origin: "China",
    founded_year: 1995,
    website: "https://www.byd.com",
    models: [
      {
        name: "Qin PLUS",
        generation: "2026",
        segment: "B-segment/Compact",
        body_type: "4-door sedan",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 79800,
          max_local: 99800,
          currency_local: "CNY",
          min_usd: 11083,
          max_usd: 13861,
        },
        powertrains: [
          {
            trim_name: "DM-i 128KM 进取型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (naturally aspirated)",
              max_power_hp: 101,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 120,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 15.87,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 128,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1000,
            unverified: true,
          },
          {
            trim_name: "DM-i 210KM 进取型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (naturally aspirated)",
              max_power_hp: 101,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 120,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 25.28,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 210,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            unverified: true,
          },
        ],
      },
      {
        name: "Song Ultra EV",
        generation: "2026",
        segment: "SUV-mid",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 151900,
          max_local: 179900,
          currency_local: "CNY",
          min_usd: 21097,
          max_usd: 24986,
        },
        powertrains: [
          {
            trim_name: "605KM 领先型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 240,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_capacity_total_kwh: 75.616,
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 1000,
              electric_range_km: 620,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.8,
            top_speed_kmh: 210,
            unverified: true,
          },
          {
            trim_name: "710KM 卓越型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 270,
              motor_torque_nm: 305,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_capacity_total_kwh: 82.732,
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 1000,
              electric_range_km: 710,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.8,
            top_speed_kmh: 210,
            unverified: true,
          },
        ],
      },
      {
        name: "Song Ultra DM-i",
        generation: "2026",
        segment: "SUV-mid",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 129900,
          max_local: 159900,
          currency_local: "CNY",
          min_usd: 18042,
          max_usd: 22208,
        },
        powertrains: [
          {
            trim_name: "205KM 领先型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (naturally aspirated)",
              max_power_hp: 101,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 175,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 205,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1845,
            unverified: true,
          },
          {
            trim_name: "310KM 卓越型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (naturally aspirated)",
              max_power_hp: 101,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 175,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 310,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1845,
            unverified: true,
          },
        ],
      },
      {
        name: "Han EV",
        generation: "2026",
        segment: "D-segment/Large",
        body_type: "4-door sedan",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 179800,
          max_local: 187800,
          currency_local: "CNY",
          min_usd: 24972,
          max_usd: 26083,
        },
        powertrains: [
          {
            trim_name: "705KM 闪充尊贵型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 240,
              motor_torque_nm: 305,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_capacity_total_kwh: 69.07,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 705,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.5,
            unverified: true,
          },
        ],
      },
      {
        name: "Han L EV",
        generation: "2026",
        segment: "D-segment/Large",
        body_type: "4-door sedan",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 209800,
          max_local: 279800,
          currency_local: "CNY",
          min_usd: 29139,
          max_usd: 38861,
        },
        powertrains: [
          {
            trim_name: "701KM 激光雷达尊享型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_count: "single",
              drive_type: "RWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 1000,
              electric_range_km: 701,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 2.7,
            unverified: true,
          },
          {
            trim_name: "四驱激光雷达旗舰型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_count: "dual",
              drive_type: "AWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 1000,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 2.7,
            unverified: true,
          },
        ],
      },
      {
        name: "Tang L EV",
        generation: "2026",
        segment: "SUV-mid",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 229800,
          max_local: 229800,
          currency_local: "CNY",
          min_usd: 31917,
          max_usd: 31917,
        },
        powertrains: [
          {
            trim_name: "670KM 激光雷达尊享型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 580,
              motor_count: "single",
              drive_type: "RWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 100.531,
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 1000,
              electric_range_km: 670,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
          {
            trim_name: "四驱激光雷达旗舰型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_count: "dual",
              drive_type: "AWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 100.531,
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 1000,
              electric_range_km: 600,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 3.6,
            top_speed_kmh: 287,
            unverified: true,
          },
        ],
      },
      {
        name: "Seagull",
        generation: "2026",
        segment: "A-segment/City",
        body_type: "5-door hatchback",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 69900,
          max_local: 85900,
          currency_local: "CNY",
          min_usd: 9708,
          max_usd: 11931,
        },
        powertrains: [
          {
            trim_name: "305km 自由版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 55,
              motor_torque_nm: 135,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 30.08,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 305,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
          {
            trim_name: "405km 飞翔版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 55,
              motor_torque_nm: 135,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 38.88,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 405,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
        ],
      },
      {
        name: "Dolphin",
        generation: "2026",
        segment: "B-segment/Compact",
        body_type: "5-door hatchback",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 99800,
          max_local: 109800,
          currency_local: "CNY",
          min_usd: 13861,
          max_usd: 15250,
        },
        powertrains: [
          {
            trim_name: "420KM 自由版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 70,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 45.12,
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 80,
              electric_range_km: 420,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
          {
            trim_name: "410KM 时尚版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 130,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 410,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
        ],
      },
      {
        name: "Yuan PLUS",
        generation: "2026 (3rd gen)",
        segment: "SUV-compact",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 119900,
          max_local: 149900,
          currency_local: "CNY",
          min_usd: 16653,
          max_usd: 20819,
        },
        powertrains: [
          {
            trim_name: "540KM 领先型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 200,
              motor_count: "single",
              drive_type: "RWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_capacity_total_kwh: 57.5,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 540,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.6,
            top_speed_kmh: 190,
            unverified: true,
          },
          {
            trim_name: "630KM 旗舰型",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 240,
              motor_count: "single",
              drive_type: "RWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_capacity_total_kwh: 68.5,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 630,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
        ],
      },
      {
        name: "Seal 06 GT",
        generation: "2026",
        segment: "B-segment/Compact",
        body_type: "5-door hatchback",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 128900,
          max_local: 169900,
          currency_local: "CNY",
          min_usd: 17903,
          max_usd: 23597,
        },
        powertrains: [
          {
            trim_name: "520km 海浪版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 520,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            unverified: true,
          },
          {
            trim_name: "620km 热浪Max版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 240,
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 620,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.5,
            unverified: true,
          },
        ],
      },
      {
        name: "Sealion 06 EV",
        generation: "2026",
        segment: "SUV-mid",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 159900,
          max_local: 179900,
          currency_local: "CNY",
          min_usd: 22208,
          max_usd: 24986,
        },
        powertrains: [
          {
            trim_name: "605领航版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 240,
              motor_count: "single",
              drive_type: "RWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 605,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            top_speed_kmh: 210,
            unverified: true,
          },
          {
            trim_name: "710远航旗舰版",
            energy_type: "BEV",
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 240,
              motor_count: "single",
              drive_type: "RWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 710,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            top_speed_kmh: 210,
            unverified: true,
          },
        ],
      },
      {
        name: "Xia DM-i",
        generation: "2026",
        segment: "MPV",
        body_type: "5-door MPV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 196800,
          max_local: 206800,
          currency_local: "CNY",
          min_usd: 27333,
          max_usd: 28722,
        },
        powertrains: [
          {
            trim_name: "100KM 进取型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (turbo)",
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 20.39,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 100,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1163,
            accel_0_100_kmh_s: 8.5,
            unverified: true,
          },
          {
            trim_name: "218KM 超越型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (turbo)",
              max_power_hp: 156,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_count: "single",
              drive_type: "FWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 218,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1163,
            accel_0_100_kmh_s: 8.1,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Denza",
    parent_group: "BYD Group",
    country_origin: "China",
    founded_year: 2010,
    website: "https://www.denzaauto.com",
    models: [
      {
        name: "D9",
        generation: "2026 (2nd gen)",
        segment: "MPV",
        body_type: "5-door MPV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 329800,
          max_local: 329800,
          currency_local: "CNY",
          min_usd: 45806,
          max_usd: 45806,
        },
        powertrains: [
          {
            trim_name: "DM-i 四驱闪充尊荣型",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (turbo)",
              max_power_hp: 156,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 245,
              motor_torque_nm: 445,
              motor_count: "dual",
              drive_type: "AWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_supplier: "BYD FinDreams",
              electric_range_km: 401,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 7.3,
            top_speed_kmh: 180,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Yangwang",
    parent_group: "BYD Group",
    country_origin: "China",
    founded_year: 2022,
    website: "https://www.yangwangauto.com",
    models: [
      {
        name: "U8",
        generation: "2026",
        segment: "SUV-full",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 1008000,
          max_local: 1008000,
          currency_local: "CNY",
          min_usd: 140000,
          max_usd: 140000,
        },
        powertrains: [
          {
            trim_name: "豪华版",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 2,
              cylinders: 4,
              fuel_type: "Gasoline (turbo)",
              max_power_hp: 272,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 880,
              motor_torque_nm: 1520,
              motor_count: "quad-motor",
              drive_type: "AWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_supplier: "BYD FinDreams",
              charging_speed_dc_kw: 574,
              electric_range_km: 230,
              range_standard: "CLTC",
            },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            combined_range_km: 1205,
            accel_0_100_kmh_s: 3.5,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Fangchengbao",
    parent_group: "BYD Group",
    country_origin: "China",
    founded_year: 2023,
    website: "https://www.fangchengbao.com",
    models: [
      {
        name: "Bao 5",
        generation: "2026",
        segment: "SUV-mid",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 259800,
          max_local: 305800,
          currency_local: "CNY",
          min_usd: 36083,
          max_usd: 42472,
        },
        powertrains: [
          {
            trim_name: "210KM 天神Max版",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 1.5,
              cylinders: 4,
              fuel_type: "Gasoline (turbo)",
              max_power_hp: 194,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 485,
              motor_torque_nm: 760,
              motor_count: "dual",
              drive_type: "AWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade)",
              battery_capacity_total_kwh: 46,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 210,
              range_standard: "CLTC",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1310,
            accel_0_100_kmh_s: 4.8,
            unverified: true,
          },
        ],
      },
      {
        name: "Bao 8",
        generation: "2026",
        segment: "SUV-full",
        body_type: "5-door SUV",
        production_status: "in production",
        unverified: true,
        price_range: {
          min_local: 419800,
          max_local: 427800,
          currency_local: "CNY",
          min_usd: 58306,
          max_usd: 59417,
        },
        powertrains: [
          {
            trim_name: "2.0T 200km 闪充 5座",
            energy_type: "PHEV",
            engine_details: {
              displacement_l: 2,
              cylinders: 4,
              fuel_type: "Gasoline (turbo)",
              max_power_hp: 245,
            },
            electric_motor_details: {
              motor_type: "PMSM",
              motor_power_kw: 550,
              motor_torque_nm: 760,
              motor_count: "dual",
              drive_type: "AWD",
            },
            battery_details: {
              battery_chemistry: "LFP (Blade, 2nd gen)",
              battery_capacity_total_kwh: 46.704,
              battery_supplier: "BYD FinDreams",
              electric_range_km: 200,
              range_standard: "WLTP",
            },
            gearbox: "CVT",
            gearbox_gears: 1,
            combined_range_km: 1380,
            accel_0_100_kmh_s: 4.8,
            top_speed_kmh: 180,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Geely",
    parent_group: "Geely Holding Group",
    country_origin: "China",
    founded_year: 1986,
    website: "https://www.geely.com",
    models: [
      {
        name: "Xingyue L",
        segment: "SUV-mid",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 138800, max_local: 179800, currency_local: "CNY", min_usd: 19500, max_usd: 25000 },
        powertrains: [
          {
            trim_name: "2.0T AWD",
            energy_type: "ICE",
            engine_details: { displacement_l: 2.0, cylinders: 4, fuel_type: "Gasoline (Turbo)", max_power_hp: 238, max_torque_nm: 385 },
            gearbox: "AT",
            gearbox_gears: 8,
            accel_0_100_kmh_s: 6.9,
            top_speed_kmh: 210,
          },
        ],
      },
      {
        name: "Galaxy E8",
        segment: "D-segment/Large",
        body_type: "Sedan",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 175800, max_local: 205800, currency_local: "CNY", min_usd: 24000, max_usd: 29000 },
        powertrains: [
          {
            trim_name: "Long Range",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 200, motor_torque_nm: 320, motor_count: "single", drive_type: "FWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 87, battery_capacity_usable_kwh: 87, battery_supplier: "CATL", charging_speed_dc_kw: 300, charging_speed_ac_kw: 11, electric_range_km: 650, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.9,
            top_speed_kmh: 190,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Chery",
    parent_group: "Chery Automobile",
    country_origin: "China",
    founded_year: 1997,
    website: "https://www.chery.com",
    models: [
      {
        name: "Tiggo 8 Pro",
        segment: "SUV-mid",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 129900, max_local: 169900, currency_local: "CNY", min_usd: 18000, max_usd: 24000 },
        powertrains: [
          {
            trim_name: "1.6T",
            energy_type: "ICE",
            engine_details: { displacement_l: 1.6, cylinders: 4, fuel_type: "Gasoline (Turbo)", max_power_hp: 197, max_torque_nm: 290 },
            gearbox: "DCT",
            gearbox_gears: 7,
            accel_0_100_kmh_s: 9.5,
            top_speed_kmh: 195,
          },
        ],
      },
      {
        name: "Omoda 5",
        segment: "SUV-compact",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 99900, max_local: 129900, currency_local: "CNY", min_usd: 14000, max_usd: 18000 },
        powertrains: [
          {
            trim_name: "1.5T",
            energy_type: "ICE",
            engine_details: { displacement_l: 1.5, cylinders: 4, fuel_type: "Gasoline (Turbo)", max_power_hp: 156, max_torque_nm: 230 },
            gearbox: "CVT",
            accel_0_100_kmh_s: 10.1,
            top_speed_kmh: 185,
          },
          {
            trim_name: "EX BEV",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 150, motor_torque_nm: 340, motor_count: "single", drive_type: "FWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 61, battery_capacity_usable_kwh: 61, battery_supplier: "Gotion", charging_speed_dc_kw: 80, charging_speed_ac_kw: 6.6, electric_range_km: 425, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 7.7,
            top_speed_kmh: 172,
          },
        ],
      },
    ],
  },
  {
    name: "GWM (Great Wall Motor)",
    parent_group: "Great Wall Motor",
    country_origin: "China",
    founded_year: 1984,
    website: "https://www.gwm-global.com",
    models: [
      {
        name: "Haval H6",
        segment: "SUV-mid",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 119800, max_local: 159800, currency_local: "CNY", min_usd: 17000, max_usd: 22000 },
        powertrains: [
          {
            trim_name: "HEV",
            energy_type: "HEV",
            engine_details: { displacement_l: 1.5, cylinders: 4, fuel_type: "Gasoline", max_power_hp: 150, max_torque_nm: 230 },
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 130, motor_torque_nm: 300, motor_count: "single", drive_type: "FWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 1.7, battery_capacity_usable_kwh: 1.7, battery_supplier: "CATL" },
            gearbox: "DCT",
            gearbox_gears: 2,
            accel_0_100_kmh_s: 8.7,
            top_speed_kmh: 190,
          },
        ],
      },
      {
        name: "Ora Good Cat",
        segment: "B-segment/Compact",
        body_type: "Hatchback",
        production_status: "in production",
        price_range: { min_local: 129800, max_local: 159800, currency_local: "CNY", min_usd: 18000, max_usd: 22000 },
        powertrains: [
          {
            trim_name: "500 Long Range",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 105, motor_torque_nm: 210, motor_count: "single", drive_type: "FWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 59.1, battery_capacity_usable_kwh: 59.1, battery_supplier: "CATL", charging_speed_dc_kw: 66, charging_speed_ac_kw: 6.6, electric_range_km: 500, range_standard: "NEDC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 8.5,
            top_speed_kmh: 160,
          },
        ],
      },
      {
        name: "Tank 300",
        segment: "SUV-mid",
        body_type: "SUV (body-on-frame)",
        production_status: "in production",
        price_range: { min_local: 199800, max_local: 239800, currency_local: "CNY", min_usd: 28000, max_usd: 33000 },
        powertrains: [
          {
            trim_name: "2.0T",
            energy_type: "ICE",
            engine_details: { displacement_l: 2.0, cylinders: 4, fuel_type: "Gasoline (Turbo)", max_power_hp: 218, max_torque_nm: 387 },
            gearbox: "AT",
            gearbox_gears: 8,
            accel_0_100_kmh_s: 8.7,
            top_speed_kmh: 180,
          },
        ],
      },
    ],
  },
  {
    name: "Changan",
    parent_group: "Changan Automobile",
    country_origin: "China",
    founded_year: 1862,
    website: "https://www.globalchangan.com",
    models: [
      {
        name: "Deepal S7",
        segment: "SUV-mid",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 149900, max_local: 189900, currency_local: "CNY", min_usd: 21000, max_usd: 26000 },
        powertrains: [
          {
            trim_name: "EREV",
            energy_type: "REEV/EREV",
            engine_details: { displacement_l: 1.5, cylinders: 4, fuel_type: "Gasoline (range extender)", max_power_hp: 95, max_torque_nm: 130 },
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 160, motor_torque_nm: 320, motor_count: "single", drive_type: "FWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 30, battery_capacity_usable_kwh: 30, battery_supplier: "CATL", charging_speed_dc_kw: 60, charging_speed_ac_kw: 6.6, electric_range_km: 200, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            combined_range_km: 1100,
            accel_0_100_kmh_s: 7.0,
            top_speed_kmh: 180,
            unverified: true,
          },
        ],
      },
      {
        name: "Avatr 12",
        segment: "C-segment/Mid-size",
        body_type: "Sedan",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 289900, max_local: 349900, currency_local: "CNY", min_usd: 40000, max_usd: 49000 },
        powertrains: [
          {
            trim_name: "Performance AWD",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 425, motor_torque_nm: 650, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 94.5, battery_capacity_usable_kwh: 94.5, battery_supplier: "CATL", charging_speed_dc_kw: 240, charging_speed_ac_kw: 11, electric_range_km: 635, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 3.7,
            top_speed_kmh: 200,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "NIO",
    country_origin: "China",
    founded_year: 2014,
    website: "https://www.nio.com",
    models: [
      {
        name: "ET5",
        segment: "C-segment/Mid-size",
        body_type: "Sedan",
        production_status: "in production",
        price_range: { min_local: 298000, max_local: 336000, currency_local: "CNY", min_usd: 41000, max_usd: 47000 },
        powertrains: [
          {
            trim_name: "100 kWh AWD",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM + Induction", motor_power_kw: 360, motor_torque_nm: 700, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 100, battery_capacity_usable_kwh: 94, battery_supplier: "CATL", charging_speed_dc_kw: 140, charging_speed_ac_kw: 11, electric_range_km: 710, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 4.3,
            top_speed_kmh: 200,
          },
        ],
      },
      {
        name: "ES6",
        segment: "SUV-mid",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 358000, max_local: 398000, currency_local: "CNY", min_usd: 49000, max_usd: 55000 },
        powertrains: [
          {
            trim_name: "75 kWh AWD",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM + Induction", motor_power_kw: 320, motor_torque_nm: 610, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 75, battery_capacity_usable_kwh: 70, battery_supplier: "CATL", charging_speed_dc_kw: 130, charging_speed_ac_kw: 11, electric_range_km: 490, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 4.7,
            top_speed_kmh: 200,
          },
        ],
      },
    ],
  },
  {
    name: "XPeng",
    country_origin: "China",
    founded_year: 2014,
    website: "https://www.xpeng.com",
    models: [
      {
        name: "P7",
        segment: "C-segment/Mid-size",
        body_type: "Sedan",
        production_status: "in production",
        price_range: { min_local: 209900, max_local: 259900, currency_local: "CNY", min_usd: 29000, max_usd: 36000 },
        powertrains: [
          {
            trim_name: "RWD Long Range",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 196, motor_torque_nm: 390, motor_count: "single", drive_type: "RWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 80.9, battery_capacity_usable_kwh: 76.3, battery_supplier: "CATL", charging_speed_dc_kw: 155, charging_speed_ac_kw: 11, electric_range_km: 670, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.5,
            top_speed_kmh: 170,
          },
        ],
      },
      {
        name: "G6",
        segment: "SUV-compact",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 209900, max_local: 249900, currency_local: "CNY", min_usd: 29000, max_usd: 35000 },
        powertrains: [
          {
            trim_name: "Performance AWD",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 315, motor_torque_nm: 660, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC (800V)", battery_capacity_total_kwh: 87.5, battery_capacity_usable_kwh: 83, battery_supplier: "CATL", charging_speed_dc_kw: 300, charging_speed_ac_kw: 11, electric_range_km: 580, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 3.9,
            top_speed_kmh: 200,
          },
        ],
      },
    ],
  },
  {
    name: "Li Auto",
    country_origin: "China",
    founded_year: 2015,
    website: "https://www.lixiang.com",
    models: [
      {
        name: "L9",
        segment: "SUV-full",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 459800, max_local: 459800, currency_local: "CNY", min_usd: 64000, max_usd: 64000 },
        powertrains: [
          {
            trim_name: "Max",
            energy_type: "REEV/EREV",
            engine_details: { displacement_l: 1.5, cylinders: 4, fuel_type: "Gasoline (range extender)", max_power_hp: 150, max_torque_nm: 245 },
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 330, motor_torque_nm: 620, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 44.5, battery_capacity_usable_kwh: 42.8, battery_supplier: "CATL", charging_speed_dc_kw: 135, charging_speed_ac_kw: 7, electric_range_km: 215, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            combined_range_km: 1315,
            accel_0_100_kmh_s: 5.3,
            top_speed_kmh: 180,
          },
        ],
      },
      {
        name: "L7",
        segment: "SUV-mid",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 319800, max_local: 379800, currency_local: "CNY", min_usd: 44000, max_usd: 53000 },
        powertrains: [
          {
            trim_name: "Pro",
            energy_type: "REEV/EREV",
            engine_details: { displacement_l: 1.5, cylinders: 4, fuel_type: "Gasoline (range extender)", max_power_hp: 150, max_torque_nm: 245 },
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 250, motor_torque_nm: 450, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 33.1, battery_capacity_usable_kwh: 32.3, battery_supplier: "CATL", charging_speed_dc_kw: 90, charging_speed_ac_kw: 7, electric_range_km: 210, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            combined_range_km: 1300,
            accel_0_100_kmh_s: 6.5,
            top_speed_kmh: 180,
          },
        ],
      },
    ],
  },
  {
    name: "Zeekr",
    parent_group: "Geely Holding Group",
    country_origin: "China",
    founded_year: 2021,
    website: "https://www.zeekr.com",
    models: [
      {
        name: "001",
        segment: "C-segment/Mid-size",
        body_type: "Shooting Brake",
        production_status: "in production",
        price_range: { min_local: 269000, max_local: 329000, currency_local: "CNY", min_usd: 37000, max_usd: 46000 },
        powertrains: [
          {
            trim_name: "WE AWD",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 400, motor_torque_nm: 686, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 100, battery_capacity_usable_kwh: 95, battery_supplier: "CATL", charging_speed_dc_kw: 200, charging_speed_ac_kw: 11, electric_range_km: 620, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 3.8,
            top_speed_kmh: 200,
          },
        ],
      },
    ],
  },
  {
    name: "Leapmotor",
    country_origin: "China",
    founded_year: 2015,
    website: "https://www.leapmotor.com",
    models: [
      {
        name: "C10",
        segment: "SUV-compact",
        body_type: "SUV",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 145800, max_local: 165800, currency_local: "CNY", min_usd: 20000, max_usd: 23000 },
        powertrains: [
          {
            trim_name: "Long Range",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 160, motor_torque_nm: 320, motor_count: "single", drive_type: "RWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 69.9, battery_capacity_usable_kwh: 67.1, battery_supplier: "CALB", charging_speed_dc_kw: 84, charging_speed_ac_kw: 6.6, electric_range_km: 420, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 7.5,
            top_speed_kmh: 170,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "AITO",
    parent_group: "Seres / Huawei (co-developed)",
    country_origin: "China",
    founded_year: 2021,
    website: "https://www.aitoauto.com",
    models: [
      {
        name: "M9",
        segment: "SUV-full",
        body_type: "SUV",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 469800, max_local: 569800, currency_local: "CNY", min_usd: 65000, max_usd: 79000 },
        powertrains: [
          {
            trim_name: "Ultra AWD",
            energy_type: "REEV/EREV",
            engine_details: { displacement_l: 1.5, cylinders: 4, fuel_type: "Gasoline (range extender, turbo)", max_power_hp: 174, max_torque_nm: 285 },
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 330, motor_torque_nm: 675, motor_count: "tri-motor", drive_type: "AWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 52, battery_capacity_usable_kwh: 50, battery_supplier: "CATL", charging_speed_dc_kw: 76, charging_speed_ac_kw: 6.6, electric_range_km: 275, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            combined_range_km: 1402,
            accel_0_100_kmh_s: 4.9,
            top_speed_kmh: 200,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Hongqi",
    parent_group: "FAW Group",
    country_origin: "China",
    founded_year: 1958,
    website: "https://www.hongqi-auto.com",
    models: [
      {
        name: "E-HS9",
        segment: "SUV-full",
        body_type: "SUV",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 439800, max_local: 519800, currency_local: "CNY", min_usd: 61000, max_usd: 72000 },
        powertrains: [
          {
            trim_name: "AWD",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 330, motor_torque_nm: 720, motor_count: "dual", drive_type: "AWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 99, battery_capacity_usable_kwh: 96, battery_supplier: "CATL", charging_speed_dc_kw: 105, charging_speed_ac_kw: 7, electric_range_km: 465, range_standard: "NEDC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.9,
            top_speed_kmh: 190,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "GAC Aion",
    parent_group: "GAC Group",
    country_origin: "China",
    founded_year: 2017,
    website: "https://www.aion.com",
    models: [
      {
        name: "Aion Y",
        segment: "SUV-compact",
        body_type: "SUV",
        production_status: "in production",
        price_range: { min_local: 129800, max_local: 169800, currency_local: "CNY", min_usd: 18000, max_usd: 24000 },
        powertrains: [
          {
            trim_name: "Long Range 600",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 135, motor_torque_nm: 225, motor_count: "single", drive_type: "FWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 63.2, battery_capacity_usable_kwh: 63.2, battery_supplier: "CATL", charging_speed_dc_kw: 90, charging_speed_ac_kw: 6.6, electric_range_km: 600, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 8.8,
            top_speed_kmh: 160,
          },
        ],
      },
      {
        name: "Hyper GT",
        segment: "C-segment/Mid-size",
        body_type: "Sedan",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 179800, max_local: 219800, currency_local: "CNY", min_usd: 25000, max_usd: 30000 },
        powertrains: [
          {
            trim_name: "Max",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 250, motor_torque_nm: 430, motor_count: "single", drive_type: "RWD" },
            battery_details: { battery_chemistry: "NMC", battery_capacity_total_kwh: 82, battery_capacity_usable_kwh: 79, battery_supplier: "CATL", charging_speed_dc_kw: 168, charging_speed_ac_kw: 11, electric_range_km: 650, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 6.5,
            top_speed_kmh: 200,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "Dongfeng",
    parent_group: "Dongfeng Motor Corporation",
    country_origin: "China",
    founded_year: 1969,
    website: "https://www.dfmc.com.cn",
    models: [
      {
        name: "Box (eπ box)",
        segment: "SUV-compact",
        body_type: "SUV",
        production_status: "in production",
        unverified: true,
        price_range: { min_local: 119900, max_local: 139900, currency_local: "CNY", min_usd: 17000, max_usd: 19500 },
        powertrains: [
          {
            trim_name: "Standard",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 150, motor_torque_nm: 310, motor_count: "single", drive_type: "RWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 56.6, battery_capacity_usable_kwh: 56.6, battery_supplier: "CATL", charging_speed_dc_kw: 90, charging_speed_ac_kw: 6.6, electric_range_km: 450, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 7.9,
            top_speed_kmh: 175,
            unverified: true,
          },
        ],
      },
    ],
  },
  {
    name: "SAIC (Roewe/MG)",
    parent_group: "SAIC Motor",
    country_origin: "China",
    founded_year: 1955,
    website: "https://www.saicmotor.com",
    models: [
      {
        name: "MG4 EV",
        segment: "B-segment/Compact",
        body_type: "Hatchback",
        production_status: "in production",
        price_range: { min_local: 99800, max_local: 129800, currency_local: "CNY", min_usd: 14000, max_usd: 18000 },
        powertrains: [
          {
            trim_name: "Standard Range",
            energy_type: "BEV",
            electric_motor_details: { motor_type: "PMSM", motor_power_kw: 125, motor_torque_nm: 250, motor_count: "single", drive_type: "RWD" },
            battery_details: { battery_chemistry: "LFP", battery_capacity_total_kwh: 51, battery_capacity_usable_kwh: 49.9, battery_supplier: "CATL", charging_speed_dc_kw: 117, charging_speed_ac_kw: 6.6, electric_range_km: 425, range_standard: "CLTC" },
            gearbox: "single-speed reducer",
            gearbox_gears: 1,
            accel_0_100_kmh_s: 7.7,
            top_speed_kmh: 160,
          },
        ],
      },
    ],
  },
];

async function seed() {
  await mongoose.connect(MONGODB_URI as string);
  console.log("Connected to MongoDB");

  console.log("Clearing existing collections...");
  await Powertrain.deleteMany({});
  await ModelSchema.deleteMany({});
  await Brand.deleteMany({});

  let brandCount = 0;
  let modelCount = 0;
  let powertrainCount = 0;

  for (const brandData of DATA) {
    const { models: modelList, ...brandFields } = brandData;
    const brand = await Brand.create(brandFields);
    brandCount++;

    for (const modelData of modelList) {
      const { powertrains, ...modelFields } = modelData;
      const modelDoc = await ModelSchema.create({ ...modelFields, brand_id: brand._id });
      modelCount++;

      for (const pt of powertrains) {
        await Powertrain.create({ ...pt, model_id: modelDoc._id });
        powertrainCount++;
      }
    }
  }

  console.log(`Seeded ${brandCount} brands, ${modelCount} models, ${powertrainCount} powertrains.`);
  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
