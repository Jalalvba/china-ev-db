import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const doc = await ModelSchema.findById(id).populate("brand_id").lean();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const powertrains = await Powertrain.find({ model_id: id }).lean();
  return NextResponse.json({ ...doc, powertrains });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const body = await req.json();
  try {
    const doc = await ModelSchema.findByIdAndUpdate(id, body, { new: true, runValidators: true });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const doc = await ModelSchema.findByIdAndDelete(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await Powertrain.deleteMany({ model_id: id });
  return NextResponse.json({ success: true });
}
