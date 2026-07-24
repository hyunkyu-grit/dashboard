/* Guard: the data colors that actually ship must clear their legibility floor
 * against the surface they sit on (§9, Session 12 list-first). A future palette
 * edit that drops one below the floor fails here.
 *
 * What ships on data: the line-safe orange chart stroke (graphical, 3:1 floor)
 * and the two direction colors (red up / blue down — used as small change-
 * number text and as mini-bar/heatmap marks). Hex is read from tokens.css. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(__dirname, "..", "src", "theme", "tokens.css"),
  "utf8",
);
const DARK_AT = css.indexOf('[data-theme="dark"]');
const lightBlock = css.slice(0, DARK_AT);
const darkBlock = css.slice(DARK_AT);

function hex(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}
function chan(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function relLum(h: string): number {
  return (
    0.2126 * chan(parseInt(h.slice(1, 3), 16)) +
    0.7152 * chan(parseInt(h.slice(3, 5), 16)) +
    0.0722 * chan(parseInt(h.slice(5, 7), 16))
  );
}
function contrast(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const lightTile = hex(lightBlock, "--bw-tile");
const darkTile = hex(darkBlock, "--bw-tile");

describe("line-safe orange clears 3:1 on both surfaces (§9)", () => {
  it("chart stroke is not washed out", () => {
    expect(contrast(hex(lightBlock, "--bw-line"), lightTile)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(darkBlock, "--bw-line"), darkTile)).toBeGreaterThanOrEqual(3);
  });
});

describe("direction colors are legible on both surfaces (§9)", () => {
  // Direction colors are used as small change-number text (4.5:1 ideal) and as
  // mini-bar/heatmap marks (3:1 graphical floor). Down and both dark variants
  // clear 4.5:1; up-light #f04452 is the owner-supplied Toss Red at 3.71:1 on
  // white — above the 3:1 mark floor, below the 4.5 text ideal, kept as brand
  // (see ## Provisional). All must clear the 3:1 graphical floor.
  it("every direction color clears the 3:1 mark floor", () => {
    expect(contrast(hex(lightBlock, "--bw-up"), lightTile)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(lightBlock, "--bw-down"), lightTile)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(darkBlock, "--bw-up"), darkTile)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(darkBlock, "--bw-down"), darkTile)).toBeGreaterThanOrEqual(3);
  });

  it("everything except owner-brand up-red clears the 4.5:1 text floor", () => {
    expect(contrast(hex(lightBlock, "--bw-down"), lightTile)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(darkBlock, "--bw-up"), darkTile)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(darkBlock, "--bw-down"), darkTile)).toBeGreaterThanOrEqual(4.5);
  });
});
