/* Visible-window extremes (pass O, 2026-08-03).
 *
 * The high and the low OF WHAT IS PLOTTED — a property of the viewport, not
 * of the series. The 52-week statistics in the tooltip answer a different
 * question (a fixed trailing window, computed server-side); these answer
 * "where are the extremes of the picture in front of me", so they are
 * computed client-side from the plotted slice and move with it. They are
 * deliberately NOT in the payload: a payload field would be one window
 * baked for every reader, which is the opposite of a viewport property.
 *
 * ONE SCAN, TWO CONSUMERS. The chart's y-domain and the marked points both
 * come from this result, so the dot that claims "this is the high" is at the
 * exact value the domain was stretched to — they cannot disagree.
 *
 * Stated rules:
 *   TIES — the FIRST occurrence wins (strict comparisons). Two days printing
 *   the same extreme level mark the earlier one; a rule either way is fine,
 *   but it has to be one rule.
 *   FLAT WINDOW — every point equal means hi === lo === 0: the high IS the
 *   low, and both marks sit on the first point. The caller may treat the
 *   coincidence however it likes; this module reports the indices honestly.
 *   EMPTY — null. A window with nothing in it has no extremes.
 */

export interface WindowExtremes {
  /** index of the window's highest value (first occurrence) */
  hi: number;
  /** index of the window's lowest value (first occurrence) */
  lo: number;
}

export function windowExtremes(
  points: readonly { v: number }[],
): WindowExtremes | null {
  if (!points.length) return null;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < points.length; i++) {
    const v = points[i].v;
    if (v > points[hi].v) hi = i;
    if (v < points[lo].v) lo = i;
  }
  return { hi, lo };
}
