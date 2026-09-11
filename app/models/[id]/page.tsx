import Link from "next/link";
import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import ModelSchema from "@/models/Model";
import Powertrain from "@/models/Powertrain";
import MoroccoListing from "@/models/MoroccoListing";
import type { IBrand, IModel, IMoroccoListing, IPowertrain } from "@/types";

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

function Row({ label, values }: { label: string; values: (string | number | undefined)[] }) {
  if (values.every((v) => v === undefined || v === null || v === "")) return null;
  return (
    <tr className="border-b border-zinc-100">
      <td className="py-2 pr-4 font-medium text-zinc-600 whitespace-nowrap">{label}</td>
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

  return (
    <div>
      <Link href={`/brands/${brand._id}`} className="text-sm text-zinc-500 hover:underline">
        ← {brand.name}
      </Link>
      <h1 className="text-2xl font-bold mt-2">
        {brand.name} {model.name}
        {model.generation ? ` (${model.generation})` : ""}
      </h1>
      <div className="text-sm text-zinc-600 flex flex-wrap gap-x-4 gap-y-1 mt-1">
        <span>{model.segment}</span>
        <span>{model.body_type}</span>
        <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 text-xs">
          {model.production_status}
        </span>
        {model.unverified && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">unverified</span>
        )}
      </div>
      {model.price_range && (
        <p className="text-sm text-zinc-600 mt-1">
          Price: {model.price_range.min?.toLocaleString()}–
          {model.price_range.max?.toLocaleString()} {model.price_range.currency_local}
          {model.price_range.min_usd &&
            ` (~$${model.price_range.min_usd.toLocaleString()}–$${model.price_range.max_usd?.toLocaleString()})`}
          {model.price_range.unverified && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">unverified</span>
          )}
        </p>
      )}
      {moroccoListing && (
        <div className="mt-3 p-3 rounded-lg bg-zinc-50 border border-zinc-200 text-sm">
          <span className="font-medium">🇲🇦 Available in Morocco:</span>{" "}
          {moroccoListing.price_mad?.toLocaleString()} MAD
          {moroccoListing.price_mad_max ? `–${moroccoListing.price_mad_max.toLocaleString()} MAD` : ""}
          {moroccoListing.dealer_morocco ? (
            <span className="text-zinc-600"> via {moroccoListing.dealer_morocco}</span>
          ) : (
            <span className="text-zinc-500 italic"> — dealer unconfirmed</span>
          )}
          {moroccoListing.dealer_confidence === "unconfirmed" && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">unconfirmed</span>
          )}
        </div>
      )}

      <h2 className="text-lg font-semibold mt-6 mb-3">Powertrain Variants ({powertrains.length})</h2>
      {powertrains.length === 0 ? (
        <p className="text-zinc-500">No powertrain data available.</p>
      ) : (
        <div className="overflow-x-auto bg-white border border-zinc-200 rounded-lg p-4">
          <table className="text-sm w-full">
            <tbody>
              <Row label="Trim" values={powertrains.map((p) => p.trim_name)} />
              <Row label="Energy Type" values={powertrains.map((p) => p.energy_type)} />
              <Row
                label="Unverified"
                values={powertrains.map((p) => (p.unverified ? "Yes ⚠" : "No"))}
              />
              <Row
                label="Engine"
                values={powertrains.map((p) =>
                  p.engine_details
                    ? `${p.engine_details.displacement_l ?? "?"}L ${p.engine_details.cylinders ?? "?"}-cyl ${p.engine_details.induction ?? ""} ${p.engine_details.fuel_type ?? ""}${
                        p.engine_details.confidence === "unconfirmed" ? " ⚠" : ""
                      }`
                    : undefined
                )}
              />
              <Row
                label="Engine Power / Torque"
                values={powertrains.map((p) =>
                  p.engine_details
                    ? `${p.engine_details.power_kw ?? "?"} kW / ${p.engine_details.max_power_hp ?? "?"} hp / ${p.engine_details.max_torque_nm ?? "?"} Nm`
                    : undefined
                )}
              />
              <Row
                label="Motor"
                values={powertrains.map((p) =>
                  p.electric_motor_details
                    ? `${p.electric_motor_details.motor_count ?? ""} ${p.electric_motor_details.motor_type ?? ""} (${p.electric_motor_details.drive_type ?? ""})`
                    : undefined
                )}
              />
              <Row
                label="Motor Power / Torque"
                values={powertrains.map((p) =>
                  p.electric_motor_details
                    ? `${p.electric_motor_details.motor_power_kw ?? "?"} kW / ${p.electric_motor_details.motor_torque_nm ?? "?"} Nm${
                        p.electric_motor_details.note ? " ⚠" : ""
                      }`
                    : undefined
                )}
              />
              <Row
                label="Motor Note"
                values={powertrains.map((p) => p.electric_motor_details?.note)}
              />
              <Row
                label="Battery"
                values={powertrains.map((p) =>
                  p.battery_details
                    ? `${p.battery_details.battery_capacity_total_kwh ?? "?"} kWh ${p.battery_details.battery_chemistry ?? ""}${
                        p.battery_details.battery_variant ? ` (${p.battery_details.battery_variant})` : ""
                      } (${p.battery_details.battery_supplier ?? "?"})`
                    : undefined
                )}
              />
              <Row
                label="Charging DC / AC"
                values={powertrains.map((p) =>
                  p.battery_details
                    ? `${p.battery_details.charging_speed_dc_kw ?? "?"} kW / ${p.battery_details.charging_speed_ac_kw ?? "?"} kW`
                    : undefined
                )}
              />
              <Row
                label="Electric Range"
                values={powertrains.map((p) =>
                  p.battery_details?.electric_range_km
                    ? `${p.battery_details.electric_range_km} km (${p.battery_details.range_standard ?? "?"})`
                    : undefined
                )}
              />
              <Row
                label="Gearbox"
                values={powertrains.map((p) =>
                  p.transmission?.type
                    ? `${p.transmission.type}${p.transmission.gears ? ` (${p.transmission.gears}-spd)` : ""}`
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
