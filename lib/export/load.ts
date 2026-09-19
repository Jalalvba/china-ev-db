import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import { buildPowertrainFilter } from "@/lib/powertrainFilter";
import { techSearchToApiParams } from "@/lib/export/techSearchParams";
import type { FlatRow } from "@/lib/export/flatColumns";

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ExportData {
  /** One row per trim; a model with NO trim docs gets exactly one row with every trim column empty (unfiltered export only). */
  rows: FlatRow[];
  filtered: boolean;
  filters: string[];
  ignoredParams: string[];
  counts: { rows: number; models: number; trimRows: number; modelsWithoutTrims: number };
  totals: { models: number; trims: number };
}

/** No filters -> the full database. With Tech Search filters -> only the matching trims (a spec filter can't match a model that has no trims, so those models are excluded). */
export async function loadExportData(sp: URLSearchParams): Promise<ExportData> {
  await connectToDatabase();
  const { api, described, ignored } = techSearchToApiParams(sp);
  const filtered = described.length > 0;
  const filter = filtered ? await buildPowertrainFilter(api) : {};

  const [trims, models, brands, dbTrimCount] = await Promise.all([
    Powertrain.find(filter).lean() as unknown as Promise<Rec[]>,
    ModelSchema.find().lean() as unknown as Promise<Rec[]>,
    Brand.find({}, { name: 1 }).lean() as unknown as Promise<Rec[]>,
    Powertrain.countDocuments(),
  ]);
  const brandName = new Map(brands.map((b) => [String(b._id), String(b.name ?? "")]));
  const modelById = new Map(models.map((m) => [String(m._id), m]));

  const rows: FlatRow[] = [];
  const modelsSeen = new Set<string>();
  let modelsWithoutTrims = 0;
  for (const t of trims) {
    const m = modelById.get(String(t.model_id));
    if (!m) continue; // orphaned trim (its model no longer exists) — nothing to attach it to
    modelsSeen.add(String(m._id));
    rows.push({ model: m, brandName: brandName.get(String(m.brand_id)) ?? "", trim: t });
  }
  if (!filtered) {
    for (const m of models) if (!modelsSeen.has(String(m._id))) { modelsWithoutTrims++; modelsSeen.add(String(m._id)); rows.push({ model: m, brandName: brandName.get(String(m.brand_id)) ?? "", trim: null }); }
  }
  rows.sort((a, b) => a.brandName.localeCompare(b.brandName) || String(a.model.name).localeCompare(String(b.model.name)) || String(a.trim?.trim_name ?? "").localeCompare(String(b.trim?.trim_name ?? "")));

  return {
    rows, filtered, filters: described, ignoredParams: ignored,
    counts: { rows: rows.length, models: modelsSeen.size, trimRows: rows.filter((r) => r.trim).length, modelsWithoutTrims },
    totals: { models: models.length, trims: dbTrimCount },
  };
}
