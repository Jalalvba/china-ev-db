// Single-sheet layout (the export's "Data" sheet): ONE ROW PER TRIM, model-level values repeated on every trim row of that model. Built by composing the
// already-approved Model and Trim column specs (lib/export/columns.ts) so headers, formats and flattening stay identical.

import { MODEL_COLUMNS, TRIM_COLUMNS, type ColumnSpec } from "@/lib/export/columns";

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** `trim` is null for a model that has no Powertrain docs at all — it still gets ONE row (model-level columns filled, every trim column empty) so it isn't silently dropped from the export. */
export interface FlatRow { model: Rec; brandName: string; trim: Rec | null }

// Brand + Model already appear once, from the model side.
const DROP_FROM_TRIM = new Set(["Brand", "Model"]);

const fromModel = MODEL_COLUMNS.map<ColumnSpec<FlatRow>>((c) => ({ ...c, get: (r) => c.get({ model: r.model, brandName: r.brandName }) }));
const fromTrim = TRIM_COLUMNS.filter((c) => !DROP_FROM_TRIM.has(c.header)).map<ColumnSpec<FlatRow>>((c) => ({ ...c, get: (r) => c.get({ trim: r.trim ?? {}, model: r.model, brandName: r.brandName }) }));

export const FLAT_COLUMNS: ColumnSpec<FlatRow>[] = [...fromModel, ...fromTrim];
export const FLAT_MODEL_COLUMN_COUNT = fromModel.length;
