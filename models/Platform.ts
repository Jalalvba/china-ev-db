import { Schema, model, models } from "mongoose";
import type { IPlatform } from "@/types";
import { CONFIDENCE_VALUES } from "@/types/canonicalPowertrain";

// A vehicle PLATFORM (technical lineage), the axis for grouping models that share underpinnings — for
// parts/tooling/diagnostic commonality. Deliberately separate from Brand.parent_group (legal ownership):
// platform sharing happens between specific MODELS/generations, often across brands (Soueast S06 and
// Jetour Dashing on Chery's T1X; Jaecoo J7 and Lepas L8 per the Lepas benchmark), never uniformly across a
// brand's whole lineup. Models link to a Platform by _id (Model.platforms) — never by a free-text name,
// which is exactly how parent_group drifted into split groups (see lib/brandParentGroup.ts).
//
// kind: "chassis" ONLY for now (explicit decision 2026-09-21). "hybrid_system" was left out because it would
// duplicate trim-level Powertrain.hybrid_system_name/hybrid_architecture; "electrical_architecture" because
// the evidence is too thin to justify a category yet. Add a kind only when real, well-sourced data does — it
// is one enum value (PLATFORM_KINDS) plus whatever import validation needs.
export const PLATFORM_KINDS = ["chassis"] as const;

const PlatformSchema = new Schema<IPlatform>(
  {
    /** Canonical name, e.g. "T1X". Unique. Import layer resolves aliases to THIS doc rather than creating a second one. */
    name: { type: String, required: true, unique: true, trim: true },
    name_cn: { type: String, trim: true },
    /** Other spellings seen in sources ("Chery T1X", "T1X platform") so a re-import matches instead of duplicating. */
    aliases: [{ type: String, trim: true }],
    kind: { type: String, enum: PLATFORM_KINDS, required: true, default: "chassis" },
    /** Who develops the platform, free text (e.g. "Chery"). Descriptive only — NOT an ownership axis, NOT used for grouping. */
    developer: { type: String, trim: true },
    description: { type: String, trim: true },
    /** Evidence that this platform exists as named. "confirmed" requires source_url (see the pre-validate hook). */
    confidence: { type: String, enum: CONFIDENCE_VALUES, required: true, default: "unconfirmed" },
    source_url: { type: String, trim: true },
  },
  { timestamps: true }
);

PlatformSchema.pre("validate", function () {
  const doc = this as unknown as { confidence?: string; source_url?: string; invalidate(p: string, m: string): void };
  if (doc.confidence === "confirmed" && !/^https?:\/\/\S+$/i.test(doc.source_url ?? "")) {
    doc.invalidate("source_url", 'confidence "confirmed" requires an http(s) source_url');
  }
});

// See the matching comment in models/Model.ts about mongoose.models caching under Fast Refresh —
// restart the dev server after any change to this file.
export default models.Platform || model<IPlatform>("Platform", PlatformSchema);
