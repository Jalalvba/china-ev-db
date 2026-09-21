"use client";

import SingleObjectManualPanel from "@/app/SingleObjectManualPanel";

interface Props {
  brandId: string;
  compact?: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  name_cn: "Chinese name",
  parent_group: "Parent group",
  relationship_type: "Relationship type",
  stake_percentage: "Stake %",
  tech_partner: "Tech partner",
  country_origin: "Country of origin",
  founded_year: "Founded",
  status: "Status",
  status_note: "Status note",
};

/** Manual export/import panel for Tier-1 brand-identity fields — see SingleObjectManualPanel for the shared mechanics. */
export default function BrandResearch({ brandId, compact }: Props) {
  return (
    <SingleObjectManualPanel
      basePath={`/api/brands/${brandId}`}
      segment="manual-brand"
      applySegment="apply-brand-research"
      dataKey="brand"
      applyBodyKey="fields"
      title="Export/import brand identity research"
      triggerLabel="Brand identity: export/import"
      triggerEmoji="📋"
      compact={compact}
      renderPreview={(brand) => (
        <>
          {Object.entries(FIELD_LABELS)
            .filter(([k]) => brand[k] !== undefined && brand[k] !== null && brand[k] !== "")
            .map(([k, label]) => (
              <p key={k} className="text-zinc-700 dark:text-zinc-300">
                <span className="text-zinc-400 dark:text-zinc-500">{label}:</span> {String(brand[k])}
              </p>
            ))}
          {brand.confidence === "unconfirmed" && <p className="text-amber-600 dark:text-amber-400">Marked unconfirmed — no source given.</p>}
        </>
      )}
    />
  );
}
