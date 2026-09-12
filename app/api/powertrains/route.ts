import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Powertrain from "@/models/Powertrain";

export async function GET(req: NextRequest) {
  await connectToDatabase();
  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = {};

  const model_id = searchParams.get("model_id");
  const energy_type = searchParams.get("energy_type");
  const gearbox = searchParams.get("gearbox");
  const minBattery = searchParams.get("min_battery_kwh");
  const maxBattery = searchParams.get("max_battery_kwh");
  const ids = searchParams.get("ids");

  if (model_id) filter.model_id = model_id;
  if (energy_type) filter.energy_type = energy_type;
  if (gearbox) filter["transmission.type"] = gearbox;
  if (ids) filter._id = { $in: ids.split(",") };
  if (minBattery || maxBattery) {
    filter["battery.capacity_total_kwh"] = {};
    if (minBattery)
      (filter["battery.capacity_total_kwh"] as Record<string, unknown>).$gte = Number(minBattery);
    if (maxBattery)
      (filter["battery.capacity_total_kwh"] as Record<string, unknown>).$lte = Number(maxBattery);
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
