import { Schema, model, models, Types } from "mongoose";
import type { IBrandWorkshopOverride } from "@/types";
import { POWERTRAIN_CATEGORIES } from "@/models/WorkshopStandard";

type BrandWorkshopOverrideDoc = Omit<IBrandWorkshopOverride, "brand_id"> & { brand_id: Types.ObjectId };

// Sparse — only created where lib/workshopResearch.ts's brand-specific research
// (Chinese-source-only, same as warranty/positioning/issues) actually found real
// brand-specific tooling/cert/lift data beyond the generic workshop_standards doc
// for that powertrain_category. A brand+category with no doc here just uses
// workshop_standards as-is — this is NOT one doc per brand, most brands will have
// zero of these.

const TechnicianCertificationSchema = new Schema(
  {
    level: { type: String, trim: true },
    body: { type: String, trim: true },
    required_for: [{ type: String, trim: true }],
    retraining_interval_months: { type: Number },
  },
  { _id: false }
);

const LiftRequirementsSchema = new Schema(
  {
    type: { type: String, trim: true },
    min_capacity_kg: { type: Number },
    lift_points_note: { type: String, trim: true },
    battery_removal_capable: { type: Boolean },
  },
  { _id: false }
);

const SpecialToolSchema = new Schema(
  {
    name: { type: String, trim: true, required: true },
    category: { type: String, trim: true },
    mandatory: { type: Boolean },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const BrandWorkshopOverrideSchema = new Schema<BrandWorkshopOverrideDoc>(
  {
    brand_id: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    powertrain_category: { type: String, enum: POWERTRAIN_CATEGORIES, required: true },
    overrides: {
      technician_certification: { type: TechnicianCertificationSchema },
      lift_requirements: { type: LiftRequirementsSchema },
      special_tools: [SpecialToolSchema],
    },
    _source_url: { type: String, trim: true },
    _last_researched_at: { type: Date },
  },
  { timestamps: true }
);

BrandWorkshopOverrideSchema.index({ brand_id: 1, powertrain_category: 1 }, { unique: true });

// See the matching comment in models/Model.ts about mongoose.models caching under
// Fast Refresh — restart the dev server after any change to this file.
export default models.BrandWorkshopOverride ||
  model<BrandWorkshopOverrideDoc>("BrandWorkshopOverride", BrandWorkshopOverrideSchema);
