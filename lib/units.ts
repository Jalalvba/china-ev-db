/** Convert engine/motor power from kW to metric horsepower for display. Not stored — compute at render time. */
export function kwToHp(kw: number | undefined | null): number | undefined {
  return kw === undefined || kw === null ? undefined : Math.round(kw * 1.34102);
}
