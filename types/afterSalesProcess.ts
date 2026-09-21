// Brand-level dealership after-sales PROCESS facts (dealership-ops-manual-v1's third section) — the
// things that are neither warranty coverage numbers (Brand.warranty_terms) nor workshop equipment
// (BrandPhevSuvWorkshopProfile). Dependency-free on purpose (no mongoose), like researchCategories.ts,
// so the Mongoose schema, the prompt and the validator all derive from the one key table below.
//
// Recall DATA is deliberately not here: recalls are model-level (Model.recalls[]) behind the exact-model
// identity guard. Only the brand's recall-NOTIFICATION process (campaign_notification) lives here.

export const NOT_FOUND = "NOT FOUND";

export const AFTER_SALES_SECTIONS = {
  claim_process: ["submission_channel", "required_documents", "approval_timeline", "reimbursement_terms", "rejection_and_appeal"],
  parts_logistics: [
    "distributor_name",
    "regional_warehouse",
    "standard_delivery_time",
    "emergency_delivery_time",
    "ordering_system",
    "parts_return_policy",
    "dealer_stocking_requirements",
  ],
  training_program: ["curriculum", "certification_cycle", "minimum_technician_headcount", "training_delivery_and_cost"],
  battery_claim_protocol: ["diagnostic_steps", "evidence_required", "replace_vs_repair_criteria", "return_and_recycling"],
  campaign_notification: ["notification_channel", "dealer_obligation", "response_deadline", "customer_contact_duty"],
} as const;

export type AfterSalesSectionKey = keyof typeof AFTER_SALES_SECTIONS;
export const AFTER_SALES_SECTION_KEYS = Object.keys(AFTER_SALES_SECTIONS) as AfterSalesSectionKey[];

/** Which market a parts_logistics fact describes. Deliberately no "china_domestic" — that is the backfill this section exists to prevent. */
export const PARTS_MARKETS = ["morocco", "mena", "other_export"] as const;
export type PartsMarket = (typeof PARTS_MARKETS)[number];

export interface IAfterSalesFact {
  value: string;
  /** http(s) URL, or "ATTACHED: <document title>" for a document the researcher was given directly. */
  source_url: string;
  /** Required on parts_logistics facts only. */
  market?: PartsMarket;
}

export type IAfterSalesSection = Partial<Record<string, IAfterSalesFact>>;

export interface IBrandAfterSalesProcess {
  _id?: string;
  brand_id: string;
  claim_process?: IAfterSalesSection;
  parts_logistics?: IAfterSalesSection;
  training_program?: IAfterSalesSection;
  battery_claim_protocol?: IAfterSalesSection;
  campaign_notification?: IAfterSalesSection;
  _confidence: "confirmed" | "unconfirmed";
  _last_researched_at?: string;
  createdAt?: string;
  updatedAt?: string;
}
