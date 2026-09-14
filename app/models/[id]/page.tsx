import Link from "next/link";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
// Side-effect import only: registers the "Brand" model so .populate("brand_id")
// below can resolve it on a cold server, regardless of request order (see the
// same fix/explanation in scripts/tech-spec-agent.ts).
import "@/models/Brand";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import MoroccoListing from "@/models/MoroccoListing";
import type { IBrand, IModel, IMoroccoListing, IPowertrain } from "@/types";
import { kwToHp } from "@/lib/units";
import { formatRelativeTime } from "@/lib/relativeTime";
import TechSpecUpdater from "@/app/TechSpecUpdater";
import ManualResearchImporter from "@/app/ManualResearchImporter";
import ExportForManualResearchButton from "@/app/ExportForManualResearchButton";
import MoroccoPriceFetcher from "@/app/MoroccoPriceFetcher";
import { formatChinaPriceUsd } from "@/lib/priceDisplay";
import { SegmentLabel } from "@/lib/segmentDisplay";
import { hasFields, groupBySpec } from "@/lib/specGrouping";

export const dynamic = "force-dynamic";

type PopulatedModel = Omit<IModel, "brand_id"> & { brand_id: IBrand };

async function getData(
  id: string
): Promise<{ model: PopulatedModel; powertrains: IPowertrain[]; moroccoListing: IMoroccoListing | null } | null> {
  await connectToDatabase();
  const model = await ModelSchema.findById(id).populate("brand_id").lean();
  if (!model) return null;
  const powertrains = await Powertrain.find({ model_id: id }).lean();
  const moroccoListing = await MoroccoListing.findOne({ model_id: id }).lean();
  return JSON.parse(JSON.stringify({ model, powertrains, moroccoListing }));
}

/** Distinguishes AI-researched data from data that's never been touched by the research pipeline (still whatever scripts/seed.ts or scripts/import-deepseek.ts originally wrote). */
function provenanceLabel(p: IPowertrain): string {
  if (p.last_researched_at) return `Researched ${formatRelativeTime(p.last_researched_at)}`;
  if (p.createdAt) return `Original import data (${formatRelativeTime(p.createdAt)})`;
  return "Original import data";
}

