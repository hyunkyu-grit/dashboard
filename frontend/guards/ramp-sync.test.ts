/* Guard: the time-basis ramp in tokens.css and ramp.ts must be identical.
 * tokens.css feeds DOM/SVG via CSS vars; ramp.ts feeds canvas-bound options
 * through the theme bridge. Divergence = two ramps on one wall.
 */

import { describe, expect, it } from "vitest";

import { css as cssOf } from "./_source";

import {
  EDGE_OPACITY,
  RAMP_OPACITY,
  RAMP_WIDTH,
  TIME_BASES,
} from "../src/theme/ramp";

const css = cssOf("theme/tokens.css");

const lightBlock = css.slice(0, css.indexOf('[data-theme="dark"]'));
const darkBlock = css.slice(css.indexOf('[data-theme="dark"]'));

function cssNumber(block: string, name: string): number {
  const m = block.match(new RegExp(`${name}:\\s*([0-9.]+);`));
  if (!m) throw new Error(`missing ${name} in tokens.css block`);
  return Number(m[1]);
}

/** color-mix(in srgb, var(--bw-ink) N%, transparent) → N/100 */
function edgeMixOpacity(block: string, cssVar: string): number {
  const line = block
    .split("\n")
    .find((l) => l.trimStart().startsWith(`${cssVar}:`));
  if (!line) throw new Error(`missing ${cssVar} in tokens.css block`);
  const m = line.match(/ink\)\s+([0-9.]+)%/);
  if (!m) throw new Error(`no ink % in ${cssVar}`);
  return Number(m[1]) / 100;
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

  // SVG paints hundreds of gridlines/markers, so edge opacities are read
  // from EDGE_OPACITY rather than resolved per element from the CSS var.
  it("edge opacities match the border color-mix percentages", () => {
    expect(edgeMixOpacity(lightBlock, "--bw-border")).toBe(
      EDGE_OPACITY.light.base,
    );
    expect(edgeMixOpacity(lightBlock, "--bw-border-live")).toBe(
      EDGE_OPACITY.light.live,
    );
    expect(edgeMixOpacity(darkBlock, "--bw-border")).toBe(
      EDGE_OPACITY.dark.base,
    );
    expect(edgeMixOpacity(darkBlock, "--bw-border-live")).toBe(
      EDGE_OPACITY.dark.live,
    );
  });
});
