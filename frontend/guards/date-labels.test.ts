/* Guard: date labels under the charts (dates session, Pass B). Orientation,
 * not an axis: 3–4 labels at ROUND boundaries, format follows the span
 * (years → year+month → month+day), and the strip carries no ticks or rule. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { dateLabels } from "../src/ui/timeAxis";

describe("label count and roundness by span", () => {
  it("a 10y span → 3–5 year labels at Jan 1, years alone", () => {
    const l = dateLabels("2016-07-28", "2026-07-24");
    expect(l.length).toBeGreaterThanOrEqual(3);
    expect(l.length).toBeLessThanOrEqual(5);
    for (const x of l) {
      expect(x.iso.endsWith("-01-01")).toBe(true);
      expect(x.text).toMatch(/^\d{4}년$/);
    }
  });

  it("a span inside a single year → month starts, year and month", () => {
    const l = dateLabels("2025-02-10", "2025-09-20");
    expect(l.length).toBeGreaterThanOrEqual(3);
    expect(l.length).toBeLessThanOrEqual(5);
    for (const x of l) {
      expect(x.iso.endsWith("-01")).toBe(true);
      expect(x.text).toMatch(/^2025년 \d{1,2}월$/);
    }
  });

  it("a few weeks → round days, month and day", () => {
    const l = dateLabels("2026-06-20", "2026-07-24");
    expect(l.length).toBeGreaterThanOrEqual(3);
    expect(l.length).toBeLessThanOrEqual(5);
    for (const x of l) {
      expect(x.text).toMatch(/^\d{1,2}월 \d{1,2}일$/);
      // round days only: 1/11/21 (10d stride) or the 5d ladder below it
      const day = Number(x.iso.slice(8));
      expect([1, 6, 11, 16, 21, 26]).toContain(day);
    }
  });

  it("labels ascend and stay inside the span", () => {
    const l = dateLabels("2019-03-05", "2024-11-30");
    const isos = l.map((x) => x.iso);
    expect([...isos].sort()).toEqual(isos);
    for (const s of isos) {
      expect(s >= "2019-03-05" && s <= "2024-11-30").toBe(true);
    }
  });

  it("degenerate spans yield no labels rather than junk", () => {
    expect(dateLabels("2026-01-01", "2026-01-01")).toEqual([]);
    expect(dateLabels("", "")).toEqual([]);
  });
});

describe("the strip is orientation, not an axis", () => {
  it("DetailChart hides LWC's own time axis and draws the strip", () => {
    const src = code("wall/DetailChart.tsx");
    expect(src).toMatch(/timeScale: \{ visible: false/);
    expect(src).toContain("dateLabels(");
  });
  it("PreviewChart draws labels from the same ladder", () => {
    const src = code("ui/PreviewChart.tsx");
    expect(src).toContain("dateLabels(");
  });
});
