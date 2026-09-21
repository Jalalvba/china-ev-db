"use client";

import SingleObjectManualPanel from "@/app/SingleObjectManualPanel";

interface Props {
  modelId: string;
  compact?: boolean;
}

/** Manual export/import panel for market_positioning — see SingleObjectManualPanel for the shared mechanics. */
export default function PositioningResearch({ modelId, compact }: Props) {
  return (
    <SingleObjectManualPanel
      basePath={`/api/models/${modelId}`}
      segment="manual-positioning"
      applySegment="apply-positioning"
      dataKey="market_positioning"
      title="Market positioning research (Chinese sources only)"
      triggerLabel="Market positioning"
      triggerEmoji="🎯"
      compact={compact}
      renderPreview={(p) => (
        <>
          <p className="text-zinc-700 dark:text-zinc-300">{String(p.text ?? "")}</p>
          {p.source ? <p className="text-zinc-400 dark:text-zinc-500">Source: {String(p.source)}</p> : null}
          {p.confidence === "unconfirmed" && <p className="text-amber-600 dark:text-amber-400">Marked unconfirmed — no source given.</p>}
        </>
      )}
    />
  );
}
