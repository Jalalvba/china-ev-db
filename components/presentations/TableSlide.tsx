import { COLORS, CANVAS, FONT, LAYOUT, colX, css } from "@/lib/presentations/tokens";
import type { ResolvedTableSlide } from "@/lib/presentations/spec";

// React renderer for a table slide (1280x720 canvas). The pptx renderer emits a native, editable PowerPoint table from the same data.
export default function TableSlide({ slide }: { slide: ResolvedTableSlide }) {
  const { data } = slide;
  const rowH = Math.min(64, (LAYOUT.bodyH - 56) / (data.rows.length + 1));
  return (
    <div style={{ position: "relative", width: CANVAS.w, height: CANVAS.h, background: css(COLORS.white), fontFamily: FONT.fallback, color: css(COLORS.gray900) }}>
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.titleY, width: CANVAS.w - 128, height: LAYOUT.titleH, fontSize: 36, fontWeight: 700, color: css(COLORS.navy), display: "flex", alignItems: "center" }}>{slide.title}</div>
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.titleY + LAYOUT.titleH - 6, width: 96, height: 4, background: css(COLORS.red) }} />
      <table style={{ position: "absolute", left: colX(0), top: LAYOUT.bodyY, width: CANVAS.w - 128, borderCollapse: "collapse", fontSize: 18 }}>
        <thead>
          <tr style={{ background: css(COLORS.navy), color: css(COLORS.white), height: rowH }}>
            {data.columns.map((c) => (
              <th key={c.label} style={{ textAlign: c.align, padding: "0 14px", fontWeight: 700 }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i} style={{ background: css(i % 2 ? COLORS.white : COLORS.gray100), height: rowH }}>
              {r.cells.map((cell, j) => (
                <td key={j} style={{ textAlign: data.columns[j].align, padding: "0 14px", fontWeight: j === 0 ? 700 : 400, color: css(j === 0 ? COLORS.navy : COLORS.gray900) }}>{cell.text}{cell.unconfirmed ? "*" : ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.footnote && <div style={{ position: "absolute", left: colX(0), top: LAYOUT.footerY - 26, width: CANVAS.w - 128, fontSize: 13, color: css(COLORS.gray600) }}>{data.footnote}</div>}
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.footerY, width: CANVAS.w - 128, fontSize: 12, color: css(COLORS.gray600) }}>Source: {data.sourceNote} · as of {data.asOf}</div>
    </div>
  );
}
