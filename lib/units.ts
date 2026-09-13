/** Convert engine/motor power from kW to metric horsepower for display. Not stored — compute at render time. */
export function kwToHp(kw: number | undefined | null): number | undefined {
  return kw === undefined || kw === null ? undefined : Math.round(kw * 1.34102);
}

/** Inverse of kwToHp — for a user-entered hp value (e.g. a search filter) that needs converting back to kW before querying, since power is always stored in kW. */
export function hpToKw(hp: number | undefined | null): number | undefined {
  return hp === undefined || hp === null ? undefined : hp / 1.34102;
}
