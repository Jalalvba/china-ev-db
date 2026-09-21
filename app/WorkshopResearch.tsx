"use client";

import SingleObjectManualPanel from "@/app/SingleObjectManualPanel";

interface Props {
  brandId: string;
  compact?: boolean;
}

/** Manual export/import panel for the brand's PHEV SUV workshop profile (BrandPhevSuvWorkshopProfile, shown on the /technical Workshop tab) — see SingleObjectManualPanel for the shared mechanics. */
export default function WorkshopResearch({ brandId, compact }: Props) {
  return (
    <SingleObjectManualPanel
      basePath={`/api/brands/${brandId}`}
      segment="manual-workshop"
      applySegment="apply-workshop-profile"
      dataKey="workshop_profile"
      title="PHEV SUV workshop profile research (Chinese sources only)"
      triggerLabel="Workshop requirements"
      triggerEmoji="🔧"
      compact={compact}
      renderPreview={(w) => {
        const list = (k: string) => (Array.isArray(w[k]) ? (w[k] as Record<string, unknown>[]) : []);
        const di = w.diagnostic_interface as Record<string, unknown> | undefined;
        const ls = w.lift_spec as Record<string, unknown> | undefined;
        const line = "text-zinc-700 dark:text-zinc-300";
        const label = "text-zinc-400 dark:text-zinc-500";
        return (
          <>
            <p className={line}>
              <span className={label}>Diagnostic interface:</span>{" "}
              {di ? [di.tool_name, di.connector_type, di.software_platform].filter(Boolean).join(" · ") || "(no name)" : "not found"}
            </p>
            <p className={line}>
              <span className={label}>Lift:</span>{" "}
              {ls ? [ls.type, ls.min_capacity_kg ? `min ${ls.min_capacity_kg} kg` : null, ls.battery_removal_capable ? "battery removal" : null].filter(Boolean).join(" · ") || "(no detail)" : "not found"}
            </p>
            <p className={line}>
              <span className={label}>PPE ({list("ppe_required").length}):</span> {list("ppe_required").map((p) => String(p.item)).join(", ") || "none found"}
            </p>
            <p className={line}>
              <span className={label}>Technician prerequisites ({list("technician_prerequisites").length}):</span>{" "}
              {list("technician_prerequisites").map((t) => String(t.certification_name_en ?? t.certification_name_cn ?? "?")).join(", ") || "none found"}
            </p>
            <p className={line}>
              <span className={label}>Audit checklist:</span> {list("audit_checklist").length} checkpoint(s)
            </p>
            {w.confidence === "unconfirmed" && (
              <p className="text-amber-600 dark:text-amber-400">
                Will be stored as unconfirmed — confirmed requires a source_url on every filled fact.
              </p>
            )}
          </>
        );
      }}
    />
  );
}
