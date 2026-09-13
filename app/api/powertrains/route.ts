import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
// Side-effect imports only: registers "Model" and "Brand" so the nested
// .populate({ path: "model_id", populate: { path: "brand_id" } }) below
// resolves on a cold server instance regardless of request order — same
// reasoning as app/api/models/route.ts's Brand import. Without this, a
// serverless instance that has never handled /api/models or /api/brands
// first throws MissingSchemaError on the populate.
import "@/models/Model";
import "@/models/Brand";
import Powertrain from "@/models/Powertrain";

export async function GET(req: NextRequest) {
  await connectToDatabase();
  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = {};

  const model_id = searchParams.get("model_id");
  const energy_type = searchParams.get("energy_type");
  const gearbox = searchParams.get("gearbox");
  const fuel_type = searchParams.get("fuel_type");
  const aspiration = searchParams.get("aspiration");
  const minBattery = searchParams.get("min_battery_kwh");
  const maxBattery = searchParams.get("max_battery_kwh");
  const minEnginePower = searchParams.get("min_engine_power_kw");
  const maxEnginePower = searchParams.get("max_engine_power_kw");
  const minMotorPower = searchParams.get("min_motor_power_kw");
  const maxMotorPower = searchParams.get("max_motor_power_kw");
  const ids = searchParams.get("ids");

  if (model_id) filter.model_id = model_id;
  if (energy_type) filter.energy_type = energy_type;
  if (gearbox) filter["transmission.type"] = gearbox;
  if (fuel_type) filter["engine.fuel_type"] = fuel_type;
  if (aspiration) filter["engine.aspiration"] = aspiration;
  if (ids) filter._id = { $in: ids.split(",") };
  if (minBattery || maxBattery) {
    filter["battery.capacity_total_kwh"] = {};
    if (minBattery)
      (filter["battery.capacity_total_kwh"] as Record<string, unknown>).$gte = Number(minBattery);
    if (maxBattery)
      (filter["battery.capacity_total_kwh"] as Record<string, unknown>).$lte = Number(maxBattery);
  }
  if (minEnginePower || maxEnginePower) {
    filter["engine.power_kw"] = {};
    if (minEnginePower) (filter["engine.power_kw"] as Record<string, unknown>).$gte = Number(minEnginePower);
    if (maxEnginePower) (filter["engine.power_kw"] as Record<string, unknown>).$lte = Number(maxEnginePower);
  }
  if (minMotorPower || maxMotorPower) {
    filter["motor.power_kw"] = {};
    if (minMotorPower) (filter["motor.power_kw"] as Record<string, unknown>).$gte = Number(minMotorPower);
    if (maxMotorPower) (filter["motor.power_kw"] as Record<string, unknown>).$lte = Number(maxMotorPower);
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
