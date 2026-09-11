import mongoose, { Schema, model, models } from "mongoose";
import type { IBrand } from "@/types";

const BrandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    logo_url: { type: String },
    parent_group: { type: String, trim: true },
    country_origin: { type: String, required: true, default: "China" },
    founded_year: { type: Number },
    website: { type: String },
  },
  { timestamps: true }
);

export default models.Brand || model<IBrand>("Brand", BrandSchema);
