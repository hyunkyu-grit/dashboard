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

describe("band hues clear 3:1 against the tile surface", () => {
  const lightTile = hex(lightBlock, "--bw-tile");
  const darkTile = hex(darkBlock, "--bw-tile");

  it.each(BAND_VARS)("%s — light on white tile", (v) => {
    expect(contrast(hex(lightBlock, v), lightTile)).toBeGreaterThanOrEqual(3);
  });

  it.each(BAND_VARS)("%s — dark on dark tile", (v) => {
    expect(contrast(hex(darkBlock, v), darkTile)).toBeGreaterThanOrEqual(3);
  });
});
