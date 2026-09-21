import { Schema, model, models, Types } from "mongoose";
import type { IBrandPhevSuvWorkshopProfile } from "@/types";
import { CONFIDENCE_VALUES } from "@/types/canonicalPowertrain";

type BrandPhevSuvWorkshopProfileDoc = Omit<IBrandPhevSuvWorkshopProfile, "brand_id"> & { brand_id: Types.ObjectId };

// See types/index.ts's IBrandPhevSuvWorkshopProfile doc comment for why this is a
// separate collection from workshop_standards/brand_workshop_overrides. One doc per
// brand (not per brand+category — this whole collection is already scoped to the
// single PHEV/REEV-SUV segment).

const DiagnosticInterfaceSchema = new Schema(
  {
    tool_name: { type: String, trim: true },
    connector_type: { type: String, trim: true },
    software_platform: { type: String, trim: true },
    requires_dealer_account: { type: Boolean },
    tool_cost: { type: String, trim: true },
    subscription_terms: { type: String, trim: true },
    source_url: { type: String, trim: true },
  },
  { _id: false }
);

const LiftSpecSchema = new Schema(
  {
    type: { type: String, trim: true },
    min_capacity_kg: { type: Number },
    battery_removal_capable: { type: Boolean },
    lift_point_notes: { type: String, trim: true },
    source_url: { type: String, trim: true },
  },
  { _id: false }
);

const PpeRequiredSchema = new Schema(
  {
    item: { type: String, trim: true, required: true },
    spec: { type: String, trim: true },
    mandatory: { type: Boolean },
    source_url: { type: String, trim: true },
  },
  { _id: false }
);

const TechnicianPrerequisiteSchema = new Schema(
  {
    certification_name_cn: { type: String, trim: true },
    certification_name_en: { type: String, trim: true },
    issuing_body: { type: String, trim: true },
    minimum_grade: { type: String, trim: true },
    hv_endorsement_required: { type: Boolean },
    source_url: { type: String, trim: true },
  },
  { _id: false }
);

const AuditChecklistItemSchema = new Schema(
  {
    check_point: { type: String, trim: true, required: true },
    category: { type: String, enum: ["tooling", "certification", "facility", "documentation", "parts"] },
    source_url: { type: String, trim: true },
  },
  { _id: false }
);

const BrandPhevSuvWorkshopProfileSchema = new Schema<BrandPhevSuvWorkshopProfileDoc>(
  {
    brand_id: { type: Schema.Types.ObjectId, ref: "Brand", required: true, unique: true },
    diagnostic_interface: { type: DiagnosticInterfaceSchema },
    lift_spec: { type: LiftSpecSchema },
    ppe_required: [PpeRequiredSchema],
    technician_prerequisites: [TechnicianPrerequisiteSchema],
    audit_checklist: [AuditChecklistItemSchema],
    _source: { type: String, enum: ["brand_specific"], required: true, default: "brand_specific" },
    _confidence: { type: String, enum: CONFIDENCE_VALUES, required: true },
    _last_researched_at: { type: Date },
  },
  { timestamps: true }
);

// See the matching comment in models/Model.ts about mongoose.models caching under
// Fast Refresh — restart the dev server after any change to this file.
export default models.BrandPhevSuvWorkshopProfile ||
  model<BrandPhevSuvWorkshopProfileDoc>("BrandPhevSuvWorkshopProfile", BrandPhevSuvWorkshopProfileSchema);
