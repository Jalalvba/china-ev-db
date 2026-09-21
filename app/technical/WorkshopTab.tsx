import PhevWorkshopProfiles from "./PhevWorkshopProfiles";
import GenericWorkshopReference from "./GenericWorkshopReference";

/** Workshop tab of /technical: brand-specific PHEV SUV profiles first, the generic industry baseline collapsed underneath. */
export default function WorkshopTab({ brandId }: { brandId?: string }) {
  return (
    <div>
      <PhevWorkshopProfiles brandId={brandId} />
      <details className="mt-8 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          Generic workshop baseline (industry reference — not brand-specific)
        </summary>
        <div className="mt-4">
          <GenericWorkshopReference brandId={brandId} />
        </div>
      </details>
    </div>
  );
}
