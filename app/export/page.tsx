import { loadExportData } from "@/lib/export/load";

export const dynamic = "force-dynamic";

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, x);
  const data = await loadExportData(sp);
  const qs = sp.toString();
  const href = `/api/export${qs ? `?${qs}` : ""}`;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">Export to Excel</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-6">Download the database as a multi-sheet .xlsx for analysis outside the app.</p>

      {data.filtered ? (
        <div className="mb-6 rounded border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold mb-1">Filtered export — exporting {data.trims.length} of {data.totals.trims} trims</p>
          <p className="mb-2">Scoped to your Tech Search filters: {data.filters.join("; ")}.</p>
          <a href="/export" className="text-blue-600 dark:text-blue-400 hover:underline">Export the full database instead</a>
        </div>
      ) : (
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">Full database. To export a Tech Search result set, open this page with the same query string as <code>/search/specs</code> (e.g. <code>/export?segment=SUV-compact&amp;displacement=1.5L</code>).</p>
      )}
      {data.ignoredParams.length > 0 && <p className="mb-4 text-sm text-red-500">Ignored (not recognised, not applied): {data.ignoredParams.join(", ")}</p>}

      <table className="text-sm mb-6 border-collapse">
        <tbody>
          <tr><td className="pr-8 py-1 font-semibold">Models sheet</td><td>{data.models.length} rows</td></tr>
          <tr><td className="pr-8 py-1 font-semibold">Trims sheet</td><td>{data.trims.length} rows (one per powertrain trim)</td></tr>
          <tr><td className="pr-8 py-1 font-semibold">Brands sheet</td><td>{data.brands.length} rows, with model and trim counts</td></tr>
          <tr><td className="pr-8 py-1 font-semibold">README sheet</td><td>scope, filters, units, what is excluded</td></tr>
        </tbody>
      </table>

      <a href={href} className="inline-block rounded bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-500">
        {data.filtered ? "Download filtered .xlsx" : "Download full database (.xlsx)"}
      </a>
      <p className="mt-6 text-xs text-zinc-500">
        Known issues, warranty, market trend, recalls and bulletins are deliberately not included: that research has not been reviewed and applied to the database yet.
      </p>
    </div>
  );
}
