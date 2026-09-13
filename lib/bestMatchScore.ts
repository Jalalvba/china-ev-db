// Composite "Best Match" ranking for the Tech Search page (Part 5 of the
// spec: min-max normalize each metric across only the CURRENTLY FILTERED
// result set, so ranking adapts to a narrowed search rather than using fixed
// global DB ranges). Deliberately framework-agnostic (no React) so it's easy
// to unit-test and reuse if another page ever wants the same ranking.

import type { IPowertrain } from "@/types";
import { kwToHp } from "@/lib/units";

type ScoreFields = Pick<IPowertrain, "battery" | "combined_system_power_kw" | "engine" | "motor" | "hybrid_architecture">;

/** Diminishing returns above 300 hp so a 1000+ hp performance trim doesn't dominate ranking for a normal buyer search — every hp above 300 counts at 30% weight before normalization. */
function dampenHp(hp: number): number {
  return hp <= 300 ? hp : 300 + (hp - 300) * 0.3;
}

function combinedHp(p: ScoreFields): number | undefined {
  if (p.combined_system_power_kw != null) return kwToHp(p.combined_system_power_kw);
  if (p.engine?.power_kw != null) return kwToHp(p.engine.power_kw);
  if (p.motor?.power_kw != null) return kwToHp(p.motor.power_kw);
  return undefined;
}

/** Min-max normalizes a list of (possibly-null) values to 0-1, using only the present values to set the domain. A null value scores 0 (present but at the domain floor is also possible to score near 0 — that's fine, it just means "not distinguished from a low-end trim on this metric"). All-equal or empty domains normalize every present value to 1 (no basis to rank them apart on this metric). */
function normalize(values: (number | undefined)[]): (number | undefined)[] {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return values.map(() => undefined);
  const min = Math.min(...present);
  const max = Math.max(...present);
  return values.map((v) => (v == null ? undefined : max === min ? 1 : (v - min) / (max - min)));
}

/**
 * Returns one composite 0-1 score per input trim, in the same order, computed
 * only from the given set (call again whenever the filtered result set
 * changes — never cache across a different filter set).
 */
export function bestMatchScores<T extends ScoreFields>(trims: T[]): number[] {
  const evRanges = trims.map((t) => t.battery?.ev_range_km ?? undefined);
  const batteryKwhs = trims.map((t) => t.battery?.capacity_total_kwh ?? undefined);
  const hps = trims.map((t) => {
    const hp = combinedHp(t);
    return hp == null ? undefined : dampenHp(hp);
  });

  const evRangeNorm = normalize(evRanges);
  const batteryNorm = normalize(batteryKwhs);
  const hpNorm = normalize(hps);

  return trims.map((t, i) => {
    const architectureBonus =
      (t.hybrid_architecture === "series_erev" || t.hybrid_architecture === "power_split") && (t.battery?.ev_range_km ?? 0) > 100 ? 1 : 0;
    return (evRangeNorm[i] ?? 0) * 0.4 + (batteryNorm[i] ?? 0) * 0.2 + (hpNorm[i] ?? 0) * 0.25 + architectureBonus * 0.15;
  });
}
