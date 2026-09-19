import type { DeckSpec } from "@/lib/presentations/spec";

// Deck specs are pure data. Only ONE slide so far: chart is being proven end-to-end (spec -> React -> pptx) before the
// other slide types exist. Reliability/known-issues slides are deliberately absent until reviewed known-issues data is applied.
export const DECKS: Record<string, DeckSpec> = {
  "phev-market": {
    id: "phev-market",
    title: "Chinese PHEV SUVs — Morocco entry prices",
    slides: [
      { type: "chart", title: "Cheapest confirmed Morocco price, by brand", source: "brands.cheapestMoroccoPrice", params: { limit: 10 } },
    ],
  },
};
