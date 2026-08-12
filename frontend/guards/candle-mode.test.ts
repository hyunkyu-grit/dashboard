/* Guard — 선 · 주봉 · 월봉, everywhere [OWNER, 2026-08-13 "지금은 차트가
 * 라인차트만 나오는데 (차트 전부 얘기하는 거임) 모드 설정하면 원하면
 * 캔들차트로 보여줄 수 있게 가능?"].
 *
 * Candles existed only inside the popup. They now draw in the hand-rolled SVG
 * chart too — the overview's three columns and the side preview pane — driven
 * by ONE global preference. Four things can silently go wrong here, and each
 * one still LOOKS like a working chart, which is why they are pinned:
 *
 *   1. the chart falls back to a line and nobody notices;
 *   2. the y-domain or the 최고/최저 dots read closes while the bars show
 *      wicks, so a dot floats off the very extreme it names;
 *   3. a zoom window survives a mode switch and names a different window of a
 *      different resolution;
 *   4. the backtest's context chart takes candles and quietly breaks its
 *      pixel alignment with the P&L chart below it.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import type { OhlcBar } from "../src/lib/api";
import { bodyWidth, candlePaths, MIN_BODY_H } from "../src/ui/candlePath";
import { CHART_TYPES, asChartType, isCandleType } from "../src/ui/chartType";
import { candleSpans, lineSpans, spanExtremes, windowExtremes } from "../src/ui/extremes";
import { fmtChangePct } from "../src/lib/format";

const bar = (t: string, o: number, h: number, l: number, c: number): OhlcBar => ({
  t,
  o,
  h,
  l,
  c,
});

/* ——— the modes themselves ——— */

describe("the mode set", () => {
  it("is 선 · 주봉 · 월봉 and nothing else", () => {
    expect(CHART_TYPES.map((c) => c.id)).toEqual(["line", "w", "m"]);
    expect(CHART_TYPES.map((c) => c.label)).toEqual(["선", "주봉", "월봉"]);
  });

  it("has NO 일봉 — the source is closes only", () => {
    /* A daily candle cannot be built from `mkt_irs_close`: the open would be
     * the close, so 2,600 bodyless bars. This is a DATA fact, not a design
     * choice, and it is why the popup never offered one either (§G). If a
     * daily OHLC source ever lands, this assertion is the thing to come
     * back to — deliberately, rather than discovering the gap on screen. */
    expect(CHART_TYPES.map((c) => c.id)).not.toContain("d");
  });

  it("refuses a mode it does not know, rather than guessing", () => {
    expect(asChartType("w")).toBe("w");
    expect(asChartType("d")).toBe(null);
    expect(asChartType(null)).toBe(null);
    expect(asChartType("candles")).toBe(null);
    expect(isCandleType("line")).toBe(false);
    expect(isCandleType("m")).toBe(true);
  });
});

/* ——— extents: a bar is its wick, a point is its close ——— */

describe("the window's extent (extremes.ts)", () => {
  it("a candle window is measured by WICKS, not closes", () => {
    // the high wick is on bar 1, the low wick on bar 2, and NEITHER bar has
    // the extreme CLOSE — a close-based scan would mark bar 0 and bar 2
    const bars = [
      bar("2026-01-02", 3.0, 3.1, 2.95, 3.05),
      bar("2026-01-09", 3.05, 3.9, 3.0, 3.2),
      bar("2026-01-16", 3.2, 3.3, 2.1, 3.25),
    ];
    const ext = spanExtremes(candleSpans(bars))!;
    expect(ext.hi).toBe(1);
    expect(ext.lo).toBe(2);
    expect(candleSpans(bars)[ext.hi].hi).toBe(3.9);
    expect(candleSpans(bars)[ext.lo].lo).toBe(2.1);
  });

  it("on a line window it is exactly the close-based scan", () => {
    // the two must not disagree: the chart calls only spanExtremes now, and a
    // line's spans are its closes twice over
    const pts = [
      { t: "a", v: 3.0 },
      { t: "b", v: 3.4 },
      { t: "c", v: 2.8 },
      { t: "d", v: 3.4 },
    ];
    expect(spanExtremes(lineSpans(pts))).toEqual(windowExtremes(pts));
  });

  it("ties take the FIRST occurrence — the preview's stated rule", () => {
    const pts = [
      { t: "a", v: 5 },
      { t: "b", v: 5 },
      { t: "c", v: 1 },
    ];
    expect(spanExtremes(lineSpans(pts))!.hi).toBe(0);
  });

  it("an empty window has no extremes", () => {
    expect(spanExtremes([])).toBe(null);
  });
});

