import type { DeckSpec } from "@/lib/presentations/spec";

// Deck specs are pure data. Slide types are added one at a time, each proven end-to-end (spec -> React -> pptx) first. Reliability/known-issues slides are deliberately absent until reviewed known-issues data is applied.
export const DECKS: Record<string, DeckSpec> = {
  "phev-market": {
    id: "phev-market",
    title: "Chinese PHEV SUVs — Morocco entry prices",
    slides: [
      { type: "callout", title: "Electric range", source: "powertrains.longestEvRange" },
      { type: "chart", title: "Cheapest confirmed Morocco price, by brand", source: "brands.cheapestMoroccoPrice", params: { limit: 10 } },
      { type: "table", title: "Spec comparison — the six cheapest priced models", source: "models.phevSpecComparison", params: { limit: 6 } },
    ],
  },
};
