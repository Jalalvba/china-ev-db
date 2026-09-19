import { NextRequest } from "next/server";
import { loadExportData } from "@/lib/export/load";
import { buildWorkbook } from "@/lib/export/workbook";

export const dynamic = "force-dynamic";

/** GET /api/export[?<Tech Search query string>] — .xlsx of the database (full when no filters). */
export async function GET(req: NextRequest) {
  const data = await loadExportData(new URL(req.url).searchParams);
  const file = await buildWorkbook(data);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="china-ev-db${data.filtered ? "-filtered" : ""}-${stamp}.xlsx"`,
    },
  });
}
