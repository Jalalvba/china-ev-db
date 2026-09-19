import { COLORS, CANVAS, FONT, LAYOUT, colX, css } from "@/lib/presentations/tokens";
import type { ResolvedCalloutSlide } from "@/lib/presentations/spec";

// React renderer for a callout slide: one big number + subtitle (1280x720 canvas). The pptx renderer draws the same text as editable text boxes.
export default function CalloutSlide({ slide }: { slide: ResolvedCalloutSlide }) {
  const { data } = slide;
  return (
    <div style={{ position: "relative", width: CANVAS.w, height: CANVAS.h, background: css(COLORS.navy), fontFamily: FONT.fallback, color: css(COLORS.white) }}>
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.titleY, width: CANVAS.w - 128, height: LAYOUT.titleH, fontSize: 36, fontWeight: 700, display: "flex", alignItems: "center" }}>{slide.title}</div>
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.titleY + LAYOUT.titleH - 6, width: 96, height: 4, background: css(COLORS.red) }} />
      <div style={{ position: "absolute", left: colX(0), top: 180, width: CANVAS.w - 128, fontSize: 200, fontWeight: 700, lineHeight: 1, color: css(COLORS.amber) }}>
        {data.value}
        {data.unconfirmed && <span style={{ fontSize: 22, marginLeft: 20, padding: "4px 12px", border: `2px solid ${css(COLORS.amber)}`, verticalAlign: "middle", fontWeight: 400 }}>unconfirmed</span>}
      </div>
      <div style={{ position: "absolute", left: colX(0), top: 430, width: 900, fontSize: 32, lineHeight: 1.25 }}>{data.subtitle}</div>
      {data.detail && <div style={{ position: "absolute", left: colX(0), top: 560, width: 900, fontSize: 18, color: css(COLORS.gray300) }}>{data.detail}</div>}
      <div style={{ position: "absolute", left: colX(0), top: LAYOUT.footerY, width: CANVAS.w - 128, fontSize: 12, color: css(COLORS.gray300) }}>Source: {data.sourceNote} · as of {data.asOf}</div>
    </div>
  );
}
