/* Guard: the BOK base rate overlay (src/ui/policyLine.ts).
 *
 * Every assertion here is about a way the overlay can draw a rate that was
 * never in force. The overlay is decorative-looking and is not — it is a
 * second market number on the same axis as the first, so a projection bug
 * looks exactly like a correct chart.
 *
 * The one to read first is "never past `through`". The backend truncates the
 * step when the workbook has not been refreshed through a Board meeting; a
 * front end that runs the last level to the axis end instead undoes that
 * silently, on every %-unit chart at once.
 */

import { describe, expect, it } from "vitest";

import type { HistoryPoint, PolicyStep } from "../src/lib/api";
import {
  alignSeries,
  policyExtent,
  policyPath,
  policySegments,
  seriesExtent,
  seriesPath,
  snapPolicyToTimes,
  takesPolicyOverlay,
} from "../src/ui/policyLine";

const pts = (...dates: string[]): HistoryPoint[] =>
  dates.map((t, i) => ({ t, v: 3 + i * 0.01, d: 0 }));

const step = (
  steps: { date: string; rate: number }[],
  through: string,
): PolicyStep => ({
  unit: "%",
  asof: steps[steps.length - 1]?.date ?? through,
  through,
  steps,
  latest: steps[steps.length - 1]?.rate ?? null,
  warnings: [],
});

const DAYS = pts(
  "2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05",
  "2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05",
);

describe("the step is projected onto the series' own index space", () => {
  it("a decision lands on the first point at or after its date", () => {
    const segs = policySegments(
      DAYS,
      step([{ date: "2026-03-01", rate: 2.5 }], "2026-08-05"),
    );
    // 2026-03-01 is not a point; the first point at or after it is index 2
    expect(segs).toEqual([{ from: 2, to: 7, rate: 2.5 }]);
  });

  it("a decision before the series starts is IN FORCE at its start", () => {
    /* Not dropped: the rate set in 2025 is the rate in force on the chart's
     * first day. Dropping it would open the chart with no line at all until
     * the next decision — a gap that means nothing and looks like missing
     * data. Clamped to index 0 instead. */
    const segs = policySegments(
      DAYS,
      step([{ date: "2025-06-01", rate: 3.0 }], "2026-08-05"),
    );
    expect(segs).toEqual([{ from: 0, to: 7, rate: 3.0 }]);
  });

  it("several pre-series decisions collapse to the LAST one", () => {
    // three hikes in 2025 are one level on a chart that starts in 2026 — and
    // it must be the most recent, not the first
    const segs = policySegments(
      DAYS,
      step(
        [
          { date: "2025-01-01", rate: 3.5 },
          { date: "2025-06-01", rate: 3.25 },
          { date: "2025-11-01", rate: 3.0 },
        ],
        "2026-08-05",
      ),
    );
    expect(segs).toEqual([{ from: 0, to: 7, rate: 3.0 }]);
  });

  it("consecutive decisions tile the axis without overlap or gap", () => {
    const segs = policySegments(
      DAYS,
      step(
        [
          { date: "2026-01-05", rate: 3.0 },
          { date: "2026-04-05", rate: 2.75 },
          { date: "2026-07-05", rate: 2.5 },
        ],
        "2026-08-05",
      ),
    );
    expect(segs).toEqual([
      { from: 0, to: 2, rate: 3.0 },
      { from: 3, to: 5, rate: 2.75 },
      { from: 6, to: 7, rate: 2.5 },
    ]);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].from).toBe(segs[i - 1].to + 1);
    }
  });
});

describe("the step never runs past `through`", () => {
  it("stops at the bound, not at the end of the chart", () => {
    /* THE guard. `through` < the series' last date means the backend refused
     * to vouch for the tail (a Board meeting the workbook has not reached).
     * The line must stop where it stops. */
    const segs = policySegments(
      DAYS,
      step([{ date: "2026-01-05", rate: 2.75 }], "2026-05-05"),
    );
    expect(segs).toEqual([{ from: 0, to: 4, rate: 2.75 }]);
    expect(segs[segs.length - 1].to).toBeLessThan(DAYS.length - 1);
  });

  it("a decision after `through` is not drawn at all", () => {
    const segs = policySegments(
      DAYS,
      step(
        [
          { date: "2026-01-05", rate: 2.75 },
          { date: "2026-07-05", rate: 3.0 },
        ],
        "2026-05-05",
      ),
    );
    expect(segs.map((s) => s.rate)).toEqual([2.75]);
  });

  it("a `through` before the series begins draws nothing", () => {
    expect(
      policySegments(DAYS, step([{ date: "2020-01-01", rate: 1.0 }], "2025-01-01")),
    ).toEqual([]);
  });

  it("no policy, no series, or no steps draws nothing", () => {
    expect(policySegments(DAYS, undefined)).toEqual([]);
    expect(policySegments([], step([{ date: "2026-01-05", rate: 2 }], "2026-08-05"))).toEqual([]);
    expect(policySegments(DAYS, step([], "2026-08-05"))).toEqual([]);
  });
});

