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
 * The direction colours are text on all three surfaces — see SURFACES below
 * for the enumeration and why each one is in the list. */

import { describe, expect, it } from "vitest";

import { css as cssOf } from "./_source";

const css = cssOf("theme/tokens.css");
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

/* Every surface a direction figure is ever painted on, enumerated both ways
 * (consumers of bg-*, then consumers of text-up/text-down) in the 2026-08-05
 * surface pass. --bw-popover was MISSING from this guard while the backtest
 * window rendered text-up/text-down on it — the gap is why it is named here.
 *
 *   tile     : the app root (App.tsx) — every table row at rest, the header
 *              band, the bottom strip, both preview panes
 *   page     : the active/hover row (InstrumentTable, OverviewColumns) AND
 *              the hover fill of three chrome buttons that carry a Δ figure —
 *              BottomStrip Anchor, ChangeLog EventLine, RegretLab RegretLine
 *   popover  : the backtest window and both bottom sheets
 *
 * --bw-page therefore stays on the TEXT floor. A 2026-08-05 proposal to
 * reclassify it to GRAPHIC (3:1) was rejected on this evidence: direction
 * TEXT genuinely renders on it in five places, not zero. */
const SURFACES = ["--bw-tile", "--bw-page", "--bw-popover"] as const;

describe("chart stroke clears the 3:1 graphical floor (§9)", () => {
  it("chart-line blue is not washed out on either surface", () => {
    expect(contrast(hex(lightBlock, "--bw-line"), lightTile)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    expect(contrast(hex(darkBlock, "--bw-line"), darkTile)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
  });

  // the reference hues [OWNER, 2026-08-04]: strokes only, so the 3:1 floor —
  // but they are drawn at partial opacity over the tile, so the SOLID token
  // must clear the floor with room, per theme, on both light surfaces
  for (const token of ["--bw-ref-cd", "--bw-ref-policy"]) {
    it(`${token} clears the stroke floor in both themes`, () => {
      expect(contrast(hex(lightBlock, token), lightTile)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      expect(contrast(hex(lightBlock, token), lightPage)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      expect(contrast(hex(darkBlock, token), darkTile)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      expect(contrast(hex(darkBlock, token), darkPage)).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    });
  }
});

describe("direction colours clear the 4.5:1 TEXT floor on every surface they sit on", () => {
  const cases: [string, string, string][] = [
    ["up", "--bw-up", "light"],
    ["down", "--bw-down", "light"],
    ["up", "--bw-up", "dark"],
    ["down", "--bw-down", "dark"],
  ];
  for (const [name, token, theme] of cases) {
    const block = theme === "light" ? lightBlock : darkBlock;
    for (const surface of SURFACES) {
      it(`${theme} ${name} is legible as text on ${surface}`, () => {
        expect(
          contrast(hex(block, token), hex(block, surface)),
        ).toBeGreaterThanOrEqual(TEXT_FLOOR);
      });
    }
  }
});
