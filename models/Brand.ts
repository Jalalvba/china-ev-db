import { Schema, model, models } from "mongoose";
import type { IBrand } from "@/types";

// See /BRAND_TAXONOMY.md before changing any field's meaning or adding new
// ownership/grouping fields — it's the frozen reference for what parent_group,
// tech_partner, status_note, data_quality_flag, etc. are each supposed to hold.

// Exported so lib/brandResearch.ts (Tier-1 AI research prompt + validation)
// has one source of truth for these enums, not a second hand-copied list.
export const BRAND_STATUSES = ["active", "discontinued", "bankrupt", "merged"];

// Describes the nature of the parent_group relationship — distinct from
// tech_partner, which is about technology/co-development (e.g. Huawei on
// AITO/Luxeed/Stelato/Maestro/Shangjie) rather than ownership.
export const RELATIONSHIP_TYPES = [
  "equity_subsidiary",
  "jv_brand",
  "technology_partner",
  "minority_controlling",
  "contract_manufactured",
  "independent",
];

const BrandSchema = new Schema<IBrand>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    name_cn: { type: String, trim: true },
    name_en: { type: String, trim: true },
    logo_url: { type: String },
    parent_group: { type: String, trim: true },
    /** Nature of the parent_group relationship (ownership/control), not the tech_partner relationship. */
    relationship_type: { type: String, enum: RELATIONSHIP_TYPES },
    /** Parent's equity/control stake in this brand, 0-100. */
    stake_percentage: { type: Number, min: 0, max: 100 },
    tech_partner: { type: String, trim: true },
    country_origin: { type: String, required: true, default: "China" },
    founded_year: { type: Number },
    website: { type: String },
    status: { type: String, enum: BRAND_STATUSES, default: "active" },
    status_note: { type: String, trim: true },
    /** Confirmed export/international sales status. Undefined = uncertain, not the same as false. */
    export_relevant: { type: Boolean },
    /** Set only by lib/applySpecUpdates.ts's brand-research write path, only when verified as actually applied — see the comment on IBrand.last_researched_at in types/index.ts. */
    last_researched_at: { type: Date },
    /** Flags a brand whose real-world existence as a currently-operating entity could not be confirmed by audit. */
    data_quality_flag: { type: String, trim: true },
  },
  { timestamps: true }
);

// See the matching comment in models/Model.ts: `models.Brand || model(...)`
// reuses whatever schema is already cached in mongoose's process-global
// registry, and Next.js Fast Refresh does not clear that cache in dev — a
// field added here needs a full dev-server restart before writes to it will
// actually persist, or they silently no-op under strict mode.
export default models.Brand || model<IBrand>("Brand", BrandSchema);
