/* Directional background tint (DESIGN §9/§J). Red for up, blue for down; the
 * ALPHA carries own-history magnitude — how unusual a move is against that
 * series' own past, precomputed server-side as a percentile (§16). This
 * replaced the cross-sectional grid-max scale, which lit 96–99% of the forward
 * matrix (a big day made every cell a large fraction of that day's max).
 *
 * Two ceilings share the one own-history scale (§J):
 *
 *   - Change columns: the number is coloured TEXT at full strength, so alpha
 *     can only live on the CELL BACKGROUND, never the glyph (fading a 4.5:1 red
 *     toward the surface drops it below the text floor at once). The tint is
 *     BINARY — an outlier cell (pct ≥ 97) gets a faint 0.12 wash, nothing else.
 *   - Forward matrix: the number is INK, which tolerates depth, so the tint is
 *     GRADED — pct70 → floor, pct97 → the 0.45 ceiling.
 *
 * One property per cell (table cells, not SVG paint), so color-mix() is fine. */

import type { CSSProperties } from "react";

// Binary wash on an outlier change cell (§J). The prompt proposed 0.12, but the
// number sits ON this wash in the SAME hue, and a 0.12 wash drops the up-red
// (4.78:1 on white) to 3.99:1 — below the text floor. 0.04 is the measured
// ceiling that keeps the coloured number ≥4.5:1 (guarded); recorded in
// ## Provisional. Faint, but the coloured glyph is the primary cue; the wash
// only flags "look here".
export const COLUMN_TINT = 0.04;
export const MATRIX_FLOOR = 0.06; // graded tint at pct70 (§J)
export const MATRIX_FULL = 0.45; // graded tint ceiling at pct97 (§J)
export const PCT_LO = 70; // below this the matrix cell is untinted
export const PCT_HI = 97; // binary threshold / graded full point

function hue(up: boolean): string {
  return up ? "var(--bw-up)" : "var(--bw-down)";
}

function wash(alpha: number, up: boolean): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${hue(up)} ${(alpha * 100).toFixed(1)}%, transparent)`,
  };
}

/** Binary outlier wash for a change-column cell: pct ≥ 97 → 0.12 tint, else
 * none. The number keeps its full-strength direction hue (§J). */
export function columnTint(pct: number | null, up: boolean): CSSProperties {
  if (pct == null || pct < PCT_HI) return {};
  return wash(COLUMN_TINT, up);
}

/** Graded own-history tint for a forward-matrix cell (ink on tint): pct70 →
 * floor, pct97 → the 0.45 ceiling, below pct70 untinted (§J). */
export function matrixTint(pct: number | null, up: boolean): CSSProperties {
  if (pct == null || pct < PCT_LO) return {};
  const f = Math.min(1, (pct - PCT_LO) / (PCT_HI - PCT_LO));
  return wash(MATRIX_FLOOR + (MATRIX_FULL - MATRIX_FLOOR) * f, up);
}
