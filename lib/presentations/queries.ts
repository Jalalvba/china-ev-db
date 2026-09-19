// Registry of named queries a slide's `source` can reference. Each returns already-shaped, renderer-ready data
// computed from live DB documents — no literals. Add a query here (with its own provenance note) before a slide can use it.

import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import { getCheapestMoroccoPriceByBrandId } from "@/lib/moroccoPrices";
import Powertrain from "@/models/Powertrain";
import ModelSchema from "@/models/Model";
import { kwToHp } from "@/lib/units";
import type { ChartData, SlideType, TableData } from "@/lib/presentations/spec";

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
    proxy: { standsInFor: "market share / sales volume", actually: "cheapest confirmed Morocco price per brand — the DB has no sales-volume data" },
    sourceNote: "Confirmed Morocco prices (moteur.ma / wandaloo.com), cheapest model per brand",
    asOf: new Date().toISOString().slice(0, 10),
  };
}

/** Every trim in the DB is PHEV <=1.5L (enforced, lib/powertrainScope.ts). Compares the N cheapest models with a confirmed Morocco price, one representative trim each (largest battery; ties -> longest EV range). params.limit (default 6). */
async function modelsPhevSpecComparison(params: Params): Promise<TableData> {
  const limit = typeof params.limit === "number" ? params.limit : 6;
  await connectToDatabase();
  const models = await ModelSchema.find({ morocco_price_confirmed: true, morocco_price_dh: { $exists: true, $ne: null } }, { name: 1, brand_id: 1, morocco_price_dh: 1 }).populate("brand_id", "name").lean();
  const trims = await Powertrain.find({ model_id: { $in: models.map((m) => m._id) }, energy_type: "PHEV" }).lean();
  const byModel = new Map<string, typeof trims>();
  for (const t of trims) byModel.set(String(t.model_id), [...(byModel.get(String(t.model_id)) ?? []), t]);
  const score = (t: (typeof trims)[number]) => (t.battery?.capacity_total_kwh ?? 0) * 1000 + (t.battery?.ev_range_km ?? 0);
  const rows = models
    .filter((m) => byModel.has(String(m._id)))
    .sort((a, b) => a.morocco_price_dh! - b.morocco_price_dh!)
    .slice(0, limit)
    .map((m) => {
      const t = [...byModel.get(String(m._id))!].sort((a, b) => score(b) - score(a))[0];
      const brand = (m.brand_id as unknown as { name?: string } | null)?.name ?? "";
      // Many model names already start with the brand ("Dongfeng Mage"); prefixing again reads "Dongfeng Dongfeng Mage".
      const label = m.name.toLowerCase().startsWith(brand.toLowerCase()) ? m.name : `${brand} ${m.name}`.trim();
      const conf = (c?: string) => c !== "confirmed";
      const hp = kwToHp(t.combined_system_power_kw);
      const cell = (text: string | undefined, unconfirmed = false) => (text === undefined ? { text: "—" } : { text, unconfirmed });
      const d = t.engine?.displacement_l;
      return {
        cells: [
          { text: label },
          cell(d !== undefined ? `${d}L${t.engine?.aspiration && t.engine.aspiration !== "n/a" ? " " + (/natural/i.test(t.engine.aspiration) ? "NA" : t.engine.aspiration) : ""}` : undefined, conf(t.engine?.confidence)),
          cell(hp !== undefined ? `${Math.round(hp)} hp` : undefined, conf(t.confidence)),
          cell(t.battery?.capacity_total_kwh !== undefined ? `${t.battery.capacity_total_kwh} kWh` : undefined, conf(t.battery?.confidence)),
          cell(t.battery?.ev_range_km !== undefined ? `${t.battery.ev_range_km} km${t.battery.ev_range_standard ? " " + t.battery.ev_range_standard : ""}` : undefined, conf(t.battery?.confidence)),
          { text: fmtDh(m.morocco_price_dh!) },
        ],
      };
    });
  if (rows.length === 0) throw new Error("no models with a confirmed Morocco price and PHEV trims");
  return {
    columns: [
      { label: "Model", align: "left" }, { label: "Engine", align: "left" }, { label: "System power", align: "right" },
      { label: "Battery", align: "right" }, { label: "EV range", align: "right" }, { label: "Morocco price", align: "right" },
    ],
    rows,
    sourceNote: "China EV DB (PHEV trims) · Morocco prices from moteur.ma / wandaloo.com",
    footnote: "One representative trim per model: largest battery, then longest EV range. * = value not yet confirmed against a source.",
    asOf: new Date().toISOString().slice(0, 10),
  };
}

export const QUERY_REGISTRY: Record<string, { kind: SlideType; run: (params: Params) => Promise<ChartData | TableData> }> = {
  "brands.cheapestMoroccoPrice": { kind: "chart", run: brandsCheapestMoroccoPrice },
  "models.phevSpecComparison": { kind: "table", run: modelsPhevSpecComparison },
};