/* ——— the ink ——— */

describe("candle geometry (candlePath.ts)", () => {
  const x = (i: number) => 10 + i * 20;
  const y = (v: number) => 100 - v * 10; // higher value → smaller y, as on screen

  it("splits by direction, 보합 counted as up", () => {
    const bars = [
      bar("a", 3.0, 3.2, 2.9, 3.1), // up
      bar("b", 3.1, 3.2, 2.5, 2.7), // down
      bar("c", 3.0, 3.1, 2.9, 3.0), // flat → up
    ];
    const p = candlePaths(bars, x, y, 8);
    // two subpaths on the up side, one on the down side
    expect((p.up.bodies.match(/M/g) ?? []).length).toBe(2);
    expect((p.down.bodies.match(/M/g) ?? []).length).toBe(1);
    expect((p.up.wicks.match(/M/g) ?? []).length).toBe(2);
    expect((p.down.wicks.match(/M/g) ?? []).length).toBe(1);
  });

  it("a doji still has a body — an unmoved week is not a missing week", () => {
    const p = candlePaths([bar("a", 3.0, 3.2, 2.8, 3.0)], x, y, 8);
    // M x0,top H x1 V bottom … — bottom must clear top by at least MIN_BODY_H
    const m = /^M([\d.-]+),([\d.-]+)H([\d.-]+)V([\d.-]+)/.exec(p.up.bodies)!;
    expect(Number(m[4]) - Number(m[2])).toBeGreaterThanOrEqual(MIN_BODY_H);
  });

  it("the wick spans high to low, centred on the bar", () => {
    const p = candlePaths([bar("a", 3.0, 3.5, 2.5, 3.2)], x, y, 8);
    expect(p.up.wicks).toBe(`M${x(0).toFixed(1)},${y(3.5).toFixed(1)}V${y(2.5).toFixed(1)}`);
  });

  it("the body is centred on the same x the crosshair uses", () => {
    const p = candlePaths([bar("a", 3.0, 3.2, 2.8, 3.1)], x, y, 8);
    const m = /^M([\d.-]+),[\d.-]+H([\d.-]+)/.exec(p.up.bodies)!;
    expect((Number(m[1]) + Number(m[2])) / 2).toBeCloseTo(x(0), 5);
  });

  it("the width never collapses to nothing and never becomes a block", () => {
    expect(bodyWidth(0.4)).toBe(1); // 553 weekly bars in a 668px column
    expect(bodyWidth(100)).toBeLessThanOrEqual(14); // zoomed to a handful
    expect(bodyWidth(20)).toBeCloseTo(12.4, 5);
  });

  it("no bars, no paths", () => {
    const p = candlePaths([], x, y, 8);
    expect(p.up.bodies).toBe("");
    expect(p.down.wicks).toBe("");
  });
});

/* ——— 등락률 is one quantity with one grammar ——— */

describe("등락률 (lib/format)", () => {
  it("is signed, two decimals, U+2212 for minus", () => {
    expect(fmtChangePct(3.0, 3.15)).toBe("+5.00%");
    expect(fmtChangePct(3.0, 2.7)).toBe("−10.00%");
    expect(fmtChangePct(3.0, 3.0)).toBe("+0.00%");
  });

  it("a ZERO open has no percent change — spreads cross zero", () => {
    // the inline version this replaced printed +0.00% here, on a bar that moved
    expect(fmtChangePct(0, 2.5)).toBe("—");
    expect(fmtChangePct(null, 2.5)).toBe("—");
    expect(fmtChangePct(2.5, null)).toBe("—");
  });

  it("both candle tooltips route through it", () => {
    expect(code("wall/DetailChart.tsx")).toMatch(/fmtChangePct\(b\.o, b\.c\)/);
    expect(code("ui/ReadoutCard.tsx")).toMatch(/fmtChangePct\(open, close\)/);
    // and neither re-derives the percent beside it
    expect(code("wall/DetailChart.tsx"), "DetailChart still computes chg").not.toMatch(
      /\(\(b\.c - b\.o\) \/ b\.o\)/,
    );
  });
});

