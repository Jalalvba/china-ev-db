import { Schema, model, models, Types } from "mongoose";
import type { IModel } from "@/types";

type ModelDoc = Omit<IModel, "brand_id"> & { brand_id: Types.ObjectId };

const SEGMENTS = [
  "A-segment/City",
  "B-segment/Compact",
  "C-segment/Mid-size",
  "D-segment/Large",
  "SUV-compact",
  "SUV-mid",
  "SUV-full",
  "MPV",
  "Pickup",
  "Sports",
];

const PRICE_RANGE_SCHEMA = new Schema(
  {
    min_local: Number,
    max_local: Number,
    currency_local: { type: String, default: "CNY" },
    min_usd: Number,
    max_usd: Number,
  },
  { _id: false }
);

const ModelSchema = new Schema<ModelDoc>(
  {
    brand_id: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    name: { type: String, required: true, trim: true },
    generation: { type: String },
    year: { type: Number },
    segment: { type: String, enum: SEGMENTS, required: true },
    body_type: { type: String, required: true },
    price_range: { type: PRICE_RANGE_SCHEMA },
    production_status: {
      type: String,
      enum: ["in production", "discontinued", "upcoming"],
      required: true,
      default: "in production",
    },
    unverified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ModelSchema.index({ brand_id: 1, name: 1 });

export default models.Model || model<ModelDoc>("Model", ModelSchema);
