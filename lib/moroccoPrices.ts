import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";

/** Brand _id (as string) -> cheapest confirmed Morocco price (DH) among its models. Shared so "confirmed price" can't be defined two ways. See CLAUDE.md "Listing conventions". */
export async function getCheapestMoroccoPriceByBrandId(): Promise<Record<string, number>> {
  await connectToDatabase();
  const models = await ModelSchema.find(
    { morocco_price_confirmed: true, morocco_price_dh: { $exists: true, $ne: null } },
    { brand_id: 1, morocco_price_dh: 1 }
  ).lean();
  const result: Record<string, number> = {};
  for (const m of models) {
    const brandId = String(m.brand_id);
    if (result[brandId] === undefined || m.morocco_price_dh! < result[brandId]) {
      result[brandId] = m.morocco_price_dh!;
    }
  }
  return result;
}
