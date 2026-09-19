import { Schema, model, models } from "mongoose";
import type { IWorkshopStandard } from "@/types";

// Generic (non-brand-specific) reference: what a workshop needs for a given
// powertrain_category + service_tier combination, sourced from published
// national/industry standards (人社部 EV technician certification grades, generic
// lift-capacity classes, baseline HV safety tooling) rather than any one brand's
// own documents. See CLAUDE.md and scripts/seed-workshop-standards.ts for how this
// collection is populated, and lib/workshopResolution.ts for how a model's
// effective requirements are resolved from this + brand_workshop_overrides.
//
// Expected size: ~12-15 docs total (4 powertrain_category x 3 service_tier, minus
// any combination that's genuinely not applicable — e.g. ICE has no hv_battery tier).

export const POWERTRAIN_CATEGORIES = ["ICE", "HEV", "PHEV", "BEV"];
export const SERVICE_TIERS = ["routine", "major_repair", "hv_battery"];

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

const WorkshopStandardSchema = new Schema<IWorkshopStandard>(
  {
    powertrain_category: { type: String, enum: POWERTRAIN_CATEGORIES, required: true },
    service_tier: { type: String, enum: SERVICE_TIERS, required: true },
    technician_certification: { type: TechnicianCertificationSchema },
    lift_requirements: { type: LiftRequirementsSchema },
    special_tools: [SpecialToolSchema],
    _source: { type: String, enum: ["industry_standard", "brand_specific"], required: true, default: "industry_standard" },
    _confidence: { type: String, enum: ["confirmed", "unconfirmed"], required: true, default: "confirmed" },
  },
  { timestamps: true }
);

WorkshopStandardSchema.index({ powertrain_category: 1, service_tier: 1 }, { unique: true });

// See the matching comment in models/Model.ts about mongoose.models caching under
// Fast Refresh — restart the dev server after any change to this file.
export default models.WorkshopStandard || model<IWorkshopStandard>("WorkshopStandard", WorkshopStandardSchema);
