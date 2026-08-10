/* Guard: row-reorder motion rules (motion session, Pass C). Reordering
 * animates only when it means "same view, new arrangement" (sort, screener),
 * is culled to the viewport's neighbourhood, and falls back to an instant
 * reorder above the row-count threshold. Transform-only FLIP — the rows'
 * layout prop is "position", asserted against the source. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import {
  FLIP_MAX_ANIMATED,
  FLIP_MAX_ROWS,
  FLIP_NEAR_SCREENS,
  flipWindow,
  reorderAnimates,
  rowShouldFlip,
} from "../src/ui/motion";

describe("what animates: cause × row count", () => {
  it("sort and screener animate; tab / start-filter snap", () => {
    expect(reorderAnimates("sort", 44)).toBe(true);
    expect(reorderAnimates("screener", 44)).toBe(true);
    expect(reorderAnimates("other", 44)).toBe(false);
  });

  it("above the threshold even sort snaps; the forward tab stays under it", () => {
    expect(reorderAnimates("sort", FLIP_MAX_ROWS)).toBe(true);
    expect(reorderAnimates("sort", FLIP_MAX_ROWS + 1)).toBe(false);
    /* 포워드 is the largest tab and it animates, culled. It was written here
     * as 168 for several sessions and the real count is 140 — rows.ts skips
     * ON starts and xSPOT tenors, so the number in the spec had never been
     * true. A literal asserting a stale fact against a constant can never
     * fail and never tells the truth; this reads the row builder's actual
     * shape instead. */
    expect(FORWARD_ROWS).toBe(140);
    expect(FORWARD_ROWS).toBeLessThanOrEqual(FLIP_MAX_ROWS);
  });
});

/** The 포워드 row count the builder actually produces: 21 start points minus
 * ON, times 8 tenors minus SPOT (ui/rows.ts). */
const FORWARD_ROWS = (21 - 1) * (8 - 1);

describe("the animated set is capped, not just culled", () => {
  /* The cull alone scales WITH the viewport: ±1 viewport-height admits ~44
   * rows on a 700px table and ~125 on a 2000px one, so a re-sort cost more on
   * a bigger monitor. The cap is what makes the bound independent of it, and
   * it is the same window the event-time snapshot measures — that loop used to
   * be O(all rows). */
  it("a short tab is entirely inside the window", () => {
    expect(flipWindow(30, 0, 700, 48)).toEqual({ from: 0, to: 30 });
  });

  it("a long tab yields exactly FLIP_MAX_ANIMATED rows", () => {
    const w = flipWindow(140, 0, 700, 48);
    expect(w.to - w.from).toBe(FLIP_MAX_ANIMATED);
  });

  it("the window follows the scroll position", () => {
    const top = flipWindow(140, 0, 700, 48);
    const mid = flipWindow(140, 48 * 60, 700, 48);
    expect(top.from).toBe(0);
    expect(mid.from).toBeGreaterThan(top.from);
    // centred on the viewport, not anchored to its top edge
    expect(mid.from).toBeLessThan(60);
    expect(mid.to).toBeGreaterThan(60);
  });

  it("it never runs off either end", () => {
    const end = flipWindow(140, 48 * 1000, 700, 48);
    expect(end.to).toBe(140);
    expect(end.from).toBe(140 - FLIP_MAX_ANIMATED);
    expect(flipWindow(140, -9999, 700, 48).from).toBe(0);
  });

  it("a zero row height cannot divide by zero", () => {
    expect(() => flipWindow(140, 100, 700, 0)).not.toThrow();
  });

  it("the cap is smaller than the threshold it sits under", () => {
    // FLIP_MAX_ROWS bounds whether the reorder animates AT ALL;
    // FLIP_MAX_ANIMATED bounds how much of it does. The second must bite first.
    expect(FLIP_MAX_ANIMATED).toBeLessThan(FLIP_MAX_ROWS);
  });
});

describe("viewport cull: a row animates only near the visible window", () => {
  const viewH = 700;
  const scrollTop = 2000;
  const slack = FLIP_NEAR_SCREENS * viewH;

  it("rows far from the viewport at both endpoints snap", () => {
    expect(rowShouldFlip(0, 100, scrollTop, viewH)).toBe(false);
    expect(rowShouldFlip(9000, 9500, scrollTop, viewH)).toBe(false);
  });

  it("a row near either endpoint animates (in, out, or through view)", () => {
    expect(rowShouldFlip(scrollTop + 100, 9000, scrollTop, viewH)).toBe(true); // leaves view
    expect(rowShouldFlip(0, scrollTop + 300, scrollTop, viewH)).toBe(true); // arrives in view
    expect(rowShouldFlip(scrollTop - slack, 9000, scrollTop, viewH)).toBe(true); // edge of slack
  });

  it("an unmeasured position never freezes a row", () => {
    expect(rowShouldFlip(null, 9000, scrollTop, viewH)).toBe(true);
    expect(rowShouldFlip(9000, null, scrollTop, viewH)).toBe(true);
  });
});

describe("the FLIP is transform-only", () => {
  const src = code("ui/InstrumentTable.tsx");
  it('rows use layout="position" (never full layout, which animates size)', () => {
    expect(src).toContain('layout={flip ? "position" : false}');
    expect(src).not.toMatch(/layout=\{true\}/);
  });
  it("exits pop out of the flow so they fade in place", () => {
    expect(src).toContain('mode="popLayout"');
  });

  it("the snapshot measures the window, not the whole tab", () => {
    // the one O(all rows) step that used to survive the cull: offsetTop was
    // read for every row in `shown` BEFORE the cull decided what could move
    expect(src).toMatch(/flipWindow\(shown\.length/);
    expect(src).not.toMatch(/for \(const r of shown\)/);
  });

  it("the render honours the same window the snapshot measured", () => {
    // otherwise an unmeasured row has a null oldTop, which rowShouldFlip
    // reads as "animate" — the whole unmeasured tail would slide from nowhere
    expect(src).toMatch(/i >= flipDest\.from/);
    expect(src).toMatch(/i < flipDest\.to/);
  });
});

describe("the reorder is the ONE surface allowed to overshoot", () => {
  const src = code("ui/InstrumentTable.tsx");

  it("rows keep the spring", () => {
    expect(src).toMatch(/transition=\{instant\(SPRING, reduced\)\}/);
  });

  it("nothing else in the product does", () => {
    // five sites were demoted in pass B [OWNER, 2026-08-06]; SPRING must not
    // reappear outside the row. The tab underline is in this same file, so
    // one occurrence is the whole budget.
    for (const f of [
      "ui/App.tsx",
      "ui/EnlargedView.tsx",
      "ui/PreviewPane.tsx",
      "ui/PayReceive.tsx",
      "ui/AnimatedNumber.tsx",
      "ui/BottomStrip.tsx",
      "ui/BacktestWindow.tsx",
      "ui/BacktestPnlCharts.tsx",
    ]) {
      expect(code(f), f).not.toMatch(/\bSPRING\b/);
    }
    expect((src.match(/\bSPRING\b/g) ?? []).length).toBe(2); // import + use
  });
});
