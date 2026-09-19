import ModelSchema from "@/models/Model";

// Extracted from app/api/powertrains/route.ts so the Tech Search API and the Excel export (lib/export) build the SAME Mongo filter from
// the same query params and can't drift apart. Behavior is unchanged from the inline version.
/** Sets `filter[field] = { $gte, $lte }` from whichever of min/max query params are present — a field with no data on a given document simply never matches a $gte/$lte clause (Mongo's normal behavior for a missing field), which is exactly the desired "optional field, no filter = no effect, missing data = excluded only when a filter IS set" rule; nothing here needs to special-case null/undefined. No-op if neither bound is present. */
function applyRangeFilter(filter: Record<string, unknown>, field: string, min: string | null, max: string | null) {
  if (!min && !max) return;
  const range: Record<string, number> = {};
  if (min) range.$gte = Number(min);
  if (max) range.$lte = Number(max);
  filter[field] = range;
}

export async function buildPowertrainFilter(searchParams: URLSearchParams): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};

  const model_id = searchParams.get("model_id");
  const energy_type = searchParams.get("energy_type");
  const gearbox = searchParams.get("gearbox");
  const fuel_type = searchParams.get("fuel_type");
  const aspiration = searchParams.get("aspiration");
  const drive = searchParams.get("drive");
  const hybrid_type = searchParams.get("hybrid_type");
  const hybrid_architecture = searchParams.get("hybrid_architecture");
  const ids = searchParams.get("ids");

  if (model_id) filter.model_id = model_id;
  // Comma-separated accepts multiple exact values (e.g. Tech Search always sends
  // "PHEV,REEV/EREV" now that energy_type isn't a user-facing filter there) while
  // staying a single-value exact match for every other caller.
  if (energy_type) filter.energy_type = energy_type.includes(",") ? { $in: energy_type.split(",") } : energy_type;
  if (gearbox) filter["transmission.type"] = gearbox;
  if (fuel_type) filter["engine.fuel_type"] = fuel_type;
  if (aspiration) filter["engine.aspiration"] = aspiration;
  if (drive) filter["motor.drive"] = drive;
  if (hybrid_type) filter.hybrid_type = hybrid_type;
  if (hybrid_architecture) filter.hybrid_architecture = hybrid_architecture;
  if (ids) filter._id = { $in: ids.split(",") };

  applyRangeFilter(filter, "battery.capacity_total_kwh", searchParams.get("min_battery_kwh"), searchParams.get("max_battery_kwh"));
  applyRangeFilter(filter, "engine.power_kw", searchParams.get("min_engine_power_kw"), searchParams.get("max_engine_power_kw"));
  applyRangeFilter(filter, "motor.power_kw", searchParams.get("min_motor_power_kw"), searchParams.get("max_motor_power_kw"));
  applyRangeFilter(filter, "engine.torque_nm", searchParams.get("min_engine_torque_nm"), searchParams.get("max_engine_torque_nm"));
  applyRangeFilter(filter, "motor.torque_nm", searchParams.get("min_motor_torque_nm"), searchParams.get("max_motor_torque_nm"));
  // Displacement is a small, closed catalog (2026-09-18 audit: only 4 real engine
  // sizes exist across the PHEV-SUV-scoped DB) rather than the continuous spread
  // power/torque/battery/price have — Tech Search sends an exact-value list here,
  // not a min/max range, same $in pattern as energy_type above.
  const displacementL = searchParams.get("displacement_l");
  if (displacementL) filter["engine.displacement_l"] = { $in: displacementL.split(",").map(Number) };
  applyRangeFilter(filter, "battery.ev_range_km", searchParams.get("min_ev_range_km"), searchParams.get("max_ev_range_km"));
  applyRangeFilter(
    filter,
    "combined_system_power_kw",
    searchParams.get("min_combined_system_power_kw"),
    searchParams.get("max_combined_system_power_kw")
  );

  // Price lives on the Model, not the Powertrain, so it can't go through
  // applyRangeFilter above — resolve it to a set of matching model_ids
  // first. min/max bound the model's own price_range.min_usd/max_usd (a
  // Min $20k/Max $30k search matches a model priced $22k-$28k, not one
  // priced $18k-$35k that merely overlaps the range) so "budget" filters
  // read the way a buyer expects, not as an overlap test.
  const minPriceUsd = searchParams.get("min_price_usd");
  const maxPriceUsd = searchParams.get("max_price_usd");
  const minMoroccoPriceDh = searchParams.get("min_morocco_price_dh");
  const maxMoroccoPriceDh = searchParams.get("max_morocco_price_dh");
  // Segment also lives on the Model, not the Powertrain — same "resolve to
  // matching model_ids first" approach as price below, folded into the same
  // modelFilter/intersection so a segment filter and a price filter combine
  // correctly (both narrow the same model_ids set) rather than needing two
  // separate resolve-then-intersect passes.
  const segment = searchParams.get("segment");
  if (minPriceUsd || maxPriceUsd || minMoroccoPriceDh || maxMoroccoPriceDh || segment) {
    const modelFilter: Record<string, unknown> = {};
    applyRangeFilter(modelFilter, "price_range.min_usd", minPriceUsd, null);
    applyRangeFilter(modelFilter, "price_range.max_usd", null, maxPriceUsd);
    applyRangeFilter(modelFilter, "morocco_price_dh", minMoroccoPriceDh, maxMoroccoPriceDh);
    // Comma-separated accepts multiple segments (Tech Search's segment filter is
    // multi-select) via $in; a single value stays an exact match either way.
    if (segment) modelFilter.segment = segment.includes(",") ? { $in: segment.split(",") } : segment;
    const matchingModels = (await ModelSchema.find(modelFilter, { _id: 1 }).lean()) as unknown as { _id: unknown }[];
    const matchingIds = matchingModels.map((m) => String(m._id));
    // Intersect with an already-set model_id filter rather than clobber it —
    // only the single-model-id caller (model_id=...) sets that today, and
    // price filters should still narrow it further if both are passed.
    const existing = filter.model_id;
    if (existing && typeof existing === "string") {
      filter.model_id = matchingIds.includes(existing) ? existing : { $in: [] };
    } else {
      filter.model_id = { $in: matchingIds };
    }
  }

  return filter;
}
