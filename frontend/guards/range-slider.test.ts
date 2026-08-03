/* Guard (pass N): the 52주 position track cannot disagree with the numbers
 * beside it.
 *
 * The track is a PICTURE of the three statistics the column already prints:
 * a low→high line with a marker at the current level. The failure this pins
 * is the cheap one — a second derivation. If the marker ever read its own
 * copy of the range (a different field, a re-derived window, a percentile),
 * a reader could see a marker near the high end beside numbers that say
 * otherwise. So the position is derived from `rangeValues` + `row.now` — the
 * exact fields `rangeText` prints — and this file asserts both the geometry
 * and the single source.
 *
 * DELIBERATELY NOT the backend's `pct`. `range1y.pct` is a RANK percentile
 * over 252 observations (backend/app/derive.py::annual_stats) and drives the
 * 고점권/저점권 screener chips; the track shows the position inside the
 * min–max RANGE. Wiring the track to `pct` would have coupled it to the chip
 * predicate — and shipping the forward percentile silently changes which rows
 * the chips return, which DESIGN ## Provisional (Pass L, item 2) records as
 * an owner decision, not a side effect. The two statistics can visibly
 * disagree (a skewed year puts the 90th-rank percentile mid-range); that
 * divergence is documented, not resolved here. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code, identifiers } from "./_source";

import { colPx, visibleColumns } from "../src/ui/columns";
import { markerPct, RangeCells, rangeValues } from "../src/ui/RangeCells";
import type { Row } from "../src/ui/rows";

function row(now: number | null, high: number | null, low: number | null): Row {
  return {
    id: "x",
    label: "x",
    group: "outright",
    unit: "%",
    now,
    changes: { d1: null, mtd: null, ytd: null },
    pct: null, // the track must not need it — forwards never carry one
    seriesId: null,
    rangeHigh: high,
    rangeLow: low,
    rangeAvg: high != null && low != null ? (high + low) / 2 : null,
    sortKey: [1],
    movePct: null,
    key: true,
  };
}

describe("marker geometry, from the same values the numbers print", () => {
  it("a level AT its 52-week high puts the marker at the track end", () => {
    expect(markerPct(row(3.875, 3.875, 2.32))).toBe(100);
    // and rendered, that is a marker at left:100% of the track
    const m = renderToStaticMarkup(
      createElement(RangeCells, { row: row(3.875, 3.875, 2.32), slider: true }),
    );
    expect(m).toContain("left:100%");
  });

  it("at the low it sits at the start; midway it sits midway", () => {
    expect(markerPct(row(2.32, 3.875, 2.32))).toBe(0);
    expect(markerPct(row(3.0, 4.0, 2.0))).toBe(50);
  });

  it("OUTSIDE the extremes it clamps to the end — never off the track", () => {
    // possible when the current print is itself the new high/low and the
    // stats lag a rounding step, or for a forward whose window differs
    expect(markerPct(row(4.1, 4.0, 2.0))).toBe(100);
    expect(markerPct(row(1.9, 4.0, 2.0))).toBe(0);
  });

  it("degenerate rows render an empty cell, the graphic's em dash", () => {
    // a zero-width range has no interior; a missing statistic has no frame
    expect(markerPct(row(3.0, 3.0, 3.0))).toBeNull();
    expect(markerPct(row(3.0, null, null))).toBeNull();
    expect(markerPct(row(null, 4.0, 2.0))).toBeNull();
    const m = renderToStaticMarkup(
      createElement(RangeCells, { row: row(3.0, 3.0, 3.0), slider: true }),
    );
    expect(m).not.toContain("left:");
  });

  it("the marker reads rangeValues — the numbers' own accessor — not a copy", () => {
    const r = row(3.5, 4.0, 2.0);
    const [high, low] = rangeValues(r);
    expect(markerPct(r)).toBe(((r.now! - low!) / (high! - low!)) * 100);
    // structurally: the row's range fields are read in exactly one place in
    // the file (inside rangeValues); markerPct and the track go through it
    const src = identifiers("ui/RangeCells.tsx");
    for (const f of ["rangeHigh", "rangeLow", "rangeAvg"]) {
      expect(
        (src.match(new RegExp(`row\\.${f}`, "g")) ?? []).length,
        `${f} is read outside rangeValues — a second source`,
      ).toBe(1);
    }
    // and it never touches the chips' percentile
    expect(src).not.toMatch(/row\.pct|\.pct\b/);
  });
});

describe("the track drops at its own threshold, inside the ladder", () => {
  const CH = 7.74;
  const w = colPx(CH);
  const full =
    w.label + w.level + 3 * w.delta + w.range + w.rangeSub;

  it("present at its threshold, gone one pixel below — 52주 unaffected", () => {
    const wide = visibleColumns(Math.ceil(full), CH, null);
    expect(wide.slider).toBe(true);
    expect(wide.hidden).toBe(0);
    const narrow = visibleColumns(Math.ceil(full) - w.rangeSub, CH, null);
    expect(narrow.slider).toBe(false);
    expect(narrow.range52).toBe(true);
    expect(narrow.hidden).toBe(1);
  });

  it("the header states the drop instead of leaving a silent gap", () => {
    // the note for the slider-only-hidden state rides in the range header's
    // filler track — the note prop exists and the table passes it
    const table = code("ui/InstrumentTable.tsx");
    expect(table).toMatch(/<RangeHeader[\s\S]{0,240}note=/);
    expect(code("ui/RangeCells.tsx")).toContain("note");
  });
});
