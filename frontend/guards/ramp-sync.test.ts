/* Guard: the time-basis ramp in tokens.css and ramp.ts must be identical.
 * tokens.css feeds DOM/SVG via CSS vars; ramp.ts feeds canvas-bound options
 * through the theme bridge. Divergence = two ramps on one wall.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RAMP_OPACITY, RAMP_WIDTH, TIME_BASES } from "../src/theme/ramp";

const css = readFileSync(
  join(__dirname, "..", "src", "theme", "tokens.css"),
  "utf8",
);

const lightBlock = css.slice(0, css.indexOf('[data-theme="dark"]'));
const darkBlock = css.slice(css.indexOf('[data-theme="dark"]'));

function cssNumber(block: string, name: string): number {
  const m = block.match(new RegExp(`${name}:\\s*([0-9.]+);`));
  if (!m) throw new Error(`missing ${name} in tokens.css block`);
  return Number(m[1]);
}

describe("ramp constants stay in sync with tokens.css", () => {
  it.each(TIME_BASES)("opacity + width for %s", (basis) => {
    expect(cssNumber(lightBlock, `--bw-ramp-${basis}`)).toBe(
      RAMP_OPACITY.light[basis],
    );
    expect(cssNumber(darkBlock, `--bw-ramp-${basis}`)).toBe(
      RAMP_OPACITY.dark[basis],
    );
    expect(cssNumber(lightBlock, `--bw-rampw-${basis}`)).toBe(
      RAMP_WIDTH[basis],
    );
  });
});
