/* Guard: the table's column grid is format-derived and frozen (grid session,
 * Pass A). Widths come from each column's widest possible RENDERING, never
 * from today's data, so the grid is identical across tabs, sorts, and filters
 * — the header must never move. One template string is shared by the header
 * row and every body row so the two cannot drift apart. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fmtDelta, fmtLevel } from "../src/lib/format";
import {
  ALL_COLUMNS,
  colPx,
  GRID_TEMPLATE,
  gridTemplate,
  ONE_LINER_MIN_PX,
  visibleColumns,
  WIDEST,
} from "../src/ui/columns";
import { traderName } from "../src/ui/rows";

describe("column widths derive from the format, not the data", () => {
  it("the template is a constant built only from the WIDEST renderings", () => {
    const label = `calc(${WIDEST.label.length}ch + 30px)`;
    const level = `calc(${WIDEST.level.length}ch + 18px)`;
    const delta = `calc(${WIDEST.delta.length}ch + 18px)`;
    expect(GRID_TEMPLATE).toBe(
      `${label} ${level} repeat(5, ${delta}) minmax(${ONE_LINER_MIN_PX}px, 1fr)`,
    );
  });

  it("한 줄 is the only flexible track, floored so it never clips to zero", () => {
    expect(GRID_TEMPLATE.match(/1fr/g)).toHaveLength(1);
    // the floor (carry session, Pass D): a narrow viewport scrolls instead
    // of crushing the sentence flush against the card edge
    expect(ONE_LINER_MIN_PX).toBeGreaterThanOrEqual(80);
    expect(GRID_TEMPLATE.endsWith(`minmax(${ONE_LINER_MIN_PX}px, 1fr)`)).toBe(true);
  });
});

describe("the WIDEST templates actually cover the display grammar", () => {
  it("현재: all three unit grammars fit the level template", () => {
    // % level 4dp / bp level 1dp incl. sign / ratio 2dp
    for (const s of [fmtLevel(4.2446, "%"), fmtLevel(-100.5, "bp"), fmtLevel(12.0, "ratio")]) {
      expect(s.length).toBeLessThanOrEqual(WIDEST.level.length);
    }
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
  const src = readFileSync(
    join(__dirname, "..", "src", "ui", "InstrumentTable.tsx"),
    "utf8",
  );

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

  function widthFor(nBases: number, oneLiner: boolean): number {
    return (
      w.label + w.level + nBases * w.delta + (oneLiner ? ONE_LINER_MIN_PX : 0)
    );
  }

  it("the visible set is always a prefix of the ladder", () => {
    for (let n = 0; n <= 5; n++) {
      const v = visibleColumns(widthFor(n, false) + 1, CH, null);
      // exactly the first n ladder entries are visible, regardless of order
      expect(new Set(v.bases)).toEqual(new Set(LADDER_IDS.slice(0, n)));
      expect(v.oneLiner).toBe(false);
      expect(v.hidden).toBe(5 - n + 1);
    }
    const all = visibleColumns(widthFor(5, true) + 1, CH, null);
    expect(all.bases).toEqual(["d1", "wtd", "mtd", "qtd", "ytd"]);
    expect(all.oneLiner).toBe(true);
    expect(all.hidden).toBe(0);
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
        w.label +
        w.level +
        v.bases.length * w.delta +
        (v.oneLiner ? ONE_LINER_MIN_PX : 0);
      expect(sum, `at ${px}px`).toBeLessThanOrEqual(Math.max(px, w.label + w.level));
    }
  });

  it("한 줄 is first to go and last to return", () => {
    // one px short of fitting 한 줄: all five bases visible, 한 줄 hidden
    const v = visibleColumns(widthFor(5, true) - 1, CH, null);
    expect(v.bases.length).toBe(5);
    expect(v.oneLiner).toBe(false);
    expect(v.hidden).toBe(1);
  });

  it("gridTemplate(ALL_COLUMNS) is the frozen full template", () => {
    expect(gridTemplate(ALL_COLUMNS)).toBe(GRID_TEMPLATE);
  });
});
