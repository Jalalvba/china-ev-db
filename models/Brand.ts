import { Schema, model, models } from "mongoose";
import type { IBrand } from "@/types";
import { checkParentGroup, parentGroupFromUpdate, parentGroupOverrideActive, InvalidParentGroupError } from "@/lib/brandParentGroup";

// See CLAUDE.md (Data model conventions) before changing any field's meaning or adding new
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
    /** The name this brand is actually marketed under in Morocco, if different from `name` — manual direct-entry only (see app/api/brands/[id]/morocco-info/route.ts), never part of AI research. Optional; falls back to `name` when unset. Brands have no single Morocco price (only Models/Trims do), so this is the only Morocco-specific field at brand level. */
    morocco_name: { type: String, trim: true },
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
    /** Chinese-source-only research (lib/warrantyResearch.ts) — see CLAUDE.md's PHEV split-warranty convention. */
    warranty_terms: {
      type: new Schema(
        {
          ice_component_years: Number,
          ice_component_km: Number,
          battery_years: Number,
          battery_km: Number,
          motor_years: Number,
          motor_km: Number,
          source: { type: String, trim: true },
          confidence: { type: String, enum: ["confirmed", "unconfirmed"] },
        },
        { _id: false }
      ),
    },
    /** Set only by app/api/brands/[id]/apply-warranty/route.ts, only when verified as actually applied. */
    warranty_terms_last_researched_at: { type: Date },
    /** Chinese-source-only research (lib/workshopResearch.ts). */
    workshop_requirements: {
      type: new Schema(
        {
          special_tools_list: [{ type: String, trim: true }],
          hv_safety_requirements: { type: String, trim: true },
          diagnostic_software_name: { type: String, trim: true },
          technician_certification_required: { type: String, trim: true },
          source: { type: String, trim: true },
          confidence: { type: String, enum: ["confirmed", "unconfirmed"] },
        },
        { _id: false }
      ),
    },
    /** Set only by app/api/brands/[id]/apply-workshop/route.ts, only when verified as actually applied. */
    workshop_requirements_last_researched_at: { type: Date },
  },
  { timestamps: true }
);

// parent_group write-time guard — see lib/brandParentGroup.ts for the rule and why it exists. These hooks
// only fire when parent_group is being written, so unrelated edits to a legacy doc are unaffected.
async function existingBrandNames(): Promise<Set<string>> {
  const rows = (await model("Brand").find({}, { name: 1 }).lean()) as unknown as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

BrandSchema.pre("validate", async function () {
  const doc = this as unknown as { name?: string; parent_group?: unknown; isModified(p: string): boolean; $locals?: { allowUnknownParentGroup?: boolean } };
  if (parentGroupOverrideActive() || doc.$locals?.allowUnknownParentGroup) return;
  if (!doc.isModified("parent_group")) return;
  const r = checkParentGroup(doc.parent_group, await existingBrandNames(), doc.name);
  if (!r.ok) throw new InvalidParentGroupError(String(doc.parent_group), r.reason ?? "is invalid");
});

BrandSchema.pre(
  ["findOneAndUpdate", "updateOne", "updateMany", "findOneAndReplace", "replaceOne"] as never,
  async function (this: { getUpdate(): unknown; getFilter(): Record<string, unknown>; getOptions(): { allowUnknownParentGroup?: boolean }; model: { findOne(f: unknown, p: unknown): { lean(): Promise<{ name?: string } | null> } } }) {
    if (parentGroupOverrideActive() || this.getOptions().allowUnknownParentGroup) return;
    const w = parentGroupFromUpdate(this.getUpdate());
    if (!w.present) return;
    // Own name for the self-reference check: only knowable when the filter targets a single brand.
    const own = await this.model.findOne(this.getFilter(), { name: 1 }).lean();
    const r = checkParentGroup(w.value, await existingBrandNames(), own?.name);
    if (!r.ok) throw new InvalidParentGroupError(String(w.value), r.reason ?? "is invalid");
  }
);

BrandSchema.pre("insertMany", async function (docs: unknown) {
  if (parentGroupOverrideActive()) return;
  const names = await existingBrandNames();
  const batch = new Set(names);
  for (const d of Array.isArray(docs) ? docs : [docs]) if (d && typeof (d as { name?: unknown }).name === "string") batch.add((d as { name: string }).name);
  for (const d of Array.isArray(docs) ? docs : [docs]) {
    const r = checkParentGroup((d as { parent_group?: unknown })?.parent_group, batch, (d as { name?: string })?.name);
    if (!r.ok) throw new InvalidParentGroupError(String((d as { parent_group?: unknown }).parent_group), r.reason ?? "is invalid");
  }
});

// See the matching comment in models/Model.ts: `models.Brand || model(...)`
// reuses whatever schema is already cached in mongoose's process-global
// registry, and Next.js Fast Refresh does not clear that cache in dev — a
// field added here needs a full dev-server restart before writes to it will
// actually persist, or they silently no-op under strict mode.
export default models.Brand || model<IBrand>("Brand", BrandSchema);
