"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChartSlide from "@/components/presentations/ChartSlide";
import CalloutSlide from "@/components/presentations/CalloutSlide";
import TableSlide from "@/components/presentations/TableSlide";
import { CANVAS, COLORS, css } from "@/lib/presentations/tokens";
import type { ResolvedDeck, ResolvedSlide } from "@/lib/presentations/spec";

function SlideView({ slide }: { slide: ResolvedSlide }) {
  switch (slide.type) {
    case "chart":
      return <ChartSlide slide={slide} />;
    case "callout":
      return <CalloutSlide slide={slide} />;
    case "table":
      return <TableSlide slide={slide} />;
  }
}

/** Fixed 16:9 canvas scaled to fit the viewport, arrow-key / click navigation. */
export default function DeckViewer({ deck }: { deck: ResolvedDeck }) {
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const last = deck.slides.length - 1;
  const go = useCallback((d: number) => setIndex((i) => Math.min(last, Math.max(0, i + d))), [last]);

  useEffect(() => {
    const fit = () => {
      const el = box.current;
      if (el) setScale(Math.min(el.clientWidth / CANVAS.w, el.clientHeight / CANVAS.h));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(last);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, last]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", display: "flex", flexDirection: "column", zIndex: 50 }}>
      <div ref={box} style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <div style={{ width: CANVAS.w * scale, height: CANVAS.h * scale, position: "relative", overflow: "hidden" }}>
          <div style={{ width: CANVAS.w, height: CANVAS.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <SlideView slide={deck.slides[index]} />
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center", padding: 8, color: css(COLORS.gray300), fontSize: 14 }}>
        <button onClick={() => go(-1)} disabled={index === 0} style={{ padding: "2px 10px" }}>←</button>
        <span>{index + 1} / {deck.slides.length} · {deck.title}</span>
        <button onClick={() => go(1)} disabled={index === last} style={{ padding: "2px 10px" }}>→</button>
        <a href={`/api/presentations/${deck.id}/pptx`} style={{ marginLeft: 16, textDecoration: "underline" }}>Download .pptx</a>
      </div>
    </div>
  );
}
