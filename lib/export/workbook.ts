import ExcelJS from "exceljs";
import { BRAND_COLUMNS, MODEL_COLUMNS, TRIM_COLUMNS, type ColumnSpec } from "@/lib/export/columns";
import type { ExportData } from "@/lib/export/load";
import { COLORS } from "@/lib/presentations/tokens";

const WRAP_HEADERS = new Set(["Source", "Battery supplier", "Unverified reason", "Motor type", "Trim names"]);

function addSheet<T>(wb: ExcelJS.Workbook, name: string, cols: ColumnSpec<T>[], rows: T[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: Math.min(c.width, 45), style: c.fmt ? { numFmt: c.fmt } : {} }));
  for (const r of rows) ws.addRow(cols.map((c) => c.get(r)));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: `FF${COLORS.white}` } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.navy}` } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  cols.forEach((c, i) => { if (WRAP_HEADERS.has(c.header)) ws.getColumn(i + 1).alignment = { wrapText: true, vertical: "top" }; });
  return ws;
}

/** README first (so it opens on it), then Models / Trims / Brands. Deliberately NO known-issues / warranty / market-trend / recalls / bulletins sheets — none of that research has been reviewed and applied to the DB. */
export async function buildWorkbook(d: ExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.title = "China EV DB export";

  const readme = wb.addWorksheet("README");
  readme.getColumn(1).width = 28;
  readme.getColumn(2).width = 110;
  const rows: [string, string][] = [
    ["China EV DB export", ""],
    ["Exported", new Date().toISOString()],
    ["Scope", d.filtered ? "FILTERED to the Tech Search result set below" : "Full database (no filters)"],
    ...(d.filtered ? [["Filters applied", d.filters.join("; ")] as [string, string]] : []),
    ...(d.ignoredParams.length ? [["Ignored parameters", d.ignoredParams.join(", ") + " (not recognised — NOT applied)"] as [string, string]] : []),
    ["Models sheet", `${d.models.length} rows${d.filtered ? ` (of ${d.totals.models} in the DB — only models with a matching trim)` : ""}`],
    ["Trims sheet", `${d.trims.length} rows${d.filtered ? ` (of ${d.totals.trims} in the DB)` : ""} — one per Powertrain document`],
    ["Brands sheet", `${d.brands.length} rows — only brands that own at least one exported model`],
    ["", ""],
    ["Scope of the data", "PHEV (plug-in hybrid, not REEV/EREV) SUVs with an engine of 1.5 L or smaller."],
    ["Empty cells", "A value the database does not have is a truly EMPTY cell (never 0 or a dash), so sums, averages and pivots are not skewed. Confidence columns say whether a value is Confirmed against a source."],
    ["Prices", "Price columns are numbers. China prices are in the stated currency plus a USD conversion; Morocco prices are in DH and 'Confirmed' only when read from moteur.ma / wandaloo.com. A Verified/Unverified flag marks China price ranges that a data audit questioned."],
    ["Power units", "Power is exported in both kW (as stored) and hp (derived: kW × 1.341, rounded)."],
    ["Excluded on purpose", "Known issues, warranty, market trend, recalls and technical bulletins are NOT included: that research has not yet been reviewed and applied to the database, and unreviewed AI research is not exported as data."],
  ];
  rows.forEach(([a, b], i) => { const r = readme.addRow([a, b]); r.getCell(1).font = { bold: true }; r.getCell(2).alignment = { wrapText: true, vertical: "top" }; if (i === 0) r.getCell(1).font = { bold: true, size: 16 }; });

  addSheet(wb, "Models", MODEL_COLUMNS, d.models);
  addSheet(wb, "Trims", TRIM_COLUMNS, d.trims);
  addSheet(wb, "Brands", BRAND_COLUMNS, d.brands);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
