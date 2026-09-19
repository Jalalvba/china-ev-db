import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { buildPowertrainFilter } from "@/lib/powertrainFilter";
import { techSearchToApiParams } from "@/lib/export/techSearchParams";
import type { BrandRow, ModelRow, TrimRow } from "@/lib/export/columns";

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ExportData {
  models: ModelRow[];
  trims: TrimRow[];
  brands: BrandRow[];
  filtered: boolean;
  filters: string[];
  ignoredParams: string[];
  totals: { models: number; trims: number; brands: number };
}

/** No filters -> the full database. With Tech Search filters -> the matching trims, plus only the models and brands those trims belong to. */
export async function loadExportData(sp: URLSearchParams): Promise<ExportData> {
  await connectToDatabase();
  const { api, described, ignored } = techSearchToApiParams(sp);
  const filtered = described.length > 0;
  const filter = filtered ? await buildPowertrainFilter(api) : {};

  const [allTrims, allModels, allBrands] = await Promise.all([
    Powertrain.find(filter).lean() as unknown as Promise<Rec[]>,
    ModelSchema.find().lean() as unknown as Promise<Rec[]>,
    Brand.find().lean() as unknown as Promise<Rec[]>,
  ]);
  const [dbTrimCount] = await Promise.all([Powertrain.countDocuments()]);

  const brandById = new Map(allBrands.map((b) => [String(b._id), b]));
  const trimsByModel = new Map<string, Rec[]>();
  for (const t of allTrims) trimsByModel.set(String(t.model_id), [...(trimsByModel.get(String(t.model_id)) ?? []), t]);

  const models = allModels.filter((m) => !filtered || trimsByModel.has(String(m._id)));
  const modelById = new Map(models.map((m) => [String(m._id), m]));
  const brandName = (m: Rec) => String(brandById.get(String(m.brand_id))?.name ?? "");

  const modelRows: ModelRow[] = models
    .map((m) => ({ model: m, brandName: brandName(m), trimCount: trimsByModel.get(String(m._id))?.length ?? 0 }))
    .sort((a, b) => a.brandName.localeCompare(b.brandName) || String(a.model.name).localeCompare(String(b.model.name)));
  const trimRows: TrimRow[] = allTrims
    .filter((t) => modelById.has(String(t.model_id)))
    .map((t) => { const model = modelById.get(String(t.model_id))!; return { trim: t, model, brandName: brandName(model) }; })
    .sort((a, b) => a.brandName.localeCompare(b.brandName) || String(a.model.name).localeCompare(String(b.model.name)) || String(a.trim.trim_name).localeCompare(String(b.trim.trim_name)));

  // Brands: only brands that own at least one exported model (orphaned brands would be empty rows). Cheapest CONFIRMED Morocco price, same rule as the homepage.
  const byBrand = new Map<string, Rec[]>();
  for (const m of models) byBrand.set(String(m.brand_id), [...(byBrand.get(String(m.brand_id)) ?? []), m]);
  const brandRows: BrandRow[] = [...byBrand.entries()]
    .map(([id, ms]) => {
      const prices = ms.filter((m) => m.morocco_price_confirmed === true && typeof m.morocco_price_dh === "number").map((m) => m.morocco_price_dh as number);
      return { brand: brandById.get(id) ?? { name: "(unknown brand)" }, modelCount: ms.length, trimCount: ms.reduce((n, m) => n + (trimsByModel.get(String(m._id))?.length ?? 0), 0), cheapestMoroccoDh: prices.length ? Math.min(...prices) : null };
    })
    .sort((a, b) => String(a.brand.name).localeCompare(String(b.brand.name)));

  return {
    models: modelRows, trims: trimRows, brands: brandRows, filtered, filters: described, ignoredParams: ignored,
    totals: { models: allModels.length, trims: dbTrimCount, brands: allBrands.length },
  };
}
