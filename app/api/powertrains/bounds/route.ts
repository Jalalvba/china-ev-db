import { NextRequest, NextResponse } from "next/server";
import type { Model, PipelineStage } from "mongoose";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";

/**
 * Live min/max across the CURRENT dataset (optionally narrowed to one or more
 * segments) for every Tech Search range-filter field — powers the "e.g. <real
 * bound>" label/pre-fill on those inputs. Queried fresh on every call rather
 * than baked in at build time: this DB is actively edited (models/trims added,
 * deleted, re-scoped), so a build-time constant would silently drift from
 * reality the next time someone edits data, exactly the same staleness this
 * page's other filters were just audited for.
 */
async function minMax(model: Model<unknown>, path: string, extraMatch: Record<string, unknown> = {}): Promise<{ min: number | null; max: number | null }> {
  const pipeline: PipelineStage[] = [
    { $match: { ...extraMatch, [path]: { $ne: null, $exists: true } } },
    { $group: { _id: null, min: { $min: `$${path}` }, max: { $max: `$${path}` } } },
  ];
  const result = await model.aggregate<{ min: number; max: number }>(pipeline);
  const row = result[0];
  return row ? { min: row.min, max: row.max } : { min: null, max: null };
}

export async function GET(req: NextRequest) {
  await connectToDatabase();

  // Same comma-separated multi-value convention as /api/powertrains' own
  // segment param — no segment param at all means "across every model",
  // unchanged from before this endpoint understood segments.
  const segmentParam = req.nextUrl.searchParams.get("segment");
  const segmentFilter = segmentParam ? { segment: segmentParam.includes(",") ? { $in: segmentParam.split(",") } : segmentParam } : {};

  let trimMatch: Record<string, unknown> = {};
  if (segmentParam) {
    const matchingModels = (await ModelSchema.find(segmentFilter, { _id: 1 }).lean()) as unknown as { _id: unknown }[];
    trimMatch = { model_id: { $in: matchingModels.map((m) => m._id) } };
  }

  const [enginePowerKw, motorPowerKw, combinedPowerKw, engineTorque, motorTorque, batteryKwh, evRangeKm, priceMinUsd, priceMaxUsd, moroccoDh] =
    await Promise.all([
      minMax(Powertrain, "engine.power_kw", trimMatch),
      minMax(Powertrain, "motor.power_kw", trimMatch),
      minMax(Powertrain, "combined_system_power_kw", trimMatch),
      minMax(Powertrain, "engine.torque_nm", trimMatch),
      minMax(Powertrain, "motor.torque_nm", trimMatch),
      minMax(Powertrain, "battery.capacity_total_kwh", trimMatch),
      minMax(Powertrain, "battery.ev_range_km", trimMatch),
      minMax(ModelSchema, "price_range.min_usd", segmentFilter),
      minMax(ModelSchema, "price_range.max_usd", segmentFilter),
      minMax(ModelSchema, "morocco_price_dh", segmentFilter),
    ]);

  return NextResponse.json({
    enginePowerKw,
    motorPowerKw,
    combinedPowerKw,
    engineTorque,
    motorTorque,
    batteryKwh,
    evRangeKm,
    priceMinUsd,
    priceMaxUsd,
    moroccoDh,
  });
}
