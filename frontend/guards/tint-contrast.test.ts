/* Guard: the darkest grid tint (TINT_MAX% of a direction colour over the
 * surface) must still leave ink text at ≥4.5:1 (DESIGN §2, Session 13). A grid
 * cell shows an ink number on a tinted background; if the tint gets too strong
 * the number stops reading. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TINT_MAX } from "../src/ui/tint";

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
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
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
  return [0, 1, 2].map((i) => Math.round(a * fg[i] + (1 - a) * bg[i])) as [
    number,
    number,
    number,
  ];
}

const A = TINT_MAX / 100;

describe("ink stays ≥4.5:1 on the darkest grid tint (§2)", () => {
  it.each([
    ["light up", lightBlock, "--bw-up", "--bw-tile", "--bw-ink"],
    ["light down", lightBlock, "--bw-down", "--bw-tile", "--bw-ink"],
    ["dark up", darkBlock, "--bw-up", "--bw-tile", "--bw-ink"],
    ["dark down", darkBlock, "--bw-down", "--bw-tile", "--bw-ink"],
  ])("%s", (_name, block, dir, tile, ink) => {
    const bg = blend(hex(block, dir), A, hex(block, tile));
    expect(contrast(hex(block, ink), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
