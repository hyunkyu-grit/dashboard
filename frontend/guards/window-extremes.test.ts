/* Guard (pass O): the marked extremes are a property of the VISIBLE WINDOW.
 *
 * The high/low dots on the detail chart mark the extremes of what is
 * currently plotted — not the 52-week statistics (a fixed server-side
 * window, answered in the tooltip) and not the full series when only part
 * of it is on screen. The failure this pins: extremes computed once and
 * kept, so that changing the window leaves stale marks — plausible-looking
 * dots sitting on values that are no longer the picture's extremes.
 *
 * Mechanically the window IS the `points` prop (the chart plots everything
 * it is given, and any windowing — a different slice today, a zoom later —
 * arrives as a different slice), so the assertion is: a different slice, a
 * different pair of marks, including a slice whose extreme sits exactly on
 * the window's edge. The grid's placement (behind the line, lightest ink)
 * is pinned here too.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HistoryPoint } from "../src/lib/api";
import { windowExtremes } from "../src/ui/extremes";
import { PreviewChart } from "../src/ui/PreviewChart";

/* a series whose global extremes live in the middle, so that windows can be
 * chosen with the extreme inside, outside, and exactly on an edge */
const SERIES: HistoryPoint[] = [
  { t: "2026-01-05", v: 3.0, d: 0 },
  { t: "2026-01-06", v: 3.6, d: 0 },
  { t: "2026-01-07", v: 2.4, d: 0 }, // global low
  { t: "2026-01-08", v: 3.1, d: 0 },
  { t: "2026-01-09", v: 4.2, d: 0 }, // global high
  { t: "2026-01-12", v: 3.3, d: 0 },
  { t: "2026-01-13", v: 3.2, d: 0 },
];

describe("windowExtremes is a function of the window, nothing else", () => {
  it("the full window finds the global extremes", () => {
    expect(windowExtremes(SERIES)).toEqual({ hi: 4, lo: 2 });
  });

  it("a different window, a different answer — stale marks are the failure", () => {
    // window excluding both global extremes: its own extremes take over
    expect(windowExtremes(SERIES.slice(3))).toEqual({ hi: 1, lo: 0 });
    expect(windowExtremes(SERIES.slice(5))).toEqual({ hi: 0, lo: 1 });
  });

  it("an extreme exactly ON the window's edge is still found", () => {
    // low at index 0 of the slice (leading edge)
    expect(windowExtremes(SERIES.slice(2))).toEqual({ hi: 2, lo: 0 });
    // high at the trailing edge
    expect(windowExtremes(SERIES.slice(0, 5))).toEqual({ hi: 4, lo: 2 });
  });

  it("ties take the FIRST occurrence — one rule, stated", () => {
    const tied = [{ v: 1 }, { v: 5 }, { v: 0 }, { v: 5 }, { v: 0 }];
    expect(windowExtremes(tied)).toEqual({ hi: 1, lo: 2 });
  });

  it("a flat window reports its first point twice; empty reports nothing", () => {
    expect(windowExtremes([{ v: 2 }, { v: 2 }, { v: 2 }])).toEqual({ hi: 0, lo: 0 });
    expect(windowExtremes([])).toBeNull();
  });
});

describe("the rendered chart: marks move with the window; the grid stays behind", () => {
  const DATES4 = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
  const render = (points: HistoryPoint[]) =>
    renderToStaticMarkup(
      createElement(PreviewChart, {
        points,
        stats: { min: 2.4, max: 4.2, avg: 3.3 },
        unit: "%",
        width: 600,
        height: 300,
      }),
    );

  const marks = (m: string) =>
    [...m.matchAll(/<circle[^>]*data-extreme="(hi|lo)"[^>]*cx="([\d.]+)"[^>]*/g)]
      .map((x) => ({ k: x[1], cx: Number(x[2]) }));

  it("both extremes are marked, and a narrower window moves them", () => {
    const full = marks(render(SERIES));
    const windowed = marks(render(SERIES.slice(3)));
    expect(full.map((m) => m.k).sort()).toEqual(["hi", "lo"]);
    expect(windowed.map((m) => m.k).sort()).toEqual(["hi", "lo"]);
    expect(windowed).not.toEqual(full);
  });

  it("an edge extreme sits at the plot edge, not clipped away", () => {
    // SERIES.slice(2): the low is the window's FIRST point → cx at PAD.left
    const m = marks(render(SERIES.slice(2)));
    const lo = m.find((d) => d.k === "lo")!;
    expect(lo.cx).toBe(6); // PAD.left — the window's leading edge
  });

  it("the extremes SAY their value, in the level grammar [OWNER, 2026-08-03]", () => {
    // "지난 10년간 최고치 최저치를 바로 보일 수 있게" — a dot without its
    // number answers nothing. The value is data, so it prints through
    // fmtLevel (4dp for %), never the axis' coarse grammar.
    const m = render(SERIES);
    expect(m).toContain(">4.2000<");
    expect(m).toContain(">2.4000<");
    // a flat window has ONE value and prints it once, not twice on one spot
    const flat = render(DATES4.map((t) => ({ t, v: 3, d: 0 })));
    expect(flat.match(/>3\.0000</g)).toHaveLength(1);
  });

  it("every horizontal gridline carries its level [OWNER, 2026-08-03]", () => {
    // before this, a chart without the reference overlay — every outright,
    // the whole 변동성 tab — had no numbers anywhere on its axis. Three
    // gridlines, three values, in fmtAxis' coarse grammar; bare on a
    // single-scale chart (units only disambiguate dual axes, pass M's rule).
    const texts = [...render(SERIES).matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map((x) => x[1]);
    const bare = texts.filter((t) => /^-?\d+\.\d\d$/.test(t));
    expect(bare.length).toBeGreaterThanOrEqual(3);
    // and the values orient on the instrument's own domain
    for (const t of bare) {
      expect(Number(t)).toBeGreaterThan(2.2);
      expect(Number(t)).toBeLessThan(4.4);
    }
  });

  it("the grid is the lightest ink and painted BEFORE the series line", () => {
    const m = render(SERIES);
    // furniture takes the hairline token, never the series colour or plain ink
    expect(m).toContain('class="stroke-edge"');
    const gridAt = m.indexOf("stroke-edge");
    const lineAt = m.indexOf('stroke-width="1.6"');
    expect(gridAt).toBeGreaterThan(-1);
    expect(lineAt).toBeGreaterThan(-1);
    // SVG paints in source order: grid first = grid behind
    expect(gridAt).toBeLessThan(lineAt);
    // and it has both directions — horizontals and verticals
    const gridLines = [...m.matchAll(/<line[^>]*stroke-edge[^>]*>/g)];
    expect(gridLines.length).toBeGreaterThanOrEqual(4);
  });
});
