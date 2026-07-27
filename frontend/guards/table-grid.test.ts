/* Guard: the table's column grid is format-derived and frozen (grid session,
 * Pass A). Widths come from each column's widest possible RENDERING, never
 * from today's data, so the grid is identical across tabs, sorts, and filters
 * — the header must never move. One template string is shared by the header
 * row and every body row so the two cannot drift apart. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fmtDelta, fmtLevel } from "../src/lib/format";
import { GRID_TEMPLATE, WIDEST } from "../src/ui/columns";
import { traderName } from "../src/ui/rows";

describe("column widths derive from the format, not the data", () => {
  it("the template is a constant built only from the WIDEST renderings", () => {
    const label = `calc(${WIDEST.label.length}ch + 30px)`;
    const level = `calc(${WIDEST.level.length}ch + 18px)`;
    const delta = `calc(${WIDEST.delta.length}ch + 18px)`;
    expect(GRID_TEMPLATE).toBe(
      `${label} ${level} repeat(5, ${delta}) minmax(0, 1fr)`,
    );
  });

  it("한 줄 is the only flexible track", () => {
    expect(GRID_TEMPLATE.match(/1fr/g)).toHaveLength(1);
    expect(GRID_TEMPLATE.endsWith("minmax(0, 1fr)")).toBe(true);
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

  it("header row and body rows both use GRID_TEMPLATE (no second table)", () => {
    const uses = src.match(/gridTemplateColumns: GRID_TEMPLATE/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/<table/);
  });

  it("the scroll container reserves a stable scrollbar gutter", () => {
    expect(src).toContain("[scrollbar-gutter:stable]");
  });

  it("no cell derives a width from content (no width styles outside the template)", () => {
    // the only width-bearing style in the table is the shared template
    expect(src).not.toMatch(/style=\{\{\s*width/);
  });
});
