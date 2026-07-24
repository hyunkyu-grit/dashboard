/* Directional background tint for GRID cells (DESIGN §2/§9, Session 13).
 *
 * Red for up, blue for down, alpha scaled by magnitude within the grid being
 * drawn. The number itself stays ink so it reads on the tint — that is what
 * makes a grid scannable (the eye reads the field of colour first). List
 * columns do NOT use this — a coloured number with nothing under it.
 *
 * Alpha ~8–45% of the direction colour; near-zero cells stay untinted (a
 * barely-there wash is worse than none). 45% keeps ink at ≥4.5:1 on both
 * surfaces (gated in tint-contrast.test.ts). One background property per cell —
 * table cells, not SVG paint, so a color-mix() var is fine here. */

import type { CSSProperties } from "react";

export const TINT_MIN = 8; // %
export const TINT_MAX = 45; // %
export const TINT_DEADZONE = 0.03; // fraction of gridMax that stays untinted

/** normalized magnitude → alpha percentage, or null if untinted */
export function tintAlphaPct(
  delta: number | null,
  gridMax: number,
): number | null {
  if (delta == null || gridMax <= 0) return null;
  const mag = Math.abs(delta) / gridMax;
  if (mag < TINT_DEADZONE) return null;
  return Math.round(TINT_MIN + (TINT_MAX - TINT_MIN) * Math.min(1, mag));
}

/** inline background style for an HTML grid cell (forward matrix). */
export function tintStyle(delta: number | null, gridMax: number): CSSProperties {
  const pct = tintAlphaPct(delta, gridMax);
  if (pct == null) return {};
  const c = delta! > 0 ? "var(--bw-up)" : "var(--bw-down)";
  return { backgroundColor: `color-mix(in srgb, ${c} ${pct}%, transparent)` };
}

/** class + fillOpacity for an SVG grid cell (calendar heatmap), sharing the
 * exact same scale so a cell means the same everywhere. */
export function tintSvg(
  delta: number,
  gridMax: number,
): { cls: string; op: number } | null {
  const pct = tintAlphaPct(delta, gridMax);
  if (pct == null) return null;
  return { cls: delta > 0 ? "text-up" : "text-down", op: pct / 100 };
}
