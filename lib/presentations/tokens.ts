// Single source of truth for deck styling, shared by BOTH renderers (React canvas + pptxgenjs) so a slide
// can't look different in the browser and in PowerPoint. The canvas is 16:9; every measurement is in
// canvas px (1280x720). The pptx renderer converts px -> inches with `px()` (13.333in x 7.5in = 96 dpi).

export const CANVAS = { w: 1280, h: 720 } as const;
export const px = (n: number) => n / 96; // canvas px -> pptx inches

export const COLORS = {
  navy: "0B2545",
  navyLight: "13315C",
  gray900: "1F2933",
  gray600: "52606D",
  gray300: "CBD2D9",
  gray100: "F0F2F5",
  white: "FFFFFF",
  red: "D62839",
  amber: "F2A541",
} as const;

/** CSS form of a token color (tokens are bare hex because pptxgenjs wants no '#'). */
export const css = (hex: string) => `#${hex}`;

export const FONT = { family: "Calibri", fallback: "Arial, Helvetica, sans-serif" } as const;

/** 12-col grid, 64px outer margin, 24px gutter. */
export const GRID = { margin: 64, gutter: 24, cols: 12 } as const;
export const colX = (col: number) => GRID.margin + col * ((CANVAS.w - GRID.margin * 2 + GRID.gutter) / GRID.cols);
export const colSpan = (n: number) => n * ((CANVAS.w - GRID.margin * 2 + GRID.gutter) / GRID.cols) - GRID.gutter;

/** Slide regions shared by slide types. */
export const LAYOUT = {
  titleY: 40,
  titleH: 80,
  bodyY: 140,
  bodyH: 520,
  footerY: 676,
} as const;

/** Series colors in order of use; red is reserved for the highlighted/featured item. */
export const SERIES_COLORS = [COLORS.navy, COLORS.gray600, COLORS.amber, COLORS.navyLight] as const;
