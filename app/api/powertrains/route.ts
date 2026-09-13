import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
// Side-effect imports only: registers "Model" and "Brand" so the nested
// .populate({ path: "model_id", populate: { path: "brand_id" } }) below
// resolves on a cold server instance regardless of request order — same
// reasoning as app/api/models/route.ts's Brand import. Without this, a
// serverless instance that has never handled /api/models or /api/brands
// first throws MissingSchemaError on the populate.
import ModelSchema from "@/models/Model";
import "@/models/Brand";
import Powertrain from "@/models/Powertrain";

/** Sets `filter[field] = { $gte, $lte }` from whichever of min/max query params are present — a field with no data on a given document simply never matches a $gte/$lte clause (Mongo's normal behavior for a missing field), which is exactly the desired "optional field, no filter = no effect, missing data = excluded only when a filter IS set" rule; nothing here needs to special-case null/undefined. No-op if neither bound is present. */
function applyRangeFilter(filter: Record<string, unknown>, field: string, min: string | null, max: string | null) {
  if (!min && !max) return;
  const range: Record<string, number> = {};
  if (min) range.$gte = Number(min);
  if (max) range.$lte = Number(max);
  filter[field] = range;
}

export async function GET(req: NextRequest) {
  await connectToDatabase();
  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = {};

  const model_id = searchParams.get("model_id");
  const energy_type = searchParams.get("energy_type");
  const gearbox = searchParams.get("gearbox");
  const fuel_type = searchParams.get("fuel_type");
  const aspiration = searchParams.get("aspiration");
  const drive = searchParams.get("drive");
  const hybrid_type = searchParams.get("hybrid_type");
  const hybrid_architecture = searchParams.get("hybrid_architecture");
  const emissions_standard = searchParams.get("emissions_standard");
  const ids = searchParams.get("ids");

  if (model_id) filter.model_id = model_id;
  if (energy_type) filter.energy_type = energy_type;
  if (gearbox) filter["transmission.type"] = gearbox;
  if (fuel_type) filter["engine.fuel_type"] = fuel_type;
  if (aspiration) filter["engine.aspiration"] = aspiration;
  if (drive) filter["motor.drive"] = drive;
  if (hybrid_type) filter.hybrid_type = hybrid_type;
  if (hybrid_architecture) filter.hybrid_architecture = hybrid_architecture;
  if (emissions_standard) filter.emissions_standard = emissions_standard;
  if (ids) filter._id = { $in: ids.split(",") };

  applyRangeFilter(filter, "battery.capacity_total_kwh", searchParams.get("min_battery_kwh"), searchParams.get("max_battery_kwh"));
  applyRangeFilter(filter, "engine.power_kw", searchParams.get("min_engine_power_kw"), searchParams.get("max_engine_power_kw"));
  applyRangeFilter(filter, "motor.power_kw", searchParams.get("min_motor_power_kw"), searchParams.get("max_motor_power_kw"));
  applyRangeFilter(filter, "engine.torque_nm", searchParams.get("min_engine_torque_nm"), searchParams.get("max_engine_torque_nm"));
  applyRangeFilter(filter, "motor.torque_nm", searchParams.get("min_motor_torque_nm"), searchParams.get("max_motor_torque_nm"));
  applyRangeFilter(filter, "engine.displacement_l", searchParams.get("min_displacement_l"), searchParams.get("max_displacement_l"));
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
  if (minPriceUsd || maxPriceUsd || minMoroccoPriceDh || maxMoroccoPriceDh) {
    const modelFilter: Record<string, unknown> = {};
    applyRangeFilter(modelFilter, "price_range.min_usd", minPriceUsd, null);
    applyRangeFilter(modelFilter, "price_range.max_usd", null, maxPriceUsd);
    applyRangeFilter(modelFilter, "morocco_price_dh", minMoroccoPriceDh, maxMoroccoPriceDh);
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

  // Refuse an unfiltered full-collection dump — every real caller (the
  // Compare page's per-model trim fetch, this new technical search) always
  // has at least one criterion. An empty filter used to mean "return every
  // powertrain in the DB, double-populated" on every page load before
  // a87acf5 fixed the one caller that did that; this closes the door on any
  // future caller reintroducing the same mistake.
  if (Object.keys(filter).length === 0) {
    return NextResponse.json({ error: "At least one filter parameter is required." }, { status: 400 });
  }

  const powertrains = await Powertrain.find(filter).populate({ path: "model_id", populate: { path: "brand_id" } }).lean();
  return NextResponse.json(powertrains);
}

export async function POST(req: NextRequest) {
  await connectToDatabase();
  const body = await req.json();
  try {
    const doc = await Powertrain.create(body);
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
