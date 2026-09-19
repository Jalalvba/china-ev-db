import { QUERY_REGISTRY } from "@/lib/presentations/queries";
import { validateDeckSpec } from "@/lib/presentations/spec";
import type { DeckSpec, ResolvedDeck, ResolvedSlide } from "@/lib/presentations/spec";

/** Spec -> resolved deck: validates the spec, runs each slide's registered query, and sanity-checks what came back. Throws (never renders partial/empty) on an unknown source or malformed data. */
export async function resolveDeck(spec: DeckSpec): Promise<ResolvedDeck> {
  validateDeckSpec(spec);
  const slides: ResolvedSlide[] = [];
  for (const [i, s] of spec.slides.entries()) {
    const q = QUERY_REGISTRY[s.source];
    if (!q) throw new Error(`slide ${i + 1}: unknown source "${s.source}" (registered: ${Object.keys(QUERY_REGISTRY).join(", ")})`);
    const data = await q(s.params ?? {});
    for (const ser of data.series) if (ser.values.length !== data.labels.length) throw new Error(`slide ${i + 1}: series "${ser.name}" has ${ser.values.length} values for ${data.labels.length} labels`);
    slides.push({ type: s.type, title: s.title, source: s.source, data });
  }
  return { id: spec.id, title: spec.title, slides };
}
