import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import type { IBrand, IModel } from "@/types";
import PositioningResearch from "@/app/PositioningResearch";
import { formatRelativeTime } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

async function getData(): Promise<{ models: IModel[]; brandNameById: Record<string, string> }> {
  await connectToDatabase();
  const [models, brands] = await Promise.all([
    ModelSchema.find().sort({ name: 1 }).lean(),
    Brand.find({}, { name: 1 }).lean() as Promise<IBrand[]>,
  ]);
  const brandNameById: Record<string, string> = {};
  for (const b of brands) brandNameById[String(b._id)] = b.name;
  return JSON.parse(JSON.stringify({ models, brandNameById }));
}

export default async function BenchmarkingPage() {
  const { models, brandNameById } = await getData();
  const researched = models.filter((m) => m.market_positioning);
  const unresearched = models.filter((m) => !m.market_positioning);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Market Positioning</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-6">
        How Chinese auto media itself frames each model&apos;s competitive position (e.g. &quot;对标本田CR-V&quot;),
        sourced only from Chinese-language auto media — not our own inference. {researched.length} of{" "}
        {models.length} models researched.
      </p>

      {models.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No models in the database yet.</p>
      ) : researched.length === 0 ? (
        <div className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 text-center">
          <p className="text-zinc-600 dark:text-zinc-400 mb-3">
            No model has confirmed positioning data yet. Use &quot;Research market positioning&quot; on any model below
            to pull competitive-framing claims from Chinese auto media.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {researched.map((m) => (
            <div key={m._id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <a href={`/models/${m._id}`} className="font-semibold hover:underline">
                  {brandNameById[String(m.brand_id)] ?? "?"} {m.name}
                </a>
                <span
                  className={
                    m.market_positioning_confidence === "unconfirmed"
                      ? "text-xs text-amber-600 dark:text-amber-400"
                      : "text-xs text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {m.market_positioning_confidence ?? "—"}
                </span>
              </div>
              <p className="text-base italic text-zinc-800 dark:text-zinc-200 mb-2">&quot;{m.market_positioning}&quot;</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                {m.market_positioning_source ? `Source: ${m.market_positioning_source} · ` : ""}
                Researched {formatRelativeTime(m.market_positioning_last_researched_at) || "—"}
              </p>
            </div>
          ))}
        </div>
      )}

      {unresearched.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 mb-2 uppercase tracking-wide">
            Not yet researched ({unresearched.length})
          </h2>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg max-h-[32rem] overflow-y-auto">
            {unresearched.map((m) => (
              <div key={m._id} className="flex items-center justify-between px-4 py-2.5">
                <a href={`/models/${m._id}`} className="text-sm hover:underline">
                  {brandNameById[String(m.brand_id)] ?? "?"} {m.name}
                </a>
                <PositioningResearch modelId={m._id as string} compact />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