function Row({ label, values }: { label: string; values: (string | number | undefined)[] }) {
  if (values.every((v) => v === undefined || v === null || v === "")) return null;
  return (
    <tr className="border-b border-zinc-100 dark:border-zinc-800">
      <td className="py-2 pr-4 font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-2 pr-4">
          {v === undefined || v === null || v === "" ? "—" : v}
        </td>
      ))}
    </tr>
  );
}

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();
  const { model, powertrains, moroccoListing } = data;
  const brand = model.brand_id;

  // price_range lives on the Model, not per-Powertrain trim — there's only
  // one blended China price range for the whole model, never a distinct
  // price per trim. Repeat the same formatted value under every trim column
  // rather than implying a per-trim breakdown the data doesn't support.
  const chinaPriceUsdLabel = formatChinaPriceUsd(model.price_range);

  return (
    <div>
      <Link href={`/brands/${brand._id}`} className="text-sm text-zinc-500 dark:text-zinc-400 hover:underline">
        ← {brand.name}
      </Link>
      <h1 className="text-2xl font-bold mt-2 flex items-center gap-2 flex-wrap">
        {brand.name} {model.name}
        {model.generation ? ` (${model.generation})` : ""}
        {model.morocco_price_confirmed && model.morocco_price_dh && (
          <a
            href={model.morocco_price_url}
            target="_blank"
            rel="noopener noreferrer"
            title={model.morocco_price_source}
            className="text-sm font-normal px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:underline"
          >
            💰 {model.morocco_price_dh.toLocaleString()} DH
          </a>
        )}
      </h1>
      <div className="text-sm text-zinc-600 dark:text-zinc-400 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-medium">
          <SegmentLabel model={model} />
        </span>
        <span>{model.body_type}</span>
        <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 text-xs">
          {model.production_status}
        </span>
        {model.unverified && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">
            unverified
          </span>
        )}
      </div>
      {chinaPriceUsdLabel && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">Price: {chinaPriceUsdLabel}</p>
      )}
      {model.notable_facts && (
        <div className="mt-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm">
          <span className="font-medium">Notable:</span> {model.notable_facts}
          {model.notable_facts_confidence === "unconfirmed" && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">
              unconfirmed
            </span>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {model.notable_facts_last_researched_at
              ? `Researched ${formatRelativeTime(model.notable_facts_last_researched_at)}`
              : `Original import data${model.createdAt ? ` (${formatRelativeTime(model.createdAt)})` : ""}`}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <TechSpecUpdater scope="model" id={model._id as string} />
        <MoroccoPriceFetcher id={model._id as string} />
        <ExportForManualResearchButton modelDbId={model._id as string} />
      </div>

      <ManualResearchImporter modelDbId={model._id as string} />

      {moroccoListing && (
        <div className="mt-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm">
          <span className="font-medium">🇲🇦 Available in Morocco:</span>{" "}
          {moroccoListing.price_mad?.toLocaleString()} MAD
          {moroccoListing.price_mad_max ? `–${moroccoListing.price_mad_max.toLocaleString()} MAD` : ""}
          {moroccoListing.dealer_morocco ? (
            <span className="text-zinc-600 dark:text-zinc-400"> via {moroccoListing.dealer_morocco}</span>
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400 italic"> — dealer unconfirmed</span>
          )}
          {moroccoListing.dealer_confidence === "unconfirmed" && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">
              unconfirmed
            </span>
          )}
          {moroccoListing.note && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{moroccoListing.note}</p>
          )}
          {moroccoListing.moteur_ma_confirmed && moroccoListing.moteur_ma_price_dh && (
            <p className="mt-2">
              {moroccoListing.moteur_ma_url ? (
                <a
                  href={moroccoListing.moteur_ma_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-xs hover:underline"
                >
                  🇲🇦 moteur.ma: {moroccoListing.moteur_ma_price_dh.toLocaleString()} DH
                </a>
              ) : (
                <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 text-xs">
                  🇲🇦 moteur.ma: {moroccoListing.moteur_ma_price_dh.toLocaleString()} DH
                </span>
              )}
            </p>
          )}
        </div>
      )}

      <h2 className="text-lg font-semibold mt-6 mb-3">Powertrain Variants ({powertrains.length})</h2>
      {(() => {
        const specGroups = groupBySpec(powertrains);
        // Only worth showing when it actually compresses something — if
        // every trim already has a distinct spec, this would just restate
        // the table below with extra steps.
        if (specGroups.length === 0 || specGroups.length === powertrains.length) return null;
        return (
          <div className="mb-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm">
            <p className="font-medium mb-2">
              {powertrains.length} trims collapse to {specGroups.length} distinct spec group{specGroups.length === 1 ? "" : "s"}:
            </p>
            <ul className="space-y-2">
              {specGroups.map((g, i) => (
                <li key={i}>
                  <span className="font-medium">
                    Group {i + 1} — {g.trims.length} trim{g.trims.length === 1 ? "" : "s"}:
                  </span>{" "}
                  {g.label}
                  <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {g.trims.map((t) => t.trim_name).join(", ")}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {powertrains.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">No powertrain data available.</p>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
          <table className="text-sm w-full">
            <tbody>
              <Row label="Trim" values={powertrains.map((p) => p.trim_name)} />
              <Row label="Energy Type" values={powertrains.map((p) => p.energy_type)} />
              <Row
                label="Unverified"
                values={powertrains.map((p) => (p.unverified ? "Yes ⚠" : "No"))}
              />
              <Row
                label="China Price (USD)"
                values={powertrains.map(() => chinaPriceUsdLabel)}
              />
              <Row
                label="Engine"
                values={powertrains.map((p) =>
                  hasFields(p.engine, ["displacement_l", "cylinders", "aspiration", "fuel_type"])
                    ? `${p.engine!.displacement_l ?? "?"}L ${p.engine!.cylinders ?? "?"}-cyl ${p.engine!.aspiration ?? ""} ${p.engine!.fuel_type ?? ""}${
                        p.engine!.is_range_extender ? " (range extender)" : ""
                      }${p.engine!.confidence === "unconfirmed" ? " ⚠" : ""}`
                    : undefined
                )}
              />
              <Row
                label="Engine Power / Torque"
                values={powertrains.map((p) =>
                  hasFields(p.engine, ["power_kw", "torque_nm"])
                    ? `${p.engine!.power_kw ?? "?"} kW / ${kwToHp(p.engine!.power_kw) ?? "?"} hp / ${p.engine!.torque_nm ?? "?"} Nm`
                    : undefined
                )}
              />
              <Row
                label="Motor"
                values={powertrains.map((p) =>
                  // "drive" (FWD/RWD/AWD) alone does NOT imply an electric motor exists —
                  // it's a drivetrain-layout fact the AI reports even for pure-ICE trims
                  // (our schema has no better place to put it), so it's deliberately
                  // excluded from this check: only count/type/power/torque indicate a
                  // real motor block worth showing under a "Motor" heading.
                  hasFields(p.motor, ["count", "type", "power_kw", "torque_nm"])
                    ? `${p.motor!.count ?? ""} ${p.motor!.type ?? ""} (${p.motor!.drive ?? ""})`
                    : undefined
                )}
              />
              <Row
                label="Motor Power / Torque"
                values={powertrains.map((p) =>
                  hasFields(p.motor, ["power_kw", "torque_nm"])
                    ? `${p.motor!.power_kw ?? "?"} kW / ${p.motor!.torque_nm ?? "?"} Nm${
                        p.motor!.note ? " ⚠" : ""
                      }`
                    : undefined
                )}
              />
              <Row
                label="Motor Note"
                values={powertrains.map((p) => p.motor?.note)}
              />
              <Row
                label="Battery"
                values={powertrains.map((p) =>
                  hasFields(p.battery, ["capacity_total_kwh", "chemistry", "battery_variant", "supplier"])
                    ? `${p.battery!.capacity_total_kwh ?? "?"} kWh ${p.battery!.chemistry ?? ""}${
                        p.battery!.battery_variant ? ` (${p.battery!.battery_variant})` : ""
                      } (${p.battery!.supplier ?? "?"})`
                    : undefined
                )}
              />
              <Row
                label="Charging DC / AC"
                values={powertrains.map((p) =>
                  hasFields(p.battery, ["dc_charge_kw", "ac_charge_kw"])
                    ? `${p.battery!.dc_charge_kw ?? "?"} kW / ${p.battery!.ac_charge_kw ?? "?"} kW`
                    : undefined
                )}
              />
              <Row
                label="Electric Range"
                values={powertrains.map((p) =>
                  p.battery?.ev_range_km
                    ? `${p.battery.ev_range_km} km (${p.battery.ev_range_standard ?? "?"})`
                    : undefined
                )}
              />
              <Row
                label="Battery Thermal Mgmt"
                values={powertrains.map((p) => {
                  const t = p.thermal_management;
                  if (t?.cooling_tier == null) return undefined;
                  const detail = t.has_heat_pump ? "Heat pump" : t.has_liquid_cooling ? "Liquid cooling" : t.thermal_evidence ?? "";
                  return t.morocco_suitable
                    ? `🌡️ Tier ${t.cooling_tier}${detail ? ` · ${detail}` : ""}`
                    : `🌡️ Tier ${t.cooling_tier} · Not Morocco-suitable`;
                })}
              />
              <Row
                label="Gearbox"
                values={powertrains.map((p) =>
                  p.transmission?.type
                    ? `${p.transmission.type}${p.transmission.speed_count ? ` (${p.transmission.speed_count}-spd)` : ""}`
                    : undefined
                )}
              />
              <Row
                label="Combined Range"
                values={powertrains.map((p) =>
                  p.combined_range_km ? `${p.combined_range_km} km${p.combined_range_note ? " ⚠" : ""}` : undefined
                )}
              />
              <Row
                label="Combined Range Note"
                values={powertrains.map((p) => p.combined_range_note)}
              />
              <Row
                label="0–100 km/h"
                values={powertrains.map((p) =>
                  p.performance?.accel_0_100_s ? `${p.performance.accel_0_100_s} s` : undefined
                )}
              />
              <Row
                label="Top Speed"
                values={powertrains.map((p) =>
                  p.performance?.top_speed_kmh ? `${p.performance.top_speed_kmh} km/h` : undefined
                )}
              />
              <Row label="Source" values={powertrains.map((p) => p.source)} />
              <Row label="Provenance" values={powertrains.map((p) => provenanceLabel(p))} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
