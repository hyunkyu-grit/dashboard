/* Guard: the data colours that actually ship must clear their legibility floor
 * against the surface they sit on (§9). Split by USAGE (§ Session 15 Pass E1):
 * a colour used as TEXT needs 4.5:1; a colour used only as a stroke or fill
 * needs 3:1. The old guard asserted only 3:1 for everything and so passed while
 * the up-red — used as change-number text — sat at 3.71:1 and was too light to
 * read. A guard that passes while the thing it guards is broken is worse than
 * no guard. Hex is read from tokens.css.
 *
 * Usage map:
 *   --bw-line  : chart stroke only        → graphical, 3:1
 *   --bw-up    : change-number TEXT        → text, 4.5:1
 *   --bw-down  : change-number TEXT        → text, 4.5:1
 * The direction colours are text on the tile (normal rows) and on the page
 * (the active/hover row background), so both light surfaces are checked. */

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

const TEXT_FLOOR = 4.5;
const GRAPHIC_FLOOR = 3;

const lightTile = hex(lightBlock, "--bw-tile");
const lightPage = hex(lightBlock, "--bw-page");
const darkTile = hex(darkBlock, "--bw-tile");
const darkPage = hex(darkBlock, "--bw-page");

describe("chart stroke clears the 3:1 graphical floor (§9)", () => {
  it("line-safe orange is not washed out on either surface", () => {
    expect(contrast(hex(lightBlock, "--bw-line"), lightTile)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    expect(contrast(hex(darkBlock, "--bw-line"), darkTile)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
  });
});

describe("direction colours clear the 4.5:1 TEXT floor on every surface they sit on", () => {
  // change-number text lands on the tile (rows) and the page (active/hover row)
  const cases: [string, string, string][] = [
    ["up", "--bw-up", "light"],
    ["down", "--bw-down", "light"],
    ["up", "--bw-up", "dark"],
    ["down", "--bw-down", "dark"],
  ];
  for (const [name, token, theme] of cases) {
    const block = theme === "light" ? lightBlock : darkBlock;
    const surfaces = theme === "light"
      ? { tile: lightTile, page: lightPage }
      : { tile: darkTile, page: darkPage };
    it(`${theme} ${name} is legible as text`, () => {
      expect(contrast(hex(block, token), surfaces.tile)).toBeGreaterThanOrEqual(TEXT_FLOOR);
      expect(contrast(hex(block, token), surfaces.page)).toBeGreaterThanOrEqual(TEXT_FLOOR);
    });
  }
});
