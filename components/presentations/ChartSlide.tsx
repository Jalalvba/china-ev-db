import { COLORS, css, CANVAS, FONT, LAYOUT, SERIES_COLORS, colSpan, colX } from "@/lib/presentations/tokens";
import type { ResolvedChartSlide } from "@/lib/presentations/spec";

// React renderer for a chart slide, drawn on the fixed 1280x720 canvas (DeckViewer scales it). Pure SVG/HTML — no
// chart library — so it stays visually aligned with the pptx renderer's native bar chart (lib/presentations/pptxExport.ts),
// both driven by the same tokens and the same ChartData.
export default function ChartSlide({ slide }: { slide: ResolvedChartSlide }) {
  const { data } = slide;
  const leftX = colX(0);
  const leftW = colSpan(3);
  const chartX = colX(4);
  const chartW = colSpan(8);
  const chartY = LAYOUT.bodyY;
  const chartH = LAYOUT.bodyH;

  const values = data.series[0].values;
  const max = Math.max(...values, 1);
  const rowH = chartH / data.labels.length;
  const labelW = 190;
  const valueW = 130;
  const barMaxW = chartW - labelW - valueW;

  return (
    <div style={{ position: "relative", width: CANVAS.w, height: CANVAS.h, background: css(COLORS.white), fontFamily: FONT.fallback, color: css(COLORS.gray900) }}>
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.titleY, width: CANVAS.w - 128, height: LAYOUT.titleH, fontSize: 36, fontWeight: 700, color: css(COLORS.navy), display: "flex", alignItems: "center" }}>{slide.title}</div>
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.titleY + LAYOUT.titleH - 6, width: 96, height: 4, background: css(COLORS.red) }} />

      {/* key-number box, top-left */}
      <div style={{ position: "absolute", left: leftX, top: LAYOUT.bodyY, width: leftW, height: 150, background: css(COLORS.navy), color: css(COLORS.white), padding: 20, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.1, color: css(COLORS.amber) }}>{data.keyNumber.value}</div>
        <div style={{ fontSize: 16, marginTop: 8 }}>{data.keyNumber.label}</div>
      </div>

      {/* logo, left */}
      <div style={{ position: "absolute", left: leftX, top: LAYOUT.bodyY + 170, width: leftW, height: 200, background: css(COLORS.gray100), display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {data.logo?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logo.imageUrl} alt={data.logo.text} style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: 30, fontWeight: 700, color: css(COLORS.navy), textAlign: "center", padding: 12 }}>{data.logo?.text}</div>
        )}
      </div>

      {/* chart, right */}
      <svg style={{ position: "absolute", left: chartX, top: chartY }} width={chartW} height={chartH} role="img" aria-label={slide.title}>
        {data.labels.map((label, i) => {
          const v = values[i];
          const w = (v / max) * barMaxW;
          const y = i * rowH;
          const color = css(i === data.highlightIndex ? COLORS.red : SERIES_COLORS[0]);
          return (
            <g key={label}>
              <text x={labelW - 12} y={y + rowH / 2} textAnchor="end" dominantBaseline="middle" fontSize={16} fill={css(COLORS.gray900)}>{label}</text>
              <rect x={labelW} y={y + rowH * 0.18} width={w} height={rowH * 0.64} fill={color} />
              <text x={labelW + w + 10} y={y + rowH / 2} dominantBaseline="middle" fontSize={16} fontWeight={600} fill={css(COLORS.gray900)}>{`${Math.round(v).toLocaleString("en-US")} ${data.unit}`}</text>
            </g>
          );
        })}
      </svg>

      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.footerY, width: CANVAS.w - 128, fontSize: 12, color: css(COLORS.gray600) }}>
        Source: {data.sourceNote} · as of {data.asOf}
      </div>
    </div>
  );
}
