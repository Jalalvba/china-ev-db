import type { IWarrantyTerms } from "@/types";
import { formatTierPeriod, WARRANTY_TIER_KINDS, type IWarrantyTier } from "@/types/warrantyTiers";

// One rendering of warranty_terms for every page (/warranty, brand page, import review). Tiers win when present; the
// legacy flat six-number block is shown only when there are no tiers, or — clearly labelled — beneath them while it
// is still on file awaiting manual clearing (CLAUDE.md, tiered-warranty entry).

const KIND_LABEL: Record<(typeof WARRANTY_TIER_KINDS)[number], string> = {
  whole_vehicle: "Whole vehicle",
  replacement_return: "Replacement / return",
  core_components: "Core components",
  special_components: "Special components",
  consumables: "Consumables",
  other: "Other",
};
const USE_LABEL = { household: "household", commercial: "commercial", all: "all use" } as const;

export function FlatWarranty({ w }: { w: IWarrantyTerms }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
      {(
        [
          ["ICE component", w.ice_component_years, w.ice_component_km],
          ["Battery", w.battery_years, w.battery_km],
          ["Motor", w.motor_years, w.motor_km],
        ] as const
      ).map(([label, y, km]) => (
        <div key={label}>
          <p className="text-zinc-500 dark:text-zinc-400 text-xs">{label}</p>
          <p>{y ?? "—"} yr / {km ?? "—"} km</p>
        </div>
      ))}
    </div>
  );
}

function hasFlat(w: IWarrantyTerms): boolean {
  return [w.ice_component_years, w.ice_component_km, w.battery_years, w.battery_km, w.motor_years, w.motor_km].some((x) => x != null);
}

export function TierList({ tiers }: { tiers: IWarrantyTier[] }) {
  return (
    <div className="space-y-2 text-xs">
      {tiers.map((t, i) => (
        <div key={i} className="border border-zinc-200 dark:border-zinc-800 rounded p-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium text-sm">{t.tier_name}</span>
            <span className="text-zinc-500 dark:text-zinc-400">{formatTierPeriod(t)}</span>
            {t.clause_ref && <span className="text-zinc-400 dark:text-zinc-500">cl. {t.clause_ref}</span>}
          </div>
          <p className="text-zinc-400 dark:text-zinc-500">
            {KIND_LABEL[t.kind]} · {USE_LABEL[t.vehicle_use]} · {t.powertrain === "all" ? "all powertrains" : t.powertrain}
          </p>
          {t.conditions && <p className="text-zinc-600 dark:text-zinc-400 mt-0.5">{t.conditions}</p>}
          {t.covered_parts?.length > 0 && <p className="text-zinc-600 dark:text-zinc-400 mt-0.5">{t.covered_parts.join(", ")}</p>}
        </div>
      ))}
    </div>
  );
}

export default function WarrantyTiers({ w }: { w: IWarrantyTerms }) {
  const tiers = w.tiers ?? [];
  if (tiers.length === 0) return <FlatWarranty w={w} />;
  return (
    <div className="space-y-2">
      <TierList tiers={tiers} />
      {hasFlat(w) && (
        <details className="text-xs text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer">Legacy flat figures (superseded by tiers, kept until reviewed)</summary>
          <div className="mt-1 opacity-70"><FlatWarranty w={w} /></div>
        </details>
      )}
    </div>
  );
}
