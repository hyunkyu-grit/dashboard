/* Time-basis ramp constants — design spec §9.
 *
 * Mirrors src/theme/tokens.css for consumers that cannot resolve CSS custom
 * properties (canvas-bound chart options). guards/ramp-sync.test.ts fails if
 * the two drift apart. DOM/SVG consumers should keep using the CSS vars.
 */

export const TIME_BASES = ["now", "d1", "wtd", "mtd", "qtd", "ytd"] as const;
export type TimeBasis = (typeof TIME_BASES)[number];

export const BASIS_LABELS: Record<TimeBasis, string> = {
  now: "Now",
  d1: "D-1",
  wtd: "WTD",
  mtd: "MTD",
  qtd: "QTD",
  ytd: "YTD",
};

export const RAMP_OPACITY: Record<"light" | "dark", Record<TimeBasis, number>> = {
  light: { now: 1, d1: 0.78, wtd: 0.6, mtd: 0.47, qtd: 0.36, ytd: 0.28 },
  dark: { now: 1, d1: 0.74, wtd: 0.56, mtd: 0.43, qtd: 0.32, ytd: 0.24 },
};

/** Border ink-opacities, mirroring the --bw-border/--bw-border-live
 * color-mix percentages in tokens.css. Used where a var() lookup would be
 * paid per element (SVG paints hundreds of gridlines/markers). */
export const EDGE_OPACITY: Record<"light" | "dark", { base: number; live: number }> = {
  light: { base: 0.12, live: 0.4 },
  dark: { base: 0.18, live: 0.55 },
};

export const RAMP_WIDTH: Record<TimeBasis, number> = {
  now: 2,
  d1: 1.5,
  wtd: 1.3,
  mtd: 1.1,
  qtd: 1,
  ytd: 1,
};
