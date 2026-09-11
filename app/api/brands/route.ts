import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";

export async function GET() {
  await connectToDatabase();
  const brands = await Brand.find().sort({ name: 1 }).lean();
  return NextResponse.json(brands);
}

export async function POST(req: NextRequest) {
  await connectToDatabase();
  const body = await req.json();
  try {
    const brand = await Brand.create(body);
    return NextResponse.json(brand, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
