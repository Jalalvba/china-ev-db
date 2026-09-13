// Maps a manufacturer hybrid-system brand name (e.g. "DM-i") to its actual
// powertrain mechanism (parallel/series_erev/power_split/mild). Deliberately
// NOT keyed off battery size or brand alone — see HybridArchitecture's doc
// comment in types/index.ts: Denza D9 pairs a 66.5 kWh battery with DM-i,
// which is power_split, proving battery size is not a reliable proxy.
//
// Entries marked verify: false are provisional (per the task spec, "VERIFY
// per model, do not assume from brand alone") — callers should still treat
// the mapped value as the best available guess, but new evidence that
// contradicts it should win.
import type { HybridArchitecture } from "@/types";

export const HYBRID_SYSTEM_ARCHITECTURE_MAP: Record<string, { architecture: HybridArchitecture; verified: boolean }> = {
  "DM-i": { architecture: "power_split", verified: true },
  "DMO": { architecture: "series_erev", verified: false },
  "EM-i": { architecture: "power_split", verified: true },
  "DHT": { architecture: "power_split", verified: true },
  "C-DM": { architecture: "power_split", verified: true },
  "Hi4": { architecture: "power_split", verified: true },
  "EM-P": { architecture: "series_erev", verified: false },
  "i-DM": { architecture: "power_split", verified: false },
  "DE-i": { architecture: "series_erev", verified: false },
};

/** Known hybrid system brand names, longest-first so e.g. "EM-P" doesn't get shadowed by a shorter partial match when scanning free text. */
const KNOWN_SYSTEM_NAMES = Object.keys(HYBRID_SYSTEM_ARCHITECTURE_MAP).sort((a, b) => b.length - a.length);

/** Extracts a known hybrid system name (e.g. "DM-i") from a trim title string, if present. Case-sensitive to the canonical spellings above (Chinese-market trim titles consistently use these exact brand spellings). */
export function extractHybridSystemName(trimName: string): string | undefined {
  for (const name of KNOWN_SYSTEM_NAMES) {
    if (trimName.includes(name)) return name;
  }
  return undefined;
}

/** Looks up architecture for a known hybridSystemName. Returns null (not "parallel") when unmapped — callers should pair this with architectureUnverified: true rather than guessing, per the fallback rule in AGENTS-facing task spec. */
export function architectureForSystemName(systemName: string | undefined): { architecture: HybridArchitecture | null; verified: boolean } {
  if (!systemName) return { architecture: null, verified: false };
  const entry = HYBRID_SYSTEM_ARCHITECTURE_MAP[systemName];
  if (!entry) return { architecture: null, verified: false };
  return { architecture: entry.architecture, verified: entry.verified };
}

/** Extracts a displacement in liters (e.g. "1.5T" / "2.0L" -> 1.5 / 2.0) from a trim title string, if present. */
export function extractDisplacementL(trimName: string): number | undefined {
  const match = trimName.match(/(\d\.\d)\s*[TL]\b/);
  return match ? Number(match[1]) : undefined;
}
