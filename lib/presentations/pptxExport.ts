import PptxGenJS from "pptxgenjs";
import { COLORS, CANVAS, FONT, LAYOUT, SERIES_COLORS, colSpan, colX, px } from "@/lib/presentations/tokens";
import type { ResolvedChartSlide, ResolvedDeck } from "@/lib/presentations/spec";

// pptx renderer: same ResolvedDeck + tokens as the React renderer, but emits NATIVE, editable PowerPoint objects
// (text boxes, shapes, a real bar chart with embedded data) — not a screenshot.

function addChartSlide(pptx: PptxGenJS, s: ResolvedChartSlide, logoData?: string) {
  const slide = pptx.addSlide();
  const d = s.data;
  slide.background = { color: COLORS.white };
  const font = { fontFace: FONT.family };

  slide.addText(s.title, { x: px(colX(0)), y: px(LAYOUT.titleY), w: px(CANVAS.w - 128), h: px(LAYOUT.titleH), fontSize: 27, bold: true, color: COLORS.navy, valign: "middle", ...font });
  slide.addShape("rect", { x: px(colX(0)), y: px(LAYOUT.titleY + LAYOUT.titleH - 6), w: px(96), h: px(4), fill: { color: COLORS.red }, line: { color: COLORS.red, width: 0 } });

  // key-number box, top-left
  slide.addShape("rect", { x: px(colX(0)), y: px(LAYOUT.bodyY), w: px(colSpan(3)), h: px(150), fill: { color: COLORS.navy }, line: { color: COLORS.navy, width: 0 } });
  slide.addText(
    [
      { text: d.keyNumber.value, options: { fontSize: 28, bold: true, color: COLORS.amber, breakLine: true } },
      { text: d.keyNumber.label, options: { fontSize: 12, color: COLORS.white } },
    ],
    { x: px(colX(0) + 20), y: px(LAYOUT.bodyY), w: px(colSpan(3) - 40), h: px(150), valign: "middle", ...font }
  );

  // logo, left
  slide.addShape("rect", { x: px(colX(0)), y: px(LAYOUT.bodyY + 170), w: px(colSpan(3)), h: px(200), fill: { color: COLORS.gray100 }, line: { color: COLORS.gray100, width: 0 } });
  if (logoData) slide.addImage({ data: logoData, x: px(colX(0) + 30), y: px(LAYOUT.bodyY + 190), w: px(colSpan(3) - 60), h: px(160), sizing: { type: "contain", w: px(colSpan(3) - 60), h: px(160) } });
  else if (d.logo?.text) slide.addText(d.logo.text, { x: px(colX(0)), y: px(LAYOUT.bodyY + 170), w: px(colSpan(3)), h: px(200), align: "center", valign: "middle", fontSize: 22, bold: true, color: COLORS.navy, ...font });

  // native bar chart, right — one series; highlighted point in red
  // A horizontal PowerPoint bar chart draws the FIRST category at the bottom (pptxgenjs' types don't expose the axis-reverse
  // option), so feed it reversed data to get first-at-top, matching the React renderer.
  const rev = <T,>(a: T[]) => [...a].reverse();
  const colors = rev(d.labels.map((_, i) => (i === d.highlightIndex ? COLORS.red : SERIES_COLORS[0])));
  slide.addChart(
    "bar",
    d.series.map((ser) => ({ name: ser.name, labels: rev(d.labels), values: rev(ser.values) })),
    {
      x: px(colX(4)), y: px(LAYOUT.bodyY), w: px(colSpan(8)), h: px(LAYOUT.bodyH),
      barDir: "bar", chartColors: colors, valAxisHidden: true, valGridLine: { style: "none" },
      showValue: true, dataLabelFormatCode: `#,##0" ${d.unit}"`, dataLabelFontSize: 12, dataLabelFontFace: FONT.family, dataLabelColor: COLORS.gray900,
      catAxisLabelFontSize: 12, catAxisLabelFontFace: FONT.family, catAxisLabelColor: COLORS.gray900, barGapWidthPct: 40, showLegend: false,
    }
  );

  slide.addText(`Source: ${d.sourceNote} · as of ${d.asOf}`, { x: px(colX(0)), y: px(LAYOUT.footerY), w: px(CANVAS.w - 128), h: px(24), fontSize: 9, color: COLORS.gray600, ...font });
}

async function fetchLogo(url?: string): Promise<string | undefined> {
  if (!url || !/^https?:\/\//.test(url)) return undefined;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return undefined;
    const type = r.headers.get("content-type") ?? "image/png";
    return `${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return undefined; // a missing logo must never fail the export — the wordmark fallback is used
  }
}

export async function buildPptx(deck: ResolvedDeck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9"; // 10 x 5.625in — rescale to our 13.333 x 7.5in canvas below
  pptx.defineLayout({ name: "CANVAS", width: px(CANVAS.w), height: px(CANVAS.h) });
  pptx.layout = "CANVAS";
  pptx.title = deck.title;
  for (const s of deck.slides) {
    if (s.type === "chart") addChartSlide(pptx, s, await fetchLogo(s.data.logo?.imageUrl));
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
