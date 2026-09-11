import { Schema, model, models } from "mongoose";
import type { IBrand } from "@/types";

const BRAND_STATUSES = ["active", "discontinued", "bankrupt", "merged"];

const BrandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    name_cn: { type: String, trim: true },
    name_en: { type: String, trim: true },
    logo_url: { type: String },
    parent_group: { type: String, trim: true },
    tech_partner: { type: String, trim: true },
    country_origin: { type: String, required: true, default: "China" },
    founded_year: { type: Number },
    website: { type: String },
    status: { type: String, enum: BRAND_STATUSES, default: "active" },
    status_note: { type: String, trim: true },
  },
  { timestamps: true }
);

export default models.Brand || model<IBrand>("Brand", BrandSchema);
