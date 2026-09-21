import ExcelJS from "exceljs";
import { FLAT_COLUMNS } from "@/lib/export/flatColumns";
import type { ExportData } from "@/lib/export/load";
import { COLORS } from "@/lib/export/colors";

const WRAP_HEADERS = new Set(["Source", "Battery supplier", "Unverified reason", "Motor type"]);

/** Two sheets: "Data" (one row per trim, 72 columns, opens first) and "README". Deliberately NO known-issues / warranty / market-trend / recalls / bulletins data — that research has not been reviewed and applied to the DB. */
export async function buildWorkbook(d: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.title = "China EV DB export";

  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  ws.columns = FLAT_COLUMNS.map((c) => ({ header: c.header, width: Math.min(c.width, 45), style: c.fmt ? { numFmt: c.fmt } : {} }));
  for (const r of d.rows) ws.addRow(FLAT_COLUMNS.map((c) => c.get(r)));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: `FF${COLORS.white}` } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: FLAT_COLUMNS.length } };
  FLAT_COLUMNS.forEach((c, i) => { if (WRAP_HEADERS.has(c.header)) ws.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" }; });

  const readme = wb.addWorksheet("README");
  readme.getColumn(1).width = 28;
  readme.getColumn(2).width = 110;
  const c = d.counts;
  const rows: [string, string][] = [
    ["China EV DB export", ""],
    ["Exported", new Date().toISOString()],
    ["Scope", d.filtered ? "FILTERED to the Tech Search result set below" : "Full database (no filters)"],
    ...(d.filtered ? [["Filters applied", d.filters.join("; ")] as [string, string]] : []),
    ...(d.ignoredParams.length ? [["Ignored parameters", d.ignoredParams.join(", ") + " (not recognised — NOT applied)"] as [string, string]] : []),
    ["Data sheet", `${c.rows} rows, ${FLAT_COLUMNS.length} columns — one row per trim, covering ${c.models} models${d.filtered ? ` (of ${d.totals.models} in the DB; ${c.trimRows} of ${d.totals.trims} trims)` : ""}.`],
    ...(!d.filtered && c.modelsWithoutTrims ? [["Models without trims", `${c.modelsWithoutTrims} models have no trim data yet; each has ONE row with its model-level columns filled and every trim column (Trim name onward) empty. Filter Trim name to "(Blanks)" to find them.`] as [string, string]] : []),
    ["", ""],
    ["Repeated values", "Model-level columns (Brand through Morocco / China price ratio) are repeated on every trim row of that model. That is expected in a flat sheet: to count or sum per MODEL, pivot on Brand + Model, or use Remove Duplicates on those columns first — summing a model-level price across trim rows would double-count."],
    ["Two kinds of price", "Columns named 'China price …' and 'Morocco price …' are MODEL-level: the price range of the whole model (China) and its listed price in Morocco. Columns named 'Trim price …' are TRIM-level: that one trim's own price range. They are different values and often do not match."],
    ["Scope of the data", "PHEV (plug-in hybrid, not REEV/EREV) SUVs with an engine of 1.5 L or smaller."],
    ["Empty cells", "A value the database does not have is a truly EMPTY cell (never 0 or a dash), so sums, averages and pivots are not skewed. The confidence columns say whether a value is Confirmed against a source."],
    ["Prices", "Price columns are numbers. China prices are in the stated currency plus a USD conversion; Morocco prices are in DH and 'Confirmed' only when read from moteur.ma / wandaloo.com. 'China price status' marks ranges that a data audit questioned as Unverified."],
    ["Power units", "Power is exported in both kW (as stored) and hp (derived: kW × 1.341, rounded)."],
    ["Excluded on purpose", "Known issues, warranty, market trend, recalls and technical bulletins are NOT included: that research has not yet been reviewed and applied to the database, and unreviewed AI research is not exported as data."],
  ];
  rows.forEach(([a, b], i) => { const r = readme.addRow([a, b]); r.getCell(1).font = { bold: true, size: i === 0 ? 16 : 11 }; r.getCell(2).alignment = { wrapText: true, vertical: "top" }; r.getCell(1).alignment = { vertical: "top" }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
