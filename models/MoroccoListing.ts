import { Schema, model, models, Types } from "mongoose";
import type { IMoroccoListing } from "@/types";

type MoroccoListingDoc = Omit<IMoroccoListing, "model_id" | "last_updated"> & {
  model_id?: Types.ObjectId;
  last_updated: Date;
};

const CONFIDENCE_VALUES = ["confirmed", "unconfirmed"];

const MoroccoListingSchema = new Schema<MoroccoListingDoc>(
  {
    // Set only when matched to an existing Model doc. Left unset for
    // listings whose brand/model isn't in the DB yet — the row is still
    // kept so the sourced data isn't lost, and can be reconciled later.
    model_id: { type: Schema.Types.ObjectId, ref: "Model" },
    brand_en: { type: String, required: true, trim: true },
    model_en: { type: String, required: true, trim: true },
    price_mad: { type: Number },
    price_mad_max: { type: Number },
    autonomie_km: { type: Number },
    powertrain: { type: String },
    dealer_morocco: { type: String },
    dealer_confidence: { type: String, enum: CONFIDENCE_VALUES },
    /** Free-text caveat about dealer_morocco, e.g. dual distribution, corporate-structure clarification, or a source discrepancy pending verification. */
    note: { type: String },
    source: { type: String },
    matched: { type: Boolean, required: true, default: false },
    last_updated: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

MoroccoListingSchema.index({ brand_en: 1, model_en: 1 }, { unique: true });
MoroccoListingSchema.index({ model_id: 1 });

export default models.MoroccoListing || model<MoroccoListingDoc>("MoroccoListing", MoroccoListingSchema);
