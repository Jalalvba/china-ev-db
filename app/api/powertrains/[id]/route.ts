import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
// Side-effect import only: registers "Model" so .populate("model_id") below
// resolves on a cold server instance regardless of request order — same
// latent bug fixed in app/api/powertrains/route.ts.
import "@/models/Model";
import Powertrain from "@/models/Powertrain";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const doc = await Powertrain.findById(id).populate("model_id").lean();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const body = await req.json();
  try {
    const doc = await Powertrain.findByIdAndUpdate(id, body, { new: true, runValidators: true });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await connectToDatabase();
  const { id } = await params;
  const doc = await Powertrain.findByIdAndDelete(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
