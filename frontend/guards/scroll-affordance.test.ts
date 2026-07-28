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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) =>
  readFileSync(join(__dirname, "..", "src", p), "utf8");

const matrix = src("wall/ForwardMatrix.tsx");
const table = src("ui/InstrumentTable.tsx");

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

describe("the grid is one continuous field — no separator rules inside it (carry Pass B)", () => {
  // No dedicated contiguity guard existed, so the rule lives here with the
  // matrix's other structural pins. Cells share edges; the tint makes the
  // shape; structure comes from the pinned header/left columns. The ONLY
  // border allowed is the live-quoted CELL cue (border-edge-live /
  // border-transparent pair) — a property of one cell, never a rule between
  // rows or columns.
  it("no border-t/border-b row separators inside the matrix", () => {
    expect(matrix).not.toMatch(/border-t-|border-b-/);
  });
  it("the live-cell cue pair is still the only bordered thing", () => {
    expect(matrix).toMatch(/border-edge-live/);
    expect(matrix).toMatch(/border-transparent/);
  });
});
