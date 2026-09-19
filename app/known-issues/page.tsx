import { connectToDatabase } from "@/lib/db";
import Brand from "@/models/Brand";
import ModelSchema from "@/models/Model";
import type { IBrand, IModel } from "@/types";
import KnownIssuesList from "./KnownIssuesList";

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

export default async function KnownIssuesPage() {
  const { models, brandNameById } = await getData();

  const rows = models.flatMap((m) =>
    (m.known_issues ?? []).map((issue) => ({
      modelId: m._id as string,
      modelName: m.name,
      brandName: brandNameById[String(m.brand_id)] ?? "?",
      issue_description: issue.issue_description,
      affected_systems: issue.affected_systems ?? [],
      frequency_signal: issue.frequency_signal,
      source: issue.source,
      confidence: issue.confidence,
      lastResearchedAt: m.known_issues_last_researched_at,
    }))
  );

  const unresearched = models
    .filter((m) => !m.known_issues || m.known_issues.length === 0)
    .map((m) => ({
      modelId: m._id as string,
      modelName: m.name,
      brandName: brandNameById[String(m.brand_id)] ?? "?",
    }));

  const researchedModelCount = models.length - unresearched.length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Failure Patterns</h1>
      <p className="text-zinc-600 dark:text-zinc-400 mb-6">
        Known issues and failure patterns per model, sourced only from Chinese-language quality/complaint platforms
        (车质网, 汽车投诉网 prioritized). {researchedModelCount} of {models.length} models researched, {rows.length}{" "}
        issue{rows.length === 1 ? "" : "s"} total.
      </p>

      {models.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No models in the database yet.</p>
      ) : (
        <KnownIssuesList rows={rows} unresearched={unresearched} />
      )}
    </div>
  );
}
