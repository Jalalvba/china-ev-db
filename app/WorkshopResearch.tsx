"use client";

import SingleObjectManualPanel from "@/app/SingleObjectManualPanel";

interface Props {
  brandId: string;
  compact?: boolean;
}

/** Manual export/import panel for brand workshop_requirements — see SingleObjectManualPanel for the shared mechanics. */
export default function WorkshopResearch({ brandId, compact }: Props) {
  return (
    <SingleObjectManualPanel
      basePath={`/api/brands/${brandId}`}
      segment="manual-workshop"
      applySegment="apply-workshop"
      dataKey="workshop_requirements"
      title="Workshop requirements research (Chinese sources only)"
      triggerLabel="Workshop requirements"
      triggerEmoji="🔧"
      compact={compact}
      renderPreview={(w) => (
        <>
          {Array.isArray(w.special_tools_list) && w.special_tools_list.length > 0 && (
            <p className="text-zinc-700 dark:text-zinc-300">
              <span className="text-zinc-400 dark:text-zinc-500">Special tools:</span> {(w.special_tools_list as string[]).join(", ")}
            </p>
          )}
          {w.hv_safety_requirements ? <p className="text-zinc-700 dark:text-zinc-300">HV safety: {String(w.hv_safety_requirements)}</p> : null}
          {w.diagnostic_software_name ? <p className="text-zinc-700 dark:text-zinc-300">Diagnostic software: {String(w.diagnostic_software_name)}</p> : null}
          {w.technician_certification_required ? <p className="text-zinc-700 dark:text-zinc-300">Certification: {String(w.technician_certification_required)}</p> : null}
          {w.source ? <p className="text-zinc-400 dark:text-zinc-500">Source: {String(w.source)}</p> : null}
          {w.confidence === "unconfirmed" && <p className="text-amber-600 dark:text-amber-400">Marked unconfirmed — no source given.</p>}
        </>
      )}
    />
  );
}
