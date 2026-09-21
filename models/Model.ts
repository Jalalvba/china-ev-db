import { Schema, model, models, Types } from "mongoose";
import type { IModel } from "@/types";
import { CONFIDENCE_VALUES } from "@/types/canonicalPowertrain";
import { AFFECTED_SYSTEMS, ISSUE_REGIONS, SALES_TRENDS } from "@/types/researchCategories";

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

// Coarse workshop-tooling bucket — see IModel.powertrain_category's doc comment in
// types/index.ts for the REEV/EREV -> PHEV and MHEV -> HEV folding rationale.
export const POWERTRAIN_CATEGORIES = ["ICE", "HEV", "PHEV", "BEV"];

const PRICE_RANGE_SCHEMA = new Schema(
  {
    min: Number,
    max: Number,
    currency_local: { type: String, default: "CNY" },
    min_usd: Number,
    max_usd: Number,
    unverified: { type: Boolean, default: false },
    flag_reason: { type: String, trim: true },
    exchange_rate_used: Number,
    exchange_rate_date: String,
  },
  { _id: false }
);

const ModelSchema = new Schema<ModelDoc>(
  {
    brand_id: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    name: { type: String, required: true, trim: true },
    name_cn: { type: String, trim: true },
    name_en: { type: String, trim: true },
    /** The name this model is actually marketed under in Morocco, if different from `name` — manual direct-entry only (see app/api/models/[id]/morocco-info/route.ts), never part of AI research. Optional; falls back to `name` when unset. */
    morocco_name: { type: String, trim: true },
    generation: { type: String },
    year: { type: Number },
    segment: { type: String, enum: SEGMENTS, required: true },
    // "confirmed" only when a real search result backed the segment;
    // "inferred" when the AI fell back to its own best-effort classification
    // (see lib/modelDiscovery.ts) — segment itself is never left null, so
    // this is the field that actually distinguishes sourced fact from guess.
    segment_confidence: { type: String, enum: ["confirmed", "inferred"] },
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
    // Chinese-source-only research (lib/positioningResearch.ts) — see CLAUDE.md's
    // AI-output-language rule: market_positioning itself is always English,
    // translated from the Chinese source's own framing.
    market_positioning: { type: String, trim: true },
    market_positioning_source: { type: String, trim: true },
    market_positioning_confidence: { type: String, enum: CONFIDENCE_VALUES },
    /** Set only by app/api/models/[id]/apply-positioning/route.ts, only when verified as actually applied. */
    market_positioning_last_researched_at: { type: Date },
    // Chinese-source-only research (lib/issueResearch.ts), prioritizing
    // 车质网/汽车投诉网 — see that module's header comment.
    known_issues: [
      {
        _id: false,
        // Not `required`: items written before this field existed have no region
        // (treated as "china" on read; scripts/backfill-known-issue-region.ts tags
        // them). Every NEW write sets it — see apply-issues/route.ts.
        region: { type: String, enum: ISSUE_REGIONS },
        issue_description: { type: String, trim: true, required: true },
        affected_systems: [{ type: String, trim: true }],
        frequency_signal: { type: String, trim: true },
        source: { type: String, trim: true, required: true },
        source_url: { type: String, trim: true },
        confidence: { type: String, enum: CONFIDENCE_VALUES, required: true },
      },
    ],
    /** Set only by app/api/models/[id]/apply-issues/route.ts, only when verified as actually applied. Either region's write bumps it; the per-region fields below say which. */
    known_issues_last_researched_at: { type: Date },
    known_issues_china_last_researched_at: { type: Date },
    known_issues_global_last_researched_at: { type: Date },
    // Chinese-source-only (lib/marketTrendResearch.ts). Nested object, unlike
    // market_positioning's flat prefixed fields, because it carries several
    // co-dependent fields plus its own _confidence/_last_researched_at.
    market_trend: {
      _id: false,
      type: new Schema(
        {
          market_share_segment: { type: String, trim: true },
          sales_trend: { type: String, enum: SALES_TRENDS },
          trend_evidence: { type: String, trim: true },
          source_url: { type: String, trim: true },
          _confidence: { type: String, enum: CONFIDENCE_VALUES, required: true },
          _last_researched_at: { type: Date },
        },
        { _id: false }
      ),
    },
    // Chinese + manufacturer-service-site sources (lib/bulletinResearch.ts).
    technical_bulletins: [
      {
        _id: false,
        bulletin_id: { type: String, trim: true },
        issue_description: { type: String, trim: true, required: true },
        affected_component: { type: String, enum: AFFECTED_SYSTEMS, required: true },
        component_detail: { type: String, trim: true },
        issued_date: { type: String, trim: true },
        source_url: { type: String, trim: true, required: true },
        confidence: { type: String, enum: CONFIDENCE_VALUES, required: true },
      },
    ],
    technical_bulletins_last_researched_at: { type: Date },
    // NOT source-restricted (lib/recallResearch.ts). required_tools LINKS to the
    // brand's existing workshop data (see IRecallRequiredTools) — no tools schema here.
    recalls: [
      {
        _id: false,
        recall_id: { type: String, trim: true },
        issue_description: { type: String, trim: true, required: true },
        affected_component: { type: String, enum: AFFECTED_SYSTEMS, required: true },
        component_detail: { type: String, trim: true },
        recall_date: { type: String, trim: true },
        remedy_description: { type: String, trim: true, required: true },
        affected_scope: { type: String, trim: true },
        issuing_body: { type: String, trim: true },
        required_tools: {
          _id: false,
          type: new Schema(
            {
              uses_brand_diagnostic_interface: { type: Boolean, required: true },
              special_tool_names: [{ type: String, trim: true }],
              extra_tool_note: { type: String, trim: true },
            },
            { _id: false }
          ),
        },
        source_url: { type: String, trim: true, required: true },
        confidence: { type: String, enum: CONFIDENCE_VALUES, required: true },
      },
    ],
    recalls_last_researched_at: { type: Date },
    // Written by app/api/models/[id]/fetch-morocco-price/route.ts (a
    // deterministic scrape of moteur.ma/wandaloo.com) OR by
    // app/api/models/[id]/morocco-info/route.ts (direct manual entry,
    // source "manual" — see that route's own comment for why a manual
    // entry is marked confirmed without a source_url). Kept separate from
    // MoroccoListing (which is keyed by brand/model name and predates Model
    // having its own brand_id-scoped Morocco fields) so the UI can show a
    // price chip straight off the Model doc without a join.
    morocco_price_dh: { type: Number },
    morocco_price_source: { type: String, enum: ["moteur.ma", "wandaloo.com", "manual"] },
    morocco_price_url: { type: String },
    morocco_price_confirmed: { type: Boolean, default: false },
    morocco_to_china_price_ratio: { type: Number },
    morocco_to_china_price_ratio_computed_at: { type: Date },
    // Derived from this model's Powertrain docs by scripts/backfill-powertrain-category.ts,
    // not researched directly — see IModel.powertrain_category's doc comment in types/index.ts.
    powertrain_category: { type: String, enum: POWERTRAIN_CATEGORIES },
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
