// Some Chinese OEMs' sub-brands are stored in Morocco source data under their
// own brand_en label (e.g. "Haval", "ORA") but live in our DB as a model-name
// prefix under one parent Brand doc, rather than as a separate Brand. Maps
// the Morocco-source brand_en to the Brand.name it should roll up under.
// Shared between scripts/import-morocco.ts and the homepage brand-card
// Morocco-dealer lookup so the two stay in sync.
export const MOROCCO_BRAND_ALIAS: Record<string, string> = {
  Haval: "GWM (Great Wall Motor)",
  ORA: "GWM (Great Wall Motor)",
  WEY: "GWM (Great Wall Motor)",
  Tank: "GWM (Great Wall Motor)",
  GWM: "GWM (Great Wall Motor)",
};
