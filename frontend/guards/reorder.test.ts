/* Guard: row-reorder motion rules (motion session, Pass C). Reordering
 * animates only when it means "same view, new arrangement" (sort, screener),
 * is culled to the viewport's neighbourhood, and falls back to an instant
 * reorder above the row-count threshold. Transform-only FLIP — the rows'
 * layout prop is "position", asserted against the source. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import {
  FLIP_MAX_ROWS,
  FLIP_NEAR_SCREENS,
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
    expect(168).toBeLessThanOrEqual(FLIP_MAX_ROWS); // 포워드 tab animates, culled
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
});