describe("the drawn path is square, never interpolated", () => {
  const segs = policySegments(
    DAYS,
    step(
      [
        { date: "2026-01-05", rate: 3.0 },
        { date: "2026-04-05", rate: 2.75 },
      ],
      "2026-08-05",
    ),
  );

  it("each level contributes a HORIZONTAL run at one y", () => {
    const runs = policyPath(segs, (i) => i * 10, (v) => v * 100);
    expect(runs).toHaveLength(1);
    const coords = runs[0].split(" ").map((p) => p.split(",").map(Number));
    // ys take exactly two distinct values — one per decision. A diagonal
    // between them would produce intermediate ys, which is the failure.
    const ys = [...new Set(coords.map((c) => c[1]))];
    expect(ys).toEqual([300, 275]);
    // and the riser is vertical: the two points either side share an x
    const riser = coords.findIndex((c, i) => i > 0 && c[1] !== coords[i - 1][1]);
    expect(coords[riser][0]).toBe(coords[riser - 1][0] + 10);
  });

  it("the extent covers every level so a caller can widen its domain", () => {
    expect(policyExtent(segs)).toEqual({ min: 2.75, max: 3.0 });
    expect(policyExtent([])).toBeNull();
  });
});

describe("snapPolicyToTimes (the lightweight-charts feed)", () => {
  const times = DAYS.map((p) => p.t);

  it("every emitted time is a date the axis actually has", () => {
    const data = snapPolicyToTimes(
      times,
      step(
        [
          { date: "2026-02-14", rate: 3.0 }, // a Saturday, not a data point
          { date: "2026-06-20", rate: 2.75 },
        ],
        "2026-08-05",
      ),
    );
    // an unsnapped date would insert a column no trading day occupies, which
    // shifts every bar after it
    for (const d of data) expect(times).toContain(d.time);
  });

  it("closes with a flat point at `through`", () => {
    const data = snapPolicyToTimes(
      times,
      step([{ date: "2026-01-05", rate: 2.75 }], "2026-05-05"),
    );
    expect(data[data.length - 1]).toEqual({ time: "2026-05-05", value: 2.75 });
  });

  it("never emits a time past `through`", () => {
    const data = snapPolicyToTimes(
      times,
      step(
        [
          { date: "2026-01-05", rate: 2.75 },
          { date: "2026-07-05", rate: 3.0 },
        ],
        "2026-05-05",
      ),
    );
    expect(data.every((d) => d.time <= "2026-05-05")).toBe(true);
  });
});

describe("which instruments take the overlay", () => {
  it("percent only — a policy rate on a bp axis is a rescale", () => {
    expect(takesPolicyOverlay("%")).toBe(true);
    expect(takesPolicyOverlay("bp")).toBe(false);
    expect(takesPolicyOverlay("ratio")).toBe(false);
  });
});

describe("CD 91d — the second reference line", () => {
  const inst = pts("2026-01-05", "2026-03-05", "2026-05-05", "2026-07-05");

  it("aligns BY DATE, never by position", () => {
    /* THE guard for this line. Two ~150-point previews are downsampled per
     * series, so index i is a different trading day in each. A zip would plot
     * a CD level from one week against an instrument level from another — a
     * chart that looks entirely plausible and is simply wrong.
     *
     * `ref` here deliberately has different, denser dates than `inst`. */
    const ref: HistoryPoint[] = [
      { t: "2026-01-01", v: 3.0, d: 0 },
      { t: "2026-02-01", v: 3.1, d: 0 },
      { t: "2026-04-01", v: 3.2, d: 0 },
      { t: "2026-06-01", v: 3.3, d: 0 },
    ];
    // each instrument date takes the last CD observation AT OR BEFORE it
    expect(alignSeries(inst, ref)).toEqual([3.0, 3.1, 3.2, 3.3]);
    // and the naive zip would have given [3.0, 3.1, 3.2, 3.3] here too only by
    // coincidence of length — so assert the shape that distinguishes them:
    const sparse: HistoryPoint[] = [{ t: "2026-04-01", v: 9.9, d: 0 }];
    expect(alignSeries(inst, sparse)).toEqual([null, null, 9.9, 9.9]);
  });

  it("is null before CD's first observation, not flat", () => {
    // a flat lead-in at CD's opening level would assert a rate for days the
    // series does not cover; the caller breaks the line instead
    const late: HistoryPoint[] = [{ t: "2026-06-01", v: 3.3, d: 0 }];
    expect(alignSeries(inst, late)).toEqual([null, null, null, 3.3]);
    expect(alignSeries(inst, undefined)).toEqual([]);
    expect(alignSeries(inst, [])).toEqual([]);
  });

  it("the drawn path BREAKS at a null rather than bridging it", () => {
    const runs = seriesPath([null, 1, 2, null, 3, 4], (i) => i * 10, (v) => v);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toBe("10.0,1.0 20.0,2.0");
    expect(runs[1]).toBe("40.0,3.0 50.0,4.0");
  });

  it("a single isolated point draws nothing — a line needs two", () => {
    expect(seriesPath([null, 5, null], (i) => i, (v) => v)).toEqual([]);
  });

  it("the extent ignores nulls so the domain is not dragged to zero", () => {
    expect(seriesExtent([null, 2, 5, null])).toEqual({ min: 2, max: 5 });
    expect(seriesExtent([null, null])).toBeNull();
    expect(seriesExtent([])).toBeNull();
  });
});
