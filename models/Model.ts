import { Schema, model, models, Types } from "mongoose";
import type { IModel } from "@/types";
import { CONFIDENCE_VALUES } from "@/types/canonicalPowertrain";

type ModelDoc = Omit<IModel, "brand_id"> & { brand_id: Types.ObjectId };

// Exported so lib/modelDiscovery.ts (AI model-discovery prompt + validation)
// has one source of truth for these enums, not a second hand-copied list.
export const SEGMENTS = [
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

export const PRODUCTION_STATUSES = ["in production", "discontinued", "upcoming"];

const PRICE_RANGE_SCHEMA = new Schema(
  {
    min: Number,
    max: Number,
    currency_local: { type: String, default: "CNY" },
    min_usd: Number,
    max_usd: Number,
    unverified: { type: Boolean, default: false },
  },
  { _id: false }
);

const ModelSchema = new Schema<ModelDoc>(
  {
    brand_id: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    name: { type: String, required: true, trim: true },
    name_cn: { type: String, trim: true },
    name_en: { type: String, trim: true },
    generation: { type: String },
    year: { type: Number },
    segment: { type: String, enum: SEGMENTS, required: true },
    body_type: { type: String, required: true },
    price_range: { type: PRICE_RANGE_SCHEMA },
    production_status: {
      type: String,
      enum: PRODUCTION_STATUSES,
      required: true,
      default: "in production",
    },
    unverified: { type: Boolean, default: false },
    notable_facts: { type: String, trim: true },
    notable_facts_confidence: { type: String, enum: CONFIDENCE_VALUES },
    /** Set only by lib/applySpecUpdates.ts, only when a notable_facts write is verified as actually applied — see the comment on IModel.notable_facts_last_researched_at in types/index.ts. */
    notable_facts_last_researched_at: { type: Date },
    // Written only by app/api/models/[id]/fetch-morocco-price/route.ts — a
    // deterministic scrape of moteur.ma/wandaloo.com, never Gemini. Kept
    // separate from MoroccoListing (which is keyed by brand/model name and
    // predates Model having its own brand_id-scoped Morocco fields) so the
    // UI can show a price chip straight off the Model doc without a join.
    morocco_price_dh: { type: Number },
    morocco_price_source: { type: String, enum: ["moteur.ma", "wandaloo.com"] },
    morocco_price_url: { type: String },
    morocco_price_confirmed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ModelSchema.index({ brand_id: 1, name: 1 });

// `models.Model || model(...)` reuses whatever schema is already registered
// under this name in mongoose's process-global registry. In dev, Next.js Fast
// Refresh reloads route/page modules but does NOT clear mongoose.models — so
// a schema field added here while the dev server keeps running (no full
// restart) is invisible to every request until the process is restarted:
// `models.Model` still resolves to the OLD compiled schema, and a
// `$set: { newField: ... }` against it is silently dropped under strict mode
// (the write call succeeds, `updatedAt` even changes, but `newField` never
// lands). This bit us for real when `notable_facts`/`notable_facts_confidence`
// were added below — a write reported success while writing nothing. Restart
// the dev server after any change to this file, and see the verification
// step in lib/applySpecUpdates.ts, which now re-fetches after every write
// specifically to catch this class of silent no-op rather than trusting that
// the write call didn't throw.
export default models.Model || model<ModelDoc>("Model", ModelSchema);
