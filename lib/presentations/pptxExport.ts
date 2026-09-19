import PptxGenJS from "pptxgenjs";
import { COLORS, CANVAS, FONT, LAYOUT, SERIES_COLORS, colSpan, colX, px } from "@/lib/presentations/tokens";
import type { ResolvedChartSlide, ResolvedDeck, ResolvedTableSlide } from "@/lib/presentations/spec";

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

  if (d.proxy) slide.addText([{ text: "Proxy metric. ", options: { bold: true } }, { text: `Not ${d.proxy.standsInFor}: ${d.proxy.actually}.` }], { x: px(colX(0)), y: px(LAYOUT.bodyY + 390), w: px(colSpan(3)), h: px(90), fontSize: 10, color: COLORS.red, valign: "top", ...font });
  slide.addText(`Source: ${d.sourceNote} · as of ${d.asOf}`, { x: px(colX(0)), y: px(LAYOUT.footerY), w: px(CANVAS.w - 128), h: px(24), fontSize: 9, color: COLORS.gray600, ...font });
}

function addTableSlide(pptx: PptxGenJS, s: ResolvedTableSlide) {
  const slide = pptx.addSlide();
  const d = s.data;
  const font = { fontFace: FONT.family };
  slide.background = { color: COLORS.white };
  slide.addText(s.title, { x: px(colX(0)), y: px(LAYOUT.titleY), w: px(CANVAS.w - 128), h: px(LAYOUT.titleH), fontSize: 27, bold: true, color: COLORS.navy, valign: "middle", ...font });
  slide.addShape("rect", { x: px(colX(0)), y: px(LAYOUT.titleY + LAYOUT.titleH - 6), w: px(96), h: px(4), fill: { color: COLORS.red }, line: { color: COLORS.red, width: 0 } });

  const rowH = Math.min(64, (LAYOUT.bodyH - 56) / (d.rows.length + 1));
  const head = d.columns.map((c) => ({ text: c.label, options: { bold: true, color: COLORS.white, fill: { color: COLORS.navy }, align: c.align, valign: "middle" as const, fontSize: 13, ...font } }));
  const body = d.rows.map((r, i) =>
    r.cells.map((cell, j) => ({
      text: `${cell.text}${cell.unconfirmed ? "*" : ""}`,
      options: { bold: j === 0, color: j === 0 ? COLORS.navy : COLORS.gray900, fill: { color: i % 2 ? COLORS.white : COLORS.gray100 }, align: d.columns[j].align, valign: "middle" as const, fontSize: 13, ...font },
    }))
  );
  // Native PowerPoint table (editable). Column widths: model column wider, the rest share the remainder equally.
  const total = CANVAS.w - 128;
  const first = total * 0.26;
  const rest = (total - first) / (d.columns.length - 1);
  slide.addTable([head, ...body], { x: px(colX(0)), y: px(LAYOUT.bodyY), w: px(total), colW: d.columns.map((_, j) => px(j === 0 ? first : rest)), rowH: px(rowH), margin: [0, 0.1, 0, 0.1], border: { type: "none" } });
  if (d.footnote) slide.addText(d.footnote, { x: px(colX(0)), y: px(LAYOUT.footerY - 26), w: px(total), h: px(22), fontSize: 9.5, color: COLORS.gray600, ...font });
  slide.addText(`Source: ${d.sourceNote} · as of ${d.asOf}`, { x: px(colX(0)), y: px(LAYOUT.footerY), w: px(total), h: px(24), fontSize: 9, color: COLORS.gray600, ...font });
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
  const proxies = deck.slides.flatMap((sl, i) => (sl.data.proxy ? [`slide ${i + 1}: proxy for ${sl.data.proxy.standsInFor} (${sl.data.proxy.actually})`] : []));
  if (proxies.length) pptx.subject = `PROXY METRICS — ${proxies.join("; ")}`;
  for (const s of deck.slides) {
    if (s.type === "chart") addChartSlide(pptx, s, await fetchLogo(s.data.logo?.imageUrl));
    else if (s.type === "table") addTableSlide(pptx, s);
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
