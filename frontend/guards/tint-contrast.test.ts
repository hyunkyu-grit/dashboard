/* Guard (§J): the own-history tint has two ceilings, and BOTH must stay legible
 * — a ceiling that passes in one context and fails in the other is the defect
 * class E1 just cleaned up. Checked here:
 *   1. Forward matrix — INK on the 0.45 graded tint of a direction hue ≥ 4.5:1.
 *   2. Change columns — the direction hue AS TEXT on a 0.12 tint of its OWN hue
 *      ≥ 4.5:1. (This is why alpha never touches the glyph and the column tint
 *      is capped low: a coloured number on a faint wash of its own colour must
 *      still clear the text floor.)
 * Hex is read from tokens.css. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COLUMN_TINT, MATRIX_FULL } from "../src/ui/tint";

const css = readFileSync(
  join(__dirname, "..", "src", "theme", "tokens.css"),
  "utf8",
);
const DARK_AT = css.indexOf('[data-theme="dark"]');
const lightBlock = css.slice(0, DARK_AT);
const darkBlock = css.slice(DARK_AT);

function hex(block: string, name: string): [number, number, number] {
  const m = block.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing ${name}`);
  const h = m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function chan(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function lum([r, g, b]: [number, number, number]): number {
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
function contrast(a: [number, number, number], b: [number, number, number]) {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
function blend(
  fg: [number, number, number],
  a: number,
  bg: [number, number, number],
): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(a * fg[i] + (1 - a) * bg[i])) as [number, number, number];
}

const themes: [string, string][] = [["light", lightBlock], ["dark", darkBlock]];
const dirs = ["--bw-up", "--bw-down"];

describe("matrix ceiling: ink stays ≥4.5:1 on the 0.45 graded tint (§J)", () => {
  for (const [name, block] of themes) {
    for (const dir of dirs) {
      it(`${name} ${dir}`, () => {
        const bg = blend(hex(block, dir), MATRIX_FULL, hex(block, "--bw-tile"));
        expect(contrast(hex(block, "--bw-ink"), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("column ceiling: direction text stays ≥4.5:1 on a 0.12 tint of its own hue (§J)", () => {
  for (const [name, block] of themes) {
    for (const dir of dirs) {
      it(`${name} ${dir}`, () => {
        const fg = hex(block, dir);
        const bg = blend(fg, COLUMN_TINT, hex(block, "--bw-tile"));
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
