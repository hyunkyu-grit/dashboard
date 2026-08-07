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
 * Colours come from `_tokens.ts` — the third and last guard to stop keeping its
 * own copy. It used to read a literal `#rrggbb` out of a slice that ran to the
 * end of the file, which meant two defects sharing one line: the `prefers-
 * contrast: more` overrides were swallowed into the dark tier, and a token that
 * became an alias (`var(--bw-…)`) simply failed the hex match. Both are the
 * shared reader's problem now, and the tier list grew from two to four —
 * boost is a tier that reaches a screen, so it carries the same floor. */

import { describe, expect, it } from "vitest";

import { MATRIX_FULL } from "../src/ui/tint";

import { TEXT_FLOOR, TIERS, contrast, over, parse, resolve } from "./_tokens";

const dirs = ["--bw-up", "--bw-down"];

describe("matrix ceiling: ink stays ≥4.5:1 on the 0.45 graded tint (§J)", () => {
  for (const [name, scope] of TIERS) {
    for (const dir of dirs) {
      it(`${name} ${dir}`, () => {
        /* The tint is the direction hue painted at MATRIX_FULL over the tile —
         * the hue's own alpha is not in play, the grade is. */
        const [r, g, b] = parse(resolve(scope, dir));
        const bg = over([r, g, b, MATRIX_FULL], resolve(scope, "--bw-tile"));
        expect(contrast(resolve(scope, "--bw-ink"), bg)).toBeGreaterThanOrEqual(TEXT_FLOOR);
      });
    }
  }
});

