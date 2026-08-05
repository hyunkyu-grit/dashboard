/* Time-basis ramp constants — design spec §9.
 *
 * Mirrors src/theme/tokens.css for consumers that cannot resolve CSS custom
 * properties (canvas-bound chart options). guards/ramp-sync.test.ts fails if
 * the two drift apart. DOM/SVG consumers should keep using the CSS vars.
 */

export const TIME_BASES = ["now", "d1", "mtd", "ytd"] as const;
export type TimeBasis = (typeof TIME_BASES)[number];

export const BASIS_LABELS: Record<TimeBasis, string> = {
  now: "Now",
  d1: "D-1",
  mtd: "MTD",
  ytd: "YTD",
};

export const RAMP_OPACITY: Record<"light" | "dark", Record<TimeBasis, number>> = {
  // Four steps, not six (2026-07-31). The stops kept are the ones the old
  // ramp already used for these bases — the ramp was never re-spaced to
  // reclaim the gap, so a D-1 line looks exactly as it did and the guard
  // against tokens.css still has something to compare.
  light: { now: 1, d1: 0.78, mtd: 0.47, ytd: 0.28 },
  dark: { now: 1, d1: 0.74, mtd: 0.43, ytd: 0.24 },
};

/** Border ink-opacities, mirroring the --bw-border/--bw-border-live
 * color-mix percentages in tokens.css. Used where a var() lookup would be
 * paid per element (SVG paints hundreds of gridlines/markers). */
export const EDGE_OPACITY: Record<"light" | "dark", { base: number; live: number }> = {
  light: { base: 0.12, live: 0.4 },
  // dark softened 0.18/0.55 -> 0.16/0.50 with the surface pass (2026-08-05):
  // the page/card step went 2.99 -> 6.13 L*, so the hairline no longer carries
  // the boundary by itself. Mirrors tokens.css; ramp-sync fails on drift.
  dark: { base: 0.16, live: 0.5 },
};

/** Levels 1–2 draw only two lines (--bw-line since the palette cut): Now at
 * full opacity and the selected
 * comparison basis at this reduced opacity (§9, Session 12). The full
 * RAMP_OPACITY above lives only in the Level-3 detail sheet. */
export const BASIS_SECONDARY_OPACITY = 0.45;

export const RAMP_WIDTH: Record<TimeBasis, number> = {
  now: 2,
  d1: 1.5,
  mtd: 1.1,
  ytd: 1,
};
