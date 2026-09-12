import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
// Side-effect import only: registers "Brand" so .populate("brand_id") below
// resolves on a cold server regardless of request order.
import "@/models/Brand";
import ModelSchema from "@/models/Model";

export async function GET(req: NextRequest) {
  await connectToDatabase();
  const { searchParams } = new URL(req.url);
  const filter: Record<string, unknown> = {};

  const brand_id = searchParams.get("brand_id");
  const segment = searchParams.get("segment");
  const production_status = searchParams.get("production_status");
  const minPrice = searchParams.get("min_price_usd");
  const maxPrice = searchParams.get("max_price_usd");

  if (brand_id) filter.brand_id = brand_id;
  if (segment) filter.segment = segment;
  if (production_status) filter.production_status = production_status;
  if (minPrice || maxPrice) {
    filter["price_range.min_usd"] = {};
    if (minPrice) (filter["price_range.min_usd"] as Record<string, unknown>).$gte = Number(minPrice);
    if (maxPrice) (filter["price_range.min_usd"] as Record<string, unknown>).$lte = Number(maxPrice);
  }

  const models = await ModelSchema.find(filter).populate("brand_id").sort({ name: 1 }).lean();
  return NextResponse.json(models);
}

export async function POST(req: NextRequest) {
  await connectToDatabase();
  const body = await req.json();
  try {
    const doc = await ModelSchema.create(body);
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
