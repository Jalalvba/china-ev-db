"use client";

import SingleObjectManualPanel from "@/app/SingleObjectManualPanel";

interface Props {
  brandId: string;
  compact?: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  ice_component_years: "ICE/component years",
  ice_component_km: "ICE/component km",
  battery_years: "Battery years",
  battery_km: "Battery km",
  motor_years: "Motor years",
  motor_km: "Motor km",
};

/** Manual export/import panel for brand warranty_terms — see SingleObjectManualPanel for the shared mechanics. */
export default function WarrantyResearch({ brandId, compact }: Props) {
  return (
    <SingleObjectManualPanel
      basePath={`/api/brands/${brandId}`}
      segment="manual-warranty"
      applySegment="apply-warranty"
      dataKey="warranty_terms"
      title="Warranty terms research (Chinese sources only)"
      triggerLabel="Warranty terms"
      triggerEmoji="📋"
      compact={compact}
      renderPreview={(w) => (
        <>
          {Object.entries(FIELD_LABELS)
            .filter(([k]) => w[k] !== undefined && w[k] !== null)
            .map(([k, label]) => (
              <p key={k} className="text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-400 dark:text-zinc-500">{label}:</span> {String(w[k])}
              </p>
            ))}
          {w.source ? <p className="text-zinc-400 dark:text-zinc-500">Source: {String(w.source)}</p> : null}
          {w.confidence === "unconfirmed" && <p className="text-amber-600 dark:text-amber-400">Marked unconfirmed — no source given.</p>}
        </>
      )}
    />
  );
}
