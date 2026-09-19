// Registry of named queries a slide's `source` can reference. Each returns already-shaped, renderer-ready data
// computed from live DB documents — no literals. Add a query here (with its own provenance note) before a slide can use it.

import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { getCheapestMoroccoPriceByBrandId } from "@/lib/moroccoPrices";
import type { ChartData } from "@/lib/presentations/spec";

type Params = Record<string, string | number | boolean>;
const fmtDh = (n: number) => `${Math.round(n).toLocaleString("en-US")} DH`;

/** Cheapest CONFIRMED Morocco price per active brand, cheapest first. params.limit (default 10). */
async function brandsCheapestMoroccoPrice(params: Params): Promise<ChartData> {
  const limit = typeof params.limit === "number" ? params.limit : 10;
  await connectToDatabase();
  const [brands, priceById] = await Promise.all([Brand.find({}, { name: 1, logo_url: 1, status: 1 }).lean(), getCheapestMoroccoPriceByBrandId()]);
  const rows = brands
    .filter((b) => (!b.status || b.status === "active") && priceById[String(b._id)] !== undefined)
    .map((b) => ({ name: b.name as string, logo: b.logo_url as string | undefined, price: priceById[String(b._id)] }))
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);
  if (rows.length === 0) throw new Error("no brands with a confirmed Morocco price");
  return {
    kind: "bar",
    labels: rows.map((r) => r.name),
    series: [{ name: "Cheapest confirmed price (DH)", values: rows.map((r) => r.price) }],
    highlightIndex: 0,
    unit: "DH",
    keyNumber: { value: fmtDh(rows[0].price), label: `Entry price — ${rows[0].name}` },
    logo: { text: rows[0].name, imageUrl: rows[0].logo },
    sourceNote: "Confirmed Morocco prices (moteur.ma / wandaloo.com), cheapest model per brand",
    asOf: new Date().toISOString().slice(0, 10),
  };
}

export const QUERY_REGISTRY: Record<string, (params: Params) => Promise<ChartData>> = {
  "brands.cheapestMoroccoPrice": brandsCheapestMoroccoPrice,
};
