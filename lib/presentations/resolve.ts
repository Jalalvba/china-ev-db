import { QUERY_REGISTRY } from "@/lib/presentations/queries";
import { validateDeckSpec } from "@/lib/presentations/spec";
import type { ChartData, DeckSpec, ResolvedDeck, ResolvedSlide, TableData } from "@/lib/presentations/spec";

/** Spec -> resolved deck: validates the spec, runs each slide's registered query, and sanity-checks what came back. Throws (never renders partial/empty) on an unknown source or malformed data. */
export async function resolveDeck(spec: DeckSpec): Promise<ResolvedDeck> {
  validateDeckSpec(spec);
  const slides: ResolvedSlide[] = [];
  for (const [i, s] of spec.slides.entries()) {
    const q = QUERY_REGISTRY[s.source];
    if (!q) throw new Error(`slide ${i + 1}: unknown source "${s.source}" (registered: ${Object.keys(QUERY_REGISTRY).join(", ")})`);
    if (q.kind !== s.type) throw new Error(`slide ${i + 1}: source "${s.source}" produces ${q.kind} data but the slide type is "${s.type}"`);
    const data = await q.run(s.params ?? {});
    if (s.type === "chart") {
      const d = data as ChartData;
      for (const ser of d.series) if (ser.values.length !== d.labels.length) throw new Error(`slide ${i + 1}: series "${ser.name}" has ${ser.values.length} values for ${d.labels.length} labels`);
      slides.push({ type: "chart", title: s.title, source: s.source, data: d });
    } else {
      const d = data as TableData;
      for (const r of d.rows) if (r.cells.length !== d.columns.length) throw new Error(`slide ${i + 1}: a row has ${r.cells.length} cells for ${d.columns.length} columns`);
      slides.push({ type: "table", title: s.title, source: s.source, data: d });
    }
  }
  return { id: spec.id, title: spec.title, slides };
}
