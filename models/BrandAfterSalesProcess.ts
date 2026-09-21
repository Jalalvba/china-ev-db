import { Schema, model, models, Types } from "mongoose";
import { AFTER_SALES_SECTIONS, AFTER_SALES_SECTION_KEYS, PARTS_MARKETS, type IBrandAfterSalesProcess } from "@/types/afterSalesProcess";
import { CONFIDENCE_VALUES } from "@/types/canonicalPowertrain";

type BrandAfterSalesProcessDoc = Omit<IBrandAfterSalesProcess, "brand_id"> & { brand_id: Types.ObjectId };

// One doc per brand. Every fact is { value, source_url, market? } — a fact with no source is never
// stored (the parser drops NOT FOUND facts), so source_url is required here. Sections and their
// fact keys derive from types/afterSalesProcess.ts's table, the same drift guard the Powertrain
// schema uses. Apply route must re-fetch-verify (CLAUDE.md "Write safety"); a change here needs a
// dev-server restart.

const FactSchema = new Schema(
  {
    value: { type: String, trim: true, required: true },
    source_url: { type: String, trim: true, required: true },
    market: { type: String, enum: PARTS_MARKETS },
  },
  { _id: false }
);

const sectionSchema = (keys: readonly string[]) =>
  new Schema(Object.fromEntries(keys.map((k) => [k, { type: FactSchema }])), { _id: false });

const sectionFields = Object.fromEntries(
  AFTER_SALES_SECTION_KEYS.map((s) => [s, { type: sectionSchema(AFTER_SALES_SECTIONS[s]) }])
);

const BrandAfterSalesProcessSchema = new Schema<BrandAfterSalesProcessDoc>(
  {
    brand_id: { type: Schema.Types.ObjectId, ref: "Brand", required: true, unique: true },
    ...sectionFields,
    _confidence: { type: String, enum: CONFIDENCE_VALUES, required: true },
    _last_researched_at: { type: Date },
  },
  { timestamps: true }
);

// See the matching comment in models/Model.ts about mongoose.models caching under Fast Refresh.
export default models.BrandAfterSalesProcess ||
  model<BrandAfterSalesProcessDoc>("BrandAfterSalesProcess", BrandAfterSalesProcessSchema);
