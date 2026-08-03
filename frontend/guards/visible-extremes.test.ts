/* Guard (2026-08-03): the detail chart's 최고/최저 marks follow the ZOOM.
 *
 * `extremeMarks` (ui/extremes.ts) is the visible-range counterpart of
 * `windowExtremes`: the window is a fractional logical range over data
 * indices, and the marks must be a pure function of the visible slice — the
 * failure this pins is a mark retained from a previous window, sitting on a
 * value that is no longer the picture's extreme, or a mark on an index the
 * reader cannot see.
 *
 * The range convention (ceil(from)..floor(to), clamped; null = everything)
 * is deliberately the SAME one DetailChart's tooltip stats use, so the
 * marked 최고 and the tooltip's 구간 최고 can never disagree about one
 * window. And because the component feeds the scan the range object the
 * library REPORTED RENDERING — the same object assertDomainRendered
 * validates after fitContent — the marks cover the domain actually drawn,
 * never indices minBarSpacing silently clipped (the domainGuard class).
 *
 * Tie rule here is MOST RECENT [OWNER task, 2026-08-03] — the opposite of
 * the preview's first-occurrence rule, and stated in both places: the
 * preview is a fixed window, the detail chart is a live one, and on a live
 * window the newest print of an extreme is the actionable one.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { fmtLevel } from "../src/lib/format";
import {
  candleSpans,
  extremeMarks,
  lineSpans,
  type Span,
} from "../src/ui/extremes";

const D = (i: number) => `2026-01-${String(i + 1).padStart(2, "0")}`;
const line = (...vs: number[]) =>
  lineSpans(vs.map((v, i) => ({ t: D(i), v })));

describe("extremeMarks: a pure function of the visible slice", () => {
  const S = line(3.0, 3.6, 2.4, 3.1, 4.2, 3.3, 3.2); // low @2, high @4

  it("null range means everything — the pre-range state the library reports", () => {
    const m = extremeMarks(S, null, "%");
    expect(m.map((x) => [x.kind, x.i, x.v])).toEqual([
      ["lo", 2, 2.4],
      ["hi", 4, 4.2],
    ]);
  });

  it("the window moves, the marks move — replaced, never retained", () => {
    // window excludes both global extremes → its own extremes take over
    const m = extremeMarks(S, { from: 5, to: 6 }, "%");
    expect(m.map((x) => [x.kind, x.i])).toEqual([
      ["hi", 5],
      ["lo", 6],
    ]);
  });

  it("fractional edges: ceil(from)..floor(to) — the tooltip stats' convention", () => {
    // from 0.4 excludes index 0; to 4.6 includes index 4
    const m = extremeMarks(S, { from: 0.4, to: 4.6 }, "%");
    expect(m.find((x) => x.kind === "hi")!.i).toBe(4);
    expect(m.find((x) => x.kind === "lo")!.i).toBe(2);
    // from 2.3 excludes the global low at 2
    const n = extremeMarks(S, { from: 2.3, to: 5.8 }, "%");
    expect(n.find((x) => x.kind === "lo")!.i).toBe(3);
  });

  it("a full-span fractional range covers every index — the fitContent shape", () => {
    // fitContent reports from −0.5 to n−0.5 (bar centers ± half a bar):
    // ceil/floor must resolve that to ALL indices, or an edge extreme is lost
    const m = extremeMarks(S, { from: -0.5, to: S.length - 0.5 }, "%");
    expect(m.map((x) => [x.kind, x.i])).toEqual([
      ["lo", 2],
      ["hi", 4],
    ]);
  });

  it("out-of-data and inverted ranges mark nothing", () => {
    expect(extremeMarks(S, { from: 40, to: 90 }, "%")).toEqual([]);
    expect(extremeMarks(S, { from: 5, to: 3 }, "%")).toEqual([]);
    expect(extremeMarks([], null, "%")).toEqual([]);
  });

  it("ties take the MOST RECENT occurrence — the stated divergence", () => {
    const tied = line(1, 5, 0, 5, 0, 3);
    const m = extremeMarks(tied, null, "%");
    expect(m.find((x) => x.kind === "hi")!.i).toBe(3);
    expect(m.find((x) => x.kind === "lo")!.i).toBe(4);
  });

  it("a flat window prints ONE bare mark on its last visible point", () => {
    const flat = line(3, 3, 3, 3);
    const m = extremeMarks(flat, { from: 0, to: 2 }, "%");
    expect(m).toHaveLength(1);
    expect(m[0].kind).toBe("flat");
    expect(m[0].i).toBe(2); // last VISIBLE, not last in data
    expect(m[0].text).toBe(fmtLevel(3, "%"));
    expect(m[0].text).not.toContain("최고");
    expect(m[0].text).not.toContain("최저");
  });

  it("candle mode: the high is a max of HIGHS, the low a min of LOWS", () => {
    const bars = candleSpans([
      { t: D(0), h: 3.5, l: 3.0 },
      { t: D(1), h: 4.4, l: 3.4 }, // wick high
      { t: D(2), h: 3.3, l: 2.1 }, // wick low
    ]);
    const m = extremeMarks(bars, null, "%");
    expect(m.map((x) => [x.kind, x.i, x.v])).toEqual([
      ["hi", 1, 4.4],
      ["lo", 2, 2.1],
    ]);
  });

  it("a single visible candle carries BOTH marks, high above and low below", () => {
    const bars = candleSpans([
      { t: D(0), h: 3.5, l: 3.0 },
      { t: D(1), h: 4.4, l: 3.4 },
    ]);
    const m = extremeMarks(bars, { from: 1, to: 1.4 }, "%");
    expect(m.map((x) => [x.kind, x.i, x.v])).toEqual([
      ["hi", 1, 4.4],
      ["lo", 1, 3.4],
    ]);
  });

  it("labels speak the level grammar — fmtLevel per unit, no new formatter", () => {
    const m = extremeMarks(S, null, "%");
    expect(m.find((x) => x.kind === "hi")!.text).toBe(`최고 ${fmtLevel(4.2, "%")}`);
    expect(m.find((x) => x.kind === "lo")!.text).toBe(`최저 ${fmtLevel(2.4, "%")}`);
    const bp = extremeMarks(line(10.5, -3.5), null, "bp");
    expect(bp.find((x) => x.kind === "hi")!.text).toBe(`최고 ${fmtLevel(10.5, "bp")}`);
  });
});

describe("parity: what is marked equals what the visible slice computes", () => {
  // a deterministic pseudo-random series (fixed LCG seed — a flaky guard is
  // worse than no guard), scanned independently of the implementation
  let seed = 20260803;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const spans: Span[] = [];
  for (let i = 0; i < 400; i++) {
    const mid = 3 + Math.sin(i / 17) + rnd();
    const w = rnd() * 0.4;
    spans.push({ t: D(i % 28), hi: mid + w, lo: mid - w });
  }

  it("over many random windows, marks equal an independent scan", () => {
    for (let k = 0; k < 60; k++) {
      const a = rnd() * (spans.length - 2);
      const b = a + rnd() * (spans.length - a);
      const lo = Math.max(0, Math.ceil(a));
      const hi = Math.min(spans.length - 1, Math.floor(b));
      const marks = extremeMarks(spans, { from: a, to: b }, "%");
      if (hi < lo) {
        expect(marks).toEqual([]);
        continue;
      }
      const slice = spans.slice(lo, hi + 1);
      const max = Math.max(...slice.map((s) => s.hi));
      const min = Math.min(...slice.map((s) => s.lo));
      const mHi = marks.find((x) => x.kind === "hi")!;
      const mLo = marks.find((x) => x.kind === "lo")!;
      expect(mHi.v, `window ${a}..${b}`).toBe(max);
      expect(mLo.v, `window ${a}..${b}`).toBe(min);
      // and a mark NEVER sits outside the visible window
      for (const m of marks) {
        expect(m.i).toBeGreaterThanOrEqual(lo);
        expect(m.i).toBeLessThanOrEqual(hi);
      }
      // most-recent tie rule, checked against the slice
      expect(slice.slice(mHi.i - lo + 1).every((s) => s.hi < max)).toBe(true);
      expect(slice.slice(mLo.i - lo + 1).every((s) => s.lo > min)).toBe(true);
    }
  });
});

describe("the component wiring (source-pinned)", () => {
  const src = code("wall/DetailChart.tsx");

  it("marks ride the ONE existing range subscription — no second pipeline", () => {
    expect(
      (src.match(/subscribeVisibleLogicalRangeChange/g) ?? []).length,
    ).toBe(1);
    // fed the subscription's own range argument — the rendered domain the
    // domain guard validates — not a re-derived or cached one
    expect(src).toMatch(/scheduleExtremes\(r\)/);
  });

  it("recompute is throttled to one scan per animation frame", () => {
    expect(src).toMatch(/if \(extremesRaf\) return/);
    expect(src).toMatch(/extremesRaf = requestAnimationFrame/);
    // and the pending frame dies with the chart
    expect(src).toMatch(/cancelAnimationFrame\(extremesRaf\)/);
  });

  it("both modes feed the shared scan through the span adapters", () => {
    expect(src).toMatch(/spansRef\.current = lineSpans\(data\.points\)/);
    expect(src).toMatch(/spansRef\.current = candleSpans\(data\.bars\)/);
    expect(src).toMatch(/extremeMarks\(spansRef\.current, lastRange, unit\)/);
  });

  it("marker hues go through the theme bridge and past assertNoCssVars", () => {
    expect(src).toMatch(/resolveDirection\(true\), lo: resolveDirection\(false\), flat: resolveInk\(\)/);
    expect(src).toMatch(/assertNoCssVars\(markHue\)/);
  });
});
