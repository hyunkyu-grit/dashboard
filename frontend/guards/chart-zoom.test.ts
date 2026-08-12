/* Guard (zoom-and-color session, 2026-08-04): the preview chart zooms in
 * place [OWNER: "크게보기 버튼을 안 눌러도 이 창에서 그냥 확대하고 축소하고"].
 *
 * The zoom is ONE piece of state — a visible index range, or null for the
 * full span — and everything downstream (y-domain, extremes, overlays, date
 * labels, crosshair) is a pure function of the slice it selects. So the
 * guard splits the same way: the range arithmetic is pinned as pure
 * functions, and the wiring facts that make the gesture safe are pinned in
 * source:
 *
 *   THE PAGE MUST NOT SCROLL under a chart being zoomed — React's
 *   root-attached wheel handler is passive, so the component must attach its
 *   own non-passive listener and preventDefault.
 *
 *   A PAN IS NOT A CLICK — the chart click opens the backtest [OWNER], so a
 *   pointer that dragged must suppress the click that follows it, or panning
 *   the window would book a backtest per drag.
 *
 *   FULLY OUT = NEVER ZOOMED — zoomRange returns null at the full span, so
 *   there is one resting state, not two that render identically. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { MIN_SPAN, panRange, zoomRange } from "../src/ui/chartZoom";

describe("zoomRange arithmetic", () => {
  const LEN = 150;

  it("zooming in narrows about the anchor; the anchored index stays put", () => {
    const v = zoomRange(null, LEN, 0.5, 0.8)!;
    expect(v).not.toBeNull();
    const span = v.i1 - v.i0 + 1;
    expect(span).toBeLessThan(LEN);
    // the middle of the new window is (about) the middle of the data
    expect(Math.abs((v.i0 + v.i1) / 2 - (LEN - 1) / 2)).toBeLessThanOrEqual(1);
  });

  it("an edge anchor pins that edge", () => {
    const left = zoomRange(null, LEN, 0, 0.8)!;
    expect(left.i0).toBe(0);
    const right = zoomRange(null, LEN, 1, 0.8)!;
    expect(right.i1).toBe(LEN - 1);
  });

  it("zooming out past everything returns null — one resting state", () => {
    const zoomed = zoomRange(null, LEN, 0.5, 0.8)!;
    let v: ReturnType<typeof zoomRange> = zoomed;
    for (let i = 0; i < 20 && v; i++) v = zoomRange(v, LEN, 0.5, 1.25);
    expect(v).toBeNull();
  });

  it("never narrower than MIN_SPAN, never wider than the data", () => {
    let v: ReturnType<typeof zoomRange> = null;
    for (let i = 0; i < 40; i++) v = zoomRange(v, LEN, 0.3, 0.5) ?? v;
    expect(v).not.toBeNull();
    expect(v!.i1 - v!.i0 + 1).toBe(MIN_SPAN);
    expect(v!.i0).toBeGreaterThanOrEqual(0);
    expect(v!.i1).toBeLessThanOrEqual(LEN - 1);
  });

  it("degenerate data (len < 2) never zooms", () => {
    expect(zoomRange(null, 1, 0.5, 0.8)).toBeNull();
  });
});

describe("panRange arithmetic", () => {
  const LEN = 150;
  const v = { i0: 40, i1: 79 }; // span 40

  it("slides by the delta and keeps the span", () => {
    const p = panRange(v, LEN, 10)!;
    expect(p.i0).toBe(50);
    expect(p.i1 - p.i0).toBe(v.i1 - v.i0);
  });

  it("stops at both edges", () => {
    expect(panRange(v, LEN, -999)!.i0).toBe(0);
    expect(panRange(v, LEN, 999)!.i1).toBe(LEN - 1);
  });

  it("the full span has nowhere to go", () => {
    expect(panRange(null, LEN, 25)).toBeNull();
  });
});

describe("wiring, pinned in source", () => {
  const chart = code("ui/PreviewChart.tsx");

  it("the wheel listener is native and non-passive, and prevents page scroll", () => {
    expect(chart).toMatch(/addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
    expect(chart).toMatch(/e\.preventDefault\(\)/);
    expect(chart).toMatch(/removeEventListener\("wheel", onWheel\)/);
  });

  it("a drag suppresses the click that follows it — a pan never opens the backtest", () => {
    // the moved flag crosses the pointerup→click boundary…
    expect(chart).toMatch(/justDragged\.current = drag\.current\?\.moved/);
    // …and the click handler stops the bubble before the pane's onOpen sees it
    expect(chart).toMatch(/if \(justDragged\.current\) \{[\s\S]{0,200}e\.stopPropagation\(\)/);
  });

  it("panning starts only on a zoomed chart, from an event-time snapshot", () => {
    // `vr` is the view AFTER the length check (below) — the pan must start
    // from the window actually being drawn, never from a stale one
    expect(chart).toMatch(/if \(e\.button !== 0 \|\| !vr\) return/);
    expect(chart).toMatch(/setPointerCapture/);
    expect(chart).toMatch(/base: vr/);
  });

  it("a view is discarded when it indexes a different-length array (candle session)", () => {
    /* A ViewRange is a pair of INDICES and they only mean something against
     * the array they were taken from. 선 → 주봉 takes one series from 2,621
     * points to 553 bars, and a surviving {i0,i1} would silently name a
     * different window of a different resolution — a picture that looks
     * completely normal. The state carries the length it indexed and the
     * render drops any view that no longer matches. */
    expect(chart).toMatch(/useState<\{ r: ViewRange; len: number \} \| null>/);
    expect(chart).toMatch(/const vr = view && view\.len === len \? view\.r : null/);
    // and every writer re-stamps the length it just indexed
    expect(chart).toMatch(/\{ r: next, len \}/);
  });

  it("the way back out exists and is its own click target", () => {
    expect(chart).toContain("전체 기간");
    expect(chart).toMatch(/setView\(null\)/);
  });
});

describe("reference hues ride the tokens, not ink (zoom-and-color session)", () => {
  it("the preview draws CD and the base rate through the ref tokens", () => {
    const chart = code("ui/PreviewChart.tsx");
    expect(chart).toContain("stroke-ref-cd");
    expect(chart).toContain("stroke-ref-policy");
  });
  it("the idle curve's base-rate line and label do too", () => {
    const curve = code("ui/CurveView.tsx");
    expect(curve).toContain("stroke-ref-policy");
    expect(curve).toContain("fill-ref-policy");
  });
  it("the enlarged chart resolves the same tokens for canvas, with the SVG charts' translucency", () => {
    const detail = code("wall/DetailChart.tsx");
    expect(detail).toMatch(/color: withAlpha\(resolveRefCd\(\), 0\.\d+\)/);
    expect(detail).toMatch(/color: withAlpha\(resolveRefPolicy\(\), 0\.\d+\)/);
  });
});
