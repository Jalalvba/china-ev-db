// Shared "segment, but honest about how sure we are" rendering — segment is
// now mandatory on every Model (never null, see lib/modelDiscovery.ts &
// models/Model.ts), but an "inferred" (AI best-guess, no source) value and a
// "confirmed" (real search result) value should never look identical to a
// reader. Two forms because segment shows up in both plain-text contexts
// (a <select><option>, a table cell) and styled JSX contexts (a card badge).

import type { IModel } from "@/types";

/** Plain-text form for contexts that can't carry styling (an <option>, a search-results table cell) — "~" is the visual cue the request itself suggested for a text-only spot. */
export function segmentText(model: Pick<IModel, "segment" | "segment_confidence">): string {
  return model.segment_confidence === "inferred" ? `~${model.segment}` : model.segment;
}

/** Styled JSX form for a card/badge context — dotted underline + muted color for "inferred", normal solid text for "confirmed" (or legacy records with no segment_confidence at all, treated as confirmed since they predate this field). */
export function SegmentLabel({
  model,
  className = "",
}: {
  model: Pick<IModel, "segment" | "segment_confidence">;
  className?: string;
}) {
  const inferred = model.segment_confidence === "inferred";
  return (
    <span
      className={className + (inferred ? " border-b border-dotted border-zinc-400 dark:border-zinc-600" : "")}
      title={inferred ? "Inferred — no source confirming this segment was found; this is the model's own best-effort classification." : undefined}
    >
      {inferred ? "~" : ""}
      {model.segment}
    </span>
  );
}
