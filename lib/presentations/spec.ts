// Slide-spec schema. A deck is DATA: each slide names a query (`source`) registered in
// lib/presentations/queries.ts and passes it `params`. A spec never contains numbers, so a slide can only ever
// show what the app's own data returns at render time. Both renderers (React, pptxgenjs) consume the RESOLVED
// slide produced by lib/presentations/resolve.ts, never the raw DB.

export const SLIDE_TYPES = ["chart"] as const; // section | table | callout | process are added one at a time, after chart is proven end-to-end.
export type SlideType = (typeof SLIDE_TYPES)[number];

export interface SlideSpec {
  type: SlideType;
  title: string;
  /** Name of a registered query (see QUERY_REGISTRY). Never a value. */
  source: string;
  params?: Record<string, string | number | boolean>;
}

export interface DeckSpec {
  id: string;
  title: string;
  slides: SlideSpec[];
}

// ---------- resolved data shapes (what a query returns; what renderers draw) ----------

export interface ChartData {
  kind: "bar";
  /** Category labels, top to bottom / left to right. */
  labels: string[];
  series: { name: string; values: number[] }[];
  /** Index into labels of the item to highlight (drawn in red), if any. */
  highlightIndex?: number;
  unit: string;
  keyNumber: { value: string; label: string };
  /** Left panel: an image URL/path if we have one, else a wordmark is drawn from `logo.text`. */
  logo?: { text: string; imageUrl?: string };
  /** Human-readable provenance shown in the slide footer, e.g. "Confirmed Morocco prices, moteur.ma / wandaloo.com". */
  sourceNote: string;
  asOf: string; // ISO date the query ran
}

export interface ResolvedChartSlide {
  type: "chart";
  title: string;
  source: string;
  data: ChartData;
}
export type ResolvedSlide = ResolvedChartSlide;

export interface ResolvedDeck {
  id: string;
  title: string;
  slides: ResolvedSlide[];
}

/** Validates a spec's shape (not its data). Throws with a specific message; used by resolve() and by tests. */
export function validateDeckSpec(d: unknown): DeckSpec {
  const rec = d as Partial<DeckSpec> | null;
  if (!rec || typeof rec !== "object") throw new Error("deck spec must be an object");
  if (!rec.id || typeof rec.id !== "string") throw new Error("deck spec needs a string id");
  if (!rec.title || typeof rec.title !== "string") throw new Error("deck spec needs a string title");
  if (!Array.isArray(rec.slides) || rec.slides.length === 0) throw new Error("deck spec needs at least one slide");
  rec.slides.forEach((s, i) => {
    const at = `slide ${i + 1}`;
    if (!s || typeof s !== "object") throw new Error(`${at}: must be an object`);
    if (!(SLIDE_TYPES as readonly string[]).includes(s.type)) throw new Error(`${at}: unknown type "${String(s.type)}" (known: ${SLIDE_TYPES.join(", ")})`);
    if (!s.title || typeof s.title !== "string") throw new Error(`${at}: needs a string title`);
    if (!s.source || typeof s.source !== "string") throw new Error(`${at}: needs a string source (query name)`);
    for (const [k, v] of Object.entries(s.params ?? {})) if (!["string", "number", "boolean"].includes(typeof v)) throw new Error(`${at}: param "${k}" must be string/number/boolean`);
  });
  return rec as DeckSpec;
}
