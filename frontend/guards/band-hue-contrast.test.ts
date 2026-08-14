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
 * for the enumeration and why each one is in the list.
 *
 * THREE TIERS, not two [2026-08-07]. The file grew a `prefers-contrast: more`
 * block in the 2026-08-06 a11y pass and this guard never learned about it: it
 * sliced the dark theme as `css.slice(indexOf('[data-theme="dark"]'))`, which
 * runs to the END OF THE FILE and therefore swallowed the boost overrides, the
 * control ramp, and the second `:root`. That was harmless only while every
 * token resolved to a literal hex inside the first few lines of the slice. It
 * stopped being harmless when --bw-line became `var(--bw-accent-fg)`
 * [OWNER, 2026-08-07 — 오너가 목업으로 간다고 확정]: the alias hop landed in
 * the boost block and measured #854301 as if it were the dark theme's colour.
 *
 * So the blocks are cut on BRACE BALANCE now, and assembled the way the
 * cascade actually assembles them — every applicable block in source order,
 * last declaration wins. That reader lives in `_tokens.ts`, because the same
 * wrong slice had been written three times (here, palette, tint-contrast). */

import { describe, expect, it } from "vitest";

import {
  GRAPHIC_FLOOR,
  TEXT_FLOOR,
  TIERS,
  ratio,
  tier,
} from "./_tokens";

/* Every surface a direction figure is ever painted on, enumerated both ways
 * (consumers of bg-*, then consumers of text-up/text-down) in the 2026-08-05
 * surface pass. --bw-popover was MISSING from this guard while the backtest
 * window rendered text-up/text-down on it — the gap is why it is named here.
 *
 *   tile     : the app root (App.tsx) — every table row at rest, the header
 *              band, the bottom strip, both preview panes
 *   page     : the active/hover row (InstrumentTable, OverviewColumns) AND
 *              the hover fill of the chrome buttons that carry a Δ figure —
 *              BottomStrip Anchor, ChangeLog EventLine (RegretLab RegretLine
 *              was a third until Lab was emptied, 2026-08-14 — the surface
 *              enumeration is unchanged, one consumer fewer)
 *   popover  : the backtest window and both bottom sheets
 *
 * --bw-page therefore stays on the TEXT floor. A 2026-08-05 proposal to
 * reclassify it to GRAPHIC (3:1) was rejected on this evidence: direction
 * TEXT genuinely renders on it in five places, not zero. */
const SURFACES = ["--bw-tile", "--bw-page", "--bw-popover"] as const;

describe("chart stroke clears the 3:1 graphical floor (§9)", () => {
  /* Measured 2026-08-07 after the stroke moved to the accent foreground:
   *   light 4.53 tile / 4.26 page · dark 6.78 / 7.47
   *   boost 7.50 / 7.06          · boost dark 7.02 / 7.74
   * The FILL orange is 2.31:1 on white and would fail here — which is the
   * whole reason --bw-accent and --bw-accent-fg are two tokens. */
  for (const [name, scope] of TIERS) {
    it(`the chart stroke is not washed out on ${name}`, () => {
      expect(ratio(scope, "--bw-line", "--bw-tile")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      expect(ratio(scope, "--bw-line", "--bw-page")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
    });
  }

  // the reference hues [OWNER, 2026-08-04]: strokes only, so the 3:1 floor —
  // but they are drawn at partial opacity over the tile, so the SOLID token
  // must clear the floor with room, per theme, on both light surfaces
  for (const token of ["--bw-ref-cd", "--bw-ref-policy"]) {
    for (const [name, scope] of TIERS) {
      it(`${token} clears the stroke floor on ${name}`, () => {
        expect(ratio(scope, token, "--bw-tile")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
        expect(ratio(scope, token, "--bw-page")).toBeGreaterThanOrEqual(GRAPHIC_FLOOR);
      });
    }
  }
});

describe("direction colours clear the 4.5:1 TEXT floor on every surface they sit on", () => {
  for (const [name, scope] of TIERS) {
    for (const token of ["--bw-up", "--bw-down"]) {
      for (const surface of SURFACES) {
        it(`${name} ${token} is legible as text on ${surface}`, () => {
          expect(ratio(scope, token, surface)).toBeGreaterThanOrEqual(TEXT_FLOOR);
        });
      }
    }
  }
});

/* The switch must never make anything WORSE. This is the invariant the boost
 * block actually holds, and it is not the one its comment claimed: "AAA 7:1 on
 * every surface of its theme" is false on the dark popover (up 6.57, down
 * 6.52, line 6.39 — measured 2026-08-07), because the popover is the lightest
 * dark surface and the boost lightens the ink further. Every value does clear
 * its floor with room and every value does gain, which is what a request for
 * more contrast promises. Asserting monotonicity keeps the promise honest;
 * asserting 7:1 would have to be relaxed per surface to pass, and a floor with
 * exceptions stops being a floor. */
describe("prefers-contrast: more never lowers contrast (§9, 2026-08-06 a11y pass)", () => {
  const TOKENS = ["--bw-up", "--bw-down", "--bw-line", "--bw-ref-policy"];
  for (const theme of ["light", "dark"] as const) {
    const base = tier(theme);
    const more = tier(theme, true);
    for (const token of TOKENS) {
      for (const surface of SURFACES) {
        it(`${theme} ${token} gains on ${surface}`, () => {
          expect(ratio(more, token, surface)).toBeGreaterThan(ratio(base, token, surface));
        });
      }
    }
  }
});
