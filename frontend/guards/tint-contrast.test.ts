/* Guard (§J / final §B): the forward-matrix tint uses INK on a background wash,
 * so the darkest tint (0.45) must still leave ink ≥ 4.5:1.
 *
 * SCOPE NOTE — the CHANGE COLUMNS carry NO background fill, by design (final
 * §B). Their number is coloured TEXT at full strength; a fill behind it
 * competes with the very contrast this guard protects, and the largest fill
 * that keeps the text legible (~0.04) is invisible. The outlier cue there is a
 * leading-edge rule (`columnCue`), off the glyph, so there is no
 * text-on-own-hue-tint case to guard. Do NOT re-add a change-column fill and a
 * matching assertion — that was tried (0.12 → 0.04 → removed).
 *
 * Hex is read from tokens.css. */

import { describe, expect, it } from "vitest";

import { css as cssOf } from "./_source";

import { MATRIX_FULL } from "../src/ui/tint";

const css = cssOf("theme/tokens.css");
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

