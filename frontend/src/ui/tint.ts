/* Directional background tint (DESIGN §9/§J). Red for up, blue for down; the
 * ALPHA carries own-history magnitude — how unusual a move is against that
 * series' own past, precomputed server-side as a percentile (§16). This
 * replaced the cross-sectional grid-max scale, which lit 96–99% of the forward
 * matrix (a big day made every cell a large fraction of that day's max).
 *
 * The change columns and the forward matrix diverge on HOW they mark magnitude,
 * because their text differs (§J / final §B):
 *
 *   - Change columns: the number is coloured TEXT at full strength. A fill
 *     behind it can NEVER work — it competes with the very contrast the guard
 *     protects, and the largest fill that keeps the text legible (0.04) is
 *     invisible (a ~4% red wash reads as near-white). So the outlier cue is NOT
 *     a fill: it is a
 *     leading-edge rule (`columnCue`), full-strength hue, off the glyph. The
 *     change columns carry NO background fill — do not re-add one.
 *   - Forward matrix: the number is INK, which tolerates depth, so the tint is
 *     a GRADED background wash — pct70 → floor, pct97 → the 0.45 ceiling.
 *
 * One property per cell (table cells, not SVG paint), so color-mix() is fine. */

import type { CSSProperties } from "react";

export const MATRIX_FLOOR = 0.06; // graded tint at pct70 (§J)
export const MATRIX_FULL = 0.45; // graded tint ceiling at pct97 (§J)
export const PCT_LO = 70; // below this the matrix cell is untinted
export const PCT_HI = 97; // outlier threshold / graded full point

function hue(up: boolean): string {
  return up ? "var(--bw-up)" : "var(--bw-down)";
}

function wash(alpha: number, up: boolean): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${hue(up)} ${(alpha * 100).toFixed(1)}%, transparent)`,
  };
}

/** Outlier cue for a change-column cell (final §B): pct ≥ 97 → a 3px
 * leading-edge rule in the direction hue, an inset shadow (no layout shift, off
 * the glyph so it never touches the number's contrast). Scannable down the
 * column; the number keeps its full-strength direction hue. NOT a fill. */
export function columnCue(pct: number | null, up: boolean): CSSProperties {
  if (pct == null || pct < PCT_HI) return {};
  return { boxShadow: `inset 3px 0 0 ${hue(up)}` };
}

/** Graded own-history tint for a forward-matrix cell (ink on tint): pct70 →
 * floor, pct97 → the 0.45 ceiling, below pct70 untinted (§J). */
export function matrixTint(pct: number | null, up: boolean): CSSProperties {
  if (pct == null || pct < PCT_LO) return {};
  const f = Math.min(1, (pct - PCT_LO) / (PCT_HI - PCT_LO));
  return wash(MATRIX_FLOOR + (MATRIX_FULL - MATRIX_FLOOR) * f, up);
}
