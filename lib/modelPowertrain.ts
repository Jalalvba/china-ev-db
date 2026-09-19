// What a Model actually IS, powertrain-wise, derived from this DB's own Powertrain trims — the target
// the research prompts and the powertrain guard (lib/categoryValidators.ts) check reports against.
// The DB is scoped to PHEV, so a model with no trims yet is still described as a PHEV (no displacement
// known → the displacement text check is skipped for it, the LLM's powertrain_scope attestation still applies).

import Powertrain from "@/models/Powertrain";
import type { TargetPowertrain } from "@/lib/categoryValidators";

interface TrimLike {
  energy_type?: string | null;
  engine?: { displacement_l?: number | null } | null;
  hybrid_system_name?: string | null;
  battery?: { capacity_total_kwh?: number | null } | null;
}

const ENERGY_LABEL: Record<string, string> = { PHEV: "plug-in hybrid (PHEV)", "REEV/EREV": "range-extender (REEV/EREV)", HEV: "hybrid (HEV)", BEV: "battery-electric (BEV)", ICE: "petrol/diesel (ICE)", MHEV: "mild hybrid (MHEV)" };
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];

/** Pure — unit-testable. Falls back to "PHEV" (the DB's scope) when there are no trims to learn from. */
export function describePowertrain(trims: TrimLike[]): TargetPowertrain {
  const energyTypes = uniq(trims.map((t) => t.energy_type).filter((e): e is string => !!e));
  if (energyTypes.length === 0) energyTypes.push("PHEV");
  const displacementsL = uniq(trims.map((t) => t.engine?.displacement_l).filter((d): d is number => typeof d === "number").map((d) => Math.round(d * 10) / 10));
  const hybridSystems = uniq(trims.map((t) => t.hybrid_system_name).filter((h): h is string => !!h)).slice(0, 3);
  const kwh = trims.map((t) => t.battery?.capacity_total_kwh).filter((k): k is number => typeof k === "number");

  const parts = [energyTypes.map((e) => ENERGY_LABEL[e] ?? e).join(" / ")];
  if (displacementsL.length) parts.push(`${displacementsL.join("/")}L engine`);
  if (hybridSystems.length) parts.push(`hybrid system: ${hybridSystems.join(" / ")}`);
  if (kwh.length) parts.push(`battery ${Math.min(...kwh)}${kwh.length > 1 && Math.min(...kwh) !== Math.max(...kwh) ? `–${Math.max(...kwh)}` : ""} kWh`);
  return { description: parts.join("; "), displacementsL, energyTypes };
}

export async function getModelPowertrain(modelId: string): Promise<TargetPowertrain> {
  const trims = (await Powertrain.find({ model_id: modelId }, { energy_type: 1, "engine.displacement_l": 1, hybrid_system_name: 1, "battery.capacity_total_kwh": 1 }).lean()) as unknown as TrimLike[];
  return describePowertrain(trims);
}
