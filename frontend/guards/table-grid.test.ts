/* Guard: the table's column grid is format-derived and frozen (grid session,
 * Pass A). Widths come from each column's widest possible RENDERING, never
 * from today's data, so the grid is identical across tabs, sorts, and filters
 * — the header must never move. One template string is shared by the header
 * row and every body row so the two cannot drift apart. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { fmtDelta, fmtLevel } from "../src/lib/format";
import {
  ALL_COLUMNS,
  colPx,
  GRID_TEMPLATE,
  gridTemplate,
  LEVEL_GLYPHS,
  RANGE_PAD,
  RANGE_SUBS,
  RANGE_TEMPLATE,
  visibleColumns,
  WIDEST,
} from "../src/ui/columns";
import { levelHeadText } from "../src/lib/format";
import { traderName } from "../src/ui/rows";

describe("column widths derive from the format, not the data", () => {
  const level = `calc(${LEVEL_GLYPHS}ch + 18px)`;
  const sub = `calc(${WIDEST.level.length}ch + ${RANGE_PAD}px)`;
  const range = `calc(${RANGE_SUBS * WIDEST.level.length}ch + ${
    RANGE_SUBS * RANGE_PAD
  }px)`;

  it("the template is a constant built only from the WIDEST renderings", () => {
    const label = `calc(${WIDEST.label.length}ch + 30px)`;
    const delta = `calc(${WIDEST.delta.length}ch + 18px)`;
    expect(GRID_TEMPLATE).toBe(
      `${label} ${level} repeat(5, ${delta}) minmax(${range}, 1fr)`,
    );
  });

  it("52주 is the only flexible track, floored so it never clips to zero", () => {
    expect(GRID_TEMPLATE.match(/1fr/g)).toHaveLength(1);
    expect(GRID_TEMPLATE.endsWith(`minmax(${range}, 1fr)`)).toBe(true);
  });

  it("the 52주 floor is THREE sub-columns — derived, not a magic number", () => {
    // pass L: the floor used to be a flat 120px sized for a sentence. It is
    // now the level glyph count times three, so it tracks any change to the
    // level grammar automatically. A hardcoded px floor here fails this.
    expect(range).not.toMatch(/\b120px\b/);
    for (const ch of [6.5, 7.74, 9]) {
      expect(colPx(ch).range).toBeCloseTo(RANGE_SUBS * colPx(ch).rangeSub, 10);
      // Same GLYPH count as a LEVEL VALUE; only the cushion differs, and only
      // because a Korean header label does not scale with `ch` (RANGE_PAD).
      //
      // Against WIDEST.level, NOT against the level COLUMN (pass M): that
      // column is now sized by its date header, and if this tracked the column
      // the three sub-columns would each grow by four glyphs to fit a header
      // they do not carry — ~90px of table width bought for nothing.
      const levelValue = WIDEST.level.length * ch + 18;
      expect(colPx(ch).rangeSub - levelValue).toBeCloseTo(RANGE_PAD - 18, 10);
      expect(colPx(ch).rangeSub).toBeLessThan(colPx(ch).level);
    }
  });

  it("the label cushion leaves real margin at every ch we render at", () => {
    // Measured live at 11px: the longest sub-label (52주 고점) is ~45px of
    // ink, and being Korean it does NOT shrink with ch. The content box is
    // 6ch + RANGE_PAD − pr-3(12). This is the assertion that stops the cushion
    // being "simplified" back to 현재's 18px, which leaves 7.7px at the runtime
    // ch and less than that on any narrower face — a clipped header label is
    // not something the rest of this file could catch.
    const LONGEST_LABEL_PX = 45;
    const PR3 = 12;
    for (const ch of [6.5, 7.74, 9]) {
      const room = colPx(ch).rangeSub - PR3;
      expect(room - LONGEST_LABEL_PX, `at ch ${ch}`).toBeGreaterThan(5);
    }
  });

  it("the sub-grid inside the cell is three fixed tracks then the slack", () => {
    // slack at the TRAILING edge: the column keeps absorbing leftover table
    // width while the three numbers stay put and stay aligned down the table
    expect(RANGE_TEMPLATE).toBe(`repeat(${RANGE_SUBS}, ${sub}) minmax(0, 1fr)`);
    expect(RANGE_TEMPLATE.match(/1fr/g)).toHaveLength(1);
    expect(RANGE_TEMPLATE.endsWith("minmax(0, 1fr)")).toBe(true);
  });
});

describe("the WIDEST templates actually cover the display grammar", () => {
  it("현재: all three unit grammars fit the level template", () => {
    // % level 4dp / bp level 1dp incl. sign / ratio 2dp
    for (const s of [fmtLevel(4.2446, "%"), fmtLevel(-100.5, "bp"), fmtLevel(12.0, "ratio")]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.level.length);
    }
  });

  it("the level track fits its HEADER too, which is the wider of the two", () => {
    // pass M: the header is the dataset's as-of date (10 glyphs), the values
    // are 6. A track sized to the values alone would clip the header, and
    // nothing else in this file would notice — the grid would still be
    // frozen and shared, just too narrow.
    expect(levelHeadText("2026-07-24")).toHaveLength(WIDEST.levelHead.length);
    expect(LEVEL_GLYPHS).toBeGreaterThanOrEqual(WIDEST.levelHead.length);
    expect(LEVEL_GLYPHS).toBeGreaterThanOrEqual(WIDEST.level.length);
    // and the fallback (a payload with no asof) is narrower than the date
    expect(levelHeadText(null).length).toBeLessThanOrEqual(LEVEL_GLYPHS);
  });

  it("change columns: bp and ratio deltas fit the delta template", () => {
    for (const s of [fmtDelta(-999.9, "bp"), fmtDelta(999.9, "%"), fmtDelta(-1.23, "ratio")]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.delta.length);
    }
  });

  it("종목: the longest producible identifiers fit the label template", () => {
    // the longest fly, the longest forward (start ON…5Y in 3M steps × tenor
    // 3M…5Y), and the longest outright/vol tenor
    for (const s of [traderName("1Y-1.5Y-10Y"), "1Y3Mx3M", "4Y9Mx5Y", "1.5Y"]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.label.length);
    }
  });
});

describe("one grid definition shared by header and body; stable gutter", () => {
  const src = code("ui/InstrumentTable.tsx");

  it("header row and body rows both use the ONE shared template", () => {
    const uses = src.match(/gridTemplateColumns: template/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/<table/);
    // both header and rows derive from the same computed `visible` set
    expect(src).toContain("visible.bases.map");
    expect((src.match(/visible\.bases\.map/g) ?? []).length).toBe(2);
  });

  it("the scroll container reserves a stable scrollbar gutter", () => {
    expect(src).toContain("[scrollbar-gutter:stable]");
  });

  it("no cell derives a width from content (no width styles outside the template)", () => {
    // the only width-bearing style in the table is the shared template
    expect(src).not.toMatch(/style=\{\{\s*width/);
  });
});

describe("the column priority ladder (columns session)", () => {
  const CH = 7.8; // a plausible 13px-font ch; the maths must hold for any
  const w = colPx(CH);
  const LADDER_IDS = ["d1", "ytd", "wtd", "mtd", "qtd"] as const;

  function widthFor(nBases: number, range52: boolean): number {
    return w.label + w.level + nBases * w.delta + (range52 ? w.range : 0);
  }

  it("the visible set is always a prefix of the ladder", () => {
    for (let n = 0; n <= 5; n++) {
      const v = visibleColumns(widthFor(n, false) + 1, CH, null);
      // exactly the first n ladder entries are visible, regardless of order
      expect(new Set(v.bases)).toEqual(new Set(LADDER_IDS.slice(0, n)));
      expect(v.range52).toBe(false);
      expect(v.hidden).toBe(5 - n + 1);
    }
    const all = visibleColumns(widthFor(5, true) + 1, CH, null);
    expect(all.bases).toEqual(["d1", "wtd", "mtd", "qtd", "ytd"]);
    expect(all.range52).toBe(true);
    expect(all.hidden).toBe(0);
  });

  it("the drop thresholds, recomputed for the 52주 cell (pass L)", () => {
    // The 606px 한 줄 threshold recorded in DESIGN was a stale constant the
    // moment the cell's content width changed. These are the live figures at
    // the MEASURED runtime ch (7.74px at 13px Pretendard — the columns
    // session's figure, not the 7.8 the arithmetic tests above use), in
    // TABLE-CONTENT px: the smallest container at which each column appears.
    const RUNTIME_CH = 7.74;
    const rw = colPx(RUNTIME_CH);
    const at = (n: number, r: boolean) =>
      Math.ceil(rw.label + rw.level + n * rw.delta + (r ? rw.range : 0));
    // Every figure moved +31px in pass M — the level column went from six
    // glyphs to ten so its header can be the data's date. Nothing else about
    // the ladder changed, which is why the whole set shifts by one column's
    // growth and the ORDER is untouched.
    expect(at(0, false)).toBe(196); // 종목 + 레벨 — the backstop pair
    expect(at(1, false)).toBe(260); // 어제
    expect(at(2, false)).toBe(324); // YTD
    expect(at(3, false)).toBe(389); // WTD
    expect(at(4, false)).toBe(453); // MTD
    expect(at(5, false)).toBe(518); // QTD
    expect(at(5, true)).toBe(729); // 52주 — was 698 before the date header
    // and the whole set genuinely needs MORE room than the sentence did, so
    // this is stated rather than assumed: 3 sub-columns > a 120px floor
    expect(at(5, true)).toBeGreaterThan(606);
  });

  it("the sorted column is NEVER dropped — it takes slot 3", () => {
    // width for exactly one change column: sorting by qtd forces qtd in
    const v = visibleColumns(widthFor(1, false) + 1, CH, "qtd");
    expect(v.bases).toEqual(["qtd"]);
    // and with two slots, the displaced ladder head (어제) returns next
    const v2 = visibleColumns(widthFor(2, false) + 1, CH, "qtd");
    expect(new Set(v2.bases)).toEqual(new Set(["d1", "qtd"]));
  });

  it("bases render in canonical display order, never ladder order", () => {
    const v = visibleColumns(widthFor(3, false) + 1, CH, null);
    // ladder admits d1, ytd, wtd — displayed as d1, wtd, ytd (canonical)
    expect(v.bases).toEqual(["d1", "wtd", "ytd"]);
  });

  it("the summed width of the visible set never exceeds the container", () => {
    for (let px = 60; px <= 900; px += 7) {
      const v = visibleColumns(px, CH, "mtd");
      const sum =
        w.label + w.level + v.bases.length * w.delta + (v.range52 ? w.range : 0);
      expect(sum, `at ${px}px`).toBeLessThanOrEqual(Math.max(px, w.label + w.level));
    }
  });

  it("52주 is first to go and last to return", () => {
    // one px short of fitting 52주: all five bases visible, 52주 hidden
    const v = visibleColumns(widthFor(5, true) - 1, CH, null);
    expect(v.bases.length).toBe(5);
    expect(v.range52).toBe(false);
    expect(v.hidden).toBe(1);
  });

  it("gridTemplate(ALL_COLUMNS) is the frozen full template", () => {
    expect(gridTemplate(ALL_COLUMNS)).toBe(GRID_TEMPLATE);
  });
});