/* ——— wiring, pinned in source ——— */

describe("the preview chart really draws candles", () => {
  const chart = code("ui/PreviewChart.tsx");

  it("emits the four direction-token paths, not a line", () => {
    // a candle chart that has silently fallen back to a line still looks fine,
    // which is exactly why this is checked in source and by data-attribute
    expect(chart).toMatch(/data-candle=""/);
    for (const part of ["up-wick", "down-wick", "up-body", "down-body"]) {
      expect(chart, `missing candle path ${part}`).toContain(`data-candle-part="${part}"`);
    }
    // 상승 빨강 / 하락 파랑 — the direction pair (§9), never the line blue
    for (const cls of ["stroke-up", "stroke-down", "fill-up", "fill-down"]) {
      expect(chart).toContain(cls);
    }
  });

  it("the 최고/최저 dots read the SPAN edge, never the bar's close", () => {
    expect(chart).toMatch(/\{ k: "hi", i: ext\.hi, v: spans\[ext\.hi\]\.hi \}/);
    expect(chart).toMatch(/\{ k: "lo", i: ext\.lo, v: spans\[ext\.lo\]\.lo \}/);
    // and the y-domain is stretched to the same two numbers
    expect(chart).toMatch(/let lo = spans\[ext\.lo\]\.lo/);
    expect(chart).toMatch(/let hi2 = spans\[ext\.hi\]\.hi/);
  });

  it("falls back to the line when bars have not arrived", () => {
    // a mode switch must never blank a chart that has data to show
    expect(chart).toMatch(/isCandleType\(chartType\) && \(bars\?\.length \?\? 0\) >= 2/);
  });
});

describe("the backtest context chart stays a LINE", () => {
  it("never passes a chart type, and the default is line", () => {
    /* [OWNER: "완전히 수직적으로 얼라인"] — that chart and the P&L chart below
     * it share CHART_PAD and one index→x formula, so they are aligned by
     * construction. Weekly bars change the index space itself (2,621 → 553),
     * and the sibling cannot follow; the alignment would break silently,
     * which is the whole failure class the linked pair exists to avoid. */
    const bt = code("ui/BacktestWindow.tsx");
    expect(bt, "the backtest context chart took a chartType").not.toMatch(
      /<PreviewChart[\s\S]{0,600}chartType=/,
    );
    expect(code("ui/PreviewChart.tsx")).toMatch(/chartType = "line"/);
  });
});

describe("the mode is ONE global preference", () => {
  it("lives in the ui store, persisted, like the theme beside it", () => {
    const store = code("state/ui.ts");
    expect(store).toMatch(/chartType: ChartType/);
    expect(store).toMatch(/localStorage\.setItem\(CHART_TYPE_KEY/);
    expect(store).toMatch(/asChartType\(localStorage\.getItem\(CHART_TYPE_KEY\)\)/);
  });

  it("every surface reads that one store — no local copies", () => {
    for (const f of [
      "ui/App.tsx", // the toolbar control
      "ui/EnlargedView.tsx", // the popup's control
      "ui/PreviewPane.tsx", // the side pane's chart
      "ui/OverviewColumns.tsx", // the three column charts
    ]) {
      expect(code(f), `${f} does not read the shared chart type`).toMatch(
        /useUiStore\(\(s\) => s\.chartType\)/,
      );
    }
  });

  it("both controls render the same list", () => {
    expect(code("ui/App.tsx")).toMatch(/CHART_TYPES\.map/);
    expect(code("ui/EnlargedView.tsx")).toMatch(/CHART_TYPES\.map/);
  });

  it("?type= is READ once as a seed and never written back", () => {
    /* A reader preference in the URL means sending a link changes the
     * recipient's setting. The parameter survives only so that links made
     * before 2026-08-13 still open on the type they named. */
    const app = code("ui/App.tsx");
    expect(app).toMatch(/asChartType\(params\.get\("type"\)\)/);
    expect(app, "?type= is being written again").not.toMatch(/\{ type: /);
  });
});
