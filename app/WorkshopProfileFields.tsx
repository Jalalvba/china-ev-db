import type { IBrandPhevSuvWorkshopProfile } from "@/types";
import SourceRef from "@/app/SourceRef";

// Shared by /workshop-phev-suv (one card per brand) and /brands/[id] (the brand's own card).
// Rendering copied verbatim from the original page — including its `requires_dealer_account !== undefined`
// test, which is only safe because apply-workshop-profile strips nulls (see CLAUDE.md, "known landmine").

function Field({ label, empty, children }: { label: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-zinc-500 dark:text-zinc-400 font-medium mb-0.5">{label}</p>
      {empty ? <p className="text-zinc-400 dark:text-zinc-600">Not found</p> : children}
    </div>
  );
}

function SourceLink({ url }: { url?: string }) {
  return <SourceRef source={url} />;
}

export default function WorkshopProfileFields({ profile }: { profile: Omit<IBrandPhevSuvWorkshopProfile, "brand_id"> & { brand_id?: unknown } }) {
  return (
      <div className="space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span
            className={
              profile._confidence === "confirmed"
                ? "text-emerald-600 dark:text-emerald-400 font-medium"
                : "text-amber-600 dark:text-amber-400 font-medium"
            }
          >
            {profile._confidence === "confirmed" ? "Confirmed (grounded)" : "Unconfirmed"}
          </span>
          {profile._last_researched_at && (
            <span className="text-zinc-400 dark:text-zinc-600">
              researched {new Date(profile._last_researched_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <Field label="Diagnostic interface" empty={!profile.diagnostic_interface}>
          <p>
            {profile.diagnostic_interface?.tool_name ?? "—"}
            {profile.diagnostic_interface?.connector_type && ` · ${profile.diagnostic_interface.connector_type}`}
          </p>
          {profile.diagnostic_interface?.software_platform && <p>{profile.diagnostic_interface.software_platform}</p>}
          {profile.diagnostic_interface?.requires_dealer_account !== undefined && (
            <p className="text-zinc-500 dark:text-zinc-400">
              {profile.diagnostic_interface.requires_dealer_account ? "Requires dealer account" : "No dealer account required"}
            </p>
          )}
          {profile.diagnostic_interface?.tool_cost && (
            <p className="text-zinc-500 dark:text-zinc-400">Tool cost: {profile.diagnostic_interface.tool_cost}</p>
          )}
          {profile.diagnostic_interface?.subscription_terms && (
            <p className="text-zinc-500 dark:text-zinc-400">Subscription: {profile.diagnostic_interface.subscription_terms}</p>
          )}
          <SourceLink url={profile.diagnostic_interface?.source_url} />
        </Field>

        <Field label="Lift spec" empty={!profile.lift_spec}>
          <p>{profile.lift_spec?.type ?? "—"}</p>
          {profile.lift_spec?.min_capacity_kg && (
            <p className="text-zinc-500 dark:text-zinc-400">
              Min {profile.lift_spec.min_capacity_kg} kg
              {profile.lift_spec.battery_removal_capable ? " · battery-removal capable" : ""}
            </p>
          )}
          {profile.lift_spec?.lift_point_notes && <p className="text-zinc-500 dark:text-zinc-400">{profile.lift_spec.lift_point_notes}</p>}
          <SourceLink url={profile.lift_spec?.source_url} />
        </Field>

        <Field label="PPE required" empty={!profile.ppe_required?.length}>
          <ul className="space-y-0.5">
            {profile.ppe_required?.map((p, i) => (
              <li key={i}>
                {p.item}
                {p.spec && ` (${p.spec})`}
                {p.mandatory === false && <span className="text-zinc-400 dark:text-zinc-600"> — recommended</span>}
                <SourceLink url={p.source_url} />
              </li>
            ))}
          </ul>
        </Field>

        <Field label="Technician prerequisites" empty={!profile.technician_prerequisites?.length}>
          <ul className="space-y-0.5">
            {profile.technician_prerequisites?.map((t, i) => (
              <li key={i}>
                {t.certification_name_en ?? t.certification_name_cn}
                {t.certification_name_cn && t.certification_name_en && ` (${t.certification_name_cn})`}
                {t.issuing_body && ` — ${t.issuing_body}`}
                {t.hv_endorsement_required && <span className="text-zinc-500 dark:text-zinc-400"> · HV endorsement required</span>}
                <SourceLink url={t.source_url} />
              </li>
            ))}
          </ul>
        </Field>

        <Field label="Audit checklist" empty={!profile.audit_checklist?.length}>
          <ul className="space-y-0.5">
            {profile.audit_checklist?.map((a, i) => (
              <li key={i}>
                {a.check_point}
                {a.category && <span className="text-zinc-400 dark:text-zinc-600"> ({a.category})</span>}
                <SourceLink url={a.source_url} />
              </li>
            ))}
          </ul>
        </Field>
      </div>
  );
}
