/* Guard (§F): a horizontally-scrollable region must never hide content past its
 * clip boundary without a visible scroll affordance. The forward matrix was
 * clipping the 주요 포워드 block off the right edge and forcing blind horizontal
 * dragging.
 *
 * jsdom has no layout, so this is a source-scan (the project's guard style): the
 * matrix must (a) live in an `overflow-x-auto` container — a scrollbar is a
 * visible affordance, unlike `overflow-x-hidden` which clips silently — and
 * (b) sit beside the key-forward block in a `flex-wrap` row so that block wraps
 * BELOW rather than being clipped. It fires if either is reverted. */

import { describe, expect, it } from "vitest";

import { code, stripComments } from "./_source";

const matrix = code("wall/ForwardMatrix.tsx");
const table = code("ui/InstrumentTable.tsx");

describe("forward matrix has a visible scroll affordance, never a silent clip (§F)", () => {
  it("the matrix table sits in an overflow-x-auto container", () => {
    expect(matrix).toMatch(/overflow-x-auto/);
  });

  it("the matrix does not clip itself horizontally with overflow-x-hidden", () => {
    expect(matrix).not.toMatch(/overflow-x-hidden/);
  });

  it("the matrix + key-forward block wrap instead of clipping", () => {
    // the row holding <ForwardMatrix/> and <KeyForwardBlock/> must be flex-wrap
    const block = table.slice(
      table.indexOf("<ForwardMatrix"),
      table.indexOf("</div>", table.indexOf("<KeyForwardBlock")),
    );
    const container = table.slice(0, table.indexOf("<ForwardMatrix")).lastIndexOf("<div");
    const openTag = table.slice(container, table.indexOf("<ForwardMatrix"));
    expect(openTag, "matrix/key-block row must be flex-wrap").toMatch(/flex-wrap/);
    expect(block.length).toBeGreaterThan(0);
  });

  it("the pinned 시작/날짜 columns are sticky so scroll never loses identity", () => {
    expect(matrix).toMatch(/sticky left-0/);
    expect(matrix).toMatch(/sticky left-12/);
  });
});

/* AXIS RULE [OWNER, 2026-08-05 geometry pass] — this REPLACES the blanket
 * "no separator rules inside grids" of the carry session:
 *
 *   horizontal separation → hairline, permitted everywhere
 *   vertical separation   → radius and gap, never a line
 *
 * So the GLOBAL ban is vertical-only, and it is asserted below against both
 * grids (the forward matrix and the instrument table). The matrix additionally
 * keeps its HORIZONTAL ban as a local, stricter choice — permitted is not
 * mandatory, and the carry session removed year-boundary `border-t` rules that
 * had crept in and made the tinted field read as a spreadsheet. That defect is
 * the justification; the pin stays with it.
 *
 * The vertical regex is deliberately narrow (border-l / border-r / border-x /
 * divide-x). A bare `border` match would false-positive on ForwardMatrix's
 * live-quoted CELL cue — `border-edge-live` when live, `border-transparent`
 * otherwise — which is a property of ONE cell, not a rule between two. */
const VERTICAL_RULE = /\b(?:border-l|border-r|border-x|divide-x)\b/;

describe("no vertical divider reaches a grid (axis rule, 2026-08-05)", () => {
  for (const [name, src] of [["forward matrix", matrix], ["instrument table", table]] as const) {
    it(`${name} carries no vertical rule`, () => {
      const hit = stripComments(src)
        .split("\n")
        .map((l, i) => [i + 1, l] as const)
        .filter(([, l]) => VERTICAL_RULE.test(l))
        .map(([n, l]) => `${name}:${n}: ${l.trim()}`);
      expect(hit, hit.join("\n")).toEqual([]);
    });
  }

  it("the regex bites on a real vertical rule but not on the live-cell cue", () => {
    // if this ever inverts, the guard above is decoration
    expect(VERTICAL_RULE.test('className="border-r border-edge"')).toBe(true);
    expect(VERTICAL_RULE.test('className="divide-x divide-edge"')).toBe(true);
    expect(VERTICAL_RULE.test('cell.live ? "border-edge-live" : "border-transparent"')).toBe(false);
    // and horizontal rules are PERMITTED now — the regex must not catch them
    expect(VERTICAL_RULE.test('className="border-b border-edge"')).toBe(false);
    expect(VERTICAL_RULE.test('className="border-t-2 border-t-edge"')).toBe(false);
  });
});

describe("the matrix stays one continuous field horizontally too (carry Pass B, retained)", () => {
  /* Local and stricter than the global rule ON PURPOSE: horizontal hairlines
   * are permitted product-wide as of 2026-08-05, and the matrix declines them.
   * Cells share edges; the tint makes the shape; structure comes from the
   * pinned header and left columns. */
  it("no border-t/border-b row separators inside the matrix", () => {
    expect(matrix).not.toMatch(/border-t-|border-b-/);
  });
  it("the live-cell cue pair is still the only bordered thing", () => {
    expect(matrix).toMatch(/border-edge-live/);
    expect(matrix).toMatch(/border-transparent/);
  });
});
