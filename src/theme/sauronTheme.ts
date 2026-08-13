import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';

import type { ThemeConfig } from '@coinbase/cds-web/core/theme';

/**
 * v2's theme, derived from CDS `defaultTheme`.
 *
 * It is deliberately a thin derivation right now. This spike has ONE independent
 * variable — the component layer — so the theme changes nothing about colour,
 * type or geometry yet. Density is *measured* in V2.7 and decided by the owner
 * later; surface tone, radius and hairline policy belong to the aesthetic
 * session (§2 of the session prompt), not here.
 *
 * The two direction hues are NOT in this object. They are in `direction.css`,
 * because CDS has no slot for "the two hues this product signs numbers with"
 * that does not already mean something else to CDS (`fgPositive`/`fgNegative`
 * carry the green-good/red-bad reading, which is inverted here).
 */
export const sauronTheme: ThemeConfig = {
  ...defaultTheme,
  id: 'sauron-v2',
};

/**
 * The surfaces v2 is allowed to paint, because they are the surfaces that can
 * hold the frozen direction pair at 4.5:1. `guards/contrast.test.ts` resolves
 * each out of the theme and measures both hues on it in both schemes; painting
 * anything outside this list fails that guard by design.
 *
 * ── MEASURED FINDING, 2026-08-13 (V1) ────────────────────────────────────────
 * `bgAlternate` and `bgSecondary` are BOTH rgb(238,240,243) in CDS light, and
 * the frozen hues do not clear the floor there:
 *
 *     up   #d92d3c on rgb(238,240,243) = 4.19:1
 *     down #0064ff on rgb(238,240,243) = 4.31:1
 *
 * Retuning the hue is forbidden (session prompt V1.3), so the surface goes
 * instead. Consequence for the component layer, and it is a real constraint on
 * V2: **v2 may not zebra-stripe table rows with `bgAlternate`.** Signed numbers
 * live on `bg` / `bgElevation1` / `bgElevation2` only. v1 stripes nothing and
 * separates rows with hairlines, so this costs nothing that v1 had.
 *
 * Both schemes clear the floor on all three surfaces below; the failure is
 * light-only.
 */
export const DIRECTION_SURFACES = ['bg', 'bgElevation1', 'bgElevation2'] as const;

/** Surfaces CDS offers that v2 has measured and rejected for direction text.
 * Named so the guard can assert they STILL fail — if CDS ever lightens them,
 * that is news, and news should arrive as a failing test rather than silence. */
export const REJECTED_FOR_DIRECTION = ['bgAlternate', 'bgSecondary'] as const;

export type DirectionSurface = (typeof DIRECTION_SURFACES)[number];

/**
 * A denser space scale, MEASURED but NOT SELECTED.
 *
 * V2.7 measures row height and hands the number to the owner; choosing a
 * density is a separate decision (§2). This exists so the third measurement in
 * that report is a real render rather than an extrapolation, and so the owner
 * can see what a custom scale buys over CDS `compact`.
 *
 * Only the small end moves. The large steps are page rhythm and have nothing to
 * do with a table row.
 */
export const sauronDenseTheme: ThemeConfig = {
  ...sauronTheme,
  id: 'sauron-v2-dense',
  space: {
    ...sauronTheme.space,
    '0.25': 1,
    '0.5': 2,
    '0.75': 3,
    '1': 4,
    '1.5': 6,
    '2': 8,
  },
};
