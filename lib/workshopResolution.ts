// Resolves a model's/brand's effective workshop requirements: the
// workshop_standards doc matching (powertrain_category, service_tier), with any
// matching brand_workshop_overrides doc merged on top — field-by-field, not
// whole-doc replace. See CLAUDE.md's "REBUILD /workshop PAGE" note and
// types/index.ts's IWorkshopStandard/IBrandWorkshopOverride doc comments.

import type {
  IWorkshopStandard,
  IBrandWorkshopOverride,
  ITechnicianCertification,
  ILiftRequirements,
  ISpecialTool,
  PowertrainCategory,
} from "@/types";

export interface ResolvedWorkshopRequirements {
  powertrain_category: IWorkshopStandard["powertrain_category"];
  service_tier: IWorkshopStandard["service_tier"];
  technician_certification?: ITechnicianCertification;
  lift_requirements?: ILiftRequirements;
  special_tools?: ISpecialTool[];
  /** true when a brand_workshop_override actually changed at least one field vs. the base standard. */
  has_override: boolean;
  _base_source: IWorkshopStandard["_source"];
  _base_confidence: IWorkshopStandard["_confidence"];
}

/**
 * Explicit "not yet classified" result for a model whose `powertrain_category` is
 * unset — e.g. no Powertrain docs have been researched for it yet (the ~260-model
 * case backfill-powertrain-category.ts reported as "skipped"). Never silently
 * treated as ICE or any other default; callers must check `classified: false` and
 * render a distinct state ("not yet classified" / "needs spec research first"),
 * not an empty/zeroed-out requirements card.
 */
export interface UnclassifiedWorkshopRequirements {
  classified: false;
}

export type WorkshopRequirementsResult = (ResolvedWorkshopRequirements & { classified: true }) | UnclassifiedWorkshopRequirements;

/**
 * Merges one override field onto the base object. Object-shaped fields
 * (technician_certification, lift_requirements) are shallow-merged key-by-key —
 * an override that only sets e.g. `retraining_interval_months` leaves the base's
 * `level`/`body` untouched.
 */
function mergeObjectField<T extends object>(base: T | undefined, override: Partial<T> | undefined): T | undefined {
  if (!override) return base;
  if (!base) return override as T;
  return { ...base, ...override };
}

/**
 * Merges special_tools by `name`: an override tool whose name matches a baseline
 * tool replaces that entry in place (so e.g. a brand-specific note on "HV glove
 * tester" doesn't erase the rest of the baseline tool list); an override tool with
 * a name not present in the baseline is appended; every baseline tool not
 * mentioned in the override is kept as-is. Order: baseline order preserved, new
 * override-only tools appended at the end.
 */
function mergeSpecialTools(base: ISpecialTool[] | undefined, override: ISpecialTool[] | undefined): ISpecialTool[] | undefined {
  if (!override) return base;
  if (!base || base.length === 0) return override;

  const overrideByName = new Map(override.map((t) => [t.name, t]));
  const merged = base.map((t) => overrideByName.get(t.name) ?? t);

  const baseNames = new Set(base.map((t) => t.name));
  const appended = override.filter((t) => !baseNames.has(t.name));

  return [...merged, ...appended];
}

export function resolveWorkshopRequirements(
  standard: IWorkshopStandard,
  override?: IBrandWorkshopOverride | null
): ResolvedWorkshopRequirements {
  const o = override?.overrides;
  const technician_certification = mergeObjectField(standard.technician_certification, o?.technician_certification);
  const lift_requirements = mergeObjectField(standard.lift_requirements, o?.lift_requirements);
  const special_tools = mergeSpecialTools(standard.special_tools, o?.special_tools);

  const has_override = Boolean(
    o && (o.technician_certification !== undefined || o.lift_requirements !== undefined || o.special_tools !== undefined)
  );

  return {
    powertrain_category: standard.powertrain_category,
    service_tier: standard.service_tier,
    technician_certification,
    lift_requirements,
    special_tools,
    has_override,
    _base_source: standard._source,
    _base_confidence: standard._confidence,
  };
}

/**
 * Model-facing entry point: looks up the matching workshop_standards doc (from an
 * already-fetched map, see app/workshop/page.tsx) for `powertrain_category` +
 * `service_tier` and merges the matching override on top — or returns the explicit
 * `{ classified: false }` state when `powertrain_category` is null/undefined
 * (per review question 3a: never default to ICE or any other category).
 */
export function resolveWorkshopRequirementsForCategory(
  powertrain_category: PowertrainCategory | null | undefined,
  service_tier: IWorkshopStandard["service_tier"],
  standardsByCategoryAndTier: Map<string, IWorkshopStandard>,
  override?: IBrandWorkshopOverride | null
): WorkshopRequirementsResult | null {
  if (!powertrain_category) return { classified: false };
  const standard = standardsByCategoryAndTier.get(`${powertrain_category}/${service_tier}`);
  if (!standard) return null; // no seeded standard for this combination (e.g. ICE/hv_battery) — distinct from "unclassified"
  return { ...resolveWorkshopRequirements(standard, override), classified: true };
}
