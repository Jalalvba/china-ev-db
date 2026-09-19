// Groups Tech Search's flat list of matching trims into one entry per Model, and orders
// both the models and the trims inside each one. Pure (no React, no fetch) so the ordering
// rules are unit-testable — the page just feeds it trims plus a sort mode.
//
// Ordering rules (chosen so they still make sense once trims are nested in a model card):
//   - Ascending metric sorts (price / hp / range / battery — the existing directions,
//     unchanged): MODELS are ordered by their LOWEST matching trim on that metric, and the
//     trims inside a card use the same metric ascending. "Lowest matching trim" — not the
//     average, not the model-wide range — because (a) it answers "the cheapest way to get a
//     spec that matches your filters", (b) an average is dragged around by how many trims
//     a model happens to have and hides the entry point, and (c) it respects the filters:
//     if the search only matches a model's expensive trims, it ranks by those, not by a
//     cheap trim the user filtered out.
//   - Best match: MODELS are ordered by their BEST-scoring trim (highest score first), trims
//     inside by score descending.
//   - A trim missing the metric sorts last WITHIN its card. For the MODEL's ordering key,
//     `modelFallback` (e.g. the model's own price-range minimum) also counts whenever ANY
//     matching trim lacks the metric: an unpriced trim's real price is unknown, and the best
//     information we have is the model's advertised range — the same figure printed on the
//     card. Without this, a model with two priced expensive trims and five unpriced cheap ones
//     would rank by the expensive two while its card visibly says "from $27k" (Galaxy M9).
//     A model with no value and no fallback sorts last.
//   - Ties keep the API's original order (stable).

export interface GroupableTrim {
  _id?: string;
  model_id?: { _id?: string } | null;
}

/** Trims inside one card that share an identical hardware fingerprint (see hardwareSpecKey). Order = first-seen order of the card's already-sorted trims, so the sort metric applies to variants for free. */
export interface SpecVariant<T> {
  trims: T[];
}

export interface ModelGroup<T extends GroupableTrim> {
  modelId: string;
  /** The populated model (taken from its first matching trim). */
  model: T["model_id"];
  /** Every matching trim, in card order (flat — used for counts). */
  trims: T[];
  /** The same trims collapsed by hardware fingerprint — one entry per row the card shows. */
  variants: SpecVariant<T>[];
}

export type GroupSortMode<T> =
  | { kind: "score"; /** aligned to the input array's order */ scores: number[] }
  | { kind: "asc"; metric: (t: T) => number | undefined; modelFallback?: (t: T) => number | undefined };

interface Indexed<T> {
  t: T;
  idx: number;
}

function ascWithMissingLast(a: number | undefined, b: number | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * `variantKey` returns a trim's collapse fingerprint, or null when the trim must NOT be merged
 * with any other (unknown/empty spec). Omit it to give every trim its own variant.
 */
export function groupTrimsByModel<T extends GroupableTrim>(trims: T[], mode: GroupSortMode<T>, variantKey?: (t: T) => string | null): ModelGroup<T>[] {
  const byModel = new Map<string, Indexed<T>[]>();
  trims.forEach((t, idx) => {
    const key = t.model_id?._id ?? `__no_model_${idx}`;
    const list = byModel.get(key) ?? [];
    list.push({ t, idx });
    byModel.set(key, list);
  });

  const scored = [...byModel.entries()].map(([modelId, list]) => {
    let ordered: Indexed<T>[];
    let key: number | undefined;
    if (mode.kind === "score") {
      ordered = [...list].sort((a, b) => mode.scores[b.idx] - mode.scores[a.idx] || a.idx - b.idx);
      key = Math.max(...list.map((x) => mode.scores[x.idx]));
    } else {
      ordered = [...list].sort((a, b) => ascWithMissingLast(mode.metric(a.t), mode.metric(b.t)) || a.idx - b.idx);
      const own = list.map((x) => mode.metric(x.t)).filter((v): v is number => v != null);
      const anyMissing = own.length < list.length;
      const fallback = mode.modelFallback && anyMissing ? list.map((x) => mode.modelFallback!(x.t)).filter((v): v is number => v != null) : [];
      const candidates = [...own, ...fallback];
      key = candidates.length > 0 ? Math.min(...candidates) : undefined;
    }
    return { modelId, ordered, key, firstIdx: Math.min(...list.map((x) => x.idx)) };
  });

  scored.sort((a, b) => {
    const byKey = mode.kind === "score" ? (b.key ?? 0) - (a.key ?? 0) : ascWithMissingLast(a.key, b.key);
    return byKey || a.firstIdx - b.firstIdx;
  });

  return scored.map((s) => {
    const orderedTrims = s.ordered.map((x) => x.t);
    return { modelId: s.modelId, model: s.ordered[0].t.model_id, trims: orderedTrims, variants: collapseTrims(s.ordered, variantKey) };
  });
}

function collapseTrims<T>(ordered: Indexed<T>[], variantKey?: (t: T) => string | null): SpecVariant<T>[] {
  const variants: SpecVariant<T>[] = [];
  const byKey = new Map<string, SpecVariant<T>>();
  for (const { t } of ordered) {
    const key = variantKey?.(t) ?? null;
    if (key === null) {
      variants.push({ trims: [t] });
      continue;
    }
    const existing = byKey.get(key);
    if (existing) existing.trims.push(t);
    else {
      const v: SpecVariant<T> = { trims: [t] };
      byKey.set(key, v);
      variants.push(v);
    }
  }
  return variants;
}

// ---------- card labels ----------

/** Header count for a model card. Unchanged wording when nothing collapsed; otherwise says both numbers so it reconciles with the page-level "Y trims match". */
export function cardCountLabel(variantCount: number, trimCount: number): string {
  const trims = `${trimCount} trim${trimCount === 1 ? "" : "s"}`;
  return variantCount === trimCount ? `${trims} matching` : `${variantCount} spec variant${variantCount === 1 ? "" : "s"} · ${trims}`;
}

export interface VariantPriceFields {
  trim_price_min_usd?: number | null;
  trim_price_max_usd?: number | null;
  trim_price_confidence?: string | null;
}

/**
 * Price span across a collapsed row's trims: lowest min to highest max among the trims that
 * HAVE their own price. `priced`/`total` let the UI say "2 of 3 priced" instead of implying the
 * span covers trims whose price is unknown. `confirmed` is false if any priced member is
 * unconfirmed (drives the same ⚠ marker formatTrimPrice uses for a single trim).
 */
export function variantPriceSpan(trims: VariantPriceFields[]): { min?: number; max?: number; priced: number; total: number; confirmed: boolean } {
  const priced = trims.filter((t) => t.trim_price_min_usd != null || t.trim_price_max_usd != null);
  if (priced.length === 0) return { priced: 0, total: trims.length, confirmed: true };
  const mins = priced.map((t) => (t.trim_price_min_usd ?? t.trim_price_max_usd) as number);
  const maxes = priced.map((t) => (t.trim_price_max_usd ?? t.trim_price_min_usd) as number);
  return {
    min: Math.min(...mins),
    max: Math.max(...maxes),
    priced: priced.length,
    total: trims.length,
    confirmed: priced.every((t) => t.trim_price_confidence !== "unconfirmed"),
  };
}
