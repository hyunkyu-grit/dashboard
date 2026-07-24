/* Guard: every band data-line hue must clear 3:1 against its theme's tile
 * surface (§9). A future palette edit that drops a hue below legibility fails
 * here instead of shipping an invisible chart line. Hex is read from
 * tokens.css (the one allowlisted hex file), split into light/dark blocks. */

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

const BAND_VARS = [
  "--bw-hue-curve",
  "--bw-hue-vol",
  "--bw-hue-fwd",
  "--bw-hue-outright",
  "--bw-hue-spread",
];

function hex(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`missing ${name}`);
  return m[1];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relLuminance(h: string): number {
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrast(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-blend `fg` at opacity `a` over opaque `bg` (both #rrggbb). */
function blend(fg: string, a: number, bg: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const mix = (i: number) =>
    Math.round(a * ch(fg, i) + (1 - a) * ch(bg, i))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

const lightTile = hex(lightBlock, "--bw-tile");
const darkTile = hex(darkBlock, "--bw-tile");

describe("navy chart line clears contrast at every step it is used (§9)", () => {
  // Chart lines are navy (--bw-brand). Level 1–2 use two steps: Now at full
  // opacity, comparison basis at 45% (BASIS_SECONDARY_OPACITY in ramp.ts).
  const navyLight = hex(lightBlock, "--bw-brand");
  const navyDark = hex(darkBlock, "--bw-brand");

  it("Now line (full navy) clears 3:1 on both surfaces", () => {
    expect(contrast(navyLight, lightTile)).toBeGreaterThanOrEqual(3);
    expect(contrast(navyDark, darkTile)).toBeGreaterThanOrEqual(3);
  });

  // The 45% basis line is a deliberately de-emphasized secondary reference
  // (the Now line carries the essential info). It only needs to stay
  // distinguishable from the surface — floor 2:1, matching the owner's
  // "readability over contrast" ruling on the historical ramp (§9).
  it("basis line (45% navy) stays distinguishable (≥2:1) on both surfaces", () => {
    expect(contrast(blend(navyLight, 0.45, lightTile), lightTile))
      .toBeGreaterThanOrEqual(2);
    expect(contrast(blend(navyDark, 0.45, darkTile), darkTile))
      .toBeGreaterThanOrEqual(2);
  });
});

describe("direction colors clear 4.5:1 against their surface (§9)", () => {
  it("up (red) and down (blue) are legible as number text", () => {
    expect(contrast(hex(lightBlock, "--bw-up"), lightTile)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(lightBlock, "--bw-down"), lightTile)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(darkBlock, "--bw-up"), darkTile)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(darkBlock, "--bw-down"), darkTile)).toBeGreaterThanOrEqual(4.5);
  });
});

// The sub-palette stays defined; keep gating it so a future reuse is legible.
describe("sub-palette band hues clear 3:1 against the tile surface", () => {
  it.each(BAND_VARS)("%s — light on white tile", (v) => {
    expect(contrast(hex(lightBlock, v), lightTile)).toBeGreaterThanOrEqual(3);
  });

  it.each(BAND_VARS)("%s — dark on dark tile", (v) => {
    expect(contrast(hex(darkBlock, v), darkTile)).toBeGreaterThanOrEqual(3);
  });
});
