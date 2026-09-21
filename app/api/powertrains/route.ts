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
import { buildPowertrainFilter } from "@/lib/powertrainFilter";

export async function GET(req: NextRequest) {
  await connectToDatabase();
  const { searchParams } = new URL(req.url);
  const filter = await buildPowertrainFilter(searchParams);

  // Refuse an unfiltered full-collection dump — every real caller (the
  // model page's per-model trim fetch, Tech Search) always
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
