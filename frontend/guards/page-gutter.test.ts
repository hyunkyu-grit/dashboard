/* Guard: ONE page gutter, used by every surface that reaches the window edge
 * (2026-07-31 — "모든 탭의 전반적인 맨 좌우 간격도 전체에 맞추기").
 *
 * The surfaces that touch the edge are not one element: the header band, the
 * tab strip, the table's scroll container, the preview pane and the bottom
 * strip each reach it independently. Four of them agreeing while the fifth
 * does not is invisible until the fifth is on screen beside the others — so
 * the constant is asserted rather than the pixel value.
 */

import { describe, expect, it } from "vitest";

import { code } from "./_source";
import { PAGE_R, PAGE_X, PAGE_X_PX } from "../src/ui/pageGutter";

const SURFACES = [
  "ui/App.tsx",
  "ui/InstrumentTable.tsx",
  "ui/BottomStrip.tsx",
] as const;

describe("the page gutter", () => {
  it("is a literal class, not one built at runtime", () => {
    /* Tailwind scans SOURCE TEXT. A class assembled at runtime — the first
     * attempt here was `PAGE_X.replace("px-", "pr-")` — names a rule that was
     * never generated, and the padding silently does not exist. Both edges get
     * their own spelled-out literal for that reason. */
    expect(PAGE_X).toBe("px-20");
    expect(PAGE_R).toBe("pr-20");
    const gutter = code("ui/pageGutter.ts");
    expect(gutter).not.toMatch(/\.replace\(/);
    expect(gutter).not.toMatch(/\$\{/);
  });

  it("the px number and the class agree", () => {
    // PANE_PAD does chart-width arithmetic in px and cannot read a class
    expect(PAGE_X_PX).toBe(Number(PAGE_X.split("-")[1]) * 4);
  });

  it("every edge-touching surface imports it", () => {
    for (const f of SURFACES) {
      expect(code(f), f).toMatch(/from "\.\/pageGutter"/);
    }
  });

  it("no edge surface still hard-codes the old 20px inset", () => {
    /* `px-5` was the app-wide inset before this: a card's padding applied to a
     * full-bleed surface. It survives INSIDE components (the bottom sheet, the
     * preview pane's interior edge); what must not survive is a top-level
     * horizontal padding on a surface that reaches the window. */
    expect(code("ui/App.tsx")).not.toMatch(/className="[^"]*\bpx-5\b/);
    expect(code("ui/InstrumentTable.tsx")).not.toMatch(/className="[^"]*\bpx-5\b/);
    expect(code("ui/BottomStrip.tsx")).not.toMatch(/className="[^"]*\bpx-3\b/);
  });

  it("the 전체 overview takes NO gutter — its own distribution supplies it", () => {
    /* `justify-evenly` splits the leftover into four equal gaps: edge, column,
     * column, edge. Container padding sits OUTSIDE the box those gaps are
     * computed in, so adding it would make the two outer margins wider than
     * the inner ones — the exact asymmetry `evenly` is there to remove. */
    const overview = code("ui/OverviewColumns.tsx");
    expect(overview).toContain("justify-evenly");
    expect(overview).not.toMatch(/PAGE_X/);
    // and the table's container applies the gutter only when NOT the overview
    expect(code("ui/InstrumentTable.tsx")).toMatch(
      /isOverview \? "flex flex-col" : `\$\{PAGE_X\}/,
    );
  });

  it("the scrollbar gutter is off on the overview and on for the table", () => {
    /* `scrollbar-gutter: stable` keeps the TABLE's grid width constant when a
     * filter crosses the overflow boundary. On the overview — a fixed set with
     * no filters and nothing to scroll — the 16px it reserves is blank space
     * that shows up as a wider RIGHT margin than left. */
    const table = code("ui/InstrumentTable.tsx");
    expect(table).toMatch(/isOverview \? "flex flex-col" : `.*scrollbar-gutter:stable/);
  });
});
